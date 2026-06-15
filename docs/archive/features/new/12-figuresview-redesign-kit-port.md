# FiguresView 디자인 킷 이식 (리디자인 1호 시범 화면)

> 유형: feature | 상태: 계획 | 작성일: 2026-05-30
> 브랜치: `codex/rag-infra-extraction` | 대상: `frontend/src/features/figures/FiguresView.tsx`

## 개요

- **목적**: 새 디자인 시스템 킷(`Redou Design System/ui_kits/redou/FiguresView.jsx`)의 레이아웃·스타일·인터랙션을 현재 `FiguresView.tsx`에 이식한다. 데이터 리디자인 작업의 **첫 시범 화면**으로, 이후 다른 화면 이식의 패턴을 확립하는 것이 목표.
- **핵심 원칙**: "복붙"이 아니라 "디자인 이식". 킷의 **시각 구조**(인라인 style + CSS 변수)만 옮기고, 현재 `.tsx`의 **데이터 연결·타입·실제 썸네일 로직·i18n**은 100% 보존한다.
- **범위**:
  - 킷의 IA(필터칩 + 검색 + 카드 그리드 + 라이트박스) 시각 구조 이식
  - 킷의 카드 스타일(hover-zoom, 타입 배지, 캡션 2줄 클램프, 출처 표시) 이식
  - 라이트박스(키보드 네비게이션) 신규 도입
  - 누락 디자인 토큰(`--shadow-xs`, `--font-mono`) 보강
- **제외**:
  - 킷의 가짜 썸네일(SVG 차트/가짜 테이블 그리드/mono LaTeX) — 현재의 **실제 pdfjs 크롭 + 추출 이미지**를 유지
  - 데이터 계층/IPC/스토어 변경 — 일절 없음
  - 다른 화면(LibraryView, SearchView 등) — 이번 범위 아님

---

## [중대 결정] 정보구조(IA) 충돌 — 사용자 확인 필요

현재 코드와 킷은 **레이아웃 철학이 근본적으로 다르다.** 이게 이번 작업의 핵심 갈림길이다.

| 측면 | 현재 `.tsx` | 킷 `.jsx` |
|------|-------------|-----------|
| 최상위 구조 | **2-pane**: 좌측 논문 목록(폴더 그룹) + 우측 선택 논문의 그림 그리드 | **1-pane**: 라이브러리 전체 그림을 한 그리드에 |
| 탐색 단위 | 논문 선택 → 그 논문 그림만 | 전체 그림 풀에서 필터/검색 |
| 필터 | 없음 (논문별로만 봄) | 필터칩 All/Figure/Table/Equation + 카운트 |
| 검색 | 없음 | 캡션·논문 제목 검색 박스 |
| 카드 | 타입별 그룹 정렬, 출처 표시 없음(이미 논문 컨텍스트) | 출처(논문 제목·페이지) 카드에 표시 |
| 확대 보기 | 없음 (클릭 시 PDF로 점프) | 라이트박스(키보드 ←/→/Esc) |
| 썸네일 | **실제** pdfjs 페이지 크롭 + 추출 이미지 | **가짜** placeholder |

### 두 가지 이식 방향

**[방향 A — 킷 IA 전면 채택] (권장, 킷 의도에 충실)**
- 좌측 사이드바 제거 → 라이브러리 전체 그림 1-그리드.
- 필터칩 + 검색 + 라이트박스 신규 도입.
- 썸네일은 실제 렌더 유지(논문별 PDF doc를 paperId별로 묶어 로드).
- **장점**: 킷이 의도한 "라이브러리 전역 그림 브라우저" 경험. 시각적으로 가장 큰 임팩트. 리디자인 시범으로 가치 명확.
- **단점**: 구조 변경 폭이 큼. 여러 논문 PDF를 동시에 다뤄야 해서 썸네일 로딩 전략 재설계 필요(아래 [데이터 매핑] 참조). 폴더별 탐색이라는 기존 동선 상실.

