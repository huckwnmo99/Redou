# SearchView 디자인 킷 이식 (리디자인 4호 화면)

> 유형: feature | 상태: 계획 | 작성일: 2026-05-31
> 브랜치: `codex/rag-infra-extraction` | 대상: `frontend/src/features/search/SearchView.tsx` (+ 보조: `SearchSidebar.tsx`)
> 선행 패턴: FiguresView(`docs/features/new/12-*.md`, 커밋 19141b7), SettingsView(`13-*.md`, e371b5e), ChatView(`14-*.md`, 38f1c98)

## 개요

- **목적**: 새 디자인 킷(`Redou Design System/ui_kits/redou/SearchView.jsx`)의 레이아웃·스타일·인터랙션을 현재 `SearchView.tsx`에 이식한다. 데이터 리디자인의 **네 번째 시범 화면**.
- **핵심 원칙**: "복붙"이 아니라 "디자인 이식". 킷의 **시각 구조**(인라인 style + CSS 변수, lucide named import, i18n 래핑)만 옮기고, 현재 `.tsx`/`searchModel.ts`의 **하이브리드 검색 훅·카테고리 필터·evidence/매치% 로직·데이터 연결(TanStack Query/IPC)·타입(TS)·i18n**은 100% 보존한다.
- **이번 화면의 특수성 — 현재 코드가 이미 상당히 정교하다.** Search는 Figures처럼 "구조가 근본부터 다른" 화면이 아니다. **검색바·카테고리 칩·매치% 뱃지·키워드 하이라이트·결과 카드·빈 상태(최근 논문)·결과 없음 상태는 현재 .tsx에 이미 모두 구현돼 있고 토큰도 동일**하다. 따라서 이번 작업의 핵심은 "무엇을 새로 만드느냐"가 아니라 **"킷과 현재가 이미 같은 부분 vs 진짜 다른 부분을 가려내고, 다른 부분만 최소 이식"**하는 것이다.
- **범위(실제 이식할 것 — 아래 [차이] 섹션의 "진짜 다른 부분"만)**:
  - 레이아웃 컨테이너: 현재 `padding 24px 20px` 전체폭 → 킷 **중앙 컬럼(maxWidth 820, `32px 24px 80px`)**
  - 검색바: 현재 height 44 → 킷 **height 54 + 포커스 시 `0 0 0 4px accent-subtle` 글로우 + ⌘K kbd 힌트**
  - **Semantic/Keyword 세그먼트 토글**(킷 신규 UI) — 단 **현재 검색이 항상 하이브리드(텍스트+시맨틱 동시)임을 반영**해 가짜 동작 금지(아래 [가짜vs실제] 참조)
  - 카테고리 칩: 현재 단색 pill → 킷 **소스 아이콘 + 카운트 뱃지 + count=0 비활성(opacity)**
  - 결과 카드: 현재 paper-centric 카드 → 킷 **좌측 소스 레일(아이콘+p.N) + 매치% 색 뱃지(>80 success/>50 accent) + "Open →"** 시각. **단 paper-centric 집계는 보존**(아래 [IA 결정] 참조)
  - 빈 상태: 현재 팁카드 3개 + 최근 논문 → 킷 **eyebrow 라벨 + Try 칩(예시 검색어) + (선택)최근 검색**
  - 결과 없음: 현재 단순 박스 → 킷 **search-x 아이콘 + 안내 2줄**
  - (선택) **키보드 힌트 푸터**(↑↓/⏎/⌘K/⎋)
  - lucide named import 정합, 한국어 하드코딩 `t()` 래핑
- **제외**:
  - 데이터 계층/IPC/스토어/타입/백엔드/DB 변경 — 일절 없음
  - 검색 로직(하이브리드 텍스트+시맨틱 퓨전, `buildUnifiedResults`, evidence 집계, 카테고리 스코프) — 일절 없음
  - `SearchSidebar`(폴더 범위 + 프리셋 컬렉션) — **글로벌 LeftSidebar 소속, 킷엔 없음 → 무변경**(ChatSidebar 선례)
  - 킷의 가짜 데이터(MOCK_RESULTS/RECENT_SEARCHES/SOURCE_META 하드코딩, all-MiniLM 캡션) 채택
  - `CURRENT_EXTRACTION_VERSION` 범프(추출 로직 무변경)

---

## [중대 인지] 킷은 단일 시안 + 전부 목업, 현재는 실제 하이브리드 검색 엔진

킷 `SearchView.jsx`는 **백엔드 없는 디자인 시안**이다. `MOCK_RESULTS`(8건 하드코딩)를 `scope`로 필터링만 하고, `mode`(semantic/keyword) 토글은 **캡션 문자열만 바꿀 뿐 검색 결과에 전혀 영향 없다**(`SearchView.jsx:102-105` — `filtered`는 `mode`를 참조하지 않음). 매치%(`score`)도 목업 상수다.

반면 현재 구현은 **실제로 동작하는 하이브리드 검색 엔진**이다:
- **텍스트 매칭**(`buildSearchGroups`, `searchModel.ts:102`) — papers/chunks/notes/figures 부분문자열 필터 + 스니펫 추출.
- **시맨틱 검색**(동시 실행) — `useSemanticChunkSearch`/`useSemanticPaperSearch`/`useSemanticFigureSearch`/`useSearchHighlightEmbeddings`. 각각 `embedding.generateQuery`(IPC)로 쿼리 임베딩 → pgvector cosine(`threshold 0.35`).
- **퓨전**(`buildUnifiedResults`, `searchModel.ts:248`) — 텍스트+시맨틱 결과를 **paper 단위로 집계**, 소스별 evidence 배열 + max-score로 정렬.

