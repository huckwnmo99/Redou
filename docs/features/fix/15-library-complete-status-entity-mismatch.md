# Fix: 라이브러리 "Complete" 상태와 실제 처리 상태 불일치 (entity 추출 미반영)

> 유형: fix | 작성일: 2026-05-27 | 작성: planner | 수정 완료: 2026-05-27 (옵션 A1, fixer)
> 대상 브랜치: `codex/rag-infra-extraction` (entity-graph 통합본) — **이 브랜치에서 작업**
> **후속(fix 16)**: 코드/테스트 변경은 그대로 유지(import+embedding 합성은 entity 정책과 독립적으로 옳음). 단 동기(자동 entity job의 "Complete" 불일치)는 fix 16의 opt-in 전환으로 흡수됨 — 토글 OFF(기본)면 자동 entity job 자체가 안 생겨 신규 import에서 불일치 미발생. 미커밋분은 fix 16 커밋에 동반.

## 문제

- **증상**: 라이브러리 카드가 논문을 "Complete"로 표시하는데, 실제로는 `extract_entities` job이 아직 running이거나 failed 상태다. 즉 카드의 완료 표시와 실제 처리 상태가 불일치한다.
- **원인(확정)**: 라이브러리 카드의 상태는 별도 컬럼이 아니라 **frontend가 `processing_jobs`에서 실시간 계산**하는데, 그 계산이 `import_pdf` job **하나만** 본다. embedding/entity job의 상태는 전혀 반영하지 않는다.
- **근거(코드)**: `frontend/src/lib/paperRepository/paperSignals.ts:18-23`

  ```ts
  supabase
    .from("processing_jobs")
    .select("paper_id, source_file_id, job_type, status, created_at")
    .eq("job_type", "import_pdf")   // ← import_pdf만 조회
    .order("created_at", { ascending: false }),
  ```

  이 결과가 `processingMap`(paper_id → {status})으로 만들어지고(`paperSignals.ts:42-56`), `rowToPaper`가 그대로 `paper.processingStatus`에 넣는다(`mappers.ts:316`). `ProcessingBadge`는 `succeeded` → "Complete"로 렌더한다(`ProcessingBadge.tsx:6`). 따라서 **import_pdf만 succeeded면 embedding/entity 상태와 무관하게 "Complete"** 가 된다.

- **근거(DB 실측, 2026-05-27 dev DB)**: 논문 4건 모두 `import_pdf` succeeded → 전부 "Complete"로 표시됨. 그러나:

  | paper | import_pdf | generate_embeddings | extract_entities | entity_version | 라이브러리 표시 |
  |-------|-----------|---------------------|------------------|----------------|----------------|
  | Adsorption equilibria... (7536d494) | succeeded | succeeded | succeeded | 2 | Complete ✔ 일치 |
  | Adsorption equilibria... (5e0f399d) | succeeded | succeeded | succeeded | 2 | Complete ✔ 일치 |
  | **Overview of CO Ad... (62fad6d4)** | succeeded | succeeded | **failed** | **0** | **Complete ✘ 불일치** |
  | Adsorptive removal... (685085c5) | succeeded | succeeded | succeeded | 2 | Complete ✔ 일치 |

  → paper `62fad6d4`는 entity 추출이 실패했고 `entity_extraction_version=0`인데도 라이브러리에서 "Complete"로 보인다. 사용자가 보고한 불일치의 실체.

- **부가 근거(사용자의 "column does not exist")**: `papers` 테이블에는 `processing_status` 컬럼이 없다(`20260309050635_initial_schema.sql` 확인). 상태는 컬럼이 아니라 frontend 계산값이므로 SQL에서 `processing_status`로 조회하면 실패한다. → "어디서 계산되는가"의 답은 `paperSignals.ts` 단일 지점.

### 보조 버그 (같은 원인 계열, 함께 수정 권장)