**[방향 B — 카드/라이트박스만 이식, 2-pane 유지] (보수적)**
- 현재 2-pane 구조 그대로 두고, **우측 그리드의 카드 디자인 + 라이트박스 + (선택)논문 내 필터칩**만 킷 스타일로 교체.
- 좌측 사이드바는 현 상태 유지(또는 미세 스타일 정리).
- **장점**: 회귀 리스크 최소. 썸네일 로직(단일 `usePaperPdfDoc`) 거의 그대로. 기존 동선 보존.
- **단점**: 킷의 핵심인 "전역 그림 풀 + 필터/검색" 경험은 부분만 반영. 시범 임팩트 약함.

> **[가정]** 사용자가 "디자인 킷을 시범 이식"이라 했고 킷이 1-pane 전역 갤러리이므로 **방향 A를 기본 전제**로 계획을 전개한다. 단, 방향 A는 develop 규모가 크고 썸네일 로딩 재설계가 필요하므로, **승인 시 방향(A/B)을 먼저 확정**해야 한다.

---

## 보존 대상 (절대 건드리지 않는 로직/훅) — 이식의 핵심 체크리스트

킷에는 아래가 전혀 없다(목업+CDN 프로토타입). 이식 중 **반드시 살아있어야 하는** 현재 자산:

### 1. 데이터 훅 (TanStack Query)
- `useAllFigures()` → `PaperFigure[]` (전역 그림, `queries.ts:232`)
- `useAllPapers()` → `Paper[]` (`queries.ts:68`)
- `useFolders()` → `Folder[]` (`queries.ts:112`) — 방향 A 채택 시 그룹핑 용도 축소 가능, 단 제거 금지(논문→폴더 라벨에 사용 가능)
- `usePrimaryPaperFile(paperId)` → PDF 경로 (`queries.ts:119`)

### 2. 데스크탑 런타임 / IPC (`@/lib/desktop`)
- `useDesktopRuntime()`, `useResolvedDesktopFilePath()`, `toDesktopFileUrl()` — 로컬 파일 경로 해석 + `file://` URL 변환. **이게 실제 썸네일/이미지의 생명줄.**

### 3. 스토어 (Zustand `useUIStore`)
- `setActiveNav`, `setSelectedPaperId`, `setReaderTargetAnchor`, `openPaperDetail`, `locale` — 그림 클릭 시 PDF 리더로 점프하는 `jumpToPage` 콜백(`FiguresView.tsx:609`)의 의존성. **킷의 라이트박스를 도입해도 "Open paper" 동선은 이 콜백으로 연결.**

### 4. 실제 썸네일 렌더 컴포넌트 (현재 코드 고유 자산, 킷엔 없음)
- `PageThumbnail` — pdfjs 페이지 → 캔버스
- `FigureImage` — 추출된 이미지 파일(`imagePath`) 렌더
- `TableCropThumbnailCard` — 페이지에서 테이블 영역만 크롭(캡션 정규식 기반)
- `FigureCropThumbnailCard` — 페이지에서 그림 영역만 크롭
- `usePaperPdfDoc` — 논문별 PDF doc 로드/정리(언마운트 destroy)
- **이식 시 카드의 시각 컨테이너(킷 스타일)만 교체하고, 그 안의 `<FigureThumb>` 자리에 위 실제 렌더 컴포넌트를 그대로 꽂는다.**

### 5. 타입 (TypeScript)
- `PaperFigure` (`types/paper.ts:149`): `itemType: "figure"|"table"|"equation"`, `figureNo`, `caption?`, `page?`, `imagePath?` 등
- `Paper`, `Folder` 등 — `any` 도입 금지, 전부 타입 유지.

### 6. i18n (`localeText`)
- `const t = (en, ko) => localeText(locale, en, ko)` 패턴 유지. 킷은 한국어 하드코딩(예: `"캡션 · 논문 검색…"`, `"라이브러리에서 추출된 그림 · 표 · 수식 N개"`)이므로, **이식 시 전부 `t("...", "...")`로 감싼다.**

### 7. LaTeX 렌더
- `LatexText` / `containsLatex` (`components/LatexText.tsx`) — 캡션 내 수식 KaTeX 렌더. 킷은 LaTeX를 mono 텍스트로만 표시하지만, **현재의 KaTeX 렌더를 유지**(캡션·equation 카드 모두). 킷 디자인의 mono-LaTeX placeholder는 채택하지 않음.