| 킷 (단일 `SearchView.jsx`, 목업) | 현재 (실 엔진) | 데이터 연결 |
|---|---|---|
| `MOCK_RESULTS` 8건 하드코딩 | `useAllPapers/Chunks/Notes/Figures` + 4개 semantic 훅 | TanStack Query + IPC `embedding.generateQuery` |
| `scope` 필터(6종) | `searchResultKind`(7종) + `buildUnifiedResults` scope 분기 | `useUIStore.searchResultKind` |
| `mode`(semantic/keyword) — **캡션만 변경, 동작 없음** | 항상 **하이브리드**(텍스트+시맨틱 동시) | (토글 없음 — 항상 둘 다 실행) |
| `score`(매치%) — 목업 상수 | 실 `similarity`(pgvector cosine) 퓨전 | `result.score` (semantic 우선) |
| `**bold**` 스니펫 하이라이트 — 정규식 split | `buildSnippet`(쿼리 주변 발췌) + `LatexText`(KaTeX) | `searchModel.buildSnippet` |
| `RECENT_SEARCHES` 4건 하드코딩 | **없음**(미구현) | — (이식 시 가짜/실제 결정 필요) |
| 결과 클릭 → 동작 없음 | `handleCardClick` → PDF 페이지 점프 or overview | `useUIStore` 4개 액션 |

> **구조 결론**: 킷의 시각(중앙 컬럼/큰 검색바/카운트 칩/소스 레일 카드/매치% 색뱃지)은 차용 가치가 크다. 그러나 **검색 동작·결과 데이터·매치%·스니펫은 전부 현재 실 엔진에 연결**해야 한다. 킷의 가짜를 그대로 옮기면 "검색되는 척하는 가짜 화면"이 된다.

---

## [중대 결정] IA 차이 — paper-centric(현재) vs evidence-centric(킷)

현재 코드와 킷은 **결과를 묶는 단위가 다르다.** 이게 이번 작업에서 사용자 확인이 필요한 핵심 갈림길이다.

| 측면 | 현재 `.tsx` | 킷 `.jsx` |
|------|-------------|-----------|
| 결과 단위 | **논문 1개 = 카드 1개** (`buildUnifiedResults`가 paper별 집계, evidence 배열에 소스 종합) | **매치 1건 = 카드 1개** (`MOCK_RESULTS` flat, 같은 논문이 여러 카드로 중복) |
| 그룹핑 | 없음(논문 카드 1열, score 정렬) | scope=all일 때 **소스별 섹션 그룹**(Title/Content/Highlight/Note/Figure), 그 외 flat |
| 카드 내용 | 논문 제목 + 대표 스니펫 1개 + **소스 뱃지들(content/highlight/note 등 ×N)** | 단일 매치: 소스 아이콘 + 논문 제목 + 스니펫 + 매치% |
| 매치% | **논문 최고 score**(여러 evidence 중 max) | 매치별 개별 score |

### 두 가지 이식 방향

**[방향 A — paper-centric 유지, 카드만 킷 스타일] (권장, 보수·저위험)**
- `buildUnifiedResults`(논문별 집계)를 **그대로 유지**하고, `PaperResultCard`의 **시각만** 킷 카드 스타일(좌측 소스 레일 + 매치% 색뱃지 + Open→)로 교체.
- 킷의 소스별 그룹 섹션(`GroupedResults`)은 **미채택**(현재는 논문 1카드에 소스 뱃지로 종합 — 이게 정보 응집도 높음).
- **장점**: 검색 로직/퓨전/evidence 집계 **무변경**(회귀 0). "한 논문이 여러 카드로 중복"되는 킷의 단점 회피. 시각 임팩트는 검색바/칩/카드 스타일로 충분히 확보.
- **단점**: 킷의 "소스별 그룹 섹션" 레이아웃은 반영 안 됨. 카드 좌측 소스 레일이 **단일 소스 아이콘**을 전제하나 현재 카드는 다중 소스(뱃지 ×N) — 레일 아이콘을 "대표 소스"로 표시하거나 레일 생략하고 현재 뱃지 유지하는 절충 필요.

**[방향 B — evidence-centric 전환, 킷 IA 충실] (고위험, 로직 변경 동반)**
- `buildUnifiedResults`를 evidence flat 리스트로 재설계(매치 1건=카드 1개) + scope=all 시 소스별 그룹.
- **장점**: 킷 의도(스캔 가능한 소스별 그룹) 완전 반영.
- **단점**: **검색 모델 로직 변경 = "데이터/로직 보존" 원칙 위반 + 회귀 리스크**. paper별 중복 카드. 클릭 동선(`handleCardClick`의 evidence 탐색)·매치% 의미 재설계. 본 리디자인의 "시각만 이식" 취지에 어긋남.

> **[가정]** 본 리디자인 시리즈의 일관 원칙("시각만 이식, 데이터/로직 100% 보존")과 회귀 리스크상 **방향 A를 기본 전제**로 계획을 전개한다. 킷의 소스 레일/그룹은 방향 A에 맞게 "대표 소스 + 다중 소스 뱃지 병행"으로 절충. 사용자가 evidence-centric 그룹 UI를 강하게 원하면 방향 B(검색 모델 재설계 — 별도 위험 평가 필요).

---

## 보존 대상 (절대 건드리지 않는 로직/훅) — 이식의 핵심 체크리스트

킷에는 아래가 **전혀 없다**(목업 8건 + CDN 프로토타입). 이식 중 **반드시 살아있어야 하는** 현재 자산:

### 1. 하이브리드 검색 훅 (TanStack Query + IPC)
- `useAllPapers/useAllChunks/useAllNotes/useAllFigures/useFolders/useHighlightPresets` — 텍스트 검색 원천 데이터.
- `useSemanticChunkSearch(query, filterIds)` (`queries.ts:199`) — 쿼리 임베딩(IPC) → 청크 pgvector 검색.
- `useSemanticPaperSearch` (`queries.ts:583`), `useSemanticFigureSearch` (`queries.ts:604`), `useSearchHighlightEmbeddings` (`queries.ts:549`) — 각각 제목/figure·table·equation/하이라이트 시맨틱 검색.
- **이 4개 semantic 훅 + IPC `window.redouDesktop.embedding.generateQuery`가 "Semantic" 검색의 생명줄.** 호출 위치/인자(`filterIds`, itemTypes)·`enabled: query>2`·`threshold` 보존.

