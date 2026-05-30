# ChatView 디자인 킷 이식 (리디자인 3호 화면)

> 유형: feature | 상태: 계획 | 작성일: 2026-05-30
> 브랜치: `codex/rag-infra-extraction` | 대상: `frontend/src/features/chat/` (6개 컴포넌트)
> 선행 패턴: FiguresView(`docs/features/new/12-*.md`, 커밋 19141b7), SettingsView(`docs/features/new/13-*.md`, 커밋 e371b5e)

## 개요

- **목적**: 새 디자인 킷(`Redou Design System/ui_kits/redou/ChatView.jsx`)의 레이아웃·스타일·인터랙션을 현재 chat 기능에 이식한다. 데이터 리디자인의 **세 번째 시범 화면**.
- **핵심 원칙**: "복붙"이 아니라 "디자인 이식". 킷의 **시각 구조**(인라인 style + CSS 변수, lucide named import, i18n 래핑)만 옮기고, 현재 `.tsx`의 **실시간 스트리밍·파이프라인 상태·테이블 생성·데이터 연결(chatStore/chatQueries/IPC)·타입(TS)·i18n**은 100% 보존한다.
- **채팅은 Redou에서 가장 복잡한 기능**(실시간 IPC 스트리밍 + 다단계 파이프라인 + SRAG 테이블 생성 + Guardian 검증). Figures/Settings와 달리 회귀 리스크가 크므로 **시각만 손대고 데이터/이벤트 흐름은 절대 건드리지 않는다.**
- **범위**:
  - 킷 ChatView의 카드형 메시지 영역(maxWidth 880 중앙 정렬, 16px gap) 스타일 정합
  - 킷 TableReport 스타일(타이틀바 + Verified 배지 + 셀 `[N]` 첨자 + zebra) 이식 → 단 **현재의 실제 verification/source_refs 데이터에 연결**
  - 킷 ReferencesBlock(번호 배지 + 분리 카드) 스타일 이식 → 현재 `source_refs` 데이터 사용
  - 킷 Assistant 헤더(R 그라데이션 아바타 + "Redou Orchestrator" + 모델 칩) 도입 검토
  - (선택) 킷 파이프라인 스트립 스타일 정합 — **단 현재 다단계 stepper 로직/실제 stage는 유지**
- **제외**:
  - 데이터 계층/IPC/스토어/타입/백엔드/DB 변경 — 일절 없음
  - ChatSidebar 구조 변경(대화 목록은 글로벌 LeftSidebar 소속, 킷엔 없음 → 현행 유지)
  - 킷의 가짜 데이터(MOCK_PAPERS, setTimeout 파이프라인 애니메이션, 무조건-초록 Verified) 채택
  - `CURRENT_EXTRACTION_VERSION` 범프(추출 로직 무변경)

---

## [중대 인지] 킷은 단일 파일 시안, 현재는 6 컴포넌트 + 실 데이터

킷 `ChatView.jsx`는 **단일 파일에 채팅 UI 전체를 목업으로 압축**한 시안이다. 현재 구현은 동일 화면을 **6개 컴포넌트 + 글로벌 사이드바**로 분산하고, 각각이 실제 데이터 훅/스토어/IPC에 연결돼 있다.

| 킷 (단일 `ChatView.jsx`) | 현재 (분산) | 데이터 연결 |
|---|---|---|
| header + mode toggle | `ChatView.tsx` (header + toggle) | `useChatStore.conversationType`, `activeConversationId` |
| messages 영역 (user/assistant 버블) | `ChatMessageList.tsx` (MessageBubble/StreamingBubble) | `useChatMessages`, `streamingContent`, `pendingUserMessage` |
| `TableReport` (목업) | `ChatTableReport.tsx` | `useChatTable(tableId)` → `ChatGeneratedTable` (headers/rows/verification/source_refs) |
| `ReferencesBlock` (목업, `MOCK_PAPERS`) | `ChatTableReport.tsx` 내부 References 섹션 | `table.source_refs: TableReference[]` |
| `ChatPipelineStatus` (4단계, setTimeout) | `ChatPipelineStatus.tsx` (table 6단계 / QA 3단계 stepper) | `useChatStore.pipelineStage/pipelineMessage` + 실 IPC `CHAT_STATUS` |
| input (textarea + send) | `ChatInput.tsx` | `onSend`/`onAbort`, `isStreaming` |
| (없음 — AppShell의 LeftSidebar) | `ChatSidebar.tsx` (대화 목록 CRUD) | `useChatConversations`/`useDeleteConversation`/`useRenameConversation` |

