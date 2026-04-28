# Fix: 채팅 UI 텍스트 선택 불가 + 사용자 메시지 지연 표시

> 유형: fix | 작성일: 2026-04-10 | 수정 완료: 2026-04-10

## 문제 1 — 사용자 메시지 텍스트 선택/복사 불가

- **증상**: 채팅에서 사용자 본인의 메시지를 마우스로 드래그해서 선택/복사할 수 없음
- **원인 추정**: 두 가지 복합 원인
  1. 사용자 메시지 버블의 **`::selection` 색상 문제** — `tokens.css:77`의 `::selection { background: var(--color-accent-subtle) }` (`rgba(37, 99, 235, 0.12)`)가 사용자 버블 배경 `var(--color-accent)` (`#2563eb`)와 거의 동일해서, 텍스트를 선택해도 **선택 영역이 눈에 보이지 않음**
  2. 사용자 메시지 Content div에 `cursor: text`가 없어서 **텍스트 위에 마우스를 올려도 텍스트 선택 커서가 나타나지 않음** — 선택 가능하다는 시각적 피드백 부재
- **근거**:
  - `frontend/src/styles/tokens.css:77-79` — `::selection { background: var(--color-accent-subtle); }` 글로벌 선택 색상
  - `frontend/src/features/chat/ChatMessageList.tsx:117-131` — 사용자 버블 스타일 `background: "var(--color-accent)"`, `color: "#fff"`, `cursor` 미지정

## 문제 2 — 사용자 메시지 지연 표시 (AI 응답 완료 후에야 표시됨)

- **증상**: 사용자가 메시지를 보내면, AI 응답이 완료된 후에야 사용자 메시지가 화면에 나타남
- **원인 추정**: Optimistic update 미구현. 현재 흐름:
  1. `ChatInput.handleSend()` → `ChatView.handleSend()` → `sendMessage.mutate()` 호출
  2. `useSendChatMessage`의 `mutationFn` 안에서 `startStreaming(tempConvId)` 호출 (스트리밍 상태만 시작)
  3. `api.chat.sendMessage()`를 await — IPC 핸들러가 **LLM 완료까지 블로킹** (수 초~수십 초)
  4. `onSuccess`에서 `invalidateQueries({ queryKey: chatKeys.messages(...) })` — 이때 비로소 DB에서 메시지를 리페치
  5. **사용자 메시지는 DB에 저장+리페치 후에야 UI에 나타남**
- **근거**:
  - `frontend/src/lib/chatQueries.ts:126-151` — `useSendChatMessage` 뮤테이션에 `onMutate` 미정의 (optimistic update 없음)
  - `frontend/src/stores/chatStore.ts:49-57` — `startStreaming()`은 스트리밍 상태만 설정, 사용자 메시지를 임시 표시하는 로직 없음
  - `frontend/src/features/chat/ChatView.tsx:57-66` — `handleSend`는 `sendMessage.mutate()`만 호출

## 수정 방안

### 수정 1: 텍스트 선택 시각적 피드백

| 파일 | 수정 내용 |
|------|-----------|
| `frontend/src/features/chat/ChatMessageList.tsx` | `MessageBubble`의 사용자 메시지 Content div에 `cursor: "text"` 추가. 사용자 버블 내부에 `::selection` 색상을 오버라이드하는 인라인 스타일 또는 CSS 클래스 적용 — 흰색 배경 + 파란 텍스트 조합으로 선택 영역이 파란 버블 위에서 명확히 보이도록 설정 |
| `frontend/src/styles/tokens.css` | `.chat-user-bubble ::selection { background: rgba(255, 255, 255, 0.35); }` 규칙 추가 — 사용자 버블(파란 배경) 위에서 선택 영역이 반투명 흰색으로 표시됨 |

**구체적 변경:**

`ChatMessageList.tsx`의 `MessageBubble` Content div (라인 116~131):
- `className`에 `isUser ? "chat-user-bubble" : undefined` 추가
- `cursor: "text"` 스타일 추가

`tokens.css` 파일 끝:
```css
/* Chat user bubble text selection — override default ::selection for blue background */
.chat-user-bubble ::selection {
  background: rgba(255, 255, 255, 0.35);
  color: #fff;
}
```

### 수정 2: Optimistic Update로 사용자 메시지 즉시 표시

