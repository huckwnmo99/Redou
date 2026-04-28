# Fix: SRAG 통합 테스트 이슈 3건 (Orchestrator clarify 과다 / 한글 인코딩 깨짐 / Guardian 검증 실패)

> 유형: fix | 작성일: 2026-04-10 | 수정 완료: 2026-04-10

3건의 이슈가 모두 소규모 수정(프롬프트 변경 + 함수 1개 수정)이며, 수정 대상이 겹치므로 하나의 계획서로 통합한다.

---

## 이슈 A: Orchestrator clarify 과다 (5회 연속)

### 문제
- **증상**: 사용자가 "AC의 흡착량, 데이터 전부" → "모든 가스, 최대한 많은 조건" → "응 포함해" → "qe까지, 응" → "응 포함해, 너가 알아서 가독성있게" 까지 5회 clarify 후에야 generate_table 진행.
- **원인**: `ORCHESTRATOR_SYSTEM_PROMPT`의 두 가지 설계 문제:
  1. **줄 104**: `"첫 번째 메시지에서는 반드시 clarify를 선택하세요."` — **무조건 1회 clarify를 강제**. 사용자가 구체적인 요청을 해도 첫 턴은 반드시 clarify.
  2. **줄 109**: 사용자가 "다 해줘"라고 해도 `"2-3개 구체적 방향을 제안하세요"` — 또 clarify를 유도.
  3. **가드레일 부재**: 대화 히스토리에서 이전 clarify 횟수를 세거나, "N회 이상 clarify 했으면 진행하라"는 규칙이 없음.
  4. **코드 레벨 가드레일 없음**: `main.mjs`에서 plan.action === "clarify"일 때 무조건 수행. 히스토리의 assistant clarify 횟수를 체크하지 않음.
- **근거**: `llm-orchestrator.mjs:94~111` — ORCHESTRATOR_SYSTEM_PROMPT, `main.mjs:3430~3451` — clarify 핸들링

### 수정 방안

| 파일 | 수정 내용 |
|------|-----------|
| `apps/desktop/electron/llm-orchestrator.mjs:94~111` | 프롬프트 수정: (1) "첫 번째 메시지에서는 반드시 clarify" 삭제. 대신 "사용자 요청이 모호하면 clarify, 구체적이면 바로 generate_table" (2) 포괄적 답변("다 해줘") 시 "합리적인 기본값으로 generate_table 진행" 지침 추가 (3) "2회 이상 clarify를 했으면, 합리적인 가정을 세우고 generate_table로 진행하라" 가드레일 추가 |
| `apps/desktop/electron/main.mjs:3430~3451` | 코드 가드레일 추가: orchestrator 호출 전에 history에서 assistant clarify 메시지 수를 카운트. 3회 이상이면 `plan.action`을 강제로 `"generate_table"`로 변경하고, search_queries를 마지막 user 메시지 기반으로 자동 생성 (기존 폴백 로직 활용) |

### 영향 범위
- 수정 파일: 2개 (`llm-orchestrator.mjs`, `main.mjs`)
- 사이드 이펙트: clarify 횟수가 줄어들므로 테이블 품질이 약간 낮아질 수 있으나, 5회 clarify로 사용자 경험이 나빠지는 것보다 낫다.

### 검증 방법
- 채팅에서 "AC의 흡착량 데이터 정리해줘" → 1~2회 clarify 후 generate_table 진행 확인
- "모든 논문 흡착 파라미터 다 비교해줘" (포괄적 요청) → 최대 2회 clarify 후 진행 확인
- 매우 구체적 요청 "zeolite 13X의 CO2 흡착 등온선 파라미터, 온도별로 정리해줘" → clarify 없이 바로 generate_table 확인

---

## 이슈 B: LLM 한글 출력 인코딩 깨짐

