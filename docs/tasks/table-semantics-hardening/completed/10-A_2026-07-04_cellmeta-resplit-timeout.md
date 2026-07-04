# 슬라이스 10-A — 측정 결손 핫픽스 2건 (cell_meta 붕괴 재분해 + per-paper 타임아웃 기본값)

> 유형: fix | 상태: 완료(fixer 2026-07-04) | 작성일: 2026-07-04
> 출처: `planned/10`(차순위 D-e/D-c/D-d)의 **축소 발동** — 08 상태 RUNS=3 측정이 특정한 결손 2건이 D-e/D-c/D-d가 아니라 계약 결손(cell_meta 붕괴 + 타임아웃)이어서 10을 10-A로 좁혀 실행. **D-e·D-c·D-d는 이번 라운드 보류(미착수)**, 10-A + 라운드 재측정 후 재판단.

> **구현 결과(fixer 2026-07-04)**: 3 프로덕션 파일(`chat/table-extraction.mjs`·`chat/table-pipeline.mjs`·`llm-orchestrator.mjs`) + 테스트 1(`tests/table-extraction.test.mjs`). **(1) cell_meta 정규화**: 신규 export `normalizeCellMeta`(순수 함수, `table-extraction.mjs`)가 `mergeExtractionResults`의 cell_meta 수용 루프(각 `cell_meta[col]` 객체를 `normalizedMeta`에 넣기 직전)에서 붕괴된 메타를 결정적으로 재분해 — `unit`/`condition`/`source_hint` 문자열이 **알려진 키 라벨(`unit:`/`condition:`/`source_hint:`/`source:`)로 시작**하면 그 라벨들로 세그먼트 분할해 각 필드로 재배치. 알려지지 않은 라벨(`pressure <=` 등)은 경계로 쓰지 않아 앞 세그먼트에 그대로 붙음(측정 조건 통째 보존). 정상 shape·라벨 없는 값(`"mmol/g"`, `"1:2"` 비율, JSON 파편 `"mmol/g} , 100 kPa"`)은 **무변경**(보수적). 재분해 필드는 그 필드가 비어 있을 때만 채움(정상 필드 무클로버). 실측 붕괴 문자열을 픽스처로 고정. **(2) 타임아웃 기본값**: `table-pipeline.mjs` `PER_PAPER_TIMEOUT_MS` 기본 240000→**300000**(fix 20 권장 상한 = 내부 ollamaSignal 300s 정합, 주석 갱신). env 오버라이드(`REDOU_PER_PAPER_TIMEOUT_MS`)·wrapper·AbortController 무변경. **(3) 프롬프트 보강(계획 범위 내 여유 항목)**: `EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 12에 "각 정보를 별도 키로, unit에 여러 정보를 뭉치지 말 것" 1줄 — 붕괴 빈도 자체 감소(정규화(1)와 이중 방어). **스테이지·LLM 호출 증가 0·외부 라이브러리 0·`CURRENT_EXTRACTION_VERSION`/DB/IPC/frontend 무변경**(채팅 경로, metadata JSONB 재사용). `node --test tests/*.test.mjs` **181/181**(기존 174 + 신규 7: normalizeCellMeta 순수 6 + merge→pivot 통합 1, 회귀 0). `node --check` 3 .mjs + 테스트 파일. env 시맨틱(미설정→300000·override→적용·invalid→300000 폴백) 확인. **커밋 금지(브랜치 `feature/table-quality-round`).** 13분 실 LLM after는 오케스트레이터 몫(라운드 재측정).

## 측정된 결손 (실데이터 근거)

1. **cell_meta 키 붕괴**: gemma가 일부 행에서 여러 메타를 unit 문자열에 뭉침(condition 필드 부재). **실증**(DB `chat_generated_tables.metadata->cellTuples`, 대화 `3dd8fbc5…` 계열):
   ```json
   {"unit": "unit: mmol/g, condition: at 293.15 K, pressure <= 1000 kPa", "confidence": "high", "source_hint": "Table 4 (p.7)"}
   ```
   결과: eval 오귀속 오판 + **09 조건 열 pivot 무력화**(condition 없어 파생 N/A) + D-f 범위 기록 소실. (두 번째 붕괴 형태 `"mmol/g} , 100 kPa"`도 DB에 실재하나 키 라벨이 없어 보수적으로 미재분해 — 값 열은 D4 밸리데이터가 계속 방어.)
2. **per-paper 타임아웃**: 08의 풍부한 출력(세트 전부 → 37행)이 240초를 초과해 런 2/3이 논문1 전체 실패("This operation was aborted"). fix 20이 명시한 권장 상한 = 300초(내부 ollamaSignal 정합).

## 구현 상세

### (1) cell_meta 정규화 — `normalizeCellMeta` (`chat/table-extraction.mjs`, 신규 export·순수 함수)
- **위치 선정(실사)**: cell_meta는 `mergeExtractionResults`의 per-row 루프에서 `dataRow.cell_meta` → `normalizedMeta`(정규화 컬럼키 맵)로 수용된 뒤, 셀별 tuple 생성 시 `meta.unit`/`meta.condition`/`meta.source_hint`로 읽힌다. **재분해 최적 지점 = `normalizedMeta.set(...)` 직전**(값 객체 `v` 하나당 1회) — 이후 tuple/충돌감지/pivot/eval 전부 정상 condition을 본다. `llm-orchestrator.mjs` 파싱부는 스키마 강제(format)만 하고 blob 내용을 모르므로 부적합 → merge 수용부가 정답.
- **알고리즘**(보수적, 결정적):
  - 알려진 키 = `unit`/`condition`/`source_hint`/`source`(source→source_hint 별칭).
  - `unit`/`condition`/`source_hint` 문자열 필드 각각에 대해, 값이 `^\s*(known label)\s*:`로 **시작**할 때만 붕괴로 판정(정상 값은 라벨로 시작 안 함 → 무변경).
  - 붕괴 시 전역 라벨 매처(`/(unit|condition|source_hint|source)\s*:/gi`)로 세그먼트 분할, 각 세그먼트를 해당 필드로. **알려지지 않은 라벨은 경계 아님** → `pressure <= 1000 kPa`는 앞 condition 세그먼트에 그대로 붙어 조건 통째 보존.
  - 재분해 대상 필드(그 blob의 필드)는 덮어쓰고, **다른 필드는 비어 있을 때만** 채움(이미 옳은 값 무클로버). 첫 라벨 우선(같은 키 중복 시 앞 승).
  - null/비객체 입력 무변경.
- **배선**: `for (const [k, v] of Object.entries(cellMeta))` 안 `normalizedMeta.set(normalizeColumnKey(k), normalizeCellMeta(v))`. 나머지 merge 로직 무변경.

### (2) per-paper 타임아웃 기본값 (`chat/table-pipeline.mjs`)
- `PER_PAPER_TIMEOUT_MS = parseInt(process.env.REDOU_PER_PAPER_TIMEOUT_MS, 10) || 300000`(240000→300000). 주석에 slice 10-A 근거(08 풍부한 출력 240s 초과 abort) + fix 20 권장 상한 명시. env 오버라이드·`setTimeout` 배선·AbortController·`NULL_RECOVERY_TIMEOUT_MS`(30000) 무변경.

### (3) 프롬프트 붕괴 방지 1줄 (`llm-orchestrator.mjs`, 계획 여유 항목)
- `EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 12 서브불릿 추가: "각 정보는 반드시 별도 키(unit/condition/source_hint)로 나눠 쓰고, unit에 'unit: …, condition: …'처럼 뭉치지 말 것." few-shot·스키마는 이미 올바른 키 형태라 무변경.

## 검증

- `node --check`: `table-extraction.mjs`·`table-pipeline.mjs`·`llm-orchestrator.mjs`·`tests/table-extraction.test.mjs` 전부 OK.
- `node --test tests/*.test.mjs`: **181 pass / 0 fail**(기존 174 + 신규 7).
  - 신규 `normalizeCellMeta` 6: 실측 붕괴 blob → unit/condition 재분해(pressure 세그먼트 보존) / 정상 shape 무변경 / 콜론 포함(1:2·12:30) 무변경 / 라벨 없는 파편 무변경 / condition-blob 분할 시 기존 source_hint 무클로버 / null·비객체 무변경.
  - 신규 merge→pivot 통합 1: 붕괴 unit blob 2행(조건 다름) → merge에서 condition 복원 → `detectConditionConflicts` 발동 → 09 pivot이 "측정 조건 (q_max)" 열 파생(계획 핵심 요구 "분해 후 condition으로 pivot·eval 정상 인식" 충족).
- env 시맨틱: 미설정→300000, `REDOU_PER_PAPER_TIMEOUT_MS=250000`→250000, invalid(`abc`)→300000 폴백.

## 제약 준수

- 브랜치 `feature/table-quality-round`, **git 커밋 안 함**.
- **스테이지·LLM 호출 추가 없음**(정규화=순수 코드, 타임아웃=값, 프롬프트=1줄).
- `scripts/e2e-table-fidelity.mjs`·fixture **미수정**(이번 슬라이스 범위 밖 — 건드리지 않음).
- `CURRENT_EXTRACTION_VERSION`/DB/IPC/frontend 무변경.

## 계획 대비 차이

- 정규화 지점을 `llm-orchestrator.mjs` 파싱부가 아니라 `table-extraction.mjs` merge 수용부로 선택(실사: 파싱부는 blob 내용을 모름, merge가 condition 소비 직전 지점).
- 두 번째 붕괴 형태(`"mmol/g} , 100 kPa"`, 키 라벨 없음)는 "알려진 키만, 보수적" 원칙대로 미재분해(값 열은 D4 밸리데이터가 계속 방어) — 테스트로 고정.
- 프롬프트 1줄(여유 항목)은 계획 "3) 여유 있으면" 범위 내 반영.

## 다음

- 오케스트레이터가 라운드 재측정(RUNS=3, gemma4:31b): 08·09·10-A after — cell_meta 붕괴 사라져 conditionConflicts/pivot 정상 발현 + 타임아웃 abort 감소로 논문 완주 + fabrication·misattribution 0 유지가 성공 기준.
- 재측정 결과에 따라 D-e/D-c/D-d 착수 여부 재판단(잔여 결손 없으면 미착수 종결).
- Phase 2·2.5 전체 `/test`→`/review`→PR(브랜치 `feature/table-quality-round`, 커밋은 사용자).
