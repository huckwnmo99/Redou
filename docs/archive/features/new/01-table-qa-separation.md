# 테이블 생성 / 논문 Q&A 서비스 분리

> 유형: feature | 상태: 계획 | 작성일: 2026-04-06

## 개요
- **목적**: 현재 하나로 합쳐진 LLM 채팅 파이프라인을 (A) 테이블 생성 서비스와 (B) 논문 Q&A 서비스로 분리하여 각각 최적화
- **범위**: Electron 백엔드 모듈 분리, IPC 파라미터 확장, Frontend 모드 전환 UI, DB 스키마 확장
- **제외**: LLM 모델 변경 (같은 모델 유지), 완전히 별도의 NavItem 추가 (같은 chat 화면에서 모드 전환)

## 설계

### DB 변경

`chat_conversations` 테이블에 `conversation_type` 컬럼 추가:

```sql
ALTER TABLE chat_conversations
  ADD COLUMN conversation_type text NOT NULL DEFAULT 'table';

COMMENT ON COLUMN chat_conversations.conversation_type IS '''table'' | ''qa'' — 서비스 유형';
```

마이그레이션 파일: `supabase/migrations/20260406010000_add_conversation_type.sql`

`main.mjs` 화이트리스트: 변경 불필요 (기존 `chat_conversations`가 이미 포함)

### Electron (Backend)

**수정 대상:**
- `apps/desktop/electron/main.mjs` — `CHAT_SEND_MESSAGE` 핸들러에 분기 로직 추가 (~2772행)
- `apps/desktop/electron/llm-chat.mjs` — `streamChat()` 유지 (Q&A에서 재사용)

**새 모듈:**
- `apps/desktop/electron/llm-qa.mjs` — Q&A 서비스 전용 모듈

`llm-qa.mjs` 구조:
```
QA_SYSTEM_PROMPT        — Q&A 전용 시스템 프롬프트 (출처 귀속 지시, 마크다운 응답 형식)
generateQaResponse()    — RAG 컨텍스트 + 대화 이력 → streamChat()으로 스트리밍 응답
formatSourceAttribution() — 응답에 [1], [2] 출처 참조 포맷팅
```

**IPC 채널:** 기존 채널 파라미터 확장 (새 채널 없음)
- `CHAT_SEND_MESSAGE` 요청에 `mode?: "table" | "qa"` 파라미터 추가
- 새 대화 생성 시 `conversation_type`에 모드 저장
- 기존 대화는 저장된 `conversation_type`으로 자동 분기

**`main.mjs` CHAT_SEND_MESSAGE 핸들러 분기 로직:**
```
기존 대화 로드 → conversation_type 확인
  ├── "table" → 기존 파이프라인 (Orchestrator → RAG → Table Agent → Guardian)
  └── "qa"    → Q&A 파이프라인 (RAG 검색 → streamChat() → 출처 귀속)
```

Q&A 파이프라인 상세:
1. RAG 검색 (기존 `runMultiQueryRag` 재사용, 쿼리 1개로 단순화)
2. 컨텍스트 조합 (텍스트 청크 위주, OCR 테이블 축소)
3. `streamChat()` 호출 — 토큰 스트리밍으로 자연어 응답
4. 응답 완료 후 `checkGroundedness()` — 핵심 주장 검증 (선택적)
5. 메시지 저장 (`message_type: "text"`, 테이블 생성 없음)

### Frontend

**타입** (`types/`)
- `types/chat.ts`:
  - `ChatConversation`에 `conversation_type: "table" | "qa"` 필드 추가
  - `ChatSendMessageParams`에 `mode?: "table" | "qa"` 필드 추가
- `types/desktop.ts`:
  - `ChatSendMessageParams`에 `mode?: "table" | "qa"` 필드 추가
  - `ChatPipelineStage`에 `"answering"` 추가 (Q&A 스트리밍 상태)

**데이터 계층** (`lib/`)
- `chatQueries.ts`:
  - `useSendChatMessage` — `mode` 파라미터 전달 추가
  - `useChatConversations` — 쿼리는 동일 (type 필터링은 UI에서)
- `chatStore.ts`:
  - `conversationType: "table" | "qa"` 상태 추가
  - `setConversationType()` 액션 추가
  - `startStreaming()`에 타입 전달