### 문제
- **증상**: SRAG 추출에서 논문 5의 notes 필드가 `"蹂??쇰Ц?먯꽌 ?붽뎄?섎뒗..."` 등 깨진 한글.
- **원인**: **모델 + Ollama JSON format 모드의 한글 처리 문제**. 직접 테스트 결과:
  - `gemma4:31b`: JSON format 모드에서 긴 한글 생성 시 반복 글자 + 미종결 문자열 오류 발생 확인
  - `gpt-oss:120b`, `gpt-oss:20b`: 한글 JSON 정상 출력
  - `"蹂??쇰Ц..."` 패턴: EUC-KR/CP949 바이트가 UTF-8로 잘못 해석되는 전형적 증상. Ollama 또는 모델 토크나이저에서 발생.
- **결론**: 코드 버그가 아니라 **모델/Ollama 인프라 문제**. 코드에서 해결 가능한 실용적 방안은 notes를 영어로 작성하도록 프롬프트를 변경하는 것.
- **근거**: `llm-orchestrator.mjs:451~498` — EXTRACTION_AGENT_SYSTEM_PROMPT, 특히 줄 492 `"notes": "이 논문에서 압력은 보고되지 않음"` (한국어 예시)

### 수정 방안

| 파일 | 수정 내용 |
|------|-----------|
| `apps/desktop/electron/llm-orchestrator.mjs:451~498` | EXTRACTION_AGENT_SYSTEM_PROMPT 수정: (1) notes 필드 가이드에 `"notes는 반드시 영어로 작성하세요."` 추가 (2) 예시의 notes를 영어로 변경: `"notes": "Pressure data not reported in this paper"` (3) paper_title도 영어 논문 제목을 그대로 사용하도록 명시 |
| `apps/desktop/electron/llm-orchestrator.mjs:193~229` | TABLE_AGENT_SYSTEM_PROMPT도 동일하게 notes 영어 작성 지침 추가 (single-call fallback에도 적용) |

### 영향 범위
- 수정 파일: 1개 (`llm-orchestrator.mjs`)
- 사이드 이펙트: notes가 영어로 출력되므로 한국어 사용자에게는 약간 불편할 수 있으나, 깨진 한글보다 영어가 낫다. 프론트엔드에서 notes는 보조 정보이므로 영향 최소.

### 검증 방법
- SRAG 추출 실행 후 notes 필드가 영어로 정상 출력되는지 확인
- 특히 gemma4:31b 모델에서 notes가 깨지지 않는지 확인

---

## 이슈 C: Guardian 검증 0/42

### 문제
- **증상**: `[Chat] Verification done: 0/42 verified` — 42개 셀 검증 중 0개 통과.
- **원인**: `checkGroundedness()` 함수가 **Ollama에서 지원하지 않는 API 프로토콜을 사용**하고 있다.
  - 현재 코드 (`llm-chat.mjs:90~119`):
    ```js
    body: JSON.stringify({
      model: GUARDIAN_MODEL,
      system: "groundedness",        // ← 최상위 system 필드
      messages: [
        { role: "context", content: sourceText },  // ← 커스텀 role
        { role: "assistant", content: claim },
      ],
    })
    ```
  - **`system` 최상위 필드**: Ollama `/api/chat`에서 `system`은 문자열로 전달되어 시스템 메시지로 사용되지만, granite3-guardian은 "groundedness"라는 한 단어만으로는 올바른 지시를 받지 못함.
  - **`role: "context"`**: Ollama는 표준 role (`system`, `user`, `assistant`)만 지원. `context`는 무시되거나 예측 불가능하게 처리됨.
  - **직접 테스트 결과**:
    - 기존 코드 방식 (`system: "groundedness"` + `role: "context"`): 소스에 없는 값도 "No" (grounded) 반환 → **Guardian이 사실상 비활성화 상태**
    - 올바른 방식 (`role: "system"` + `role: "user"`에 Context/Claim 구조화): 정상적으로 grounded/ungrounded 판별
  - **그러나 "0/42" 결과는 모두 "unverified"(= "Yes" = ungrounded)**: 이는 Guardian이 매번 "Yes"를 반환했다는 뜻. 테스트에서 확인한 패턴과 다소 불일치. 가능한 설명: (1) 실제 5회 배치 병렬 호출 시 Ollama가 불안정하게 동작, (2) 16000자 combinedSource가 너무 길어 Guardian이 컨텍스트를 제대로 처리하지 못함, (3) `role: "context"` 처리가 비결정적(때로는 "Yes", 때로는 "No" 무작위).
  - **핵심**: Ollama granite3-guardian에 맞는 올바른 API 호출 방식으로 전환 필요.