| 파일 | 수정 내용 |
|------|-----------|
| `frontend/src/stores/chatStore.ts` | `pendingUserMessage: string \| null` 상태 추가. `setPendingUserMessage(msg)` / `clearPendingUserMessage()` 액션 추가 |
| `frontend/src/lib/chatQueries.ts` | `useSendChatMessage`의 `mutationFn` 시작 시 `setPendingUserMessage(params.message)` 호출. `onSuccess` 및 `onError`에서 `clearPendingUserMessage()` 호출 |
| `frontend/src/features/chat/ChatView.tsx` | `pendingUserMessage`를 `chatStore`에서 구독. `ChatMessageList`에 전달 |
| `frontend/src/features/chat/ChatMessageList.tsx` | props에 `pendingUserMessage?: string \| null` 추가. `messages` 뒤에 `pendingUserMessage`가 있으면 사용자 스타일 버블로 즉시 렌더링 |

**구체적 변경:**

`chatStore.ts`:
```ts
// 상태 추가
pendingUserMessage: string | null;

// 액션 추가
setPendingUserMessage: (msg: string | null) => void;
clearPendingUserMessage: () => void;

// 초기값
pendingUserMessage: null,

// 구현
setPendingUserMessage: (msg) => set({ pendingUserMessage: msg }),
clearPendingUserMessage: () => set({ pendingUserMessage: null }),
```

`chatQueries.ts`의 `useSendChatMessage`:
```ts
// mutationFn 시작 부분에 추가 (startStreaming 호출 직후)
useChatStore.getState().setPendingUserMessage(params.message);

// onSuccess에 추가
useChatStore.getState().clearPendingUserMessage();

// onError 콜백 추가
onError: () => {
  useChatStore.getState().clearPendingUserMessage();
},
```

`ChatView.tsx`:
```ts
// chatStore에서 추가 구독
const pendingUserMessage = useChatStore((s) => s.pendingUserMessage);

// ChatMessageList에 prop 전달
<ChatMessageList
  ...
  pendingUserMessage={pendingUserMessage}
/>
```

`ChatMessageList.tsx`:
```tsx
// Props 타입에 추가
pendingUserMessage?: string | null;

// messages 렌더링 뒤, 스트리밍 버블 앞에 pending 메시지 렌더링
{pendingUserMessage && (
  <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexDirection: "row-reverse" }}>
    <div style={{ /* 사용자 아바타 */ }}>
      <User size={22} color="var(--color-accent)" />
    </div>
    <div className="chat-user-bubble" style={{ /* 사용자 버블 스타일 */ opacity: 0.75 }}>
      {pendingUserMessage}
    </div>
  </div>
)}
```

`opacity: 0.75`로 "전송 중" 시각적 피드백을 제공합니다. DB 리페치로 실제 메시지가 `messages` 배열에 들어오면 `clearPendingUserMessage()`가 호출되어 중복 없이 전환됩니다.

## 영향 범위

- 수정 파일: **4개**
  - `frontend/src/features/chat/ChatMessageList.tsx`
  - `frontend/src/features/chat/ChatView.tsx`
  - `frontend/src/stores/chatStore.ts`
  - `frontend/src/lib/chatQueries.ts`
  - `frontend/src/styles/tokens.css`
- 사이드 이펙트: 없음. CSS 변경은 `.chat-user-bubble` 클래스 스코프 한정. Optimistic update는 기존 데이터 흐름에 추가만 하고 변경하지 않음.

## 검증 방법

### 텍스트 선택
1. 채팅에서 메시지를 보내 사용자 버블 생성
2. 사용자 메시지(파란 버블) 위에 마우스를 올려 텍스트 커서(`I-beam`) 확인
3. 드래그로 텍스트 선택 → 반투명 흰색 하이라이트 확인
4. `Ctrl+C`로 복사 후 붙여넣기 확인
5. AI 응답(흰 버블) 텍스트도 동일하게 선택 가능한지 확인

### Optimistic Update
1. 채팅에서 메시지 입력 후 전송
2. 전송 직후 사용자 메시지가 **즉시** 화면에 표시되는지 확인 (약간 투명한 상태)
3. AI 응답 스트리밍 시작 시 파이프라인 상태 표시 정상 확인
4. AI 응답 완료 후 사용자 메시지가 정상 불투명도로 전환되는지 확인
5. 네트워크 오류 시 pending 메시지가 사라지는지 확인