- **ProcessingView 라벨 누락**: `frontend/src/features/processing/ProcessingView.tsx:212`

  ```ts
  {job.job_type === "import_pdf" ? t("Import & Extract", ...) : t("Embeddings", ...)}
  ```

  삼항 연산자라 `extract_entities` job이 **"Embeddings"로 오표시**된다. (generate_embeddings도 entity도 모두 "Embeddings"가 됨)

- **ProcessingView dedup**: `ProcessingView.tsx:49-57`은 paper별 가장 최근 job 1개만 표시한다. entity job이 가장 최근이면 import/embedding 진행 이력이 가려진다. (의도된 단순화일 수 있으나 라벨 버그와 함께 보면 entity 단계가 사실상 모니터링에서 잘 안 보임)

## 설계 판단: 방향 (a) vs (b)

**질문**: "Complete"가 core 파이프라인만 의미하고 entity는 별도 보조 상태로 분리할 것인가(a), 아니면 "Complete"가 entity까지 포함하도록 확장할 것인가(b)?

**planner 권장: 방향 (a) — core "Complete" + entity는 별도 보조 상태.**

근거:
1. **graceful-degradation 설계와 정합**: entity 추출은 부가 기능이다. `entity-extractor.mjs` / `graph-search.mjs`는 entity가 없어도 논문 읽기·검색·노트·채팅이 동작하도록 설계됐고, embedding job은 entity 큐잉(`main.mjs:1441` `enqueueEntityExtractionIfNeeded`)이 실패해도 succeeded로 끝난다(큐잉 함수가 try/catch로 false 반환). 즉 코드 자체가 "entity는 core가 아니다"를 전제한다.
2. **실패가 사용을 막으면 안 됨**: 방향 (b)를 택하면 entity 추출 1건 실패(`62fad6d4`)가 논문을 영구히 "미완료"로 묶는다. 사용자는 정상적으로 읽을 수 있는 논문을 "실패"로 인식하게 되어 UX가 나빠진다. plan 11(entity graph) 설계 의도(부가 기능)에 반한다.
3. **재처리 의미 분리**: core 재처리는 `CURRENT_EXTRACTION_VERSION`(현재 25), entity 재처리는 `CURRENT_ENTITY_EXTRACTION_VERSION`(별도)로 이미 버전 축이 분리돼 있다. 상태 표시도 같은 축으로 분리하는 것이 일관적이다.

**방향 (b)를 굳이 택한다면**: "Complete"의 의미가 무거워지고, entity 실패/모델 미가용(Ollama 다운 등) 시 모든 논문이 "미완료"로 보이는 부작용이 있다. 부가 기능 장애가 core 경험을 깎는 구조라 비권장.

### extract_entities 실패의 상태 반영 (분석 4)

- entity job이 **failed** → core는 영향 없음. 카드의 메인 상태는 여전히 core 기준 "Complete" 유지(읽기 가능).
- entity 보조 상태만 "추출 실패"로 표시(또는 표시 안 함). 사용자가 원하면 재시도 가능하나, 재시도 UI는 본 fix 범위 밖(별도 백로그 권장).
- 핵심 원칙: **entity 실패는 core "Complete"를 뒤집지 않는다.**

## 수정 방안

방향 (a)를 두 단계 옵션으로 제시한다. **사용자가 옵션을 선택**한다.

### 옵션 A1 — 최소 수정 (core 정확화 + 보조 표시 없음)

core "Complete"가 import+embedding 둘 다 succeeded를 의미하도록 정확화하고, entity는 카드에 표시하지 않는다(현행처럼 조용히 백그라운드).

| 파일 | 수정 내용 |
|------|-----------|
| `frontend/src/lib/paperRepository/paperSignals.ts` | `processing_jobs` 조회에서 `.eq("job_type", "import_pdf")` 필터 제거 → `import_pdf` + `generate_embeddings` **둘 다** 로드. paper별로 두 core job을 합성해 status 도출: 하나라도 `failed`→failed, 하나라도 `running`→running, 둘 다 없으면 `queued`, **둘 다 succeeded일 때만** succeeded. `extract_entities`는 제외(필터 유지). `updatedAt`은 더 최근 job 기준. |
| `frontend/src/features/processing/ProcessingView.tsx:212` | job_type 라벨을 삼항 → 매핑 객체/스위치로 변경. `extract_entities` → "Entities/엔티티" 라벨 추가. (모니터링 화면이므로 entity job도 올바른 이름으로 표시) |