- **근거**: `llm-chat.mjs:90~119` — checkGroundedness 함수

### 수정 방안

| 파일 | 수정 내용 |
|------|-----------|
| `apps/desktop/electron/llm-chat.mjs:90~119` | `checkGroundedness()` 함수를 표준 Ollama `/api/chat` 프로토콜로 전환: (1) `system` 최상위 필드 제거, `role: "system"` 메시지로 변경. 내용: groundedness 체크 지침 (grounded면 "No", ungrounded면 "Yes" 반환) (2) `role: "context"` → `role: "user"`로 변경, 내용에 `"Context: {sourceText}\n\nClaim: {claim}"` 형식 사용 (3) 기존 응답 파싱 로직("no"로 시작하면 verified)은 유지 |
| `apps/desktop/electron/main.mjs:3847~3851` | `combinedSource` 길이 최적화: (1) figures의 `summary_text`(HTML)는 길이가 길므로 각 figure를 1000자로 제한 (2) chunks도 각 chunk를 800자로 제한 (3) 전체 길이를 12000자로 줄여서 Guardian 모델의 컨텍스트 윈도우에 여유 확보 |
| `apps/desktop/electron/main.mjs:3879` | claim 구성 개선: `"The value of ${header} is ${cleanValue}"` → 해당 행의 식별 열(Adsorbent, Gas 등) 정보를 포함하여 `"For [Adsorbent], the value of ${header} is ${cleanValue}"` 형태로 변경하면 Guardian이 더 정확히 검증 가능 |

### 영향 범위
- 수정 파일: 2개 (`llm-chat.mjs`, `main.mjs`)
- 사이드 이펙트: Guardian 검증 결과가 실질적으로 의미 있는 값으로 변경됨. 기존에는 사실상 비활성화 상태였으므로 부정적 사이드 이펙트 없음.

### 검증 방법
- 직접 `checkGroundedness` 테스트: 소스에 있는 값 → "verified", 없는 값 → "unverified" 반환 확인
- SRAG 테이블 생성 후 Guardian 검증 실행: 42개 중 합리적인 비율(30~40개)이 verified 되는지 확인
- 병렬 5개 배치에서 Ollama가 안정적으로 응답하는지 확인

---

## 전체 요약

| 이슈 | 근본 원인 | 수정 유형 | 수정 파일 |
|------|-----------|-----------|-----------|
| A: Orchestrator clarify 과다 | 프롬프트에 "반드시 clarify" 강제 + 가드레일 없음 | 프롬프트 수정 + 코드 가드레일 | `llm-orchestrator.mjs`, `main.mjs` |
| B: 한글 인코딩 깨짐 | 모델/Ollama의 한글 JSON 처리 문제 | 프롬프트에서 notes 영어 강제 | `llm-orchestrator.mjs` |
| C: Guardian 검증 0/42 | Ollama 비표준 API 프로토콜 사용 | API 호출 방식 표준화 | `llm-chat.mjs`, `main.mjs` |

- **총 수정 파일**: 3개 (`llm-orchestrator.mjs`, `llm-chat.mjs`, `main.mjs`)
- **DB 변경**: 없음
- **새 IPC 채널**: 없음
- **새 컴포넌트/모듈**: 없음
- **CURRENT_EXTRACTION_VERSION 범프**: 불필요

## 수정 순서 (권장)
1. 이슈 C (Guardian) — API 프로토콜 수정이 가장 독립적이고 검증이 쉬움
2. 이슈 B (한글 인코딩) — 프롬프트만 변경, 가장 간단
3. 이슈 A (Orchestrator clarify) — 프롬프트 + 코드 가드레일, 테스트에 대화가 필요
