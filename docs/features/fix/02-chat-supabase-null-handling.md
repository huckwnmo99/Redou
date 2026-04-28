# Fix: chat 파이프라인 Supabase null 처리 및 query builder .catch() 오용

> 유형: fix | 작성일: 2026-04-10 | 수정 완료: 2026-04-10

## 문제

- **증상**: SRAG 통합 테스트 중 `chat:send-message` 호출 시 대화 생성/로드 단계에서 다음 3종 에러가 연쇄적으로 발생하고, error 로깅 로직 자체도 crash하여 원인이 숨겨진다.
  ```
  [Chat] CHAT_SEND_MESSAGE error: TypeError: Cannot read properties of null (reading 'id')
      at apps/desktop/electron/main.mjs:3326:21
  [Chat] CHAT_SEND_MESSAGE error: TypeError: Cannot read properties of null (reading 'scope_folder_id')
      at apps/desktop/electron/main.mjs:3329:34
  Error occurred in handler for 'chat:send-message': TypeError: supabase.from(...).insert(...).catch is not a function
      at apps/desktop/electron/main.mjs:3856:15
  ```
- **원인 추정**:
  1. **Null destructuring 버그** — `const { data } = await supabase....single()` 패턴에서 `error`를 버리고 `data`만 꺼낸 뒤 `data.id` / `data.scope_folder_id`를 곧바로 접근한다. RLS 위반, 유니크 제약 위반, 스키마 드리프트(SRAG용 migration 미적용 등) 중 어느 하나라도 발생하면 `data = null`이 되어 null 접근 TypeError로 throw.
  2. **supabase-js v2 query builder는 Promise가 아님** — PostgrestBuilder는 thenable이지만 `.catch()` 메서드가 존재하지 않는다. `supabase.from(...).insert(...).catch(() => {})`는 **await 하기 전에** `.catch`를 호출하므로 동기적으로 `TypeError: ... .catch is not a function` throw. 더구나 이 코드가 catch 블록 **내부**(원본 에러를 로깅하려는 곳)에 있어서, 원본 에러를 덮어쓰고 숨겨 버린다.
- **근거**:
  - `apps/desktop/electron/main.mjs:3321-3326` — 신규 대화 insert 후 `conv.id` 접근 (error 무시).
  - `apps/desktop/electron/main.mjs:3328-3331` — 기존 대화 select 후 `conv.scope_folder_id` / `conv.scope_all` / `conv.conversation_type` 접근 (error 무시, null 체크 없음).
  - `apps/desktop/electron/main.mjs:3850-3857` — catch 블록 내부에서 query builder에 `.catch(() => {})` 체인. query builder는 Promise가 아니라 thenable이므로 `.catch`가 undefined → 동기 throw로 원본 에러 은폐.
  - 동일한 "insert/select → `.single()` → data 곧바로 접근" 패턴이 같은 핸들러 내 여러 곳에 반복되어 있어 앞으로도 동일 장애가 재발할 위험이 있다 (3243, 3297, 3399, 3428, 3733, 3771 라인).

## 수정 방안

### 1) 공통 헬퍼 추가 (선택 — 파일 1개만 수정하므로 인라인 수정으로도 충분)

각 수정 지점에서 반복되는 로직을 줄이기 위해, `main.mjs` 상단(기존 유틸 함수들 근처)에 헬퍼를 한 번만 정의한 뒤 재사용한다. 인라인으로만 고쳐도 무방하지만, 같은 파이프라인 내 동일 패턴이 8곳이라 헬퍼 쪽이 훨씬 깔끔하다.

```js
// Supabase single() 결과를 throw-on-error로 강제. 호출 측에서 구조분해로 사용.
function unwrapSingle({ data, error }, label) {
  if (error) throw new Error(`[supabase] ${label}: ${error.message}`);
  if (!data) throw new Error(`[supabase] ${label}: no row returned`);
  return data;
}
```

### 2) `.single()` 호출 지점 전체를 안전화 (같은 파일, 같은 핸들러 내)

아래 8개 지점 모두 같은 규칙으로 수정한다:
- `const { data: X } = await supabase.<...>.single();` →
  `const X = unwrapSingle(await supabase.<...>.single(), "<짧은 레이블>");`
- 또는 인라인으로 `const { data: X, error: xErr } = await ...; if (xErr) throw xErr; if (!X) throw new Error("...");`

| 파일 | 라인 | 현재 코드 요지 | 수정 방향 |
|------|------|----------------|----------|
| `apps/desktop/electron/main.mjs` | 3243 | `{ data: errMsg } = insert no-data chat_messages .single()` (Q&A 분기) → `errMsg.id` 접근 | `unwrapSingle(..., "chat_messages insert (qa/no-data)")` |
| `apps/desktop/electron/main.mjs` | 3297 | `{ data: msg } = insert assistant chat_messages .single()` (Q&A 최종) → `msg.id` 접근 | `unwrapSingle(..., "chat_messages insert (qa/final)")` |
| `apps/desktop/electron/main.mjs` | 3321-3326 | `{ data: conv } = insert chat_conversations .single()` → `conv.id` 접근 | `unwrapSingle(..., "chat_conversations insert")` |
| `apps/desktop/electron/main.mjs` | 3328-3331 | `{ data: conv } = select chat_conversations .single()` → `conv.scope_folder_id` 등 접근 | `unwrapSingle(..., "chat_conversations load")` — `.single()` 대신 `.maybeSingle()` + null 체크 후 "존재하지 않는 대화" 에러 메시지로 변환 (사용자 친화적) |
| `apps/desktop/electron/main.mjs` | 3399 | `{ data: msg } = insert clarify chat_messages .single()` → `msg.id` 접근 | `unwrapSingle(..., "chat_messages insert (clarify)")` |
| `apps/desktop/electron/main.mjs` | 3428 | `{ data: errMsg } = insert no-data chat_messages .single()` (table 분기) | `unwrapSingle(..., "chat_messages insert (table/no-data)")` |
| `apps/desktop/electron/main.mjs` | 3733 | `{ data: msg } = insert table_report chat_messages .single()` → `msg.id` 접근 (여러 후속 사용) | `unwrapSingle(..., "chat_messages insert (table_report)")` |
| `apps/desktop/electron/main.mjs` | 3771 | `{ data: tableRow } = insert chat_generated_tables .single()` → `tableRow.id` 접근 | `unwrapSingle(..., "chat_generated_tables insert")` |