### 2. 검색 모델 로직 (`searchModel.ts`) — 읽기만, 변경 금지(방향 A)
- `applySearchScope(papers, folders, activeFolderId)` — 폴더/starred/recent 스코프 적용.
- `buildSearchGroups({...})` — 텍스트 매칭 papers/chunks/notes/figures + `buildSnippet`(쿼리 주변 발췌).
- `buildUnifiedResults({...})` — **paper별 집계 + evidence 배열 + score max + scope별 소스 포함/제외**. 카테고리 7종(title/content/highlights/notes/figures/equations) 분기가 여기 있음(`searchModel.ts:273-377`). **방향 A에서 이 함수는 무변경.**
- `semanticResultsToChunks` — 시맨틱 결과 → 스니펫 매핑.
- 타입: `MatchEvidence`(source 5종 + snippet/page/similarity/color), `UnifiedPaperResult`.

### 3. 스토어 (Zustand `useUIStore`)
- 검색 상태: `searchQuery`/`setSearchQuery`, `searchResultKind`/`setSearchResultKind`(7종), `searchPresetFilter`/`setSearchPresetFilter`, `activeFolderId`, `locale`.
- 결과 클릭 동선: `setActiveNav`/`setSelectedPaperId`/`setReaderTargetAnchor`/`openPaperDetail` — `handleCardClick`/`openPaper`(`SearchView.tsx:131-145`)가 PDF 페이지 점프 or overview로 이동. **킷엔 클릭 동작 없음 → 이 동선 전부 보존.**

### 4. 카테고리 필터 — **7종 (킷은 6종)**
- 현재: `all` / `title`(제목·초록) / `content`(본문) / `highlights`(하이라이트) / `notes`(노트) / `figures`(Figure) / `equations`(테이블·수식). (`SearchView.tsx:199-207`, `SearchResultKind` 타입 `types/paper.ts:7`)
- **킷은 6종**(전체/제목/본문/하이라이트/노트/Figure) — **"테이블·수식"(equations) 카테고리가 없다.** 이식 시 **현재 7종 유지**(equations 칩 보존). 킷 6칩 디자인에 7번째 칩을 동일 스타일로 추가.

### 5. 매치% / evidence 로직 (실데이터)
- `bestSimilarity = Math.round(score*100)`, `>70 success / >50 accent / 그외 muted` 색 분기(`SearchView.tsx:355-367`) — **이미 킷과 동일한 임계 구조**(킷은 >80/>50). 실 score 기반. 보존.
- `snippetEvidence` 우선순위(content→highlight→note→figure), `sourceCounts`(소스별 카운트 뱃지) — 보존.
- 하이라이트 색 border(`snippetEvidence.color`) — 프리셋 색. 보존.

### 6. 타입 (TypeScript)
- `SearchResultKind`/`SemanticSearchResult`/`PaperSearchResult`/`FigureSearchResult`/`HighlightSearchResult`/`MatchEvidence`/`UnifiedPaperResult` — `any` 도입 금지, 전부 유지.

### 7. i18n (`localeText`)
- `const t = (en, ko) => localeText(locale, en, ko)` 패턴 유지. **현재 코드는 이미 전부 `t()` 적용**(킷보다 우수). 킷은 한국어/혼합 하드코딩(`"논문, 본문, 노트, 하이라이트, Figure 검색…"`, `"all-MiniLM-L6-v2 임베딩 기반 의미 검색"`, `"전체 라이브러리"` 등)이므로 **이식 시 전부 `t("...", "...")`로 분리**. (특히 킷 `all-MiniLM-L6-v2`는 **틀린 모델명** — 실제는 `nvidia/llama-nemotron-embed-vl-1b-v2`. 캡션 채택 시 정정 또는 일반 문구로.)

### 8. LaTeX 렌더
- `LatexText` / `containsLatex` (`components/LatexText.tsx`) — 스니펫 내 수식 KaTeX 렌더(`SearchView.tsx:389-393`). 킷은 `**bold**` mark 하이라이트만. **현재 KaTeX 렌더 유지** + 킷의 키워드 하이라이트(`<mark>`)는 별도 도입 검토(아래 [가짜vs실제]).

---

## 가짜(킷 목업) vs 실제(현재 로직) 구분 — 가장 중요한 섹션

