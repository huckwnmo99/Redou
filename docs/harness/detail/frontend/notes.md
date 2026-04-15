# 노트 워크스페이스
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 개요
논문별 연구 노트 작성/편집/관리 워크스페이스. 7가지 노트 유형과 다양한 scope(논문/섹션/청크/그림/하이라이트)를 지원한다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `frontend/src/features/notes/NotesView.tsx` | 노트 워크스페이스 메인 | ~676 |
| `frontend/src/features/notes/notePresentation.ts` | 노트 유형 메타/포맷팅 | — |

## 주요 컴포넌트

### NotesView
- 좌측 패널: 노트 목록 (논문별 필터, 검색)
- 우측 패널: 노트 편집기 (제목, 내용, 유형, 핀)
- 새 노트 생성: `useCreateNote` 훅
- 노트 수정: `useUpdateNote` 훅
- dirty 감지: `isDraftDirty()` → 저장 버튼 활성화

### notePresentation.ts
- `noteKindMeta`: 노트 유형별 아이콘/라벨/설명
- `formatNoteDate`: 날짜 포맷팅

## 노트 유형 (note_type enum)
| 유형 | 설명 |
|------|------|
| `summary_note` | 요약 |
| `relevance_note` | 관련성 메모 |
| `presentation_note` | 발표 메모 |
| `result_note` | 결과 메모 |
| `followup_note` | 후속 연구 |
| `figure_note` | Figure 메모 |
| `question_note` | 질문 |
| `custom` | 사용자 정의 |

## 노트 scope (note_scope enum)
| scope | FK | 설명 |
|-------|------|------|
| `paper` | paper_id | 논문 전체 |
| `section` | section_id | 특정 섹션 |
| `chunk` | chunk_id | 특정 청크 |
| `figure` | figure_id | 특정 Figure |
| `highlight` | highlight_id | 특정 하이라이트 |

## 의존성
- 사용: Supabase (notes 테이블), TanStack Query (useAllNotes, useCreateNote, useUpdateNote), uiStore
- 사용됨: AppShell (activeNav === "notes"), PaperDetailView (notes 탭에서도 접근)

## 현재 상태
- 구현 완료: 노트 CRUD, 유형 선택, 핀, 논문 연결