> **구조 결론**: 킷에는 대화 목록 사이드바가 없다(킷 `AppShell.jsx`도 LeftSidebar 별도, ChatView는 content만 차지). 따라서 **이식은 content 영역 6개 중 4개(ChatView header, ChatMessageList, ChatTableReport, ChatPipelineStatus)에 집중**하고, `ChatSidebar.tsx`와 `ChatInput.tsx`는 변경 최소(이미 킷과 거의 동일).

---

## 보존 대상 (절대 건드리지 않는 로직/훅) — 이식의 핵심 체크리스트

킷에는 아래가 **전혀 없다**(목업+CDN+setTimeout 프로토타입). 이식 중 **반드시 살아있어야 하는** 현재 자산:

### 1. 실시간 스트리밍 (chatStore + chatQueries 브리지)
- `useChatStreamBridge()` (`chatQueries.ts:247`) — `onChatToken`/`onChatComplete`/`onChatVerificationDone`/`onChatError`/`onChatStatus` IPC 구독. **이게 실시간 스트리밍의 심장.** ChatView.tsx에서 호출(`ChatView.tsx:34`) → 이 호출 위치/타이밍 유지.
- `useChatStore`: `streamingContent`, `isStreaming`, `appendToken`, `startStreaming`, `finishStreaming`, `pendingUserMessage`, `pipelineStage/pipelineMessage` — 전부 보존.
- `StreamingBubble`(`ChatMessageList.tsx:149`) — 스트리밍 중 토큰 누적 렌더. 킷엔 없음(완성 텍스트만). **유지**.

### 2. 파이프라인 상태 (실제 IPC stage)
- 백엔드 실제 emit 순서(`apps/desktop/electron/chat/table-pipeline.mjs`): `orchestrating` → `searching` → `parsing` → `extracting` → `researching`(NULL recovery) → `assembling` → `verifying`(비동기). Q&A: `searching` → `graphing`(opt-in) → `answering`. (`main.mjs:2443/2459/2517`)
- `ChatPipelineStatus.tsx`의 `TABLE_STAGES`(6)/`QA_STAGES`(3) 매핑 + `stageIndex` 로직 + `orchestrating`/`answering` compact 인디케이터 — **로직 보존**. 킷의 4단계(intent/retrieval/table/guardian, setTimeout)는 **시각 참고만**, 실제 단계 수/매핑은 현재 것 유지.
- `ChatStatusEvent`/`ChatPipelineStage` 타입(`types/desktop.ts:161`) — 변경 금지.

### 3. 테이블 생성 + 검증 + 인용
- `useChatTable(tableId)` (`chatQueries.ts:114`) → `ChatGeneratedTable`. `TableReportLoader`(`ChatMessageList.tsx:23`)가 tableId로 lazy 로드.
- `verification: CellVerification[]` (`row`/`col`/`status: verified|unverified`/`evidence`) — **셀별 실제 검증 데이터**. `getCellVerification`/`cellBgColor`/`cellBorderColor`(`ChatTableReport.tsx:12-31`) 보존.
- `source_refs: TableReference[]` (`refNo`/`paperId`/`title`/`authors`/`year`/`doi`/`evidenceSummary`) — **실제 참조 데이터**. References 렌더 + `onNavigateToPaper`(paperId 클릭→논문 이동) + DOI 외부 링크(`window.redouDesktop.openExternal`) 보존.
- `useExportChatCsv()`(`chatQueries.ts:228`) — CSV 내보내기 버튼. 킷엔 없음. **유지**.
- `InlineTableReport`(`ChatMessageList.tsx:35`) — tableId 없는 폴백(JSON 파싱). 유지.

### 4. 데이터 연결 (대화/메시지 CRUD)
- `useChatConversations`/`useChatMessages`/`useSendChatMessage`/`useAbortChat`/`useDeleteConversation`/`useRenameConversation` — 전부 보존.
- 모드 잠금 로직: `canToggleMode = !activeConversationId`(`ChatView.tsx:47`) — 기존 대화는 모드 변경 불가. 킷엔 없음(자유 토글, 가짜). **현재 로직 유지** (킷처럼 항상 토글 가능으로 바꾸면 백엔드 conversation_type 불일치).
- DB→스토어 conversationType 동기화 `useEffect`(`ChatView.tsx:37`) 보존.

### 5. 타입 (TypeScript)
- `ChatMessage`/`ChatGeneratedTable`/`TableReference`/`CellVerification`/`ConversationType`/`ChatPipelineStage` — `any` 도입 금지, 전부 유지.