| 킷 표현 | 킷 실제 정체 (가짜) | 현재 실제 로직 | 이식 시 연결 |
|---|---|---|---|
| **Semantic/Keyword 세그먼트 토글** (`SearchView.jsx:231-243`) | `mode` state가 **캡션 문구만 변경**, `filtered`는 `mode` 미참조 → **검색 동작 없음** | 현재는 토글 없이 **항상 하이브리드**(텍스트+시맨틱 동시 실행 후 퓨전) | **세 옵션**: ① 토글 미도입(현 하이브리드 유지, 가장 정직) ② 토글 도입하되 **실제로 keyword=텍스트만/semantic=하이브리드 분기**(검색 로직 변경 = 위험) ③ 토글 도입하되 "Hybrid 항상 ON" 정보 배지로 대체. **[가정] ①+③ 절충: 토글 대신 "Hybrid · 의미+키워드 동시" 정보 칩** 권장. 가짜 토글(②의 UI만, 동작 없음) **절대 미채택** |
| **매치%(score)** | `MOCK_RESULTS[].score` 하드코딩 상수 | `buildUnifiedResults`의 실 `similarity`(pgvector cosine) max 집계 | **현재 실 score 유지.** 색 임계(>70/>50)도 현재 것(이미 킷과 동일 구조) |
| **`**bold**` 키워드 하이라이트** (`ResultCard` parts split, `SearchView.jsx:527/587-601`) | 스니펫에 수동으로 `**`를 박아둔 목업 | 현재는 `buildSnippet`이 **쿼리 주변 발췌만**(하이라이트 없음) + `LatexText` | **킷의 키워드 하이라이트는 실제 가치 有** → 스니펫에서 **실제 검색어(searchQuery 토큰) 매칭부를 `<mark>`로 강조**하는 로직 신규 도입 검토. 단 `buildSnippet`/`LatexText`와 충돌 주의(LaTeX 스니펫엔 mark 미적용, plain 스니펫에만). **킷의 수동 `**` 파싱은 미채택**(실 쿼리 토큰 기반으로) |
| **소스별 그룹 섹션**(`GroupedResults`) | `MOCK_RESULTS`를 source로 그룹 | 현재는 paper-centric(그룹 없음) | 방향 A: **미채택**(IA 결정 참조). 방향 B 선택 시에만 |
| **최근 검색**(`RECENT_SEARCHES`) | 4건 하드코딩 (`"zeolite kinetic 비교" 2시간 전 14건` 등) | **미구현**(현재 빈 상태는 "최근 논문"만) | **가짜 하드코딩 절대 미채택.** 실제 최근 검색 이력은 **별도 영속화(스토어/DB) 필요 = 신규 기능** → **이번 범위 제외**. 현재 "최근 논문"(`recentPapers`, 실데이터) 유지 |
| **Try 프롬프트 칩**(`TRY_PROMPTS`) | 4건 하드코딩 검색어 예시 | 현재는 "팁 카드 3개"(제목·초록/본문/노트 설명) | Try 칩 **시각은 차용 가능**(클릭 시 `setSearchQuery`). 단 프롬프트는 도메인 일반 예시로(킷의 `"활성화 에너지 78 kJ/mol"` 같은 특정 화학 예시는 부적절). **[가정]** 팁 카드 유지 + Try 칩 추가 or 택1 — 사용자 확인 |
| **"전체 라이브러리" 필터 버튼**(`CommandBar` 우측, `SearchView.jsx:245-258`) | 드롭다운 **목업, 동작 없음** | 현재는 **폴더 범위를 `SearchSidebar`(글로벌 좌측)에서** 제어(`activeFolderId`) | 킷의 본문 내 필터 버튼은 **미채택**(폴더 범위는 SearchSidebar에 이미 존재). 중복 UI 금지. (원하면 후속에서 통합 검토) |
| **결과 수 "N results"** | `filtered.length`(목업) | `unifiedResults.length`(실집계) — **이미 표시 중**(`SearchView.tsx:183`) | 현재 것 유지(이미 구현). 킷 스타일(tabular-nums)만 정합 |
| **⌘K kbd 힌트 / 키보드 힌트 푸터** | 정적 표시, **키 바인딩 없음** | 현재 `autoFocus`만 있음(⌘K 핸들러 없음) | kbd **시각만** 도입 가능. 단 **실제 키 바인딩(↑↓ 네비/⏎ open/⌘K focus/⎋ clear) 없이 힌트만 표시하면 "거짓 약속"** → 힌트 도입 시 **최소 ⎋(clear)·⌘K(focus) 정도는 실제 핸들러 연결** 권장, 또는 힌트 푸터 자체를 미채택. **[가정]** 키보드 힌트 푸터는 **미채택**(실 핸들러 없이 가짜 표시 회피), ⌘K kbd는 검색바 우측에 장식+실 focus 핸들러 1개만 |

---

## 현재 vs 킷 — 시각/구조 차이 (이미 같은 부분 vs 진짜 다른 부분)

> **이 섹션이 작업량 산정의 핵심.** 현재가 이미 정교하므로 "이미 같은 부분"을 빼면 실제 이식 범위가 드러난다.

### ✅ 이미 같은(또는 거의 같은) 부분 — 손댈 필요 적음
- **검색바 기본 구조**: 둘 다 둥근 박스 + search 아이콘 + input + 결과수 + X(clear). hasQuery 시 border accent. (현재 `SearchView.tsx:153-195` ≈ 킷 `CommandBar`)
- **카테고리 칩 기본 구조**: 둘 다 pill, active 시 `accent` border + `accent-subtle` 배경 + accent 텍스트. (현재 `:198-231` ≈ 킷 `ScopeChips`)
- **매치% 색 뱃지**: 둘 다 score 임계로 success/accent/muted 분기 + `borderRadius 999` + tabular-nums. (현재 `:355-367` ≈ 킷 `ResultCard` score)
- **결과 스니펫 좌측 컬러 border**: 둘 다 하이라이트 색 or 기본 border-subtle 3px. (현재 `:380-382` ≈ 킷 `:582`)
- **빈 상태 "최근" 섹션**: 둘 다 최근 항목 리스트(현재=논문, 킷=검색+논문). 카드 스타일 유사.
- **결과 없음 상태**: 둘 다 점선 박스 + 아이콘 + 문구.
- **토큰**: `--shadow-xs`/`--shadow-sm`/`--font-mono`/`--radius-*`/`--color-accent-subtle`/`--color-success`/`--transition-fast` **전부 이미 `tokens.css`에 존재**(Figures/Settings 선보강). **신규 토큰 불필요.**

