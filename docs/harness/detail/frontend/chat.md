# 채팅 프론트엔드
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 개요
LLM 기반 비교 테이블 생성 및 Q&A 채팅 UI. 대화 관리, 메시지 스트리밍, 테이블 렌더링, 파이프라인 진행 표시를 담당한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `frontend/src/features/chat/ChatView.tsx` | 채팅 메인 화면 (레이아웃) | ~220 |
| `frontend/src/features/chat/ChatInput.tsx` | 메시지 입력 + 전송 + 중단 | ~132 |
| `frontend/src/features/chat/ChatMessageList.tsx` | 메시지 목록 렌더링 (user/assistant/table) | ~284 |
| `frontend/src/features/chat/ChatSidebar.tsx` | 대화 목록 사이드바 + 새 대화 생성 | ~260 |
| `frontend/src/features/chat/ChatTableReport.tsx` | 생성 테이블 렌더링 + verification 뱃지 | ~220 |
| `frontend/src/features/chat/ChatPipelineStatus.tsx` | 파이프라인 단계 스테퍼 UI | ~271 |
| `frontend/src/stores/chatStore.ts` | 채팅 상태 (Zustand) | ~100 |
| `frontend/src/lib/chatQueries.ts` | 채팅 TanStack Query 훅 | ~337 |

## 주요 컴포넌트/함수

### ChatView.tsx
- 레이아웃: ChatSidebar + ChatMessageList + ChatInput + ChatPipelineStatus
- `mode` 전환: table / qa (useChatStore.conversationType)

### ChatInput.tsx
- 입력: textarea + 전송 버튼
- IPC 호출: `window.redouDesktop.chat.sendMessage({conversationId, message, scopeFolderId, scopeAll, mode})`
- 중단: `window.redouDesktop.chat.abort({conversationId})`

### ChatMessageList.tsx
- 메시지 유형별 렌더링:
  - `text` → 마크다운 (react-markdown)
  - `table_report` → ChatTableReport 컴포넌트
  - `error` → 에러 스타일
- optimistic user message (pendingUserMessage)
- 스트리밍 중: streamingContent 실시간 표시

### ChatTableReport.tsx
- 테이블 그리드 렌더링 (headers + rows)
- source_refs → 참조 목록 (DOI 링크)
- verification → 셀별 verified/unverified 뱃지
- CSV 내보내기 버튼

### ChatPipelineStatus.tsx
- 6단계 스테퍼: orchestrating → searching → parsing → extracting → assembling → verifying
- 각 단계별 아이콘/색상/메시지 표시

### ChatSidebar.tsx
- 대화 목록 조회/선택
- 새 대화 생성 (table/qa 모드 선택)
- scope 설정 (전체 라이브러리 / 특정 폴더)

## Zustand Store (chatStore.ts)
| 상태 | 타입 | 설명 |
|------|------|------|
| `activeConversationId` | string \| null | 현재 대화 ID |
| `streamingContent` | string | 실시간 스트리밍 텍스트 |
| `isStreaming` | boolean | 스트리밍 중 여부 |
| `pipelineStage` | ChatPipelineStage \| null | 현재 파이프라인 단계 |
| `pipelineMessage` | string | 단계 메시지 |
| `conversationType` | "table" \| "qa" | 대화 유형 |
| `scopeFolderId` | string \| null | 검색 범위 폴더 |
| `scopeAll` | boolean | 전체 라이브러리 검색 여부 |
| `pendingUserMessage` | string \| null | 낙관적 사용자 메시지 |

## IPC 이벤트 수신 (chatQueries.ts)
- `chat:token` → `appendToken(token)`
- `chat:complete` → `finishStreaming(messageId)` + 쿼리 무효화
- `chat:error` → 에러 표시 + 스트리밍 종료
- `chat:status` → `setPipelineStage(stage, message, detail)`
- `chat:verification-done` → 테이블 검증 결과 갱신

## 의존성
- 사용: Electron IPC (chat:send-message, chat:abort, chat:export-csv), Supabase (대화/메시지 조회), chatStore, uiStore
- 사용됨: AppShell (activeNav === "chat")

## 현재 상태
- 구현 완료: 테이블 생성 채팅, Q&A 채팅, 파이프라인 스테퍼, CSV 내보내기, 모드 전환
- 알려진 이슈: 텍스트 선택 불가 + optimistic update 미완성 (ROADMAP fix/03)
