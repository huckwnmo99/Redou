# Frontend Structure Options

이 문서는 현재 결정한 프론트엔드 스택을 기준으로,  
이 앱의 프론트엔드를 **대략적으로 어떻게 구성할지**를 정리한 초안이다.

고정 전제:
- Desktop shell: `Electron`
- Frontend: `React + TypeScript`
- Styling: `Tailwind CSS + CSS variables`
- UI primitives: `Radix Primitives`
- State: `Zustand`
- PDF Viewer: `PDF.js`
- Database: `local Supabase` 고려
- Visual direction: `subtle glassmorphism + neutral Notion-like tone`

목적:
- 지금 당장 세부 구현을 정하는 것이 아니라
- 화면 구조, 데이터 흐름, 폴더 방향, 역할 분리를 대략적으로 맞추는 것

---

## 1. 프론트엔드에서 맡을 역할

프론트엔드는 아래 역할에 집중한다.

- 논문 업로드 UI
- 라이브러리 목록 / 필터 / 검색 UI
- 논문 카드 및 상세 화면
- PDF 뷰어
- figure 보기
- 메모 작성과 편집
- 상태 표시: 업로드 중, 분석 중, 완료, 실패
- Supabase 데이터 조회/수정 결과를 화면에 반영

프론트엔드가 직접 하지 않는 것:
- PDF 파싱 로직 자체
- 파일명 변경의 실제 파일 시스템 작업
- LLM 처리 로직
- 섹션/figure 추출 엔진

이런 작업은 Electron main process 또는 별도 backend/service 레이어가 맡는 편이 안전하다.

### 1-1. 디자인 방향

현재 시각 방향은 아래처럼 정리한다.

- 전체 톤은 무채색 중심
- Notion처럼 과하게 튀지 않는 차분한 업무용 인상
- 다만 평면적이지만은 않도록, 약한 glassmorphism과 layered surface 사용
- 강조는 색 자체보다 구조, 여백, 투명도 차이로 주는 편이 맞다

---

## 2. 전체 화면 구성 옵션

중요 전제:
- 기본 UI는 3패널 workspace로 간다.
- 하지만 사용자가 원하면 각 패널을 끄고 켤 수 있어야 한다.
- 또한 특정 패널은 별도의 독립 창으로 분리(detach)할 수 있어야 한다.
- 즉, 단순 3단 레이아웃이 아니라 `도킹 가능한 workspace`로 보는 것이 맞다.

### Option A. Workspace 중심 3패널 구조

구성:
- 왼쪽: 라이브러리 / 폴더 / 태그 / 필터 / 업로드
- 가운데: 논문 리스트 또는 논문 상세 핵심 영역
- 오른쪽: 메모 / figure / metadata / activity panel

장점:
- 연구 도구 느낌이 강함
- 논문을 보면서 메모를 함께 쓰기 좋음
- 나중에 PDF + figure + notes를 동시에 보여주기 좋음

단점:
- 처음 설계가 조금 더 복잡함
- 작은 화면에서 답답할 수 있음

적합도:
- 매우 높음

### Option B. List + Detail 2단 구조

구성:
- 왼쪽: 논문 리스트
- 오른쪽: 선택한 논문 상세

장점:
- 단순하고 구현이 쉬움
- MVP 초반에는 빠르게 만들기 좋음

단점:
- 기능이 늘어나면 detail 화면이 비대해짐
- PDF, notes, figures를 동시에 보기 어렵다

적합도:
- 높음

### Option C. Route 중심 구조

구성:
- `/library`
- `/paper/:id`
- `/search`
- `/settings`

장점:
- 구조가 명확함
- 기능이 커져도 관리가 편함

단점:
- 데스크톱 도구 특유의 한 화면 집중 작업감은 약해질 수 있음

적합도:
- 높음

### 현재 권장

- 기본 골격은 `Option A`
- 내부 구현은 `Option C`의 route 개념을 섞는 방식
- 패널 구조는 처음부터 `show/hide + detach/reattach` 가능성을 염두에 둔다

즉:
- 겉으로는 workspace형 앱처럼 보이되
- 내부 라우팅은 `library`, `paper detail`, `search`, `settings` 정도로 나누는 것이 좋다.
- 각 패널은 합쳐진 창 안에서 보일 수도 있고, 필요하면 별도 창으로 뺄 수 있어야 한다.

---

## 3. 추천 화면 구조

### 3-1. App Shell

최상위 구조 예시:

- Top bar
- Left sidebar
- Main content
- Right inspector panel
- Bottom status bar

각 영역 역할:

- Top bar: 전역 검색, 빠른 업로드, 현재 분석 상태, 설정 진입
- Left sidebar: Library, Folders, Recent, Important, Revisit, Tags, Filters
- Main content: 논문 리스트 / 상세 화면 / 검색 결과
- Right panel: 선택한 paper의 notes, metadata, figure quick view
- Bottom status: ingestion job, sync status, local db 상태

