# 노트 워크스페이스
> 하네스 버전: v1.1 | 최종 갱신: 2026-05-31

## 개요
연구 노트 작성/편집/관리 워크스페이스. 6가지 노트 종류(`NoteKind`)와 다양한 scope(논문/섹션/청크/그림/하이라이트)를 지원한다. 디자인 킷 이식(리디자인 5호) 완료 — **3-pane IA**(좌 리스트 패널 + 드래그 리사이즈 + 우 캄 에디터).

## 핵심 파일
| 파일 | 역할 |
|------|------|
| `frontend/src/features/notes/NotesView.tsx` | 노트 워크스페이스 메인 (단일 파일, 보조 컴포넌트 포함) |
| `frontend/src/features/notes/notePresentation.ts` | `noteKindMeta`(종류별 label/accent/background) + `formatNoteDate` |

## 레이아웃 (3-pane)

```
┌──────────────────────────┬─┬─────────────────────────────┐
│ NoteList (width=listWidth)│R│ NoteEditor / EmptyEditor    │
│  ├ 헤더(Notes + 카운트 + New)│e│  ├ 헤더(NoteKindSelect       │
│  ├ 검색 input             │s│  │     +SaveStatus+pin)      │
│  ├ KindChip 행(전체+6종)   │i│  ├ 큰 제목 input(controlled) │
│  ├ CompactSelect×2        │z│  ├ MetaChip strip(논문/p.N/수정)│
│  │   (논문[글로벌]·정렬)    │e│  ├ linkedAnchor 배너(인용+소스)│
│  └ flat 리스트(NoteCard)   │H│  ├ 앵커 input(linked 시 숨김) │
│                          │a│  ├ 본문 textarea(controlled) │
│                          │n│  └ 푸터(워드/문자 + 저장 버튼)  │
│                          │d│                             │
│                          │l│                             │
│                          │e│                             │
└──────────────────────────┴─┴─────────────────────────────┘
   flex 컨테이너: display:flex; height:100%; overflow:hidden (외곽 패딩 0)
```

## 주요 컴포넌트 (NotesView.tsx 내부)
| 컴포넌트 | 역할 |
|----------|------|
| `NotesView` | 루트. flex 컨테이너 + 상태/파생/핸들러 + 드래그 로직 보유 |
| `NoteList` | 좌 패널. 헤더+검색+종류칩+select×2+flat 리스트. props로 상태 주입 |
| `KindChip` | 색 점 + 라벨 + 카운트. 종류 필터칩 (아이콘 없음) |
| `CompactSelect` | 논문(글로벌 selectedPaperId)·정렬 드롭다운. SVG chevron 인라인 배경 |
| `NoteCard` | 좌측 종류색 보더 + 종류칩/핀 + 날짜 + 제목(ellipsis) + 2줄 클램프 + 논문·p.N 푸터 |
| `ResizeHandle` | 드래그 분할선 (hover 인라인 state) |
| `NoteEditor` | 우 캄 에디터. controlled draft를 props로 받아 킷 시각으로 렌더 |
| `NoteKindSelect` | 킷 NoteKindChip 시각 + 투명 native `<select>` 오버레이 → 실 `draft.kind` 변경 |
| `MetaChip` | 헤더 메타 칩(논문[link]·p.N[accent]·수정일). 논문 칩 클릭 = `openPaperNotes` |
| `SaveStatus` | dirty 반영(미저장 = accent dot + "저장되지 않은 변경" / 저장됨 = check + "저장됨") |
| `IconButtonNotes` | pin 토글 버튼(hover 인라인). 실 `draft.pinned` 토글 |
| `EmptyEditor` | 노트 미선택 시 placeholder |

## 상태 / 파생

### 보존 (글로벌 `useUIStore`)
- `selectedPaperId`/`setSelectedPaperId` — **글로벌 공유**(리더·라이브러리·소스이동). 논문 필터 CompactSelect 값에 매핑("all"↔null).
- `selectedNoteId`/`setSelectedNoteId` — 활성 노트. `useEffect`로 빈 목록 시 null, 첫 노트 자동 선택.
- `setReaderTargetAnchor`/`openPaperDetail` — 소스 이동 동선.