### 6. i18n (`localeText`)
- `const t = (en, ko) => localeText(locale, en, ko)` 패턴 유지. **킷은 한국어/영어 혼합 하드코딩**(예: `"Research Data Chat · 연구 데이터 채팅"`, `"전체 논문 · 6 papers"`, `"세 편의 논문에서..."`). 이식 시 전부 `t("...", "...")`로 분리. **추가로 현재 `ChatPipelineStatus.tsx`의 stage label들이 한국어 하드코딩(`"논문 데이터 검색 중..."` 등)이라 i18n 미적용** — 이식 기회에 `t()` 래핑 권장(아래 [부수 개선] 참조).

### 7. 마크다운/LaTeX 렌더
- `ReactMarkdown + remarkGfm`(`ChatMessageList.tsx`) — assistant 텍스트 렌더. 킷은 평문 `<p>`만. **현재 마크다운 렌더 유지**(LLM 응답이 마크다운).
- `.chat-user-bubble ::selection`(`tokens.css:139`) — 파란 버블 위 텍스트 선택 가독성. 유지.

---

## 가짜(킷 목업) vs 실제(현재 로직) 구분 — 가장 중요한 섹션

킷 `ChatView.jsx`는 **디자인 시안**이라 백엔드 없는 가짜 표현이 많다. 그대로 옮기면 "동작하는 척하는 가짜 UI"가 된다. **시각 스타일은 차용하되, 데이터는 반드시 현재 실제 소스에 연결**한다.

| 킷 표현 | 킷 실제 정체 (가짜) | 현재 실제 로직 | 이식 시 연결 |
|---|---|---|---|
| `<TableReport>` 타이틀바 **"Verified" 배지** (`ChatView.jsx:62-70`) | **무조건 초록 고정** (검증 안 함) | `table.verification[]` 셀별 verified/unverified, 비동기 도착(`onChatVerificationDone`) | 배지를 **검증 결과 종합**으로 연결: verification 있고 전부 verified→"Verified", 일부 unverified→"N unverified" 경고, verification null(아직)→배지 숨김 또는 "Verifying...". 무조건 초록 금지 |
| 셀 우측 **`[N]` 첨자 인용** (`ChatView.jsx:100-106`) | `[{i+1}]` = **행 인덱스 단순 표기**, 클릭 동작 없음 | 현재는 셀에 인용 첨자 없음. 대신 `source_refs[].refNo` + References 블록에 매핑. 셀 값에 `[refNo]`가 텍스트로 포함될 수 있음(mergeExtractionResults가 부여) | **행 인덱스 가짜 첨자 미채택.** 셀 텍스트의 실제 `[refNo]`는 그대로 표시. (선택) refNo→References 스크롤 연결은 후속. 현재 검증 색상(셀 배경)과 충돌 안 하게 조율 |
| **셀 검증 표시 방식** | 색상 없음(첨자만) | **셀 배경/좌border 색**(verified=초록 8%, unverified=빨강 8%) + hover title(evidence) | 현재의 셀 색상 검증을 **유지**(실제 데이터 기반). 킷 zebra(짝수행 배경)와 병합 시 우선순위: verification 색 > zebra |
| `<ReferencesBlock>` (`ChatView.jsx:116-143`) | `MOCK_PAPERS` 슬라이스, `authors[0].name · venue year · p.3+i`(가짜 페이지) | `table.source_refs: TableReference[]` — 실제 refNo/title/authors/year/doi/evidence | **킷 카드 스타일**(번호 배지 + 분리 카드) 차용, **데이터는 source_refs**. 가짜 `p.3+i` 미사용(실제 evidenceLocations 있으면 표시). paperId 클릭→`onNavigateToPaper`, DOI→openExternal 보존 |
| `<ChatPipelineStatus>` 4단계 가로 스트립 (`ChatView.jsx:11-45`) | `intent/retrieval/table/guardian`, **setTimeout으로 가짜 진행** | 실제 7 stage(table) / 3 stage(QA), **IPC `CHAT_STATUS`로 실시간 구동**, 세로 stepper | **현재 stepper 로직/단계/실 stage 유지.** 킷 가로 스트립은 시각 옵션으로만 검토(아래 [파이프라인 결정] 참조). setTimeout 가짜 절대 미채택 |
| Assistant 헤더: "Redou Orchestrator" + **`gpt-oss:120b` 모델 칩** (`ChatView.jsx:246-251`) | **하드코딩 문자열** | 실제 활성 모델 = `useActiveLlmModel()`(`chatQueries.ts:330`) 존재 | 헤더 도입 시 모델 칩은 **`useActiveLlmModel().model`** 실제값. 하드코딩 금지(없으면 칩 숨김) |
| "전체 논문 · 6 papers" 스코프 칩 (`ChatView.jsx:180`) | **하드코딩 6** | `scopeAll`/`scopeFolderId`(현재는 "All papers"/"Folder scope" 텍스트만, 카운트 없음) | 현재 텍스트 유지. 논문 수 표시는 실제 카운트 필요(별도 쿼리) → **이번 범위 제외**, 현행 텍스트 칩 유지 |
| 사용자 버블 우측 정렬(`flex-end`) (`ChatView.jsx:224`) | 정적 | 현재도 동일(우측 정렬, `chat-user-bubble`) | 스타일 미세 정합만 |