---

## 현재 vs 킷 — 시각/구조 차이 (구체)

### 헤더
- 현재: 좌측 사이드바 상단에 `h2` "Figures & Tables" + 작은 통계줄.
- 킷: 본문 상단 중앙 정렬(maxWidth 1180) `h1`(19px, weight 600, letterSpacing -0.01em) + 부제(12.5px muted) "라이브러리에서 추출된 ... N개".
- 이식: 킷의 헤더 타이포 채택. 문구는 `t()`로 i18n.

### 컨트롤 바 (킷 신규)
- 필터칩: `padding 6px 12px`, `borderRadius 999`, active 시 `background var(--color-accent)` + 흰 글자, 카운트 뱃지 inline. (`FiguresView.jsx:344-367`)
- 검색 박스: `height 36`, `border-radius var(--radius-sm)`, lucide `search` 아이콘 + input. (`FiguresView.jsx:372-389`)
- 현재 코드엔 둘 다 없음 → 신규.

### 카드 (`.fig-card`)
- 킷: `background var(--color-bg-elevated)`, `border-radius var(--radius-md)`, hover 시 `border-color accent` + `shadow-md` + `translateY(-2px)`(styles.css:18-23), 좌상단 타입 배지(`color-mix`로 옅은 배경), 우상단 hover-zoom 아이콘(`maximize-2`), 캡션 2줄 클램프, 하단 출처(파일 아이콘 + 논문 제목 ellipsis + p.N).
- 현재: `background var(--color-bg-surface)`, `border-radius 8`, hover 효과 없음, 배지 없음, 캡션 3줄 클램프, 출처 표시 없음(논문 컨텍스트라 불필요했음), 상단에 `figureNo — p.N` 텍스트.
- 이식: 킷 카드 스타일 채택. **단 썸네일 영역 내부는 실제 렌더 컴포넌트**로 채운다. 방향 A에서는 출처(논문 제목) 표시가 필수(전역 그리드라 어느 논문인지 알아야 함) → 보존된 `paperMap`으로 채운다.

### 호버 인터랙션
- `.fig-card:hover .fig-zoom { opacity: 1 }` — CSS 규칙 필요. 현재 `tokens.css`엔 없음 → **`tokens.css`에 `.fig-card` hover 규칙 2줄 추가** 또는 컴포넌트 로컬 `<style>`/CSS module. (인라인 style로는 `:hover` 불가.)

### 라이트박스 (킷 신규, `FiguresView.jsx:185-301`)
- 전체 오버레이(`position absolute inset 0`, `rgba(10,16,28,0.72)` + `backdrop blur`), 상단 바(타입 배지 + `index/total` + 닫기), 좌우 네비 버튼, 중앙 스테이지(maxWidth 820), 하단 캡션 바 + "논문 · p.N" 링크.
- 키보드: `Esc` 닫기, `←/→` 이전/다음.
- 현재 코드엔 라이트박스 없음(클릭=PDF 점프) → 신규 도입. **단 라이트박스 내부의 큰 미리보기도 실제 렌더 컴포넌트 사용**, "논문 열기" 링크는 보존된 `jumpToPage`에 연결.

---

## 데이터 매핑 — 킷 목업 필드 → 현재 실제 타입

| 킷 목업 필드 (`MOCK_FIGURES`) | 현재 실제 (`PaperFigure`) | 매핑 방법 |
|------|------|------|
| `f.type` (`figure`/`table`/`equation`) | `figure.itemType` | 동일 의미, 직접 대응 |
| `f.n` (번호) | `figure.figureNo` (문자열, 예 "Figure 3") | 배지에 `figureNo` 그대로 또는 숫자만 추출 |
| `f.page` | `figure.page` (optional) | 직접. 없으면 p.N 숨김 |
| `f.caption` | `figure.caption` (optional) | 직접. LaTeX는 `LatexText`로 |
| `f.latex` (equation 전용) | — (없음) | **킷 가짜 LaTeX placeholder 미사용.** equation 카드도 실제 크롭/이미지/캡션으로 렌더 |
| `f.id`, `f.paperId` | `figure.id`, `figure.paperId` | 직접 |
| `paperMap.get(paperId).title` | `useAllPapers()` → `paper.title` | `papers`로 Map 구성 (현재 코드에 이미 `figureCounts` 패턴 있음) |
| (썸네일 비주얼) | `imagePath` 있으면 `FigureImage`, 없으면 `itemType`별 크롭/페이지 썸네일 | 현재 `FigureCard`의 분기 로직(`FiguresView.tsx:366-384`) 그대로 |