### 보존 (편집/저장 — controlled draft)
- `draft: NoteDraft` (`{ title, content, kind, anchorLabel, pinned }`) + `setDraft`.
- `buildDraft(note)` / `isDraftDirty(activeNote, draft)` — dirty 추적.
- `useEffect`로 `activeNote` 변경 시 `setDraft(buildDraft(activeNote))` — 킷 `key={note.id}`+`defaultValue` 트릭을 대체하는 메커니즘(controlled가 더 견고).
- `handleSave()` — `anchorLabel: linkedSelectionNote ? undefined : draft.anchorLabel` 분기(linked 노트는 앵커 보존).
- `linkedSelectionNote = Boolean(activeNote?.highlightId || activeLinkedAnchor)` — 앵커 input 잠금(숨김) + 소스 배너 + 인용문(`activeQuote = anchorQuote.trim()`).

### 신규 (로컬 useState, 부수효과 0)
- `search` — 검색어. `matchesSearch(note, q)`(제목·본문 lowercase includes).
- `sort: "updated" | "created" | "title" | "kind"` — 정렬키(실 필드, pinned 우선).
- `kindFilter: NoteKind | "all"` — 종류 필터.
- `listWidth` — 드래그 폭(280~560px). `lazyListWidth()` lazy init + `localStorage["redou.notes.listWidth"]` 저장. `dragCleanupRef` + unmount cleanup으로 리스너 누수 방지.

### 파생 메모 (`useMemo`)
- `paperMap` — paperId → Paper.
- `paperScopedNotes` — `selectedPaperId` 필터(논문별).
- `kindCounts` — 종류별 카운트(paperScopedNotes 기준, 칩 표시용).
- `filteredNotes` — kindFilter + search 필터.
- `sortedNotes` — sort + pinned 우선 정렬.
- `activeNote` — sortedNotes에서 selectedNoteId 매칭(없으면 [0]).
- (제거됨) `groupedNotes` — 논문별 그룹 헤더. 방향 A에서 flat 리스트로 전환.

## 노트 종류 (NoteKind — 6종)
`frontend/src/types/paper.ts`: `"summary" | "insight" | "question" | "quote" | "action" | "memo"`.
`noteKindMeta`(notePresentation.ts)가 종류별 `label`(영문)/`accent`/`background` 단일 진실. 필터칩·에디터 종류 칩은 `NOTE_KIND_KEYS = Object.keys(noteKindMeta)` 순회로 생성.

| NoteKind | label | accent |
|----------|-------|--------|
| `summary` | Summary | #2563eb |
| `insight` | Insight | #0f766e |
| `question` | Question | #b45309 |
| `quote` | Quote | #7c3aed |
| `action` | Action | #be123c |
| `memo` | Memo | #64748b |

> DB 매핑은 `lib/paperRepository/mappers.ts`의 `KIND_TO_DB`/`DB_TO_KIND`가 6종 ↔ DB `note_type` 양방향 변환. (킷이 발명한 `idea`/`comparison`/`todo`는 실 타입·DB에 없어 폐기.)

## 노트 scope (note_scope enum)
| scope | FK | 설명 |
|-------|------|------|
| `paper` | paper_id | 논문 전체 |
| `section` | section_id | 특정 섹션 |
| `chunk` | chunk_id | 특정 청크 |
| `figure` | figure_id | 특정 Figure |
| `highlight` | highlight_id | 특정 하이라이트(소스 점프 연결) |

## 의존성
- 사용: Supabase(`notes` 테이블), TanStack Query(`useAllNotes`/`useAllPapers`/`useCreateNote`/`useUpdateNote`), `useUIStore`(selectedPaperId/selectedNoteId/소스이동 액션), `noteKindMeta`/`formatNoteDate`, `localeText`/`t()`.
- 사용됨: AppShell(`activeNav === "notes"`), PaperDetailView(notes 탭에서도 접근).

## 디자인 킷 이식 (리디자인 5호) 처리 원칙
- **시각만 이식, 로직 100% 보존**: controlled draft·저장·소스이동·하이라이트 연결 무변경.
- **킷 가짜 미채택**: 발명 종류 3종 폐기 / `defaultValue`+`key` 트릭(controlled 유지) / 무조건 "저장됨"(실 dirty) / `onNew` 빈함수(`handleCreateNote`) / **삭제 버튼·⌘S 힌트 미이식**(동작 없는 가짜 노출 금지).
- `.scroll-y` 클래스 미정의 → 인라인 `overflowY:auto`. lucide named import(kebab→PascalCase). `tokens.css` 무변경(필요 변수 전부 기존재).

## 현재 상태
- 구현 완료: 노트 CRUD, 종류 선택(투명 select), 핀 토글, 논문 연결, 소스 점프, 하이라이트 연결, 검색/정렬/종류필터, 드래그 리사이즈.
- 미구현: 노트 삭제, 단축키 바인딩(⌘S/⌘⏎), 종류칩 아이콘/한글 라벨(별도 작업 — `noteKindMeta` 확장 필요).