---

## 현재 vs 킷 — 컴포넌트별 시각/구조 차이 + 이식 매핑

### A. `ChatView.tsx` (header + mode toggle) — **차이 미미, 거의 이식 완료 상태**
- **현재**: 헤더(18px bold 제목 + 스코프 칩) + 모드 토글(table/qa, `--bg-panel` 배경 pill, active=elevated+accent). `ChatView.jsx:166-217`과 **이미 거의 동일**(이전 작업에서 정합된 듯).
- **킷 차이**: 제목 문구 `"Research Data Chat · 연구 데이터 채팅"`(킷은 양언어 한 줄), 현재는 `t()` 분리(영/한 토글). → **현재 방식이 더 옳음**(i18n). 유지.
- **이식**: 사실상 무변경. 모드 토글 라벨/아이콘 정합 확인만(`Table2`/`MessageCircleQuestion` 이미 사용). 킷의 "항상 토글 가능"은 **미채택**(모드 잠금 보존).

### B. `ChatMessageList.tsx` (messages) — **레이아웃 컨테이너 + 버블 정합**
- **현재**: `padding 24px 28px`, `gap 20`, 아바타 42px(User/Bot/AlertTriangle lucide), assistant 버블 `padding 16px22px` border-subtle. 좌우 배치는 `flexDirection: row/row-reverse` + 아바타.
- **킷**: `maxWidth 880 중앙 정렬`, `padding 0 20px`, `gap 16`. 사용자 버블 우측 정렬(아바타 없음, `maxWidth 70%`, accent 배경). assistant는 **24px R-그라데이션 아바타 + "Redou Orchestrator" 헤더 + 모델 칩** 후 본문. 버블 컨테이너 없이 본문 직접(`maxWidth 85%`).
- **차이 핵심**:
  1. 킷은 **중앙 정렬 maxWidth 880 컬럼**(현재는 full-width + padding). → **킷 중앙 컬럼 채택** 검토(가독성↑).
  2. 킷 assistant는 **아바타가 작고(24) 헤더형**(이름+모델칩), 현재는 큰 아바타(42)+버블. → 킷 헤더형이 모던. 단 **모델 칩은 실제값 연결**(가짜 금지).
  3. 킷 사용자 버블은 **아바타 없이 우측**, 현재는 **아바타 있음(User 42px)**. → 킷 스타일(아바타 없는 우측 버블)이 깔끔. 단 `pendingUserMessage`(optimistic) 버블도 동일 스타일로.
- **이식 매핑**:
  - 메시지 컨테이너를 킷 중앙 컬럼(maxWidth 880, gap 16)으로.
  - `MessageBubble`: user=아바타 없는 우측 버블(accent), assistant=R 아바타+헤더(이름+`useActiveLlmModel` 칩)+본문(마크다운 유지).
  - `StreamingBubble`: assistant 스타일 동일 적용(스트리밍 중에도 헤더 표시), 마크다운 렌더 유지.
  - `pendingUserMessage` 버블: user 스타일 + `opacity 0.75`(현재 유지).
  - 빈 상태: 현재 문구 유지(`t()`).

### C. `ChatTableReport.tsx` (table + verification + references) — **가장 큰 시각 변화**
- **현재**: 타이틀바(제목 + CSV 버튼) + 테이블(검증 색 셀 배경/border) + 검증 범례(verified/unverified 점) + References(테이블 내부 하단 통합).
- **킷**: 타이틀바(table-2 아이콘 + 제목 + **우측 "Verified" 배지**) + 테이블(zebra 짝수행 + 첫 열 강조 + **셀 `[N]` 첨자**) + **References는 테이블 밖 분리 블록**.
- **이식 매핑**:
  - 타이틀바: 킷 스타일(아이콘 + 제목 + 우측 배지). **단 배지는 verification 종합 상태**(전부 verified→초록 Verified / 일부 unverified→경고 / null→숨김 or Verifying). CSV 버튼은 **현재 것 유지**(킷엔 없지만 필수 기능) — 배지 옆에 배치.
  - 테이블: 킷 zebra + 첫 열 bold + tabular-nums **차용**. **단 셀 검증 색(verified/unverified 배경/border)은 현재 로직 유지**(zebra와 병합, verification 우선). hover title(evidence) 유지.
  - 셀 `[N]` 첨자: 킷의 행인덱스 가짜 첨자 **미채택**. 셀 텍스트에 실제 `[refNo]` 있으면 그대로.
  - References: 킷 분리 블록 스타일(번호 배지 + 카드)로 **시각 개편**하되 `source_refs` 데이터·`onNavigateToPaper`·DOI 링크·evidence 보존. **위치는 테이블 카드 직후**(MessageBubble 내, ChatTableReport 반환 트리). 검증 범례도 유지(또는 배지로 대체 검토).
  - `InlineTableReport`(폴백): 동일 톤으로 미세 정합(선택).