### 방향 A 채택 시 — 썸네일 PDF doc 로딩 전략 (재설계 필요 포인트)
- 현재 `usePaperPdfDoc`는 **선택된 단일 논문** PDF 1개만 로드.
- 방향 A의 전역 그리드는 **여러 논문 그림이 한 화면에 혼재** → 각 그림의 크롭 썸네일이 자기 논문 PDF doc를 필요로 함.
- 옵션:
  - **A-1 (권장)**: `imagePath`(추출 이미지)가 있는 그림은 PDF doc 불필요(`FigureImage`만으로 렌더). `imagePath` 없는 그림만 크롭 필요 → **카드별로 자기 paperId의 doc를 lazy 로드**하는 작은 훅(`usePaperPdfDoc`를 카드 단위로). 단 동일 논문 다수 카드가 각자 doc 로드하면 비효율 → **paperId별 doc 캐시(공유 Map, ref/context)** 도입 권장.
  - **A-2 (간단)**: 크롭 썸네일 비활성, `imagePath` 있으면 이미지·없으면 타입 아이콘 placeholder만(전역 그리드 성능 우선). 크롭은 라이트박스(단일 논문 doc 로드)에서만. → 그리드 단순/안전, 단 표/그림 미리보기 품질 하락.
- **[가정]** 1차 이식은 **A-1 + paperId별 doc 캐시**로 품질 유지. 성능 이슈 시 A-2로 후퇴 가능.

---

## 설계

### DB 변경
변경 없음.

### Electron (Backend)
변경 없음. (새 IPC 채널 없음. 기존 `window.redouDesktop` 파일 경로 해석만 사용.)
`CURRENT_EXTRACTION_VERSION` 범프: **불필요** (추출 로직 무변경).

### 디자인 토큰 (`frontend/src/styles/tokens.css`) — 보강 필요
킷이 쓰지만 현재 `tokens.css`에 **없는** 토큰:
- `--shadow-xs` — 카드 배지/zoom 버튼 그림자. (없으면 `box-shadow: var(--shadow-xs)`가 빈 값 → 그림자 누락)
- `--font-mono` — equation/숫자 mono. (없으면 폰트 폴백) — 단 equation 카드에 킷 mono-LaTeX를 안 쓸 경우 사용처 축소되나, 다른 화면 이식 대비 추가 권장.
- 추가 위치: `tokens.css` `:root` 블록. 값 제안:
  - `--shadow-xs: 0 1px 2px rgba(15, 23, 42, 0.06);`
  - `--font-mono: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;`

`.fig-card` hover 규칙(인라인 불가):
```css
.fig-card:hover {
  border-color: var(--color-accent) !important;
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.fig-card:hover .fig-zoom { opacity: 1 !important; }
```
→ `tokens.css` 하단 또는 figures 전용 CSS에 추가.

### Frontend

**타입** (`types/paper.ts`)
- 변경 없음. `PaperFigure`/`Paper`/`Folder` 그대로 사용.

**데이터 계층** (`lib/`)
- 변경 없음. 기존 훅 재사용.

**아이콘 (lucide)**
- 킷은 CDN `window.lucide` + `Icon.jsx` 래퍼 사용. **현재 프로젝트는 `lucide-react` 컴포넌트 import 방식**(이미 `FiguresView.tsx:1`에서 사용 중).
- 킷의 `Icon name="maximize-2"` → `import { Maximize2 } from "lucide-react"`. 동일하게 `Search`, `ImageOff`, `X`, `ChevronLeft`, `ChevronRight`, `FileText`, `ExternalLink` 등 named import로 치환.
- **`Icon.jsx`/CDN 방식은 이식하지 않는다.**

