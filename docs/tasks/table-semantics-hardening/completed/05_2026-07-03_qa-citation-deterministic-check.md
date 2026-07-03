# Phase 2-4 — QA 인용 결정적 검증 (좁게)

> 유형: feature (소규모 fix, 04 이후) | 상태: 계획 | 작성일: 2026-07-03 | 슬라이스: 05

## 개요

- **목적**: QA 답변의 `[N]` 인용에 대해 **코드로 결정적 검증**을 얹는다 — (1) 인용의 존재·범위(범위 밖 [N] 없음) (2) paperId 정합(인용 인덱스↔실제 근거 논문) (3) refNo 결정적 순서 부여(B-D3). 결과를 metadata에 기록한다.
- **왜**: 감사 B-D3 — QA `paperMetadata` 순서가 `[...new Set([...chunks.map, ...figures.map])]`(chunk 등장 순서)에 의존해 **비결정적**이다. LLM이 `[2]`를 썼는데 그 주장의 실제 근거가 `refList[0]`이면 오귀속인데, `formatSourceAttribution`(`llm-qa.mjs:121`)은 `idx < paperMetadata.length` **범위만** 검사하고 내용 정합을 확인하지 않는다(B-D2도 여기 걸림). table 파이프라인은 셀 [refNo]를 코드가 병합에서 부여하는 반면 QA는 LLM 자유 부여라 검증이 없다. 결정적 순서 + 범위·정합 코드 체크는 LLM 없이 가능하다.
- **범위**: (1) `paperMetadata` 결정적 순서 부여(B-D3) (2) `[N]` 인용 범위·존재 코드 검증 (3) 인용↔근거 paperId 정합 체크(각 인용 논문이 실제 RAG 근거에 있는지) (4) 검증 결과 metadata 기록. **소규모 fix**(04 분리 후 qa-pipeline.mjs 국소 수정).
- **제외**: **LLM groundedness 검증 보류**(명시) — "인용이 실제 주장을 뒷받침하는가"는 SCITAB급 난제라 이 슬라이스 밖. 여기서는 **코드로 확정 가능한 것만**(범위·존재·paperId 정합·순서). B-R2(스트리밍 실패 salvage)도 별도. **외부 라이브러리 0개**. DB·새 IPC·`CURRENT_EXTRACTION_VERSION` 무변경.

## 현재 동작 근거 (코드 실측)

- **paperMetadata 순서 비결정**: main.mjs QA 경로 `paperIds = [...new Set([...ragResults.chunks.map(c => c.paper_id), ...ragResults.figures.map(f => f.paper_id)])]`(2605-2608) → `.in("id", paperIds)` 조회(2609, **DB 반환 순서 미지정**). paperRefMap도 이 배열 순서(2619-2620). refList(프롬프트, `llm-qa.mjs:49-51`)도 동일 배열 → 내부 일관은 있으나 **실행 간 안정성 없음**(B-D3).
- **formatSourceAttribution 범위-only 검사**: `llm-qa.mjs:121-158` — `[N]`을 정규식으로 파싱, `idx = N-1`이 `[0, paperMetadata.length)`면 `referencedIndices`에 추가(128행). **인용이 그 논문 근거에서 실제 왔는지 확인 안 함.** `referencedPaperIds`(134-136)는 인용된 인덱스의 paperId를 정렬 매핑 — 범위만 통과하면 hallucinated 인용도 그대로.
- **04가 전제**: 이 로직은 04 슬라이스에서 `chat/qa-pipeline.mjs`로 옮겨진 뒤 수정하는 게 안전(테스트 가능). 04 미완이면 main.mjs 인라인 수정(가능하나 테스트 어려움).
- **RAG 근거 = 정합의 기준**: `ragResults.chunks`/`ragResults.figures`의 `paper_id` 집합이 "실제 근거가 있는 논문". 인용된 paperId가 이 집합에 있으면 정합, 없으면(범위는 맞아도) 근거 밖 인용 — 코드로 판정 가능.
- **metadata 저장 지점**: QA persist(main.mjs 2648-2652 / 04 후 qa-pipeline)에서 `source_chunk_ids`·`referenced_paper_ids`·`source_evidence_locations`를 이미 기록. 여기 `citationCheck` 키를 부가하면 됨(기존 JSONB).