### ⚠️ 진짜 다른 부분 — 실제 이식 대상
1. **레이아웃 폭**: 현재 `padding 24px 20px` **전체폭** ↔ 킷 **중앙 컬럼 maxWidth 820 + `32px 24px 80px`**. → 컨테이너 1곳 변경.
2. **검색바 크기/포커스**: 현재 height **44**, 포커스 글로우 없음 ↔ 킷 height **54** + `boxShadow 0 0 0 4px accent-subtle` + 글자 17px + ⌘K kbd. → 검색바 치수/그림자/kbd.
3. **eyebrow 라벨**: 킷은 `"Search · 검색"`, `"Try · …"`, `"Recent · …"` 소문자 추적(letterSpacing) 라벨(`.eyebrow` 클래스). 현재 없음. → 인라인 `eyebrowStyle` 헬퍼(SettingsView 선례).
4. **Semantic/Keyword 토글 영역**: 킷 신규 — 세그먼트 탭 + 캡션 + 우측 "전체 라이브러리" 버튼. 현재 없음. → [가짜vs실제]대로 **정보 칩으로 대체**(가짜 토글 회피).
5. **카테고리 칩 디테일**: 킷은 **소스 아이콘 + 카운트 뱃지 + count=0 비활성(opacity 0.45 + disabled)**. 현재는 텍스트만(아이콘·카운트 없음). → 칩에 아이콘+카운트 추가. **단 카운트는 실제 집계 필요**(아래 [데이터 매핑]).
6. **결과 카드 레이아웃**: 킷은 **좌측 소스 레일(28px 아이콘 칩 + p.N) + 본문(제목/스니펫) + 우측(매치% + Open→)** 3단. 현재는 상단(메타+%) → 제목 → 스니펫 → 소스 뱃지들 세로 스택. → 카드 내부 재배치(단 paper-centric 데이터 유지 → 좌측 레일은 "대표 소스", 소스 뱃지는 하단 유지하는 절충).
7. **키워드 하이라이트**: 킷은 스니펫 내 `<mark>` 강조. 현재 없음. → 실 쿼리 토큰 기반 `<mark>` 신규([가짜vs실제]).
8. **빈 상태 구성**: 현재 팁카드 3 + 최근논문 ↔ 킷 Try칩 + 최근검색 + 최근논문(3섹션 grid gap30). → Try 칩 도입 + (최근검색은 제외).
9. **결과 없음 문구**: 현재 1줄("검색 결과가 없습니다") ↔ 킷 2줄(쿼리 인용 + "Semantic 시도/필터 풀기" 안내) + search-x 아이콘. → 문구·아이콘 정합.
10. **(선택) 키보드 힌트 푸터**: 킷 신규. → [가짜vs실제]대로 **미채택 권장**.

---

## 데이터 매핑 — 킷 목업 → 현재 실제

| 킷 목업 (`MOCK_RESULTS`/`SOURCE_META`) | 현재 실제 | 매핑 방법 |
|------|------|------|
| `SOURCE_META[src].icon/color/label/ko` | `sourceLabels`(`SearchView.tsx:42-48`) — 이미 존재(FileText/FileSearch/Highlighter/StickyNote/Images + en/ko) | **현재 `sourceLabels` 재사용**. 킷 색(`#f59e0b`/`#a855f7`/`#22d3a0`)을 소스별 강조색으로 추가 검토(현재는 색 없음). 단 lucide 컴포넌트는 현재 것 유지 |
| `r.source` (title/content/highlight/note/figure) | `MatchEvidence.source` (동일 5종) | 직접 대응 |
| `r.score` | `result.score`(논문 max) | 카드 매치% — 실값 |
| `r.page` | `evidence[].page` | 소스 레일 p.N — 대표 evidence의 page |
| `r.snippet` (`**bold**` 포함) | `snippetEvidence.snippet`(`buildSnippet` 발췌) | 스니펫 — 실 발췌 + (신규)쿼리 토큰 `<mark>` |
| `r.color` (하이라이트 border) | `snippetEvidence.color`(프리셋 colorHex) | 직접 |
| `paperMap.get(paperId)` | `paperMap`(`SearchView.tsx:76`) — 이미 존재 | 직접 |
| `counts[c.id]` (칩 카운트) | **현재 미계산** | **신규**: scope별 매칭 논문/evidence 수 집계. **방향 A에선 "해당 scope로 `buildUnifiedResults` 돌렸을 때 논문 수"** 또는 evidence 소스별 카운트. 성능 위해 `unifiedResults`(scope=all) 1회에서 소스별 카운트 도출 권장 |
| `RECENT_SEARCHES` | **없음** | 미채택(가짜) |
| `TRY_PROMPTS` | **없음**(현재 팁카드) | (선택) 도메인 일반 예시로 신규 |

### 카테고리 칩 카운트 — 산정 주의 (신규 로직, 단 표시용)
- 킷은 `counts`를 `MOCK_RESULTS` 소스별 단순 카운트.
- 현재는 paper-centric이라 "scope별 논문 수"가 자연스럽다. 단 `buildUnifiedResults`를 scope마다 7번 호출하면 비효율 → **scope=all 결과 1벌에서 evidence 소스 분포로 칩 카운트 도출**(예: highlight evidence 있는 논문 수 = highlights 칩 카운트). title/abstract↔title, tables/equations↔figure(itemType 분기) 매핑 주의.
- **[가정]** 카운트는 "해당 카테고리에 매칭 evidence가 있는 논문 수"로 정의. 이는 **표시용**이며 검색 동작·정렬엔 영향 없음(로직 보존). count=0 칩은 킷처럼 비활성(opacity).

---

## 설계

### DB 변경
변경 없음.

### Electron (Backend)
변경 없음. 새 IPC 채널 없음. 기존 `embedding.generateQuery` IPC + Supabase RPC(`match_chunks`/`match_papers`/`match_figures`/하이라이트) 그대로 사용. `CURRENT_EXTRACTION_VERSION` 범프: **불필요**.

### CSS/토큰 (`frontend/src/styles/tokens.css`)
- **신규 토큰 불필요** — 킷이 쓰는 `--shadow-xs`/`--shadow-sm`/`--font-mono`/`--radius-*`/`--color-accent-subtle`/`--color-success`/`--transition-fast` **전부 이미 존재**(라인 17/18/33/34/35/38).
- 킷 `.eyebrow`(소문자 추적 라벨) → **인라인 `eyebrowStyle: CSSProperties` 헬퍼**로 변환(SettingsView/ChatView 선례, 별도 CSS 추가 안 함).
- 킷 `.scroll-y` → 현재 이미 컨테이너에 `overflow: auto` 있음(`SearchView.tsx:150`). 유지.
- 카드 `:hover`(킷은 `onMouseEnter`/`Leave`로 border 변경 — 인라인 가능, 현재도 무hover). → **결과 카드 hover가 필요하면** `tokens.css`에 `.search-result-card:hover` 규칙 1개 추가 검토(Figures `.fig-card` 선례). 또는 킷처럼 `onMouseEnter` 인라인(JS hover) — **인라인 JS hover 권장**(CSS 추가 회피).