**컴포넌트** (`features/chat/`)
- `ChatView.tsx` — 모드 전환 UI 추가 (헤더 영역에 탭 또는 토글)
- `ChatInput.tsx` — placeholder 텍스트를 모드에 따라 변경
- `ChatMessageList.tsx` — 변경 없음 (이미 text/table_report 양쪽 처리)
- `ChatSidebar.tsx` — 대화 목록에 타입 아이콘/뱃지 표시
- `ChatPipelineStatus.tsx` — Q&A 모드용 간소화된 상태 표시 추가 ("answering" 스테이지)

**네비게이션:** 변경 없음 (기존 `chat` NavItem 유지)

## 작업 분해

구현 순서대로 나열. `/develop` 에이전트가 이 순서대로 실행한다.

1. [x] DB 마이그레이션 작성 — `supabase/migrations/20260406010000_add_conversation_type.sql`
2. [x] `llm-qa.mjs` 생성 — Q&A 시스템 프롬프트, `generateQaResponse()`, `formatSourceAttribution()`
3. [x] `main.mjs` CHAT_SEND_MESSAGE 핸들러 리팩토링 — Q&A/테이블 분기 로직 + `mode` 파라미터 처리
4. [x] Frontend 타입 정의 — `chat.ts`, `desktop.ts`에 `conversation_type`/`mode` 추가
5. [x] `chatStore.ts` 확장 — `conversationType` 상태 + `setConversationType` 액션
6. [x] `chatQueries.ts` 확장 — `useSendChatMessage`에 mode 전달
7. [x] `ChatView.tsx` 모드 전환 UI — 헤더에 "테이블 생성" / "Q&A" 토글
8. [x] `ChatInput.tsx` 모드별 placeholder 분기
9. [x] `ChatSidebar.tsx` 대화 타입 뱃지 추가
10. [x] `ChatPipelineStatus.tsx` Q&A 모드 상태 표시

## 영향 범위

- 수정되는 기존 파일:
  - `apps/desktop/electron/main.mjs` (CHAT_SEND_MESSAGE 핸들러 분기)
  - `frontend/src/types/chat.ts` (타입 확장)
  - `frontend/src/types/desktop.ts` (타입 확장)
  - `frontend/src/stores/chatStore.ts` (상태 확장)
  - `frontend/src/lib/chatQueries.ts` (파라미터 확장)
  - `frontend/src/features/chat/ChatView.tsx` (모드 전환 UI)
  - `frontend/src/features/chat/ChatInput.tsx` (placeholder)
  - `frontend/src/features/chat/ChatSidebar.tsx` (타입 뱃지)
  - `frontend/src/features/chat/ChatPipelineStatus.tsx` (Q&A 상태)
- 새로 생성하는 파일:
  - `apps/desktop/electron/llm-qa.mjs`
  - `supabase/migrations/20260406010000_add_conversation_type.sql`
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요**
- IPC 채널 추가: **없음** (기존 채널 파라미터 확장)

## 리스크 & 대안

- **리스크**: `main.mjs` CHAT_SEND_MESSAGE 핸들러가 이미 ~400줄. Q&A 분기 추가 시 더 커짐
  - **대안**: `handleTablePipeline()` / `handleQaPipeline()`으로 함수 추출 리팩토링
- **리스크**: Q&A 토큰 스트리밍 이벤트가 기존 테이블 파이프라인의 clarify 토큰과 혼동 가능
  - **대안**: `CHAT_TOKEN` 이벤트에 `mode` 필드 추가 (현재는 `conversationId`로 구분 가능)
- **리스크**: Q&A 출처 귀속 정확도가 프롬프트 품질에 의존
  - **대안**: Guardian 검증을 Q&A에도 적용 (`checkGroundedness()`)

## 가정 사항

- [가정] Q&A 모드에서 `chat_generated_tables` 레코드는 생성하지 않음 (텍스트 응답만)
- [가정] Q&A에서도 기존 `runMultiQueryRag()` 함수를 재사용, 쿼리를 사용자 질문 1개 기반으로 단순화
- [가정] 모드 전환은 대화 시작 시에만 가능, 대화 중간에는 전환 불가 (대화 타입 고정)
- [가정] 기존 `streamChat()` 함수의 시스템 프롬프트만 Q&A용으로 교체하면 스트리밍 메커니즘 재사용 가능
