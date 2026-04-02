# 채팅 기능 구현 진행 트래커

> 상세 설계: `plans/chat-feature-plan.md`
> 시작일: 2026-03-30

## 진행 상태

| 단계 | 설명 | 상태 | 비고 |
|------|------|------|------|
| 1 | DB 마이그레이션 (chat_conversations, chat_messages, chat_generated_tables) | ✅ 완료 | `references` → `source_refs` (예약어) |
| 2 | IPC 채널 등록 (ipc-channels.mjs + preload.mjs) | ✅ 완료 | 3 channels + 4 events 양쪽 독립 등록 |
| 3 | LLM 채팅 모듈 (llm-chat.mjs — streamChat, generateTableJson, checkGroundedness) | ✅ 완료 | ~230줄, node --check 통과 |
| 4 | Main.mjs IPC 핸들러 (CHAT_SEND_MESSAGE, CHAT_ABORT, CHAT_EXPORT_CSV) | ✅ 완료 | node --check 통과 |
| 5 | 프론트엔드 타입 (chat.ts, paper.ts NavItem, desktop.ts API 타입) | ✅ 완료 | tsc --noEmit 통과 |
| 6 | 상태 관리 + 데이터 레이어 (chatStore.ts, chatQueries.ts) | ✅ 완료 | tsc --noEmit 통과 |
| 7 | UI 컴포넌트 (ChatView, ChatSidebar, ChatMessageList, ChatTableReport, ChatInput) | ✅ 완료 | tsc --noEmit 통과, react-markdown+remark-gfm 설치 |
| 8 | 네비게이션 통합 (LeftSidebar, AppShell) | ✅ 완료 | tsc --noEmit 통과 |
| 9 | 검증 에이전트 (Granite Guardian 3.3 8B 통합) | ✅ 완료 | 4단계 CHAT_SEND_MESSAGE 핸들러에 포함 |
| 10 | CSV 내보내기 | ✅ 완료 | 4단계 CHAT_EXPORT_CSV 핸들러에 포함 |
| — | 구문 검증 (node --check) | ✅ 완료 | main.mjs, llm-chat.mjs, preload.mjs 모두 통과 |
| — | 프론트엔드 타입 검증 (tsc --noEmit) | ✅ 완료 | 에러 0 |
| — | 통합 테스트 | ⬜ 대기 | 앱 실행 후 수동 테스트 필요 |

## 상태 범례
- ⬜ 대기
- 🔄 진행 중
- ✅ 완료
- ❌ 실패/차단

## 변경 로그

### 2026-03-30
- 플랜 최종 검토 완료 (4개 버그 수정, 5개 불일치 해결)
- 트래커 생성, 구현 시작
- 1~4단계 완료: DB 마이그레이션, IPC 채널, llm-chat.mjs, main.mjs 핸들러
- 5~8단계 완료: 프론트엔드 타입, chatStore/chatQueries, UI 컴포넌트 5개, 네비게이션 통합
- 9~10단계: 4단계에 이미 포함 (검증 에이전트 + CSV 내보내기)
- 구문 검증 완료: node --check 3파일 + tsc --noEmit 에러 0
- react-markdown, remark-gfm 의존성 설치 완료