기본 원칙:
- Left/Main/Right 패널은 각각 visible state를 가져야 한다.
- Right panel은 notes, metadata, figures를 상황에 따라 바꿔 보여주는 inspector 역할을 한다.
- PDF reader나 notes panel은 추후 별도 창으로 분리 가능해야 한다.

### 3-2. 주요 화면 목록

필수 화면:
- Library
- Paper Detail
- Search
- Import Queue
- Settings

선택 화면:
- Figure Browser
- Note View
- Analysis Queue

### 3-3. Paper Detail 내부 탭 구조

권장 탭:
- Overview
- PDF
- Sections
- Figures
- Notes
- Metadata

의도:
- Overview는 논문 카드 요약 중심
- PDF는 원문 읽기 중심
- Sections는 구조화 본문 확인
- Figures는 figure/caption/linked text 확인
- Notes는 사용자 메모와 LLM 요약 관리
- Metadata는 DOI, 파일명, 상태, provenance 확인

### 3-4. 패널 제어 요구사항

이 앱의 패널은 고정 레이아웃이 아니라 작업 방식에 맞게 바뀔 수 있어야 한다.

필수 요구사항:
- 각 패널 `show/hide` 가능
- 왼쪽 패널 숨기기 가능
- 오른쪽 패널 숨기기 가능
- PDF 중심 모드에서 메모 패널 숨기기 가능
- 메모 패널만 따로 띄우기 가능
- PDF viewer를 별도 창으로 띄우기 가능
- detached panel을 다시 메인 창에 붙이기 가능

추천 패널 분리 후보:
- PDF viewer
- Notes panel
- Figures panel

처음부터 모든 패널을 다 detachable하게 만들 필요는 없지만, 최소한 `PDF`와 `Notes`는 분리 가능하게 설계하는 편이 좋다.

### 3-5. 권장 동작 방식

기본 상태:
- 하나의 메인 창 안에 3패널로 통합

사용자 선택 시:
- 특정 패널 숨김
- 특정 패널만 확장
- 특정 패널을 별도 창으로 분리

재실행 시:
- 마지막 레이아웃 상태를 복원하는 것이 좋다

예시 레이아웃:
- 기본 연구 모드: Left + Main + Right
- 읽기 집중 모드: Main only
- 읽기 + 메모 모드: Main + detached Notes
- figure 검토 모드: Main + Right(Figures)

---

## 4. 프론트엔드 데이터 흐름 옵션

### Option A. 컴포넌트에서 Supabase 직접 호출

흐름:
- React component -> supabase client 직접 사용

장점:
- 빠르게 시작 가능

단점:
- 화면 로직과 데이터 로직이 섞임
- 나중에 유지보수가 어려워짐

적합도:
- 낮음

### Option B. Hook/Service 레이어 분리

흐름:
- React component
- custom hooks
- feature service / repository
- supabase client

장점:
- 역할이 분리됨
- 화면 교체와 데이터 로직 수정이 쉬움

단점:
- 초반 구조를 조금 더 잡아야 함

적합도:
- 매우 높음

### Option C. TanStack Query + Zustand 혼합

흐름:
- 서버성 데이터: TanStack Query
- UI 상태: Zustand
- 실제 저장소: local Supabase

장점:
- 쿼리 캐시, 로딩 상태, invalidation 관리가 좋음
- UI 상태와 DB 상태를 나눌 수 있음

단점:
- 라이브러리 하나가 더 늘어남

적합도:
- 매우 높음

### 현재 권장

- `TanStack Query + Zustand + service/repository layer`

역할 분리:
- Zustand: 모달, 패널 열림 상태, 선택된 paper, 필터, 뷰 모드
- Zustand: 패널 docking 상태, detached window 상태, 현재 layout preset
- TanStack Query: papers, notes, figures, sections, jobs 조회/갱신
- Service/Repository: Supabase query 묶음

---

## 5. local Supabase를 고려한 프론트엔드 경계

### 기본 원칙

- 메타데이터, notes, sections, chunks, figures 정보는 `local Supabase`에서 읽는다.
- 실제 PDF 파일 복사, 파일명 변경, 로컬 경로 작업은 Electron 쪽에서 처리한다.
- 프론트엔드는 파일 내용을 직접 만지기보다, `파일 작업 요청 -> main process 처리 -> DB 갱신` 흐름을 따르는 게 좋다.

### 추천 흐름

1. 사용자가 PDF 드래그 앤 드롭
2. Electron preload/main이 파일 복사
3. ingestion 파이프라인 실행
4. 결과가 local Supabase에 저장
5. React가 Supabase 조회 결과를 다시 렌더링

### 파일 저장 방식 옵션

#### Option A. 파일은 로컬 디스크, 메타데이터는 Supabase

장점:
- 가장 단순함
- Windows 앱에 자연스러움
- PDF/이미지 대용량 파일 처리에 유리함

단점:
- 파일 백업/이동은 별도 정책이 필요