### Frontend

**타입** (`types/paper.ts`, `searchModel.ts`)
- 변경 없음(방향 A). 전부 기존 타입 사용.

**데이터 계층** (`lib/queries.ts`, `searchModel.ts`, `stores/uiStore.ts`)
- 변경 없음. 기존 훅/스토어/모델 재사용.

**아이콘 (lucide)**
- 현재 이미 named import(`Clock`/`FileSearch`/`FileText`/`Highlighter`/`Images`/`Search`/`StickyNote`/`X`, `SearchView.tsx:1`).
- 킷 신규 시각요소용 추가 named import 후보: `Sparkles`(semantic/Try 칩), `Type`(keyword), `Filter`/`ChevronDown`(필터 버튼 — 미채택이면 불필요), `SearchX`(결과 없음), `History`(최근), `ArrowRight`(Open→). **CDN `Icon.jsx` 방식 미도입.**

**컴포넌트** (`features/search/SearchView.tsx` — 단일 파일 재구성)
- `SearchView`(top-level): 컨테이너를 킷 중앙 컬럼(maxWidth 820)으로. 검색바(54px+글로우+⌘K) + (정보 칩 또는 Hybrid 배지) + 카테고리 칩(아이콘+카운트) + 빈 상태(eyebrow + Try칩 + 최근논문) + 결과 리스트(paper 카드) + 결과 없음(search-x). **모든 훅/`useMemo`/`handleCardClick`/`openPaper` 보존.**
- `PaperResultCard`(킷 스타일로 개편): 좌측 소스 레일(대표 소스 아이콘 + p.N) + 본문(메타/제목/스니펫+키워드 mark) + 우측(매치% 색뱃지 + Open→). **하단 소스 뱃지(sourceCounts ×N)는 유지**(다중 소스 정보). verification·evidence·LaTeX 보존.
- (신규 소형) 키워드 하이라이트 헬퍼: plain 스니펫에서 쿼리 토큰을 `<mark>`로. LaTeX 스니펫은 `LatexText` 유지(mark 미적용).
- (신규 소형) 칩 카운트 헬퍼: scope=all 결과에서 소스별 논문 수 도출.

**보조** (`features/search/SearchSidebar.tsx`)
- **무변경**(글로벌 LeftSidebar 소속, 킷엔 대응 없음 — ChatSidebar 선례). 폴더 범위 + 프리셋 컬렉션 그대로.

**네비게이션**
- 변경 없음. `AppShell.tsx case "search"`(`:22-23`), `LeftSidebar.tsx activeNav==="search"`(`:82-83`) 그대로.

---

## 작업 분해 (develop, 방향 A 기준)

1. [x] **CSS/토큰 현황 확인** — `tokens.css` 필요한 토큰 전부 존재 확인(추가 없음). 킷 `.eyebrow`→인라인 `eyebrowStyle` 헬퍼 준비
2. [x] **레이아웃 컨테이너** — `SearchView` 최상위를 킷 중앙 컬럼(maxWidth 820, padding `32px 24px 80px`, `overflow: auto`)으로. 기존 훅/`useMemo`/상태 selector **그대로 유지**
3. [x] **검색바** — height 54 + 포커스 글로우(`boxShadow 0 0 0 4px accent-subtle`) + input 17px + ⌘K kbd(클릭 시 실 focus 핸들러) + Esc clear. 결과수/X clear 보존. placeholder `t()`
4. [x] **검색 모드 영역** — 가짜 Semantic/Keyword 토글 대신 **"Hybrid · 의미+키워드 동시" 정보 칩**(`t()`) 도입. 킷 "전체 라이브러리" 버튼 미채택(SearchSidebar 중복). all-MiniLM 캡션 미채택
5. [x] **카테고리 칩** — **7칩 유지**(equations 포함). 킷 스타일(소스 아이콘 + 카운트 뱃지 + count=0 비활성) 적용. 카운트는 동일 검색 입력에서 카테고리별 논문 수 도출(`chipCounts`, 표시용·로직 무변경). `t()` 유지
6. [x] **결과 카드** `PaperResultCard` — 킷 3단 레이아웃(좌측 소스 레일[대표 소스+p.N] / 본문[메타·제목·스니펫] / 우측[매치% 색뱃지 + Open→]). **하단 소스 뱃지(×N) 유지**. score 색 임계·하이라이트 border·`handleCardClick` 보존
7. [x] **키워드 하이라이트** — plain 스니펫에서 실 쿼리 토큰 `<mark>` 강조 헬퍼(`highlightSnippet`) 신규. LaTeX 스니펫은 `LatexText` 유지(mark 미적용). 킷 수동 `**` 파싱 미채택
8. [x] **빈 상태** — eyebrow 라벨 + Try 칩(도메인 일반 예시, 클릭→`setSearchQuery`) + 최근 논문(실데이터, 유지). **최근 검색(RECENT_SEARCHES) 미채택**(가짜·미구현). 팁카드 → Try 칩으로 대체
9. [x] **결과 없음** — search-x 아이콘 + 2줄 안내(쿼리 인용 + 필터/논문 추가 안내) `t()`
10. [x] **(선택) 키보드 힌트 푸터** — **미채택**(실 핸들러 없는 가짜 표시 회피). ⌘K(focus)/Esc(clear) 실 핸들러는 검색바에 연결
11. [x] **lucide import 정합** — `Sparkles`/`SearchX`/`ArrowRight` named import 추가. CDN/Icon.jsx 미도입
12. [x] **i18n 스윕** — 킷 한국어/혼합 하드코딩 전부 `t(en, ko)`로. all-MiniLM 오모델명 미반영. 영어 모드 한글 잔존 0
13. [x] **빌드/타입 통과** — `cd frontend && npm run build`(tsc -b + vite) 통과. `any` 0, vitest 28건(searchModel 포함) 회귀 통과

