# NotesView 디자인 킷 이식 (리디자인 5호 화면)

> 유형: feature | 상태: 계획 | 작성일: 2026-05-31
> 브랜치: `codex/rag-infra-extraction` | 대상: `frontend/src/features/notes/NotesView.tsx` (단일 파일)
> 선행 패턴: FiguresView(`docs/features/new/12-*.md`, 커밋 19141b7), SettingsView(`13-*.md`, e371b5e), ChatView(`14-*.md`, 38f1c98), SearchView(`15-*.md`, 8099d11)

## 개요

- **목적**: 새 디자인 킷(`Redou Design System/ui_kits/redou/NotesView.jsx`)의 레이아웃·스타일·인터랙션을 현재 `NotesView.tsx`에 이식한다. 데이터 리디자인의 **다섯 번째(마지막 주요 워크스페이스) 시범 화면**.
- **핵심 원칙**: "복붙"이 아니라 "디자인 이식". 킷의 **시각 구조**(인라인 style + CSS 변수, lucide named import, i18n 래핑)만 옮기고, 현재 `.tsx`의 **데이터 훅·편집/저장(dirty 추적)·linkedAnchor 소스 이동·하이라이트 연결·타입(TS)·i18n**은 100% 보존한다.
- **이번 화면의 특수성 — 현재 화면과 킷이 "구조부터 다르다".** Search(이미 정교)와 달리, NotesView는 **IA가 근본적으로 바뀐다**:
  - **현재**: 전체폭 2-단(`grid` 좌 리스트 / 우 에디터) + **논문별 필터칩** + **논문별 그룹 리스트**(논문 헤더 + 그 아래 노트 카드들). 검색/정렬/리사이즈 **없음**.
  - **킷**: **3-pane 느낌의 2분할**(좌 리스트 패널[내부에 필터/검색/정렬 헤더 통합] + **드래그 리사이즈 핸들** + 우 캄(calm) 에디터). **종류(kind)별 필터칩** + **노트 검색** + **정렬 드롭다운** + **리스트↔에디터 드래그 리사이즈**(localStorage).
- 따라서 이번 작업은 "시각 스킨"을 넘어 **레이아웃 재배치 + 신규 인터랙션(검색/정렬/리사이즈) 추가 + 필터 축 전환(논문→종류)**을 포함한다. 단, **편집/저장/소스이동 등 핵심 로직은 한 줄도 바꾸지 않는다.**
- **범위(실제 이식할 것)**:
  - 레이아웃: 현재 `padding 18px 20px` 전체폭 + 2-grid → 킷 **`display:flex; height:100%`** + 좌 리스트(가변폭) + ResizeHandle + 우 에디터(flex:1). 페이지 외곽 패딩 제거(꽉 찬 워크스페이스).
  - 좌 리스트 패널: **헤더(제목+카운트 뱃지+New 버튼) / 검색 입력 / 종류별 필터칩(wrap) / (논문 필터 + 정렬) compact select 행 / 스크롤 리스트(NoteCard)**.
  - **종류별 필터칩**(`KindChip`): 전체 + 6종(실 `noteKindMeta` 기반 — 아래 [가짜vs실제] 참조). 색 점 + 라벨 + 카운트.
  - **노트 검색**(신규): 제목·본문 부분문자열 필터.
  - **정렬 드롭다운**(신규): 최종수정/생성일/제목/종류 — 실 `updatedAt`/`createdAt`/`title`/`kind`로 동작.
  - **리스트↔에디터 드래그 리사이즈**(신규): `listWidth` 상태(280~560px clamp) + `ResizeHandle` + `localStorage["redou.notes.listWidth"]` 저장.
  - NoteCard: 킷 카드 스타일(좌측 종류색 보더 + 종류 라벨/핀 + 날짜 + 제목 + 2줄 본문 클램프 + 논문 제목·p.N 푸터).
  - 우 에디터: 킷 캄 에디터 헤더(`NoteKindChip` + 저장상태 + pin/delete 아이콘) + 큰 제목 input + 메타 칩 strip + linkedAnchor 배너 + 큰 textarea + 푸터(워드카운트 + 단축키 힌트). **단, 모든 입력은 현재의 controlled `draft` 패턴 유지**(킷의 `defaultValue`/`key` 패턴 미채택 — 아래 [가짜vs실제] 참조).
  - lucide named import 정합, 한국어 하드코딩 `t()` 래핑.
- **제외**:
  - 데이터 계층/IPC/스토어/타입/백엔드/DB 변경 — 일절 없음.
  - 편집/저장 로직(`draft` 상태, `isDraftDirty`, `handleSave`, `useUpdateNote`), 노트 생성(`handleCreateNote`, `useCreateNote`), linkedAnchor 소스 이동(`openNoteSource`/`openPaperNotes`), 하이라이트 연결(`linkedSelectionNote` 분기) — 일절 변경 없음.
  - 킷의 가짜 데이터(`MOCK_NOTES`/`MOCK_PAPERS`/하드코딩 `updatedAt:"2시간 전"`) 채택.
  - 킷이 발명한 가짜 노트 종류(`idea`/`comparison`/`todo`) — 실 타입에 없음. 채택 금지(아래 [가짜vs실제]).
  - 킷의 핀/삭제/종류변경 **드롭다운**의 미연결 동작 — 현재 구현 범위에 맞게 처리(아래 [미결] 참조).
  - `CURRENT_EXTRACTION_VERSION` 범프(추출 로직 무변경).