적합도:
- 매우 높음

#### Option B. 파일까지 Supabase Storage 사용

장점:
- 저장 방식 일관성
- 장기적으로 공유 구조와 연결하기 쉬움

단점:
- 로컬 앱 MVP에서는 다소 무거울 수 있음
- 대용량 PDF 처리 흐름이 더 복잡해질 수 있음

적합도:
- 중간

### 현재 권장

- `파일은 로컬 디스크`
- `구조화 데이터는 local Supabase`

---

## 6. 상태 관리 구분

프론트엔드 상태는 크게 3종류로 나누는 것이 좋다.

### 6-1. UI 상태

예:
- 현재 선택한 paper id
- sidebar 접힘 여부
- 오른쪽 패널 열린 탭
- PDF 확대 비율
- 현재 선택한 figure
- 패널 visible 여부
- 패널 detached 여부
- 현재 레이아웃 preset

권장 저장:
- Zustand

### 6-2. 서버성 데이터 상태

예:
- paper 목록
- notes
- figures
- sections
- jobs

권장 저장:
- TanStack Query

### 6-3. 일시 입력 상태

예:
- 메모 작성 중 임시 텍스트
- 메타데이터 수정 폼
- 태그 편집 중 draft

권장 저장:
- component local state 또는 React Hook Form

---

## 7. 기능 단위 폴더 구성 옵션

### Option A. 타입별 폴더 구조

예시:
- `components/`
- `pages/`
- `hooks/`
- `stores/`
- `lib/`

장점:
- 처음에는 익숙함

단점:
- 기능이 커질수록 관련 파일이 흩어진다

적합도:
- 중간

### Option B. feature 기반 구조

예시:
- `features/library/`
- `features/paper/`
- `features/import/`
- `features/search/`
- `features/settings/`

장점:
- 관련 코드가 모인다
- 기능별로 확장하기 좋다

단점:
- 초반에는 다소 과하게 느껴질 수 있다

적합도:
- 매우 높음

### 현재 권장

- `feature 기반 구조`

대략 예시:

```txt
src/
  app/
  components/
  features/
    library/
    paper/
    import/
    search/
    notes/
    figures/
  hooks/
  lib/
    supabase/
    electron/
  stores/
  styles/
  types/
```

---

## 8. 추천 페이지/기능 분리

### Library feature

역할:
- 논문 목록
- 폴더 트리
- 태그/상태 필터
- 정렬
- 빠른 검색

주요 컴포넌트:
- PaperList
- FolderTree
- FilterPanel
- TagSidebar
- ImportButton

### Paper feature

역할:
- 논문 상세
- 카드 정보
- metadata 수정
- 읽음 상태 변경

주요 컴포넌트:
- PaperHeader
- PaperOverviewCard
- PaperTabs
- MetadataEditor

### PDF feature

역할:
- PDF 렌더링
- 페이지 이동
- chunk/figure 하이라이트

주요 컴포넌트:
- PdfViewer
- PdfToolbar
- PageNavigator

### Notes feature

역할:
- 논문 메모
- section/chunk/figure 연결 메모
- note type 관리

주요 컴포넌트:
- NoteEditor
- NoteList
- NoteTypeTabs

### Figures feature

역할:
- figure 목록
- figure 상세
- caption + linked text 표시

주요 컴포넌트:
- FigureGallery
- FigureCard
- FigureDetailPanel

### Search feature

역할:
- 키워드 검색
- 조건 검색
- 추후 RAG 결과 표시

주요 컴포넌트:
- SearchInput
- SearchFilterBar
- SearchResultList

---

## 9. 프론트엔드 MVP 구성안

MVP에서는 아래 정도만 있어도 충분하다.

### 필수

- Library 화면
- Paper Detail 화면
- PDF 탭
- Notes 탭
- Figures 탭
- Import Queue
- Settings 최소 화면
- 패널 show/hide
- 최소 1개 패널 detach/reattach 지원 권장

### 나중으로 미뤄도 되는 것

- 전용 Figure Browser 페이지
- 전용 Analytics 페이지
- 복잡한 Dashboard
- 다중 창 UI

---

## 10. 추천 결론

현재 가장 현실적인 프론트엔드 구성은 아래와 같다.

- 앱 형태: `Electron workspace app`
- 화면 구조: `도킹 가능한 3패널 기반 + 내부 route 분리`
- 데이터 흐름: `TanStack Query + Zustand + repository`
- 저장 구조: `PDF는 로컬 디스크, 메타데이터는 local Supabase`
- 코드 구조: `feature 기반 폴더`
- 핵심 화면: `Library / Paper Detail / Search / Import Queue / Settings`

한 줄로 정리하면:

> 프론트엔드는 "도킹 가능한 연구 작업 공간"처럼 보이게 만들고, 데이터는 local Supabase에서 읽고, 파일 작업은 Electron이 담당하는 구조가 가장 무난하다.