### D. `ChatPipelineStatus.tsx` (pipeline) — **시각 정합, 로직 보존**
- **현재**: 세로 stepper(원형 아이콘 노드 + 커넥터 라인), table 6단계/QA 3단계, active 펄스, done 체크, 한국어 하드코딩 label. `orchestrating`/`answering`은 compact 펄스 인디케이터.
- **킷**: **가로 4단계 스트립**(작은 칩 + 구분선), setTimeout 가짜.
- **[파이프라인 결정] 두 방향**:
  - **방향 1 (권장, 보수)**: **현재 세로 stepper 유지**(실제 다단계 표현이 더 정보가치 높음). 킷에서 **스타일 토큰만 차용**(칩 색/펄스 정합). 단계 수/매핑/실 stage 그대로. → 회귀 0, 정보량 유지.
  - **방향 2 (킷 충실)**: 킷 **가로 4단계 스트립**으로 단순화. 7개 실 stage를 4개 그룹(intent=orchestrating / retrieval=searching+graphing / table=parsing+extracting+researching+assembling / guardian=verifying)으로 **압축 매핑**. → 시각 임팩트↑, 단 세분 진행 정보 손실 + 매핑 로직 신규.
- **[가정]** 채팅 복잡도/회귀 리스크상 **방향 1 기본 전제**(stepper 유지 + 킷 톤 정합). 사용자가 킷 가로 스트립을 강하게 원하면 방향 2(매핑 테이블 추가 설계 필요).
- **부수 개선(권장)**: 현재 stage label 한국어 하드코딩 → `t()` 래핑(영/한 토글 정합). 단 이는 **시각 외 동작 무변경**.

### E. `ChatInput.tsx` (input) — **차이 거의 없음, 무변경 가까움**
- **현재**: textarea(autosize, `--bg-surface`) + send/stop 버튼(48x48). `ChatView.jsx:299-341`과 **거의 동일**. placeholder도 모드별 분기 일치.
- **킷 차이**: 킷은 stop 버튼 없음(현재는 `isStreaming` 시 Square 중단 버튼 = **실제 abort 기능, 보존 필수**). → **현재 유지**. 미세 스타일(radius/padding) 정합만.

### F. `ChatSidebar.tsx` (conversation list) — **킷에 없음, 무변경**
- 킷 ChatView엔 대화 목록 없음(글로벌 LeftSidebar 소속). → **이번 이식 범위 외, 무변경**. (일관성 위해 후속에서 별도 정합 가능하나 본 계획 제외.)

---

## CSS 클래스/토큰 — 현황 (대부분 이미 보강됨)

선행 Figures/Settings 이식으로 필요한 토큰이 **이미 `tokens.css`에 존재**:
- `--shadow-xs`(34), `--font-mono`(33), `--radius-xs/sm/md/lg`, `--color-accent-subtle`(17), `--color-success`(18), `--transition-fast`(38) — **모두 있음. 추가 불필요.**
- `.chat-user-bubble ::selection`(139) — 있음. 유지.
- 킷 `.eyebrow`(References 라벨) → 현재 미정의. **SettingsView 선례대로 인라인 style 헬퍼(`eyebrowStyle: CSSProperties`)로 변환**(별도 CSS 추가 대신).
- 킷 `.scroll-y`(`overflow-y:auto`) → 인라인 `overflow-y: auto`로 대체(FiguresView가 `.n`/인라인으로 처리한 선례).
- `.chat-markdown`/`.ln` className은 현재 CSS 정의 없음(ReactMarkdown 무스타일). 이식과 무관, 현행 유지.

> **결론**: `tokens.css` **신규 변경 불필요** 전망(Figures/Settings에서 선보강 완료). 단 만약 킷 메시지 컬럼/배지에서 `:hover`가 필요해지면 그때만 최소 규칙 추가.

---

## 설계

### DB 변경
변경 없음.

