# Fix B-R1: 같은 대화 동시 전송 시 abort 레지스트리 붕괴

> 유형: fix | 작성일: 2026-07-03 | 완료: 2026-07-03 | 출처: pipeline-risk-audit B-R1 (P0)

## 문제
같은 conversationId로 동시에 `CHAT_SEND_MESSAGE`가 두 번 오면:
1. 요청2의 `chatAbortControllers.set(convId, B)`가 요청1의 컨트롤러 A를 덮어씀 → **요청1 abort 불능**.
2. 요청1이 먼저 끝나면 `finally`의 `delete(convId)`가 **아직 실행 중인 요청2의 엔트리 B를 삭제** → 요청2도 abort 불능.
3. 둘 다 완주 → 같은 대화에 assistant 메시지/테이블 **중복 영속화**.

## 원인 (수정 전 코드 앵커)
- `main.mjs:2436` — `chatAbortControllers` Map (convId → controller, 단일 키).
- `main.mjs:2696-2697` — `set(convId, abortController)` 무조건 덮어씀.
- `main.mjs:2755-2757` — `finally { chatAbortControllers.delete(convId) }` 소유 확인 없음.
- `main.mjs:2778-2782` — CHAT_ABORT: get → abort → delete.

## 수정 결과 (main.mjs 1파일, 4개 지점)

### 0. abort 컨트롤러 변수 호이스팅 (신규)
`main.mjs:2650` — 핸들러 최상단에 `let abortController = null;` 추가. finally에서 identity guard를 하려면 컨트롤러 참조가 try/catch/finally 전 스코프에서 필요. 기존 `const abortController = new AbortController()`(try 내부)는 finally 스코프 밖이라 TDZ/미참조 문제 → 상단 `let` 선언 후 할당(2705)으로 전환.

### 1. in-flight 가드 (거부 정책) — `main.mjs:2680-2686`
convId 확정 직후 · **사용자 메시지 insert(2689) 전** 지점:
```js
if (chatAbortControllers.has(convId)) {
  return { conversationId: convId, error: "A response is already being generated for this conversation." };
}
```
- 거부 시 **DB 기록 없음** + **이벤트 발신 없음**. try 블록 안이지만 **직접 return**이라 catch를 거치지 않음 → CHAT_ERROR emit·error 행 insert 모두 스킵. IPC 반환값만으로 거부.
- 반환 형태 `{ conversationId, error }`는 핸들러의 최종 에러 반환(공통 catch의 `return { conversationId: convId, error: err.message }`, 2763)과 **동일 형태** → frontend 기존 에러 경로가 그대로 처리(신규 계약 불필요).
- 신규 대화 경로(`!convId` 블록에서 방금 생성, 2658-2665)는 convId가 방금 만들어져 `has(convId)`가 항상 false → 가드가 자연스럽게 통과(충돌 불가).

### 2. finally 소유 확인 (identity guard) — `main.mjs:2764-2771`
```js
finally {
  if (abortController && chatAbortControllers.get(convId) === abortController) {
    chatAbortControllers.delete(convId);
  }
}
```
- 가드 거부(요청2)로 early return 시 `abortController`는 아직 null → `if` false → **요청1 엔트리 보존**(요청2의 finally가 요청1을 지우는 사고 차단).
- CHAT_ABORT가 A를 지운 뒤 재전송이 B를 set하고 나서 취소된 요청1의 finally가 늦게 실행되는 레이스 → `get(convId)`가 B ≠ A → **delete 스킵**(B 보존).

### 3. CHAT_ABORT는 무변경 — `main.mjs:2774-2797`
`get → abort → delete` 유지("취소 직후 재전송 허용"). 2번 identity guard와 조합:
- CHAT_ABORT의 delete는 A만 제거. 요청1 finally가 이후 오면 `get(convId)`는 undefined(재전송 없음) 또는 B(재전송) → 둘 다 ≠ A → delete 스킵. 이중 삭제·타 요청 엔트리 삭제 없음. **조합 안전 확인됨**.