- 수정 파일: 2개
- 사이드 이펙트: `processingStatus`를 소비하는 모든 곳(`PaperCard`, `PaperListItem`, `PaperDetailView`, `RightInspector`)이 자동으로 정확해짐. 타입/매퍼 시그니처 변경 없음.
- 결과: paper `62fad6d4`는 여전히 "Complete"(core 기준 정상). entity 실패는 ProcessingView(처리 파이프라인 탭)에서만 보임. 라이브러리 카드는 변화 없이 정확해짐.

### 옵션 A2 — 보조 상태 표시 추가 (core "Complete" + "엔티티 추출 중/실패" 별도 뱃지)

A1에 더해, 카드에 entity 보조 상태를 작게 표시한다.

| 파일 | 수정 내용 |
|------|-----------|
| `paperSignals.ts` | A1 + `extract_entities` job도 별도로 로드해 paper별 `entityStatus`(queued/running/succeeded/failed) 맵 추가 반환 |
| `frontend/src/types/paper.ts` | `Paper`에 `entityStatus?: ProcessingJobStatus` 필드 추가 |
| `frontend/src/lib/paperRepository/mappers.ts` | `rowToPaper` 시그니처에 entity 맵 인자 추가, `paper.entityStatus` 매핑 |
| `frontend/src/lib/supabasePaperRepository.ts` | `fetchPaperSignals` 반환 구조 변경에 맞춰 `rowToPaper` 호출부(8곳) 인자 전달 |
| `frontend/src/components/ProcessingBadge.tsx` 또는 신규 작은 컴포넌트 | entity 보조 뱃지("Entities: extracting/failed") — running/failed일 때만 노출, succeeded면 숨김 |
| `PaperCard.tsx` (`:159` 부근) | core 뱃지 옆에 entity 보조 뱃지 조건부 렌더 |
| `ProcessingView.tsx:212` | A1과 동일 (entity 라벨) |

- 수정 파일: 6~7개
- 사이드 이펙트: `fetchPaperSignals`/`rowToPaper` 시그니처 변경 → 호출부 전수 갱신 필요(supabasePaperRepository.ts 8곳). 타입 변경.

## 영향 범위

- **DB 변경**: 없음 (`entity_extraction_version` 컬럼은 `20260423010000_add_entity_graph.sql`에 이미 존재, `job_type` enum에 `extract_entities` 이미 추가됨)
- **새 IPC**: 없음
- **CURRENT_EXTRACTION_VERSION 범프**: 불필요 (추출 로직 변경 아님, 표시 로직만)
- **DB 화이트리스트 변경**: 없음
- `processingStatus` 소비처(자동 영향): `PaperCard.tsx:159,172`, `PaperListItem.tsx:110`, `PaperDetailView.tsx:54,123`, `RightInspector.tsx:163,193,280`

## 규모 판단

- **옵션 A1 → 소규모 수정 (`/fix`)**: 2개 파일, DB/IPC/타입 변경 없음. 명확히 fix 범위.
- **옵션 A2 → 경계선 (6~7개 파일 + 타입 변경)**: fix 상한(1~5개)을 약간 초과. 타입·매퍼 시그니처 변경이 있으나 새 모듈/DB/IPC는 없음. `/fix`로도 가능하나 파일 수 기준상 `/develop`도 검토 가능.

