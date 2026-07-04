# 슬라이스 10-B/C/D — 측정 잔여 결손 3건 (리서치 확정안)

> 유형: fix | 구현: fixer(Opus 4.8) 2026-07-05 | 검증: 오케스트레이터 독립 확인 (fixer 최종 보고는 전송 오류로 유실 — 코드·테스트로 완료 확정)

## 구현 확인 내역 (오케스트레이터 실사)

- **B 채점기 파생 열 크레딧** — `eval-runner.mjs:315-337`: conditionMixedColumns 열마다 `max(감지 여부, 파생 열 행별 채움율)`로 크레딧. `findDerivedConditionColumnIndex` + `derivedConditionFillRate` 신설. 빈 pivot=0점(느슨화 방지). 리서치 권장안(벤치마크의 cell-level 판정 정합) 그대로.
- **C 출력 다이어트** — `llm-orchestrator.mjs`: `resolveExtractNumPredict`(`REDOU_EXTRACT_NUM_PREDICT` env, invalid 폴백, HARD-stop 리스크 주석) + 추출 호출 options 배선(:643). 프롬프트 규칙 12를 "cell_meta는 parameter 열 + 비자명 조건만"으로 축소.
- **D 열 이름 사후 스냅** — ⚠️ **정정(2026-07-05 리뷰 발견)**: 신규 `chat/column-grounding.mjs`(순수 함수)와 단위 테스트까지만 구현됨. **`table-pipeline.mjs` 배선·`metadata.columnGrounding` persist·타입은 미완(데드코드)** — fixer 보고 유실 시 오케스트레이터 검증이 모듈 존재만 확인하고 배선을 놓침. 프로덕션에서 실행되지 않으므로 측정(72.1%)·동작 오염 없음. **배선은 다음 라운드 1번(MAPE 스펙 어휘 제약)과 함께 처리.**

## 검증 (오케스트레이터)

- `node --test tests/*.test.mjs` **188/188** (10-A 시점 181 + 신규 7, 회귀 0)
- frontend `tsc --noEmit` + `npm run build` 통과
- 프로덕션 제약 준수: 스테이지·LLM 호출 증가 0, `CURRENT_EXTRACTION_VERSION`/DB/IPC 무변경

## 남김

- frontend 미접지(grounded:false) 경고 배지 표시 — 후속 후보(metadata까지만 이번 범위).
- D-e/D-c/D-d 원계획 중 **D-c는 본 슬라이스 D로 흡수**, D-e(3d 예산)·D-d(quota floor)는 최종 측정 후 재판단.

## C 수정판 — cell_meta condition 필수화 (2026-07-05, fixer, 측정 회귀 즉응)

> 최종 측정(RUNS=3, 2026-07-05)에서 C의 프롬프트 헤지("condition이 자명하지 않을 때만")가 **역효과로 확정**되어 되돌린 외과수술. parameter-열-한정 다이어트(타임아웃 전멸의 본체)는 유지, condition 생략 규칙만 뒤집음.

### 측정 근거 (2026-07-05 최종 런)
- coverage `conditions: 0~1`(이전 6) — 조건 기록 소실 → `conditionConflicts=0` → 09 파생 열 0 → 오귀속 12~23(값은 정답인데 조건 딱지 부재).
- 반면 타임아웃 전멸은 **해결**(3런 완주, 논문1 38~50행, 검증 127~155 back-match) → parameter-열-한정 다이어트 자체는 유지 가치 확정.

### 수정 (외과수술, 1 프로덕션 파일 + 테스트 1)
`llm-orchestrator.mjs` `EXTRACTION_AGENT_SYSTEM_PROMPT` **규칙 12**(10-C가 좁힌 부분)만 수정:
- **유지**: cell_meta는 parameter 열에만(식별/조건/raw_data 열 생략 = 토큰 절감의 본체).
- **변경**: parameter 열 셀의 `condition`을 **필수화** — "자명하면 생략" 문구 삭제, "측정 조건 세트가 여러 개면 각 행이 어느 세트인지 명시, 하나뿐이면 그 조건을 그대로 기입, 비우거나 생략 금지"로 교체. `unit`·`source_hint`도 parameter 셀에 함께 유지(값 역매칭에 필요)로 명문화.
- **few-shot 정합**: 두 예시 행 모두 parameter 셀(`q_max`·`K_L`)의 cell_meta에 `condition` + `unit` + `source_hint` 항상 존재하도록 갱신(1행 `q_max`에 `condition:"at 303 K, <=100 kPa"` 추가, 2행 `K_L`에 `unit:"kPa⁻¹"` 추가).
- **미변경**: 규칙 4(D-f 범위 표기, 슬라이스 09)·B·D 무관 코드·다른 규칙 전부 무접촉.

### 자기 검증
- `node --check electron/llm-orchestrator.mjs` PASS.
- `node --test tests/*.test.mjs` **188/188**(회귀 0). 프롬프트 문자열 변경이라 **테스트 영향은 계약 검증 테스트 1건**(`table-extraction.test.mjs` "cell_meta ... slice 10-C")만 — 그 테스트가 삭제된 헤지 계약(`/자명하지 않을 때만/`)을 고정하고 있어 새 계약(condition 필수)으로 갱신: 헤지 문구 부재 assert + few-shot parameter 블록마다 `"condition":` 존재 assert 추가. 나머지 187건 무영향.

### 제약 준수
브랜치 `feature/table-quality-round` 유지, **git 커밋 없음**, 실 LLM E2E 미실행(재측정은 오케스트레이터 몫). 스테이지·LLM 호출 증가 0·외부 라이브러리 0·`CURRENT_EXTRACTION_VERSION`/DB/IPC/frontend 무변경.

## 최종 측정 (C 수정판 이후, RUNS=3, 2026-07-05) — 라운드 합격

- **중앙값 fidelity 72.1%** [41.9–72.1] (라운드 시작 41.9% → 72.1%)
- **misattribution 0·0·0** (직전 12~23 → 완전 복원) · fabrication 0 유지
- **conflictHandling 2/2 전 런 작동** (파생 열 + 행별 채움 크레딧) — 라운드 목표 축 달성
- 조건 coverage 6세트 회복, 타임아웃 전멸 유지(3런 완주, 검증 back-match ~100%)
- 잔여 천장(단일): 논문2 MAPE 8셀 — 스펙이 "R2"로 발명, D 스냅은 설계대로 교체 없이 grounded:false 플래그만. **다음 라운드 1번 후보 = 스펙 단계 후보 열명(원문 캡션·헤더 어휘) 제시(리서치 대안안)**. 잡히면 ~90% 사정권.
- D-e(3d 예산)·D-d(quota floor): 이번 측정에서 병목으로 미지목 → **미착수 종결**(재소환 조건: 다논문 스코프 실측에서 쏠림 재현 시).