## 영향 범위
- 1파일: `main.mjs` (CHAT_SEND_MESSAGE/CHAT_ABORT 범위). QA/table 두 분기 모두 같은 finally를 타므로 공통 적용.
- DB/IPC 채널/frontend/`CURRENT_EXTRACTION_VERSION` 무변경.
- 사용자 가시 변화: 진행 중 대화에 재전송하면 완료 전까지 거부(이전: 조용히 이중 실행 + 중복 답변).

## 착수 전 필수 확인 결과 (보고 항목)
- **초입 기존 검증 실패 반환 형태**: 초입(2666-2677)의 검증 실패는 `throw new Error(...)`로 공통 catch를 타 최종 `{ conversationId, error }`(2763)로 반환. 가드는 이 **최종 반환 형태에 맞추되**, catch가 하는 DB insert·CHAT_ERROR emit를 피하려고 catch를 거치지 않는 **직접 return**을 택함(slice가 요구한 "DB·이벤트 없음" 충족).
- **사용자 메시지 insert 지점**: `main.mjs:2689`(role:user). 가드(2684)는 그보다 **앞** — 확인됨.
- **신규 대화 생성 경로**: `!convId` 블록에서 convId 즉시 생성 → 가드 지점에서 `has(convId)` 항상 false → 자연 통과, 신규 대화가 거부되는 오탐 없음 — 확인됨.
- **에러 메시지 톤**: 기존 CHAT_ABORT의 영어 에러("Conversation is not available for this user.") 톤에 맞춰 영어 문장 채택.

## 검증
- `node --check apps/desktop/electron/main.mjs` — **통과**.
- 회귀 `node --test apps/desktop/tests/*.test.mjs` — **65건/14스위트 전부 통과**(수정 전후 동일, 회귀 없음).
- **단위 테스트 미추가 사유**: CHAT_SEND_MESSAGE/CHAT_ABORT 핸들러는 `main.mjs`에 `ipcMain.handle`로 인라인 등록되고 `main.mjs`에 **export가 전무**(grep 확인). `supabase` 싱글턴·`ipcMain`·`broadcastToWindows`에 강결합되어 A-R2와 동일하게 공개 진입점으로 격리 단위 테스트 불가. → 아래 수동 검증 절차로 대체.

### 수동 검증 절차 (3가지)
1. **테이블 생성 중 같은 대화 재전송 → 거부·중복 없음**: 테이블 모드로 메시지 전송(파이프라인 진행 중). 완료 전 같은 대화에 두 번째 전송 → 반환값이 `{ conversationId, error: "A response is already being generated…" }`. `chat_messages`에 두 번째 user 행 미insert, assistant/table 행 1세트만 영속화, CHAT_ERROR 이벤트 미수신.
2. **생성 중 abort → 즉시 중단**: 전송 진행 중 CHAT_ABORT 호출 → 스트리밍 즉시 중단(AbortError 경로), 엔트리 제거.
3. **abort 직후 재전송 → 정상 시작**: 2번 직후 같은 대화에 재전송 → 가드 통과(엔트리 없음), 정상 시작. 취소된 요청1의 finally가 늦게 와도 identity guard로 새 요청 엔트리 보존(늦은 finally가 abort 불능을 유발하지 않음).

## 가정 (검증 결과)
- [가정] frontend는 `{ conversationId, error }` 반환을 기존 에러 경로와 동일하게 처리한다 → 반환 형태가 공통 catch 반환(2763)과 문자열 필드까지 **동일 구조**임을 확인해 성립(신규 이벤트 계약 불필요, frontend 무변경).

## 미해결 (범위 밖)
- 감사 문서의 §"범위 밖 메모": frontend optimistic update가 중복 전송을 유발하면 B-R1을 악화시킬 수 있음(프론트 디바운스 확인)은 frontend 범위로 별도. 이번 백엔드 거부 가드는 프론트 디바운스 유무와 무관하게 서버측에서 중복 영속화를 차단.