## 설계

### DB 변경

**없음.** 검증 결과는 assistant 메시지의 `metadata`(기존 JSONB)에 `citationCheck` 키로 저장.

### Electron (Backend)

**신규 헬퍼** (`chat/qa-pipeline.mjs` 내부 또는 `llm-qa.mjs`에 export — 04의 모듈 경계 따름):

- `orderPaperMetadataDeterministic(paperMetadata, ragResults) → paperMetadata[]` — paperMetadata를 **결정적 순서**로 재정렬(B-D3). 기준: 각 논문의 **첫 등장 chunk의 rerank 순위**(ragResults.chunks 배열 인덱스, 없으면 figures 인덱스, 둘 다 없으면 paperId 사전순). 이 순서로 refNo 부여 → 실행 간 안정.
  - **호출 위치**: paperRefMap/refList 생성 **전**에 적용 → 프롬프트·인용·persist 전부 같은 결정적 순서 공유.
- `checkQaCitations(responseText, orderedPaperMetadata, ragResults) → { inRange, outOfRange[], grounded[], ungroundedRefs[], citationCount }`:
  - `[N]` 파싱(기존 정규식 재사용).
  - `outOfRange`: `N-1`이 `[0, len)` 밖인 인용 번호(존재하지 않는 [N]).
  - `grounded`/`ungroundedRefs`: 인용된 논문의 paperId가 `ragResults.chunks∪figures`의 paper_id 집합에 **있으면 grounded, 없으면 ungrounded**(범위는 맞지만 근거 밖).
  - `citationCount`: 총 인용 수.
  - **LLM 미사용** — 순수 코드.

**수정** `chat/qa-pipeline.mjs`(04 후) 또는 `main.mjs`(04 전):
- paperMetadata 로드 직후 `orderPaperMetadataDeterministic` 적용(paperRefMap·refList·formatSourceAttribution 모두 이 순서 사용).
- `formatSourceAttribution` 호출 후 `checkQaCitations` 실행.
- persist metadata에 `citationCheck: { citationCount, outOfRange, ungroundedRefs }` 추가.

> [가정 A] 결정적 순서 기준은 "첫 등장 chunk의 rerank 순위". ragResults.chunks는 이미 rerank된 순서(multi-query-rag)라 안정적 결정 기준. figures-only 논문은 figure 순위, 근거 없는(placeholder) 논문은 사전순 tiebreak.
> [가정 B] "grounded"의 정의는 **인용 논문이 RAG 근거 집합에 존재**(paperId 수준). 이건 "주장이 실제 뒷받침되는가"(LLM groundedness)가 **아님** — 그건 명시적 제외. 코드로 확정 가능한 약한 정합만.
> [가정 C] `checkQaCitations`는 **차단이 아니라 기록**. ungrounded 인용이 있어도 답변을 막지 않고 metadata에만 남김(향후 UI 경고 여지). 사용자 답변 흐름 무변경.

### Frontend

**최소/선택.** metadata.citationCheck를 렌더에 노출할지는 이 슬라이스의 핵심이 아님(기록이 우선). 최소 구현은 **백엔드 기록까지**. 노출한다면:
- `ChatMessageMetadata`(`types/chat.ts:33`)에 `citationCheck?: { citationCount: number; outOfRange: number[]; ungroundedRefs: number[] }` 추가(선택).
- QA 메시지 렌더 컴포넌트에서 `outOfRange`/`ungroundedRefs`가 있으면 작은 주의 문구(선택, 후속 가능).

## 작업 분해

`/develop` 또는 `/fix`(04 완료 후 소규모)가 실행한다.