**컴포넌트** (`features/figures/FiguresView.tsx` 재구성)
- `FiguresView` (top-level): 방향 A 기준 — 헤더 + 컨트롤 바(필터칩 + 검색) + `FigureGallery` + `FigureLightbox`. 상태: `filter`, `query`, `openIdx`.
- `FigureGallery`: 킷의 카드 그리드 스타일 + 카드 내부에 **현재 실제 썸네일 분기 로직**. props로 `figures`, `paperMap`, `onOpen`.
- `FigureCard`(킷 스타일로 개편): 컨테이너/배지/zoom/캡션/출처 = 킷, 썸네일 = 현재 렌더 컴포넌트.
- `FigureLightbox`(신규): 킷 구조. 큰 미리보기 = 현재 렌더 컴포넌트, "논문 열기" = `jumpToPage`.
- **유지**: `PageThumbnail`, `FigureImage`, `TableCropThumbnailCard`, `FigureCropThumbnailCard`, `usePaperPdfDoc`(+ 캐시 확장).
- **방향 A에서 제거/축소**: `PaperRow`, `FolderGroup`, `SelectedPaperPanel`, 2-pane 레이아웃. (폴더 그룹 탐색 동선 상실 — 이게 IA 결정의 트레이드오프.)
- **방향 B 선택 시**: 위 제거 없이, `SelectedPaperPanel` 내부 그리드의 `FigureCard`만 킷 스타일로 교체 + 라이트박스 추가.

**네비게이션**
- 변경 없음. AppShell의 `case "figures"`는 그대로(`AppShell.tsx:24-25`).

---

## 작업 분해 (develop, 방향 A 기준)

1. [x] `tokens.css` — `--shadow-xs`, `--font-mono` 추가 + `.fig-card` hover 규칙 2개 추가
2. [x] 보존 컴포넌트 격리 확인 — `PageThumbnail`/`FigureImage`/`TableCropThumbnailCard`/`FigureCropThumbnailCard`/`usePaperPdfDoc`를 변경 없이 유지(동일 파일 내 유지, 별 파일 분리는 생략)
3. [x] paperId별 PDF doc 캐시 훅 — A-1 채택. `PaperDocCacheProvider`/`PaperDocLoader`/`usePaperDoc`(context)로 논문당 doc 1개 공유 lazy 로드
4. [x] `FigureCard` 킷 스타일로 개편 — 컨테이너/타입 배지/hover-zoom/캡션 2줄/출처(논문 제목·p.N). 내부 썸네일은 실제 렌더 분기(`FigureThumb`) 유지. 문구 `t()` 적용
5. [x] `FigureGallery` — 킷 그리드(`minmax(250px,1fr)`, gap 14) + `paperMap` 주입
6. [x] `FigureLightbox` 신규 — 킷 구조 + 키보드 핸들러 + 큰 미리보기(실제 렌더) + `jumpToPage` 연결. 문구 `t()`. LaTeX 캡션도 `LatexText`
7. [x] `FiguresView` 재구성 — 헤더 + 필터칩(All/Figure/Table/Equation + 카운트) + 검색 박스(캡션·제목) + 갤러리 + 라이트박스. `filter`/`query`/`openIdx` 상태. 정렬은 typeOrder + 숫자 정렬 + 논문 제목 tiebreak
8. [x] lucide import 치환 — `Maximize2`/`Search`/`ImageOff`/`X`/`ChevronLeft`/`ChevronRight`/`FileText`/`ExternalLink` 등 named import. `Icon.jsx`/CDN 미도입
9. [x] i18n 스윕 — 킷의 한국어 하드코딩 전부 `t(en, ko)`로 감쌈(빈 상태/검색 placeholder/통계 문구/타입 라벨/라이트박스 포함)
10. [x] 빌드/타입 통과 확인 — `cd frontend && npm run build`(tsc -b + vite build) 통과. ESLint는 환경 미설치로 미실행(`/test` 단계 권장)

## 구현 중 변경 사항