### Electron (Backend)
변경 없음. 새 IPC 채널 없음. 기존 `CHAT_TOKEN`/`CHAT_STATUS`/`CHAT_COMPLETE`/`CHAT_VERIFICATION_DONE`/`CHAT_ERROR` 이벤트와 `chat.sendMessage`/`abort`/`exportCsv` IPC 그대로 사용.
`CURRENT_EXTRACTION_VERSION` 범프: **불필요**.

### Frontend

**타입** (`types/chat.ts`, `types/desktop.ts`)
- 변경 없음. 전부 기존 타입 사용.

**데이터 계층** (`lib/chatQueries.ts`, `stores/chatStore.ts`)
- 변경 없음. 기존 훅/스토어 재사용. (단 ChatMessageList에서 `useActiveLlmModel` 추가 호출 — 이미 존재하는 훅, 신규 아님.)

**아이콘 (lucide)**
- 현재 이미 `lucide-react` named import 사용(`Table2`/`MessageCircleQuestion`/`User`/`Bot`/`Send`/`Square`/`Download`/`Search`/`ShieldCheck`/`Check` 등). 킷 신규 시각요소용으로 필요 시 `Table2`(table-2), `ShieldCheck`(shield-check), `FileText`(file 출처) 등 추가 named import. **CDN `Icon.jsx` 방식 미도입.**

**컴포넌트** (`features/chat/`)
- `ChatView.tsx`: 헤더/토글 미세 정합(거의 무변경). `useChatStreamBridge()` 호출 위치 보존.
- `ChatMessageList.tsx`: 메시지 컬럼(중앙 maxWidth 880, gap 16) + `MessageBubble`(user 우측/assistant R헤더+모델칩) + `StreamingBubble`(헤더형) 시각 개편. 마크다운/스트리밍/pending 로직 보존.
- `ChatTableReport.tsx`: 타이틀바(아이콘+제목+검증배지+CSV) + zebra 테이블(검증 색 병합) + 분리 References 블록 시각 개편. verification/source_refs/CSV/navigate/DOI 데이터 보존.
- `ChatPipelineStatus.tsx`: 방향 1 기준 — 현 stepper 유지 + 킷 톤 정합 + (권장)label `t()` 래핑.
- `ChatInput.tsx`: 미세 정합(무변경 가까움). abort 버튼 보존.
- `ChatSidebar.tsx`: 무변경.

**네비게이션**
- 변경 없음. `AppShell.tsx case "chat"`, `LeftSidebar.tsx activeNav==="chat"` 그대로.

---

## 작업 분해 (develop, 방향 1[stepper 유지] 기준)

1. [ ] **CSS/토큰 현황 확인** — `tokens.css`에 필요한 토큰 모두 존재 확인(추가 없음 전망). 킷 `.eyebrow`→인라인 `eyebrowStyle` 헬퍼 준비
2. [ ] **`ChatView.tsx`** — 헤더/모드 토글 킷 정합(거의 무변경). 모드 잠금/`useChatStreamBridge`/conversationType 동기화 보존. 문구 `t()` 확인
3. [ ] **`ChatMessageList.tsx`** — 중앙 컬럼(maxWidth 880, gap 16) + `MessageBubble`(user 우측 버블 / assistant R아바타+이름+`useActiveLlmModel` 모델칩 헤더+마크다운 본문) + `StreamingBubble`(헤더형, 마크다운 유지) + `pendingUserMessage` 버블 정합. 빈 상태 `t()` 유지
4. [ ] **`ChatTableReport.tsx`** — 타이틀바(table-2 아이콘+제목+**검증종합 배지**+CSV 버튼) + zebra 테이블(첫 열 bold/tabular-nums + **verification 색 병합·우선**) + **분리 References 블록**(번호 배지 카드, `source_refs` 데이터, navigate/DOI/evidence 보존). 행인덱스 가짜 첨자 미채택
5. [ ] **검증 배지 로직** — `verification` null→배지 숨김(또는 "Verifying"), 전부 verified→"Verified"(초록), 일부 unverified→"N unverified"(경고색). 무조건 초록 금지
6. [ ] **`ChatPipelineStatus.tsx`** — 방향 1: 현 stepper 유지 + 킷 칩/펄스 톤 정합 + stage label `t(en, ko)` 래핑(table 6/QA 3 + orchestrating/answering). 실 stage 매핑/단계 수 불변
7. [ ] **`ChatInput.tsx`** — 미세 스타일 정합. abort(Square) 버튼 + placeholder 모드 분기 보존
8. [ ] **lucide import 정합** — 신규 시각요소 named import 추가, CDN/Icon.jsx 미도입
9. [ ] **i18n 스윕** — 킷 한국어/혼합 하드코딩 전부 `t(en, ko)`로 분리(제목/스코프 칩/버블/배지/References 라벨/파이프라인 label). 영어 모드 한글 잔존 0 확인
10. [ ] **빌드/타입 통과** — `cd frontend && npm run build`(tsc -b + vite). `any` 0, vitest 회귀 통과(채팅 관련 테스트 있으면 우선)