**참고 (수정 대상 아님)**:
- 1497, 1656, 1718, 3880 라인은 이미 `?.` 또는 `if (!x)` null 체크가 있으므로 변경 불필요.

### 3) Line 3856 — catch 블록 내부의 `.catch()` 체인 제거

```js
// Before (3850-3857)
if (convId) {
  await supabase.from("chat_messages").insert({
    conversation_id: convId,
    role: "assistant",
    content: err.message,
    message_type: "error",
  }).catch(() => {});
}
```

```js
// After
if (convId) {
  try {
    const { error: logErr } = await supabase.from("chat_messages").insert({
      conversation_id: convId,
      role: "assistant",
      content: err.message,
      message_type: "error",
    });
    if (logErr) console.warn("[Chat] failed to persist error message:", logErr.message);
  } catch (logCrash) {
    console.warn("[Chat] failed to persist error message (exception):", logCrash.message);
  }
}
```

- query builder에는 `.catch()`를 호출하지 않는다 (Promise 아님).
- try/catch로 감싸 error 로깅 자체가 핸들러를 crash 시키지 않도록 한다.
- `error` 필드도 함께 확인해 실패 시 warn 로깅 (silent swallow 지양).

## 영향 범위

- **수정 파일**: 1개 — `apps/desktop/electron/main.mjs`
- **DB 변경**: 없음
- **IPC 채널 변경**: 없음
- **프론트엔드 변경**: 없음 (기존 `{ conversationId, error }` 응답 계약 유지)
- **사이드 이펙트**:
  - 지금까지 조용히 null을 반환하며 crash하던 경로가 **명시적으로 에러 메시지와 함께 실패**한다. 사용자는 "대화를 생성할 수 없습니다" / "대화를 불러올 수 없습니다" 같은 에러 토스트를 받게 된다 (이전에는 stacktrace만 콘솔에 찍히고 채팅창이 멈췄음 → UX 개선).
  - catch 블록의 error 메시지 저장이 더 이상 원본 에러를 숨기지 않는다. 원본 stacktrace가 정상적으로 `console.error("[Chat] CHAT_SEND_MESSAGE error:", err)` (3847 라인)에 남아 디버깅이 쉬워진다.
  - SRAG 통합 테스트를 진행할 수 있게 되어, SRAG 관련 에러가 있다면 그것이 표면화된다 (지금은 이 3개 버그에 가려져 보이지 않음).

## 검증 방법

1. **문법 검사**:
   ```bash
   node --check apps/desktop/electron/main.mjs
   ```
2. **타입/빌드/린트** (`/test`가 자동 수행):
   ```bash
   cd frontend && npm run build && npm run lint
   cd apps/desktop && npm run build
   ```
3. **수동 시나리오**:
   - (a) **정상 경로**: Electron 실행 → 새 대화 생성 → 메시지 전송 → 신규 `convId`가 반환되고 chat_messages/chat_conversations에 row가 정상 insert 되는지 확인.
   - (b) **기존 대화 로드**: 기존 대화 선택 → 후속 메시지 전송 → `scope_folder_id`, `conversation_type`이 올바르게 로드되는지 확인.
   - (c) **에러 경로 (인위적 주입)**: 임시로 `convId = "00000000-0000-0000-0000-000000000000"`를 넘겨 존재하지 않는 대화를 로드하게 한 뒤, 핸들러가 **명확한 에러 메시지**("chat_conversations load: no row returned" 등)와 함께 실패하고 Electron main 프로세스가 crash하지 않는지 확인. 원본 에러가 `console.error`에 온전히 찍히는지 확인.
   - (d) **SRAG 통합 테스트 재개**: 이 fix merge 후 SRAG 통합 테스트를 다시 시도해 SRAG 자체 로직에 별도 이슈가 있는지 확인.
4. **회귀 확인**: `.single()` 사용처를 다시 grep하여 수정 지점 외에 동일 패턴이 남아 있지 않은지 확인.
   ```
   grep -n "\.single()" apps/desktop/electron/main.mjs
   ```

## 메모

- 이 fix는 SRAG 작업과 **독립적**이다. SRAG diff hunk(3010, 3571 부근)와 겹치지 않으며, 현재 working tree에 남아 있는 SRAG 미커밋 변경을 건드리지 않는다.
- `/fix`는 단일 파일 내 인라인 수정 방식으로 진행해도 무방하지만, 헬퍼(`unwrapSingle`)로 통합하는 편이 유지보수 측면에서 권장된다. 구현자 재량.