## 구현 중 변경 사항

- **컨테이너 배경**: 킷의 `background: var(--color-bg-surface)`를 최상위 스크롤 컨테이너에 적용(킷과 동일). 기존엔 명시 배경 없었음.
- **빈 상태에서 팁카드 제거**: 가정 6의 "팁카드 유지/대체" 중 **Try 칩으로 대체**를 선택(킷 의도 + 정보 중복 회피). Try 프롬프트는 도메인 일반 예시(`attention mechanism`/`retrieval augmented generation`/`evaluation benchmark`/`ablation study`)로 — 킷의 화학-특정 예시(`활성화 에너지 78 kJ/mol`) 미채택.
- **카운트 산정 방식**: 계획의 "scope=all `buildUnifiedResults` 1벌에서 소스 분포 도출" 대신, **동일 검색 입력(groups + 시맨틱 4결과)에서 직접 카테고리별 paper id Set을 집계**(`chipCounts` useMemo). 이유: `MatchEvidence`에 `itemType`이 없어 figures↔equations 분리가 불가 → 원천 입력(`itemType` 보유)에서 분리하는 것이 정확. `buildUnifiedResults`는 무변경 유지(로직 보존 원칙).
- **검색바 kbd는 항상 표시가 아니라** hasQuery 시 결과수+X, 미입력 시 ⌘K kbd(클릭→focus)로 킷과 동일하게 토글.
- **소스 레일 대표 소스**: paper-centric이므로 `snippetEvidence.source` → 없으면 `evidence[0].source` → fallback `title`. 다중 소스는 하단 뱃지로 병행(방향 A 절충).

---

## 영향 범위

- **수정되는 기존 파일**:
  - `frontend/src/features/search/SearchView.tsx` (중간~대규모: 컨테이너/검색바/칩/카드/빈상태 시각 재구성 — 단 모든 훅/로직 보존)
  - (잠재) `frontend/src/styles/tokens.css` — 현재 전망상 **무변경**(필요 시 결과 카드 hover 규칙 1개만, 또는 JS hover로 회피)
- **변경 없음**: `SearchSidebar.tsx`, `searchModel.ts`, `types/paper.ts`, `lib/queries.ts`, `stores/uiStore.ts`, `lib/locale.ts`, `app/AppShell.tsx`, `app/LeftSidebar.tsx`, Electron 전체, DB.
- 새 IPC: 없음. 새 DB: 없음. 새 컴포넌트: 없음(기존 `SearchView`/`PaperResultCard` 시각 개편 + 소형 헬퍼). 새 모듈: 없음.
- `CURRENT_EXTRACTION_VERSION` 범프: 불필요.

---

## 리스크 & 대안 (기능 회귀 포인트)

| 리스크 | 영향 | 대안 |
|---|---|---|
| **하이브리드 검색 회귀** — 카드/컨테이너 개편 중 semantic 4훅 호출/`buildUnifiedResults` 입력 훼손 | 시맨틱 검색 결과 누락(핵심 기능) | 훅 호출·`useMemo` 입력·`searchModel` import **로직 무변경**, 시각만 교체. 검색 동작 수동 검증 |
| **가짜 Semantic/Keyword 토글** — 킷 토글 UI만 옮기면 "동작 안 하는 토글" | 사용자 혼란(누르면 결과 바뀔 줄) | 가짜 토글 미채택. **Hybrid 정보 칩**으로 대체. 실제 keyword/semantic 분기 원하면 별도 검색 로직 설계(범위 외) |
| **카테고리 7→6 축소 실수** — 킷 6칩만 보고 equations(테이블·수식) 칩 누락 | 테이블·수식 검색 카테고리 상실 | **7칩 유지** 명시. 리뷰 체크리스트화 |
| **paper-centric→evidence 혼동** — 킷 flat 카드 따라 하다 `buildUnifiedResults` 집계 깨짐 | 한 논문 중복 카드/매치% 의미 손상 | 방향 A: 집계 유지, 카드 시각만. 좌측 레일은 "대표 소스", 다중 소스는 하단 뱃지 |
| **칩 카운트 성능/정확** — scope마다 buildUnifiedResults 재호출 or 매핑 오류(title↔abstract, figures↔equations) | 느림 or 카운트 오표시 | scope=all 결과 1벌에서 소스 분포 도출. itemType(figure/table/equation)→figures/equations 칩 매핑 주의. 카운트는 표시용(정렬 무관) |
| **키워드 하이라이트 vs LaTeX 충돌** — 수식 스니펫에 `<mark>` 삽입 시 KaTeX 깨짐 | 수식 렌더 손상 | `containsLatex` true면 `LatexText`(mark 미적용), false면 토큰 mark. 분기 명확화 |
| **최근 검색 가짜 도입** — RECENT_SEARCHES 하드코딩을 그대로 표시 | "가짜 이력" 노출 | 미채택. 실 이력은 영속화 필요(신규 기능) → 범위 제외. 최근 논문(실데이터)만 |
| **키보드 힌트 거짓 약속** — 푸터 힌트만 표시, 키 바인딩 없음 | UX 신뢰 저하(↑↓ 눌러도 무반응) | 푸터 미채택 권장. 도입 시 ⌘K/⎋ 최소 실핸들러 연결 |
| **⌘K kbd 장식** — 글로벌 단축키 핸들러 부재 | 장식 kbd가 동작 약속처럼 보임 | kbd는 장식 허용하되, 가능하면 검색바 focus 핸들러 1개 연결(저위험) |
| **i18n 한글 잔존 + 오모델명** — 킷 `all-MiniLM` 등 하드코딩 미정정 | 영어 모드 한글/틀린 모델명 노출 | 작업 12 스윕 + 리뷰 체크. all-MiniLM 미반영(일반 문구 or 실모델명) |
| **SearchSidebar 무변경 일관성** — 본문만 킷화하고 좌측 사이드바는 구식 | 시각 불일치 | ChatSidebar 선례대로 사이드바는 글로벌 소속 — 본 범위 외. 후속 일관 정합 가능 |