- **`useFolders` import 제거**: 방향 A는 폴더 그룹 탐색을 제거하므로 `FiguresView.tsx`에서 `useFolders`를 사용하지 않는다. TS `noUnusedLocals`가 미사용 import를 에러로 잡으므로 **이 파일의 import만** 제거했다. `lib/queries.ts`의 `useFolders` 훅 자체는 그대로 보존(다른 화면에서 사용). 계획서의 "제거 금지"는 *폴더 라벨에 쓸 경우* 보존하라는 취지였고, A에서는 카드 출처를 논문 제목으로 표시하므로 폴더 라벨 미사용.
- **보존 컴포넌트 분리 생략**: `PageThumbnail` 등 실제 썸네일 렌더 컴포넌트를 별 파일로 분리하지 않고 `FiguresView.tsx` 내에 그대로 유지(작업 2의 "필요 시"). 회귀 리스크 최소화 우선.
- **`FigureThumb`(현재용) 신설**: 킷의 가짜 `FigureThumb`를 대체해, 실제 렌더 분기(imagePath→`FigureImage` / table→`TableCrop` / figure→`FigureCrop` / page→`PageThumbnail` / 폴백 아이콘)를 한 컴포넌트로 묶고 `usePaperDoc(context)`로 doc를 받는다. 카드/라이트박스 양쪽에서 재사용.
- **라이트박스 LaTeX 캡션**: 킷은 라이트박스 캡션을 평문으로 두지만, 보존 원칙(KaTeX)대로 `containsLatex`→`LatexText` 렌더 적용.
- **라이트박스 미리보기 스크롤**: 큰 미리보기가 세로로 길 수 있어(크롭 높이 가변) 컨테이너 `overflow: auto`로 두어 잘림 방지(킷은 `hidden`).
- **빈 상태 분기**: 킷은 단일 "결과 없음" 문구. 현재는 추출 figure가 0개("아직 추출된 Figure가 없습니다.")와 검색/필터로 0건("일치하는 결과가 없습니다.")을 구분.

---

## 영향 범위

- **수정되는 기존 파일**:
  - `frontend/src/features/figures/FiguresView.tsx` (대규모 재구성)
  - `frontend/src/styles/tokens.css` (토큰 2개 + hover 규칙 추가)
  - (선택) figures 전용 CSS 또는 컴포넌트 분리 시 신규 파일 1~2개
- **변경 없음**: `types/paper.ts`, `lib/queries.ts`, `lib/desktop`, `stores/uiStore.ts`, `app/AppShell.tsx`, Electron 전체, DB.
- `CURRENT_EXTRACTION_VERSION` 범프: 불필요.
- 새 IPC: 없음. 새 DB 테이블: 없음. 새 컴포넌트: 있음(FigureLightbox + 카드/갤러리 개편).

---

## 리스크 & 대안 (기능 회귀 포인트)

| 리스크 | 영향 | 대안 |
|------|------|------|
| **IA 전환(2-pane→1-pane)으로 폴더별 탐색 동선 상실** | 사용자 워크플로 변화 | 승인 시 방향 A/B 확정. 방향 A에서도 필터칩에 "폴더" 차원 추가 가능(후속) |
| **전역 그리드에서 다수 논문 PDF doc 동시 로드 → 메모리/성능** | 큰 라이브러리에서 버벅임 | A-1 doc 캐시 + lazy. 한계 시 A-2(이미지/아이콘만, 크롭은 라이트박스에서) |
| **크롭 썸네일 정규식 의존(`TableCrop`/`FigureCrop`)이 전역 그리드에서 다양한 PDF에 일관 동작 안 할 수 있음** | 일부 카드 크롭 어긋남 | 기존 로직 그대로 유지(현재도 동일 한계). 실패 시 `PageThumbnail` 폴백 경로 유지 |
| **인라인 style로 `:hover`/`:focus` 불가** → 킷 hover-zoom 누락 위험 | 인터랙션 누락 | `tokens.css`에 `.fig-card` 규칙 추가(킷 styles.css와 동일). className `fig-card`/`fig-zoom` 부여 |
| **`--shadow-xs`/`--font-mono` 미정의 → 그림자/폰트 silent 누락** | 미묘한 비주얼 차이 | tokens.css에 선보강(작업 1번) |
| **킷 한국어 하드코딩을 그대로 옮기면 i18n 깨짐** | 영어 모드에서 한글 노출 | 작업 9 i18n 스윕 필수. 리뷰 체크리스트화 |
| **equation 카드: 킷 mono-LaTeX placeholder 채택 시 실제 데이터와 불일치** | 가짜 수식 표시 | 미채택. 실제 크롭/이미지/`LatexText` 캡션 유지 |
| **라이트박스 `position: absolute inset 0`가 AppShell 레이어와 충돌** | z-index/클릭 누수 | AppShell 인스펙터 z-index(20), 토스트(40) 확인 → 라이트박스 z-index를 컨테이너 기준 충분히 높게(킷은 70). AppShell은 figures 컨테이너를 `position relative`로 감쌈(`AppShell.tsx:142-149`) → 그 안에서 absolute면 안전 |