---

## 영향 범위

- **수정되는 기존 파일**:
  - `frontend/src/features/chat/ChatMessageList.tsx` (중간~대규모: 버블/헤더/컬럼 개편)
  - `frontend/src/features/chat/ChatTableReport.tsx` (대규모: 타이틀바/배지/zebra/References 분리)
  - `frontend/src/features/chat/ChatPipelineStatus.tsx` (중간: 톤 정합 + label i18n)
  - `frontend/src/features/chat/ChatView.tsx` (소규모: 헤더/토글 미세 정합)
  - `frontend/src/features/chat/ChatInput.tsx` (소규모: 미세 정합)
  - (잠재) `frontend/src/styles/tokens.css` — 현재 전망상 무변경(필요 시 최소 hover 규칙만)
- **변경 없음**: `ChatSidebar.tsx`, `types/chat.ts`, `types/desktop.ts`, `lib/chatQueries.ts`, `stores/chatStore.ts`, `app/AppShell.tsx`, `app/LeftSidebar.tsx`, Electron 전체, DB.
- 새 IPC: 없음. 새 DB: 없음. 새 컴포넌트: 없음(기존 컴포넌트 시각 개편). 새 모듈: 없음.
- `CURRENT_EXTRACTION_VERSION` 범프: 불필요.

---

## 리스크 & 대안 (기능 회귀 포인트)

| 리스크 | 영향 | 대안 |
|---|---|---|
| **스트리밍 회귀** — 버블 개편 중 `streamingContent`/`appendToken`/`StreamingBubble` 렌더 경로 훼손 | 실시간 토큰 표시 안 됨(핵심 기능 깨짐) | `useChatStreamBridge` 호출·스토어 셀렉터·StreamingBubble 마크다운 경로 **로직 무변경**, 시각 컨테이너만 교체. 스트리밍 수동 검증 필수 |
| **파이프라인 stage 매핑 깨짐** — 방향 2 채택 시 7→4 압축 매핑 오류로 단계 표시 오작동 | 진행 상태 오표시 | **방향 1(현 stepper 유지) 기본**. 방향 2 선택 시 압축 매핑 테이블 별도 설계 + stage별 단위 검증 |
| **검증 배지 가짜화** — 킷의 무조건-초록 Verified를 그대로 옮기면 미검증 데이터에 "Verified" 오표시 | 신뢰성 훼손(허위 검증 표시) | 배지를 `verification` 실데이터에 연결. null→숨김, unverified 존재→경고. **무조건 초록 금지(리뷰 필수 체크)** |
| **셀 검증 색 vs zebra 충돌** — zebra 짝수행 배경이 verified/unverified 색을 덮음 | 검증 시각 손실 | verification 색 **우선**(zebra는 verification 없는 셀만). 명시적 우선순위 구현 |
| **References 데이터 손실** — 킷 MOCK_PAPERS 구조로 옮기다 `source_refs`(refNo/paperId/doi/evidence) 누락 | 출처 추적·논문 이동·DOI 링크 깨짐 | `TableReference` 필드 전부 매핑. `onNavigateToPaper`/`openExternal` 콜백 보존. paperId 클릭 동선 수동 검증 |
| **모델 칩 하드코딩** — 킷 `gpt-oss:120b` 문자열 잔존 | 실제 모델과 불일치 표시 | `useActiveLlmModel().model` 실값 사용, 없으면 칩 숨김 |
| **모드 잠금 해제 오류** — 킷의 자유 토글을 옮겨 기존 대화 모드 변경 허용 | conversation_type 불일치(QA 대화를 table로 전송 등) | `canToggleMode = !activeConversationId` 보존 |
| **abort 버튼 누락** — 킷엔 stop 없음 | 생성 중단 불가 | `isStreaming` 분기 + Square abort 버튼 보존 |
| **i18n 한글 잔존** — 킷 하드코딩 미래핑 | 영어 모드 한글 노출 | 작업 9 스윕 + 리뷰 체크. 현재 ChatPipelineStatus label도 함께 정리 |
| **마크다운 렌더 손실** — 버블 개편 중 ReactMarkdown 제거 | LLM 응답 포맷 깨짐 | `chat-markdown` + ReactMarkdown/remarkGfm 경로 유지 |
| **CSV 내보내기 버튼 누락** — 킷엔 없음 | 내보내기 기능 상실 | 타이틀바에 CSV 버튼 보존(배지 옆) |