**planner 권장: 옵션 A1으로 `/fix` 진행.** 근거:
- 사용자 보고의 핵심 불일치(="Complete"인데 안 끝남)는 A1이 정확히 해소한다. core 상태가 import+embedding을 정직하게 반영하게 되고, entity 실패는 더 이상 "Complete"로 위장되지 않는다(ProcessingView에서 올바른 라벨로 노출).
- entity 보조 뱃지(A2)는 "있으면 좋은" UX 향상이지 불일치 해소의 필수 요소가 아니다. 부가 기능 상태를 라이브러리 카드에 상시 노출하는 것이 오히려 시각적 노이즈가 될 수 있다.
- A2가 필요하다고 판단되면 별도 백로그/feature로 분리하는 편이 추적성이 좋다.

## 검증 방법

1. 수정 후 빌드/타입체크: `cd frontend && npm run build`, `npm run lint`
2. dev DB 기준 수동 확인:
   - paper `62fad6d4`(entity failed, embedding succeeded) → 카드가 **"Complete"** 유지 (core 정상). ProcessingView에서 해당 paper의 entity job이 "Failed" + "Entities" 라벨로 표시.
   - 정상 paper 3건 → 카드 "Complete" 유지.
   - (A2 채택 시) `62fad6d4` 카드에 entity 보조 뱃지("failed")가 추가로 보이는지 확인.
3. 회귀: 새 PDF 임포트 시 import 진행 중("Extracting") → embedding 진행 중("Extracting") → 둘 다 끝나면 "Complete"로 전이하는지(A1에서 embedding running이 이제 카드에 반영됨). 기존에는 import만 끝나면 바로 "Complete"였던 것과 달라진 정상 동작.

## 하네스 갱신 (수정 시 함께)

본 fix 진행 시 다음 하네스 정합성도 함께 보정 필요(현재 코드보다 하네스가 뒤처져 있음):
- `docs/harness/main/feature-status.md:61` — 엔티티 그래프가 "📋 계획됨"으로 표기돼 있으나 **실제 codex 브랜치에 통합·동작 중**(dev DB에 `extract_entities` job 실행 이력 존재). "✅ 구현됨"으로 갱신 + entity 처리 상태 표시 항목 추가.
- `docs/harness/main/flows.md` — PDF 임포트 흐름(섹션 1)에 embedding 완료 후 `extract_entities` 큐잉(`main.mjs:1441`) → `processEntityExtractionJob` 단계가 누락됨(`grep entity` 0건). 추가 필요.
- 본 계획서 작성 시점 기준 `docs/harness/detail/frontend/` 또는 `stores-queries.md`에 "라이브러리 카드 상태는 `paperSignals.ts`가 core job(import+embedding)에서 계산하며 entity는 보조 상태"임을 명시.

## 가정 사항

- **[가정]** core 파이프라인 = `import_pdf` + `generate_embeddings`. 이 둘이 끝나면 논문은 읽기/검색/노트/채팅에 완전히 사용 가능하다는 전제(코드상 embedding 완료 후 entity는 try/catch 비차단 큐잉이라는 점이 근거). 사용자 확인 시 정정 가능.
- **[가정]** 사용자가 보고한 "core(import+embedding)는 끝났다"는 인식은 맞지만, 현행 코드는 **embedding조차 카드 상태에 반영 안 함**(import_pdf만 봄). 따라서 A1은 단순히 entity 추가가 아니라 **embedding까지 정직하게 반영**하는 수정이다(현행 대비 카드가 더 정확해짐).
- **[가정]** ProcessingView dedup(최근 1건만 표시)은 의도된 단순화로 보고 본 fix에서 변경하지 않는다. 라벨 버그만 고친다. (전체 job 타임라인 표시는 별도 개선 사항)
- **[작업 위치 주의]** 이 버그가 있는 코드(entity-graph 통합본)는 `codex/rag-infra-extraction` 브랜치(메인 리포 `C:\Users\admin\Desktop\Server\Redou\V3`)에 있다. worktree `bold-hofstadter-a85d9f`(main 브랜치)에는 entity-graph 코드 자체가 없으므로, `/fix`는 반드시 **codex 브랜치**에서 수행해야 한다.