---

## 비주얼 검증 방법 (현재 ↔ 이식본 비교)

- `frontend/`에서 `npm run dev`로 렌더러 기동 후 Figures 탭 진입.
- **킷 원본 미리보기**: `Redou Design System/ui_kits/redou/index.html`을 브라우저로 열어 킷의 의도된 비주얼과 대조(필터칩 active 색, 카드 hover-zoom, 라이트박스 키보드 ←/→/Esc).
- 체크 항목:
  1. 필터칩 All/Figure/Table/Equation 카운트가 실제 `figures` 수와 일치
  2. 검색 박스에 캡션/논문 제목 입력 시 필터 동작
  3. 카드 hover 시 border accent + 상승 + zoom 아이콘 노출
  4. 카드 썸네일이 **실제 PDF 크롭/추출 이미지**(가짜 SVG 아님)
  5. 카드 클릭 → 라이트박스 → ←/→ 이동, Esc 닫힘, "논문 열기" 시 PDF 리더 점프(`jumpToPage`)
  6. 영어/한국어 토글 시 모든 문구 전환(하드코딩 한글 없음)
  7. equation 캡션의 LaTeX가 KaTeX로 렌더(mono 텍스트 아님)
- **회귀 확인**: 그림 클릭 → 해당 페이지 PDF 점프가 기존과 동일하게 동작하는지(스토어 연결 보존 검증).

---

## 규모 판단 — develop (대규모)

| 기준 | 판단 |
|------|------|
| 수정 파일 수 | 2~4개 (FiguresView.tsx 대규모 재구성 + tokens.css + 선택 분리 파일) |
| DB 변경 | 없음 |
| 새 IPC | 없음 |
| 새 컴포넌트 | 있음 (FigureLightbox 신규 + Card/Gallery 개편) |
| 구조 변경 | **큼** (방향 A: 2-pane→1-pane IA 전환, 썸네일 로딩 재설계) |

→ 파일 수는 적지만 **단일 화면 전면 재구성 + 새 인터랙션(라이트박스) + IA 전환 + 썸네일 로딩 전략 변경**으로 **`/develop` 대상**. (방향 B 선택 시 규모 축소되나 여전히 라이트박스 신규 + 카드 개편으로 develop 권장.)

---

## 가정 사항 (승인 전 사용자 확인 필요)

1. **[필수] IA 방향**: 방향 A(킷 IA 전면, 1-pane 전역 갤러리) vs 방향 B(2-pane 유지, 카드/라이트박스만). 본 계획은 A 전제.
2. **썸네일 전략**: A-1(paperId별 doc 캐시로 실제 크롭 유지) vs A-2(이미지/아이콘만, 크롭은 라이트박스에서). 본 계획은 A-1 권장.
3. **폴더 탐색 동선**: 방향 A에서 좌측 폴더 그룹 제거 수용 여부(후속으로 필터에 폴더 차원 추가 가능).
4. **디자인 토큰 보강**: `--shadow-xs`/`--font-mono`를 `tokens.css`에 추가하는 것(다른 화면 이식에도 공통 이득) 동의 여부.