---

## 비주얼/회귀 검증 방법 (현재 ↔ 이식본)

- `frontend/`에서 `npm run dev` → Search 탭 진입(데스크탑 셸 권장 — semantic은 IPC `embedding.generateQuery` 의존. 셸 없으면 텍스트 매칭만 동작 = graceful).
- **킷 원본 미리보기**: `Redou Design System/ui_kits/redou/index.html` 브라우저로 열어 의도 비주얼 대조(중앙 컬럼/검색바 글로우/카운트 칩/소스 레일 카드/매치% 색뱃지/빈상태).
- **시각 체크**:
  1. 검색바 중앙 컬럼(maxWidth 820), 포커스 시 accent 글로우 + ⌘K kbd
  2. 카테고리 **7칩**(전체/제목·초록/본문/하이라이트/노트/Figure/**테이블·수식**) + 소스 아이콘 + 실 카운트 + count=0 비활성
  3. 결과 카드: 좌측 소스 레일(아이콘+p.N) / 매치% 색뱃지(>70 success) / Open→ / 하단 소스 뱃지(×N)
  4. 스니펫 키워드 `<mark>` 강조(plain) + 수식은 KaTeX(mark 없음)
  5. 빈 상태: eyebrow + (도입 시)Try 칩 + 최근 논문(실데이터). 가짜 최근검색 없음
  6. 결과 없음: search-x + 2줄 안내
  7. 영/한 토글 시 전 문구 전환(킷 하드코딩·all-MiniLM 잔존 0), Hybrid 정보 칩
- **회귀 체크 (기능 — 가장 중요)**:
  1. 쿼리 입력(>2자) → **텍스트+시맨틱 동시** 결과, 논문별 1카드 집계
  2. 카테고리 칩 전환(7종) → `buildUnifiedResults` scope 분기 정상(특히 equations=테이블·수식, figures 구분)
  3. 폴더 범위(SearchSidebar) 변경 → `filterIds` 반영, 스코프 논문만
  4. 프리셋 필터(SearchSidebar) → 하이라이트 검색 프리셋 제한
  5. 결과 카드 클릭 → content/highlight/figure evidence면 **PDF 페이지 점프**, 아니면 overview(`handleCardClick`)
  6. 최근 논문 클릭 → overview 이동
  7. 매치% 색이 실 score 반영, 하이라이트 스니펫 좌측 색 border = 프리셋 색

---

## 규모 판단 — develop (대규모 화면 재구성, 단 단일 파일)

| 기준 | 판단 |
|---|---|
| 수정 파일 수 | **1~2개** (SearchView.tsx 중간~대규모 + 잠재적 tokens.css hover 1줄) |
| DB 변경 | 없음 |
| 새 IPC | 없음 |
| 새 컴포넌트 | 없음 (기존 시각 개편 + 소형 헬퍼) |
| 구조 변경 | **중간** (컨테이너/검색바/칩/카드 재구성 — 데이터·로직 불변. IA는 paper-centric 유지) |
| 복잡도/리스크 | **중간** — Chat보다 낮음(실시간 스트리밍 없음). 단 하이브리드 검색 4훅+퓨전 보존이 핵심 |

→ 파일 수는 적으나(**1~2개**) **단일 화면 시각 전면 재구성 + 새 인터랙션(키워드 하이라이트/카운트 칩) + 가짜/실제 구분 판단**이 필요해 **`/develop` 대상**. (Figures/Settings/Chat 리디자인 선례와 동일 분류.) 데이터/IPC/스토어/타입/모델 무변경이므로 develop 범위는 **프론트 시각 레이어 + 표시용 카운트/하이라이트 헬퍼로 한정**.

---

## 가정 사항 (승인 전 사용자 확인 필요)

1. **[필수] IA 방향**: 방향 A(paper-centric 집계 유지, 카드만 킷 스타일 — 권장·저위험) vs 방향 B(evidence-centric flat+소스 그룹 — 검색 모델 재설계, 고위험). 본 계획은 **A 전제**.
2. **[필수] Semantic/Keyword 토글**: 가짜 토글 미채택 + **"Hybrid 정보 칩"**으로 대체(현재 항상 하이브리드). vs 실제 keyword/semantic 분기 구현(검색 로직 변경 — 별도 위험). 본 계획은 **정보 칩** 전제.
3. **카테고리 칩**: **7칩 유지**(equations 포함, 킷 6칩에 1개 추가). 동의 여부.
4. **카운트 정의**: "해당 카테고리에 매칭 evidence가 있는 논문 수"(표시용, 로직 무관). count=0 비활성. 동의 여부.
5. **키워드 하이라이트**: 실 쿼리 토큰 `<mark>` 신규(plain 스니펫만, LaTeX 제외). 도입 여부.
6. **빈 상태 구성**: Try 칩 도입 여부 + 팁카드 유지/대체. 최근 검색(RECENT_SEARCHES)은 **미채택**(가짜·미구현 — 별도 영속화 기능 필요) 확정.
7. **키보드 힌트 푸터 / ⌘K**: 푸터 미채택(가짜 표시 회피) + ⌘K는 검색바 장식(+선택 실 focus 핸들러). vs 실 키 바인딩(↑↓/⏎/⌘K/⎋) 신규 구현. 본 계획은 **미채택/최소** 전제.
8. **SearchSidebar**: 무변경(글로벌 소속). 더 적극적 정합 원하면 범위 추가.