---

## [중대 인지] 킷은 단일 시안 + 전부 목업, 현재는 실제 노트 CRUD + 하이라이트 연결

킷 `NotesView.jsx`는 **백엔드 없는 디자인 시안**이다. `MOCK_NOTES`(7건 하드코딩)를 종류/논문/검색으로 필터링만 하고, **편집은 `defaultValue`만 표시**(저장 동작 없음, `onNew` 빈 함수), `SaveStatus`는 **무조건 "저장됨"**, 핀/삭제/종류 칩은 **클릭해도 아무 일 없음**, "소스로 이동" 버튼도 **동작 없음**.

반면 현재 구현은 **실제로 동작하는 노트 워크스페이스**다:
- **데이터**: `useAllNotes`(TanStack Query → `notes` 테이블) + `useAllPapers`(paperMap).
- **편집/저장**: controlled `draft` 상태 + `isDraftDirty(activeNote, draft)` + `handleSave`(`useUpdateNote.mutateAsync`). 저장 버튼은 `dirty && !isPending`일 때만 활성.
- **생성**: `handleCreateNote`(`useCreateNote.mutateAsync`) → 새 노트 선택.
- **소스 이동**: `openNoteSource`(linkedAnchor → `setReaderTargetAnchor` + `openPaperDetail("pdf")`) / `openPaperNotes`(논문 노트 탭 열기).
- **하이라이트 연결**: `linkedSelectionNote`(`highlightId || linkedAnchor`) → 앵커 input 잠금 + 소스 배너 + 인용문(`anchorQuote`) 표시.

| 킷 (`NotesView.jsx`, 목업) | 현재 (실 워크스페이스) | 데이터 연결 |
|---|---|---|
| `MOCK_NOTES` 7건 하드코딩 | `useAllNotes` (실 `notes` 테이블) | TanStack Query |
| `MOCK_PAPERS` paperMap | `useAllPapers` → `paperMap` | TanStack Query |
| `updatedAt:"2시간 전"` 문자열 | 실 ISO `updatedAt` + `formatNoteDate` | DB `updated_at` |
| 편집 = `defaultValue`(저장 없음) | controlled `draft` + `handleSave`/`useUpdateNote` | DB update |
| `onNew={() => {}}` (빈 함수) | `handleCreateNote`/`useCreateNote` | DB insert |
| `SaveStatus` = 무조건 "저장됨" | `dirty` → "저장되지 않은 변경"/"저장됨" | `isDraftDirty` |
| 핀/삭제/종류 칩 = 동작 없음 | pin 토글 = 실 `draft.pinned`+save / 삭제·종류드롭다운 = 현재 미구현 | (아래 [미결]) |
| "소스로 이동" = 동작 없음 | `openNoteSource` → PDF 페이지 점프 | `useUIStore` 액션 |
| `n.kind`(idea/comparison/todo 포함) | 실 6종(summary/insight/question/quote/action/memo) | `note_type` 매핑 |

> **구조 결론**: 킷의 시각(3-pane 레이아웃/종류 필터칩/검색/정렬/리사이즈/캄 에디터)은 차용 가치가 크다. 그러나 **편집·저장·생성·소스이동·하이라이트연결은 전부 현재 실 로직에 연결**해야 한다. 킷의 가짜를 그대로 옮기면 "편집되는 척하는 가짜 노트장"이 된다.

---

## [중대 결정 1] 노트 종류(kind) 매핑 — 킷의 발명 vs 실제 6종

이번 작업에서 **가장 위험한 함정**이다. 킷과 실제 타입이 **다르다.**