---

## 비주얼/회귀 검증 방법 (현재 ↔ 이식본)

- `frontend/`에서 `npm run dev` → Chat 탭 진입(데스크탑 셸 필요 — IPC 의존).
- **킷 원본 미리보기**: `Redou Design System/ui_kits/redou/index.html` 브라우저로 열어 의도 비주얼 대조(메시지 컬럼, TableReport 배지/zebra/첨자, References 분리 블록, 파이프라인 스트립).
- **시각 체크**:
  1. 메시지 영역 중앙 컬럼(maxWidth 880) 정렬, user 우측 버블 / assistant R헤더+모델칩
  2. 모델 칩이 **실제 활성 모델**(가짜 `gpt-oss:120b` 아님)
  3. TableReport 타이틀바 배지가 **실제 검증 결과 반영**(전부 verified만 초록, 미검증 시 경고/숨김)
  4. 테이블 zebra + 검증 색이 공존(verification 색 우선)
  5. References 분리 블록(번호 배지 카드), 영/한 토글 시 라벨 전환
  6. 파이프라인 stepper(방향 1) 톤 정합 + label 영/한 전환
- **회귀 체크 (기능 — 가장 중요)**:
  1. **table 모드 전송** → orchestrating→searching→...→assembling 단계가 실시간 갱신, 테이블 생성, References/검증 색 표시
  2. **Q&A 모드 전송** → searching→answering, 토큰 스트리밍 실시간 누적
  3. **생성 중 Stop** → abort 동작(생성 중단)
  4. **Verifying 비동기 도착** → `onChatVerificationDone` 후 셀 검증 색/배지 갱신
  5. **References paperId 클릭** → 논문 상세 이동, **DOI 클릭** → 외부 링크
  6. **CSV 내보내기** → 파일 저장
  7. **기존 대화 선택** → conversationType 동기화, 모드 토글 잠금
  8. **새 대화 생성/이름변경/삭제**(ChatSidebar) → 정상(무변경 확인)

---

## 규모 판단 — develop (대규모)

| 기준 | 판단 |
|---|---|
| 수정 파일 수 | 4~5개 (ChatMessageList/ChatTableReport 대규모 + ChatPipelineStatus 중간 + ChatView/ChatInput 소규모) |
| DB 변경 | 없음 |
| 새 IPC | 없음 |
| 새 컴포넌트 | 없음 (기존 시각 개편) |
| 구조 변경 | 중간 (버블/테이블/References 시각 재구성, 데이터·이벤트 흐름 불변) |
| **복잡도/리스크** | **높음** — Redou에서 가장 복잡한 기능(실시간 스트리밍 + 다단계 파이프라인 + SRAG 테이블 + 검증). 시각 변경이 데이터/이벤트 경로를 건드리면 즉시 회귀 |

→ 파일 수는 중간이나 **실시간 스트리밍/파이프라인/테이블 생성이라는 고위험 영역의 시각 재구성**이라 **`/develop` 대상**(신중). 데이터/IPC/스토어/타입/백엔드 무변경이므로 develop 범위는 **프론트 시각 레이어로 한정**.

---

## 가정 사항 (승인 전 사용자 확인 필요)

1. **[필수] 파이프라인 방향**: 방향 1(현 세로 stepper 유지 + 킷 톤 정합, 실 다단계 정보 보존) vs 방향 2(킷 가로 4단계 스트립으로 압축, 7→4 매핑). 본 계획은 **방향 1 전제**(회귀 리스크↓).
2. **메시지 컬럼**: 킷 중앙 maxWidth 880 컬럼 채택 vs 현재 full-width 유지. 본 계획은 **킷 중앙 컬럼 채택** 전제(가독성).
3. **Assistant 헤더형**: 킷 R아바타+"Redou Orchestrator"+모델칩 헤더 도입 vs 현재 큰 아바타+버블 유지. 본 계획은 **킷 헤더형 + 모델칩 실값** 전제.
4. **검증 배지 정책**: verification null일 때 배지 "숨김" vs "Verifying..." 표시 중 선택(본 계획은 숨김 우선, 확정 필요).
5. **References 위치**: 테이블 카드 직후(현재 위치 유지) vs 메시지 하단 별도. 본 계획은 **테이블 직후** 전제.
6. **ChatPipelineStatus label i18n**: 현재 한국어 하드코딩 label을 이번에 `t()` 래핑할지(부수 개선, 권장) — 동작 무변경이나 파일 수정 동반.
7. **ChatInput/ChatSidebar**: 본 계획은 사실상 무변경. 더 적극적 정합 원하면 범위 추가.