1. [ ] **결정적 순서** — `orderPaperMetadataDeterministic`(첫 등장 chunk rerank 순위 기준). paperMetadata 로드 직후 적용해 refNo 안정화(B-D3).
2. [ ] **인용 체크** — `checkQaCitations`(범위·존재·paperId 정합, LLM 없음).
3. [ ] **배선** — qa-pipeline(04 후)에서 순서 적용 + 체크 실행 + persist metadata에 `citationCheck` 기록.
4. [ ] **테스트** — 순서 결정성(같은 입력 → 같은 refNo), 범위 밖 [N] 검출, 근거 밖 인용(paperId 부재) 검출, 정상 인용 통과. qa-pipeline.test.mjs(04 신설) 확장.
5. [ ] **프론트 타입**(선택) — `citationCheck` 타입 추가 시 any 0.

## 영향 범위

- 수정되는 기존 파일: `chat/qa-pipeline.mjs`(04 후) 또는 `main.mjs`(04 전) + (선택) `llm-qa.mjs`(헬퍼 export), (선택) `frontend/src/types/chat.ts`.
- 신규 파일: 없음(04의 qa-pipeline.test.mjs 확장).
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요**.
- DB 마이그레이션: **불필요**(metadata JSONB).
- 새 IPC 채널: **없음**.

## 리스크 & 대안

- **R-1 04 의존**: 04(QA 분리) 미완이면 이 수정을 main.mjs 인라인에 해야 해 테스트가 어려움. → **04 → 05 순서 고정**. 04 완료 후 착수.
- **R-2 결정적 순서가 인용 번호를 바꿈**: 순서 재정렬로 refNo가 기존과 달라져 "예전 대화"와 표기 불일치 가능 → **신규 대화부터 적용**(과거 대화 metadata 재작성 안 함). 프롬프트·인용·persist가 같은 순서라 대화 내부 일관은 유지.
- **R-3 grounded 정의 오해**: "grounded=RAG 근거에 paperId 존재"는 약한 정합(주장 검증 아님) → metadata 키 이름·문서에 "범위/존재/paperId 정합만, LLM groundedness 아님" 명시(가정 B).
- **R-4 차단 vs 기록**: ungrounded 인용을 차단하면 답변 UX 훼손 위험 → **기록만**(가정 C). 차단·UI 경고는 데이터 쌓인 뒤 별도.

## 가정 사항 (developer 확인/판단)

- [가정 A] 결정적 순서 = 첫 등장 chunk rerank 순위(figures/사전순 tiebreak).
- [가정 B] grounded = 인용 논문이 RAG 근거 집합에 존재(약한 정합). LLM groundedness 아님(제외).
- [가정 C] 검증은 기록만, 답변 차단 안 함.
- [가정 D] 신규 대화부터 적용(과거 metadata 재작성 없음).

## 검증 기준

1. `node --check`: 수정 .mjs 통과.
2. `node --test tests/*.test.mjs`: 기존 회귀 + 신규 순서 결정성·범위 밖·근거 밖·정상 케이스.
3. **결정성 실증**: 동일 ragResults·응답 텍스트 입력 → `orderPaperMetadataDeterministic`이 항상 같은 순서·refNo(테스트로 고정, B-D3 해소).
4. **정합 검출**: 범위 밖 [N]과 근거 밖 paperId 인용을 코드가 잡아 metadata에 기록. 정상 인용은 통과.
5. `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경.
6. harness 갱신: `detail/electron/llm.md`(QA 인용 결정적 검증 + refNo 순서) + `entity-graph.md` 또는 `rag-pipeline.md`(QA 순서 안정화) + `feature-status.md`(Q&A 파이프라인 행 보강) + `VERSION.md` 범프.

## 실행 순서 메모

**Phase 2의 4번**. **04(QA 분리) 이후 필수** — qa-pipeline.mjs가 있어야 국소·테스트 가능하게 얹힌다. 02·03(테이블)과 독립. 04 → 05 순서 고정. 규모는 04 이후라면 **소규모 fix**(국소 수정 + 테스트 확장).