| 킷 `NOTE_KINDS` (6) | 실제 `NoteKind` 타입 (6) | 실제 `noteKindMeta` 색 |
|---|---|---|
| `summary` (요약, #2563eb) | `summary` (Summary) | #2563eb ✅ 동일 |
| `question` (질문, #a855f7) | `question` (Question) | #b45309 (색 다름) |
| `idea` (아이디어, #f59e0b) | ❌ **없음** | — |
| `comparison` (비교, #0f766e) | ❌ **없음** | — |
| `quote` (인용, #52627c) | `quote` (Quote) | #7c3aed (색 다름) |
| `todo` (할 일, #dc2626) | ❌ **없음** | — |
| — | `insight` (Insight) | #0f766e |
| — | `action` (Action) | #be123c |
| — | `memo` (Memo) | #64748b |

- **실제 타입**(`frontend/src/types/paper.ts:18`): `"summary" | "insight" | "question" | "quote" | "action" | "memo"`.
- **실제 메타**(`frontend/src/features/notes/notePresentation.ts`): `noteKindMeta`에 6종의 `label`/`accent`/`background` 정의. **여기엔 `icon`이 없다**(킷은 종류별 lucide 아이콘 사용).
- **DB 매핑**(`frontend/src/lib/paperRepository/mappers.ts`): `KIND_TO_DB`/`DB_TO_KIND`가 6종 ↔ DB `note_type` 양방향 변환. **킷의 idea/comparison/todo는 DB에 저장 불가**(매핑 없음 → 런타임 깨짐).

### 결정: **실제 6종(`noteKindMeta`)을 단일 진실로 사용**

- 필터칩/에디터 종류 칩은 **`Object.entries(noteKindMeta)`를 순회**해 생성(현재 `select`가 이미 이 방식). 킷의 `NOTE_KINDS` 객체는 **버린다.**
- 킷의 종류별 **아이콘**(file-text/help-circle/lightbulb/git-compare/quote/circle-check)은 6종 중 매핑되는 것만 선택 차용하거나, **아이콘 없이 색 점(dot)만** 사용(킷 `KindChip`도 색 점이 주력, 아이콘은 에디터 `NoteKindChip`에만). → **[가정 A]** 칩은 색 점만 사용, 에디터 종류 칩도 색 점만 사용(아이콘 매핑 불완전·6종 중 3종은 킷에 대응 아이콘 없음). 사용자가 아이콘을 원하면 `noteKindMeta`에 `icon` 필드를 추가하는 별도 작업(타입 확장 → 본 계획 범위 밖).
- 킷의 `k.ko`(한글 라벨)는 실제엔 없음. 종류 라벨은 **영문 `meta.label` 단일 표기**(현재 `select`와 동일) 또는 `t()`로 한/영 분기. → **[가정 B]** 현재 `select`가 `meta.label`(영문)만 쓰므로, 칩도 `meta.label` 단일 표기 유지(i18n 일관성보다 기존 동작 보존 우선). 한글 라벨이 필요하면 `noteKindMeta`에 `labelKo` 추가(별도 작업).

---

## [중대 결정 2] 논문 필터 축 — 현재 "논문별"(글로벌 상태) vs 킷 "종류별"(로컬)

| 측면 | 현재 `.tsx` | 킷 `.jsx` |
|------|-------------|-----------|
| 1차 필터 | **논문별 칩**(`selectedPaperId`) — 전체/논문A/논문B… | **종류별 칩**(`kindFilter` 로컬) — 전체/Summary/Question… |
| 논문 필터 | (1차 필터가 논문) | **compact select 드롭다운**(`paperFilter` 로컬, 보조) |
| 상태 위치 | `selectedPaperId`는 **글로벌 `useUIStore`** (리더/라이브러리와 공유) | `kindFilter`/`paperFilter` 둘 다 **로컬 useState** |
| 리스트 그룹핑 | **논문별 그룹**(논문 헤더 + 그 아래 노트들, `groupedNotes`) | **그룹 없음**(flat 리스트, 핀 우선만) |

### 핵심 주의: `selectedPaperId`는 글로벌 공유 상태다

현재 `selectedPaperId`(`uiStore.ts:16`)는 **노트 전용이 아니다.** 리더(`PaperDetailView`)·라이브러리·`openNoteSource`/`openPaperNotes`가 모두 읽고 쓴다. 노트 화면에서 논문 필터를 바꾸면 **다른 화면의 선택 논문도 바뀐다**(현재 동작). 또한 `openNoteSource`/`openPaperNotes`는 **`setSelectedPaperId`를 호출**하므로, 논문 필터를 글로벌에서 떼어내면 소스 이동 동선과 충돌할 수 있다.

### 두 가지 이식 방향

**[방향 A — 종류 필터 신규(로컬) + 논문 필터는 글로벌 `selectedPaperId` 유지, 그룹핑 제거] (권장, 보수)**
- **신규**: `kindFilter`(로컬 useState) + 종류 칩. `search`(로컬) + `sort`(로컬).
- **유지**: 논문 필터는 킷의 compact select에 매핑하되 **값은 글로벌 `selectedPaperId`**(`onChange`→`setSelectedPaperId`). → 리더/소스이동과의 글로벌 동기 **그대로 보존**.
- **제거**: `groupedNotes`(논문별 그룹 헤더) → 킷처럼 flat 리스트. NoteCard에 논문 제목을 푸터로 표시하므로 정보 손실 최소.
- **장점**: 글로벌 상태 동선(소스이동/리더 동기) 무변경 = 회귀 최소. 종류 필터/검색/정렬은 순수 추가(로컬, 부수효과 0).
- **단점**: 논문 필터가 로컬이 아니라 글로벌이라 "노트장에서만 임시로 논문 좁히기"가 다른 화면에 전파됨(단, 이는 **현재도 동일한 동작** — 회귀 아님).

**[방향 B — 논문 필터도 로컬로 분리] (비권장, 회귀 위험)**
- 논문 필터를 로컬 `paperFilter`로 두고 글로벌 `selectedPaperId`와 분리.
- **단점**: `openNoteSource`/`openPaperNotes`/`handleCreateNote`가 `selectedPaperId`에 의존 → 로컬/글로벌 이중 상태 동기화 필요 = **소스이동·생성 동선 회귀 리스크**. 본 리디자인의 "로직 보존" 취지에 어긋남.

> **[가정 C]** 본 리디자인 시리즈의 일관 원칙("시각만 이식, 데이터/로직 보존")과 글로벌 상태 회귀 리스크상 **방향 A를 기본 전제**로 한다. `groupedNotes` 그룹 헤더는 킷에 없으므로 제거(논문 제목은 카드 푸터로 노출). 사용자가 "논문별 그룹 유지"를 강하게 원하면 킷 flat 리스트 대신 그룹 리스트를 유지하는 절충안 가능(시각만 킷 카드 스타일).

---

## [중대 결정 3] 드래그 리사이즈 신규 인터랙션 이식 여부

킷 CHANGES.md §4의 핵심 신규 기능. 리스트↔에디터 경계를 드래그해 폭 조절(280~560px), `localStorage`에 저장.

- **이식 권장 O**: 순수 **로컬 UI 상태**(`listWidth` useState + `ResizeHandle` + `document` mousemove/mouseup 리스너)로, 데이터/스토어/IPC와 무관. 회귀 표면이 좁고 사용자 가치가 큼(노트는 긴 글 편집 → 폭 조절 수요 높음).
- **이식 시 주의점**:
  1. **localStorage 키**: `"redou.notes.listWidth"`(킷 그대로). 다른 화면과 충돌 없음(고유 prefix).
  2. **이벤트 리스너 정리**: 킷은 `onUp`에서 `removeEventListener` + `document.body.style` 복원. React에서 **컴포넌트 언마운트 시 누수 방지**를 위해 `useEffect` cleanup 또는 드래그 종료 보장 필요. → 킷 패턴(드래그 시작 시 add, mouseup 시 remove)은 안전하나, **언마운트 중 드래그가 끝나지 않는 엣지 케이스** 대비해 cleanup 추가 검토.
  3. **SSR/초기값**: `localStorage` 읽기는 lazy init(`useState(() => …)`)로 — 킷과 동일. Electron 렌더러라 SSR 이슈 없음.
  4. **타입**: `dragRef`(킷의 미사용 ref)는 제거. 핸들러에 `React.MouseEvent` 타입 명시.
- **[가정 D]** 드래그 리사이즈를 이식한다(권장). 사용자가 불필요하다고 판단하면 고정폭(예: 360px)으로 단순화 가능 — 그 경우 `ResizeHandle`/`listWidth`/localStorage 전부 생략.

---

## [차이] 현재 vs 킷 — 구체적 시각/구조 매핑표

| 영역 | 현재 `NotesView.tsx` | 킷 `NotesView.jsx` | 이식 방향 |
|------|----------------------|--------------------| ---------|
| 컨테이너 | `height:100%; overflow:auto; padding:18px 20px 26px` | `display:flex; height:100%; overflow:hidden` (패딩 0) | 킷 채택(꽉 찬 워크스페이스). AppShell이 `height:100%` 보장(`AppShell.tsx:150`) |
| 페이지 헤더 | 상단 큰 제목 + 설명문단 + New 버튼(전체폭) | **좌 패널 내부** 헤더(제목+카운트+New) | 킷 채택(헤더를 좌 패널로 이동). 설명 문단은 제거 또는 축약 |
| 1차 필터 | 논문별 칩 행 | 좌 패널: 검색 + 종류칩 + (논문 select + 정렬 select) | 킷 채택. 논문 select 값=글로벌 `selectedPaperId`(방향 A) |
| 리스트 | 논문별 **그룹**(헤더+노트들), 우측 "논문 열기" | **flat** 리스트(핀 우선), NoteCard | 킷 채택(그룹 제거, 카드에 논문 푸터) |
| NoteCard | 박스 카드(칩+날짜+제목+앵커라벨+요약) | 좌측 종류색 보더 + 칩/핀 + 날짜 + 제목 + 2줄 클램프 + 논문·p.N 푸터 | 킷 스타일 채택, 데이터는 실 노트 |
| 분할 | CSS `grid` 2열 고정비 | flex + **드래그 ResizeHandle** | 킷 채택(방향 D) |
| 에디터 헤더 | 종류칩 + 논문명 + "Editor" eyebrow + 최종수정 + dirty 상태 | `NoteKindChip` + 저장상태 + pin/delete 아이콘 + 큰 제목 input + 메타칩 strip | 킷 시각 채택, **dirty/save는 실 로직 연결** |
| 제목/본문 입력 | controlled `draft.title`/`draft.content` (onChange) | **`defaultValue` + `key={note.id}`** | **현재 controlled 유지**(킷 패턴 미채택 — [가짜vs실제]) |
| linkedAnchor | "Linked Reader Selection" 박스 + 소스 버튼 + 인용 | "소스로 이동" 인용 배너(상단) | 킷 시각 채택, `openNoteSource`/`anchorQuote` 실 연결 |
| 종류 변경 | `<select>`(draft.kind) | 종류칩 + chevron(드롭다운 암시, 동작 없음) | **현재 select 유지 또는 칩+팝오버**(아래 [미결]) |
| 앵커 input | `draft.anchorLabel` input(linked 시 잠금) | (킷엔 별도 앵커 input 없음 — 배너로 대체) | **현재 앵커 input 로직 보존** 필요(linked 잠금) |
| 저장 버튼 | "변경 저장" 버튼(dirty 시 활성) | 푸터 `⌘S` kbd 힌트(실제 버튼 없음) | **현재 저장 버튼 유지** + 킷 kbd 힌트는 시각 장식 |
| 푸터 | 없음 | 워드카운트 + `⌘S`/`⌘⏎` kbd | 시각 채택(워드카운트 실 계산). 단축키 실제 바인딩은 [미결] |
| 빈 상태(리스트) | "No notes yet" 박스(영문 하드코딩) | search-x + "매칭되는 노트가 없습니다" | 킷 시각 채택 + `t()` 래핑 |
| 빈 상태(에디터) | StickyNote + "노트를 선택하면…" | sticky-note + "노트를 선택하면…" | 거의 동일, 킷 시각 |
| 아이콘 | lucide named import(`BookOpen` 등 6개) | CDN `Icon name="…"`(kebab) | 모든 아이콘 lucide named import로 변환 |
| 스크롤 영역 | `overflow:auto`(루트) | `className="scroll-y"` | **인라인 `overflow:auto`로 변환**(`.scroll-y` 클래스 미정의 — Figures/Settings 선례) |
| 한국어 | `t(en, ko)` 래핑 | 한국어 하드코딩 | 전부 `t()` 래핑 |

---

## [가짜 vs 실제] 킷이 가짜로 표현한 것 → 현재 실제로 연결

이식 중 **반드시 가려내야 할** 항목. 킷의 "동작하는 척"을 그대로 옮기면 안 된다.

| 킷의 가짜 표현 | 실제 연결 / 처리 |
|---|---|
| `MOCK_NOTES` 7건 + `updatedAt:"2시간 전"` | `useAllNotes` 실 데이터 + `formatNoteDate(note.updatedAt)` |
| 종류 `idea`/`comparison`/`todo` | **실 타입에 없음 → 채택 금지.** `noteKindMeta` 6종(summary/insight/question/quote/action/memo)만 사용 |
| `defaultValue` + `key={note.id}` (입력 갱신) | **현재 controlled `draft` 패턴이 이미 노트 전환 시 `useEffect`로 갱신**(`NotesView.tsx:109-111`). 킷의 `key` 트릭 불필요(controlled가 더 견고). **변경 금지** |
| `SaveStatus` 무조건 "저장됨" | `dirty ? "저장되지 않은 변경" : "저장됨"` (실 `isDraftDirty`) |
| `onNew={() => {}}` 빈 함수 | `handleCreateNote`(`useCreateNote`) |
| 핀 아이콘 토글(동작 없음) | `draft.pinned` 토글 → `handleSave` 시 `is_pinned` 저장(현재 동작) |
| 삭제(trash) 버튼(동작 없음) | **현재 NotesView에 노트 삭제 기능 없음.** → [미결]: (a) 버튼 미이식(가짜 노출 금지), (b) 삭제 훅 신규(범위 확대). 기본 **(a) 미이식** |
| 종류 칩 chevron(드롭다운 암시, 동작 없음) | 현재 `<select>`로 종류 변경. → [미결]: select 유지 vs 칩+팝오버 신규 |
| "소스로 이동" 버튼(동작 없음) | `openNoteSource(note)` → `setReaderTargetAnchor` + `openPaperDetail("pdf")` (실 PDF 점프) |
| 검색 입력(목업 필터) | **실 동작 가능** — 제목·본문 부분문자열 필터(현재 미구현 → 신규, 순수 클라 필터) |
| 정렬 드롭다운(킷은 pinned만 정렬) | **실 동작 가능** — `updatedAt`/`createdAt`/`title`/`kind` 정렬(전부 실 필드 존재). 킷은 `sort` state를 받지만 실제론 pinned만 정렬 → 우리는 4종 전부 구현 |
| `⌘S`/`⌘⏎` kbd 힌트 | 시각 장식. **실제 키 바인딩은 [미결]**(현재 없음). 기본: 시각만, 바인딩 미구현(가짜 힌트 노출은 허용 가능하나 권장은 실제 바인딩 또는 제거) |
| `wordCount`/`chars` | 실 계산(`draft.content` 기준) — 진짜 동작 |

---

## 보존 대상 (절대 건드리지 않는 로직/훅) — 이식의 핵심 체크리스트

킷에는 아래가 **전혀 없다**(목업 7건 + CDN 프로토타입). 이식 중 **반드시 살아있어야 하는** 현재 자산:

### 1. 데이터 훅 (TanStack Query)
- `useAllNotes()` (`queries.ts:283`) — 노트 원천. `notes` 테이블 `updated_at DESC`.
- `useAllPapers()` — `paperMap`(논문 제목/venue/year) 원천.
- `useCreateNote()` (`queries.ts:485`) — 노트 생성. `mutateAsync({ paperId, kind })`.
- `useUpdateNote()` (`queries.ts:509`) — 노트 수정. `mutateAsync({ id, title, content, kind, anchorLabel, pinned })`.

### 2. 편집/저장 상태 머신 (controlled draft)
- `draft: NoteDraft` (`{ title, content, kind, anchorLabel, pinned }`) + `setDraft`.
- `buildDraft(note)` / `isDraftDirty(activeNote, draft)` — dirty 추적.
- `useEffect`로 `activeNote` 변경 시 `setDraft(buildDraft(activeNote))` (`NotesView.tsx:109-111`) — **킷의 `key={note.id}` 트릭을 대체하는 현재 메커니즘**. 보존.
- `handleSave()` — `anchorLabel: linkedSelectionNote ? undefined : draft.anchorLabel` 분기(linked 노트는 앵커 보존). 이 미묘한 분기 **그대로 유지**.

### 3. 선택/네비게이션 상태 (글로벌 `useUIStore`)
- `selectedPaperId`/`setSelectedPaperId` — **글로벌 공유**(리더·라이브러리·소스이동). 논문 필터에 매핑(방향 A).
- `selectedNoteId`/`setSelectedNoteId` — 활성 노트. `useEffect`로 빈 목록 시 null, 첫 노트 자동 선택(`NotesView.tsx:96-107`). 보존.
- `setReaderTargetAnchor` / `openPaperDetail` — 소스 이동 동선.

### 4. 소스 이동 / 하이라이트 연결
- `openNoteSource(note)` — `note.linkedAnchor` → PDF 페이지 점프.
- `openPaperNotes(paperId)` — 논문 노트 탭 열기.
- `linkedSelectionNote = Boolean(activeNote?.highlightId || activeLinkedAnchor)` — linked 분기(앵커 input 잠금 + 소스 배너 + 인용문).
- `activeQuote = activeNote?.anchorQuote?.trim()` — 인용 배너 텍스트.

### 5. 표시 메타 / i18n
- `noteKindMeta` (`notePresentation.ts`) — **6종 단일 진실**(label/accent/background). 킷 `NOTE_KINDS` 대체.
- `formatNoteDate` (`notePresentation.ts`) — 날짜 포맷.
- `localeText`/`t(en, ko)` — 모든 한국어 `t()` 래핑.
- 타입 `NoteKind`/`ResearchNote` (`types/paper.ts`) — `any` 0 유지.

### 6. 신규 추가 상태 (로컬 useState, 부수효과 0)
- `search`(검색어), `sort`(정렬키), `kindFilter`(종류 필터) — 전부 로컬, 표시용 파생만.
- `listWidth`(드래그 폭) + localStorage — 로컬 UI.

---

## 설계

### DB 변경
변경 없음.

### Electron (Backend)
변경 없음. (IPC 채널/핸들러/`CURRENT_EXTRACTION_VERSION` 무변경.)

### Frontend

**타입** (`types/`)
- 변경 없음. `NoteKind`(6종)/`ResearchNote` 그대로 사용.
- (선택·범위 밖) 종류별 아이콘/한글 라벨을 원하면 `noteKindMeta`에 `icon`/`labelKo` 필드 확장 — **본 계획 제외**([가정 A/B]).

**데이터 계층** (`lib/`)
- 변경 없음. `useAllNotes`/`useAllPapers`/`useCreateNote`/`useUpdateNote` 그대로.

**컴포넌트** (`features/notes/NotesView.tsx` — 단일 파일 전면 재구성)
- 루트 `NotesView`: flex 컨테이너 + 좌 리스트 + ResizeHandle + 우 에디터(or 빈 에디터).
- 내부 보조 컴포넌트(파일 내 정의, 킷 구조 참고):
  - `NoteList`(props: width, notes, activeId, setActiveId, paperMap, search/setSearch, kindFilter/setKindFilter, kindCounts, paperFilter/setPaperFilter, sort/setSort, onNew) — 헤더+검색+칩+select+리스트.
  - `KindChip`(active, onClick, color, label, count) — 색 점 + 라벨 + 카운트.
  - `CompactSelect`(value, onChange, options, Icon) — 논문/정렬 드롭다운(킷 SVG chevron 배경 인라인).
  - `NoteCard`(note, paper, active, onClick) — 카드 시각, **실 노트 데이터**.
  - `ResizeHandle`(onMouseDown) — 드래그 분할선.
  - `NoteEditor`(note, paper, draft, setDraft, dirty, onSave, linkedSelectionNote, activeQuote, openNoteSource, …) — **현재 에디터 로직을 킷 시각으로 감싼 형태**. 제목/본문 controlled, save 버튼 실 동작.
  - `NoteKindChip` / `MetaChip` / `SaveStatus`(dirty 반영) / `IconButtonNotes`(pin 실 토글) / `EmptyEditor`.
- **파생 메모(`useMemo`)**:
  - `paperMap`(기존), `filteredNotes`(검색+종류+논문 필터), `sortedNotes`(정렬키+pinned 우선), `activeNote`, `kindCounts`(종류별 카운트 — `noteKindMeta` 키 순회).
- **헬퍼**: `wordCount(text)`(킷 그대로), `matchesSearch(note, q)`(제목·본문 lowercase includes).

**네비게이션**
- 변경 없음. Notes nav는 이미 `LeftSidebar.tsx:121`에 `StickyNote` 아이콘으로 존재.

**스타일 토큰** (`styles/tokens.css`)
- **변경 없음 전망.** 킷이 쓰는 토큰 전부 이미 존재: `--color-bg-surface/panel/elevated/hover`, `--color-border-subtle`, `--color-text-primary/secondary/muted`, `--color-accent/accent-subtle`, `--color-success/warning/danger`, `--radius-xs/sm/md/lg`, `--transition-fast`, `--font-sans/mono`, `--shadow-xs/sm` (확인 완료).
- `.scroll-y` 클래스는 **미정의** → 인라인 `overflow:auto`/`overflowY:auto`로 변환(FiguresView `841`·Settings 선례).
- 드래그 핸들 hover는 인라인 state(`hover` useState)로 표현(킷 방식) → CSS `:hover` 규칙 불필요. (Figures의 `.fig-card:hover`처럼 추가할 수도 있으나 인라인으로 충분.)

---

## 작업 분해

`/develop` 에이전트가 이 순서대로 실행한다. **단일 파일(`NotesView.tsx`) 재구성**이 핵심.

1. [x] lucide named import 정리 — 사용 아이콘: `Plus, Search, X, SearchX, StickyNote, Pin, Clock, Bookmark, ExternalLink, FileText, Quote, Check, ChevronDown, ArrowUpDown` (킷 kebab → PascalCase). 미사용(`BookOpen`, `Save`) 제거. `Trash2`는 삭제 버튼 미이식이므로 import하지 않음.
2. [x] 신규 로컬 상태 추가: `search`/`sort`/`kindFilter`(useState) + `listWidth`(`lazyListWidth()` localStorage lazy init) + `ResizeHandle` 드래그 로직(`startDrag` mousemove/up + `dragCleanupRef` + unmount cleanup).
3. [x] 파생 메모 재구성: `paperScopedNotes`(논문) → `filteredNotes`(검색+종류) → `sortedNotes`(sort+pinned) → `activeNote`/`kindCounts`. **기존 `groupedNotes` 제거**(방향 A).
4. [x] 루트 레이아웃 교체: 전체폭 grid → `display:flex; height:100%; overflow:hidden` + 좌 `NoteList` + `ResizeHandle` + 우 `NoteEditor`/`EmptyEditor`.
5. [x] `NoteList` 구현: 헤더(제목+카운트+New[=`handleCreateNote`]) + 검색 input + `KindChip` 행(`NOTE_KIND_KEYS` 순회) + `CompactSelect`×2(논문[=`selectedPaperId`]/정렬) + flat 리스트(`NoteCard`) + 빈상태(search-x).
6. [x] `NoteCard` 구현: 킷 시각 + 실 노트(`noteKindMeta[note.kind]`, `formatNoteDate`, `paperMap`, `note.pageNumber`, `note.pinned`). 텍스트 클램프/`flexShrink:0` 반영.
7. [x] `NoteEditor` 구현: 킷 헤더(`NoteKindSelect`[칩 시각+투명 select]+`SaveStatus`[dirty]+pin[실토글]; delete 미이식) + 제목 input(**controlled `draft.title`**) + 메타칩 strip + linkedAnchor 배너(`openNoteSource`/`activeQuote`) + 본문 textarea(**controlled `draft.content`**) + 종류 변경(투명 native select) + 앵커 input(linked 시 숨김 보존) + 저장 버튼(**실 `handleSave`, dirty 활성**, 푸터로 이동) + 푸터(워드/문자 카운트, ⌘S kbd 힌트는 미이식).
8. [x] 빈 상태(`EmptyEditor`) + 빈 리스트(search-x) + 모든 한국어 `t()` 래핑 확인.
9. [x] `any` 0 / 미사용 import 0 / 보존 로직(handleSave/openNoteSource/useEffect 선택 동기) 무변경 검증. 빌드(tsc -b+vite) 통과·vitest 28건 회귀 통과.

---

## 구현 중 변경 사항

- **[미결 3 — ⌘S/⌘⏎ 단축키] → kbd 힌트 제거로 확정**: 계획서 기본안은 "시각 힌트만 또는 제거"였다. 동작하지 않는 단축키 힌트는 삭제 버튼 미이식과 동일한 "가짜 노출 금지" 원칙에 어긋나므로 **kbd 힌트를 노출하지 않는다**(실제 키 바인딩 미구현). 푸터에는 실제로 계산되는 **워드/문자 카운트만** 유지. 실 저장은 푸터의 "변경 저장" 버튼(`handleSave`, dirty 활성)으로 수행.
- **[미결 2 — 종류 변경 UI] → 킷 NoteKindChip 시각 + 투명 native `<select>` 오버레이**: 계획서 기본안("현재 select 유지")의 동작을 보존하되, 킷의 캄 에디터 헤더 시각(색 점 칩 + chevron)을 살리기 위해 `NoteKindSelect`에서 칩 위에 `opacity:0` native select를 절대배치로 겹쳤다. 네이티브 select 동작(접근성·키보드)을 그대로 쓰면서 시각만 킷 칩으로 대체 — 가짜 드롭다운이 아님.
- **앵커 input 배치**: 현재 별도 그리드 행이던 앵커 input을 에디터 본문 영역 상단(제목 점선 구분선)으로 이동. linked 노트일 때는 **숨김**(기존 "linked 시 잠금" 로직을 "linked 시 미표시"로 — 앵커는 `handleSave`에서 `undefined`로 보존되므로 동작 동일).
- **`Trash2` 미import**: 삭제 버튼 미이식([미결 1])에 따라 lucide `Trash2` 자체를 import하지 않음(미사용 import 0 원칙).
- **`kindCounts` 산정 기준**: 종류칩 카운트를 전체 노트가 아닌 **`paperScopedNotes`(논문 필터 적용 후) 기준**으로 산정 — 논문을 좁히면 칩 카운트도 해당 논문 기준으로 반영(검색·종류 필터는 제외해 칩 자체 카운트는 안정적).

## 영향 범위

- **수정되는 기존 파일**: `frontend/src/features/notes/NotesView.tsx` (단일 파일, 전면 재구성).
- **읽기만(변경 없음)**: `notePresentation.ts`(noteKindMeta/formatNoteDate), `types/paper.ts`, `lib/queries.ts`, `lib/paperRepository/*`, `stores/uiStore.ts`, `styles/tokens.css`, `app/AppShell.tsx`, `app/LeftSidebar.tsx`.
- **CURRENT_EXTRACTION_VERSION 범프**: 불필요(추출 로직 무변경).
- **DB/IPC/Electron/스토어/타입**: 무변경.

## 리스크 & 대안

| 리스크 | 영향 | 대안/완화 |
|--------|------|-----------|
| 편집/저장 회귀 | 노트 저장 안 됨/dirty 오판 | controlled `draft` + `isDraftDirty` + `handleSave` **그대로 유지**. 킷 `defaultValue`/`key` 미채택. 입력은 onChange로 draft 갱신 |
| 소스 이동 회귀 | PDF 점프 안 됨 | `openNoteSource`/`openPaperNotes`/`setReaderTargetAnchor` 시그니처·호출 무변경 |
| 종류 매핑 깨짐 | idea/comparison/todo 저장 시 런타임 오류 | **킷 NOTE_KINDS 폐기, `noteKindMeta` 6종만 사용**([중대결정1]) |
| 글로벌 `selectedPaperId` 부작용 | 노트 논문필터가 리더/라이브러리에 전파 | 방향 A — **현재도 동일 동작**(회귀 아님). 글로벌 유지로 소스이동 동선 보존 |
| 드래그 리스너 누수 | 언마운트 중 드래그 시 리스너 잔존 | mouseup에서 remove(킷) + 필요 시 `useEffect` cleanup 보강 |
| 노트 그룹핑 제거 | "논문별 묶음" 정보 손실 | NoteCard 푸터에 논문 제목·p.N 노출. 사용자가 그룹 원하면 절충안([가정 C]) |
| 삭제 버튼 가짜 노출 | trash 아이콘 클릭 무동작 | 기본 **미이식**(가짜 노출 금지). 삭제 기능은 별도 계획 |

## 가정 사항 (사용자 확인 필요)

- **[가정 A]** 필터칩/에디터 종류 칩은 **색 점만**(아이콘 없음). 6종 중 3종은 킷 대응 아이콘이 없고 `noteKindMeta`에 `icon` 필드도 없어, 아이콘 매핑은 타입 확장(별도 작업)이 필요. → *아이콘을 원하면 알려주세요.*
- **[가정 B]** 종류 라벨은 영문 `meta.label` 단일 표기(현재 `select`와 동일). 한글 라벨(`labelKo`)은 별도 작업. → *한/영 라벨 원하면 알려주세요.*
- **[가정 C]** 방향 A 채택: 종류/검색/정렬은 로컬 신규, **논문 필터는 글로벌 `selectedPaperId` 유지**, **논문별 그룹 헤더(`groupedNotes`) 제거**(flat 리스트 + 카드 푸터에 논문명). → *논문별 그룹 묶음을 유지하고 싶으면 알려주세요(절충 가능).*
- **[가정 D]** 드래그 리사이즈(280~560px, localStorage) **이식**. → *불필요하면 고정폭으로 단순화.*
- **[미결 1 — 삭제 버튼]** 킷 trash 아이콘. 현재 NotesView에 삭제 기능 **없음**. 기본 **미이식**(가짜 노출 금지). → *삭제 기능을 추가하려면 별도 범위(삭제 훅 + 확인 다이얼로그) 필요.*
- **[미결 2 — 종류 변경 UI]** 킷은 종류 칩+chevron(드롭다운 암시). 현재는 `<select>`. 기본 **현재 select 유지**(동작 보존). → *칩+팝오버 메뉴를 원하면 신규 UI 작업 추가.*
- **[미결 3 — ⌘S/⌘⏎ 단축키]** 킷 푸터 kbd 힌트. 현재 키 바인딩 **없음**. 기본 **시각 힌트만**(실 바인딩 미구현) 또는 **힌트 제거**. → *실제 단축키(저장/새노트)를 바인딩하려면 keydown 핸들러 추가(소규모).*

---

## 규모 판단 — `/develop` 예상

| 기준 | 판정 |
|------|------|
| 수정 파일 수 | **1개**(`NotesView.tsx` 전면 재구성) |
| DB 변경 | 없음 |
| 새 IPC 채널 | 없음 |
| 새 컴포넌트 | 파일 내 보조 컴포넌트(NoteList/NoteCard/NoteEditor/ResizeHandle 등) — 외부 신규 모듈 아님 |
| 새 모듈 | 없음 |
| 신규 인터랙션 | 검색/정렬/종류필터/드래그리사이즈(전부 로컬 상태) |

> **판정: `/develop` (대규모 변경)**. 수정 파일은 1개지만 (a) IA가 근본적으로 바뀌고(2-grid→3-pane flex), (b) 신규 인터랙션 4종(검색/정렬/종류필터/드래그리사이즈)을 추가하며, (c) 편집/저장/소스이동/하이라이트연결 등 **고위험 핵심 로직을 보존하면서 시각을 전면 교체**하는 작업이라 단순 fix를 넘어선다. 선행 리디자인 4건(Figures/Settings/Chat/Search)과 동일하게 **feature(`/develop`)** 트랙으로 진행하며, 위 [가정 A~D]·[미결 1~3] 승인 후 착수한다. 시각 레이어 한정이나 controlled 편집/소스이동 보존이 회귀 핵심.
