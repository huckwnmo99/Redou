# SettingsView 디자인 킷 이식 (리디자인 2호 화면)

> 유형: feature | 상태: 계획 | 작성일: 2026-05-30
> 브랜치: `codex/rag-infra-extraction` | 대상: `frontend/src/features/settings/SettingsView.tsx`

## 개요

- **목적**: 새 디자인 시스템 킷(`Redou Design System/ui_kits/redou/SettingsView.jsx`)의 **2-pane 섹션 레이아웃**(좌측 섹션 네비 + 우측 설정 행)을 현재 `SettingsView.tsx`에 이식한다. FiguresView(리디자인 1호)에서 확립한 "디자인만 이식, 데이터/로직/i18n 100% 보존" 패턴을 그대로 따른다.
- **핵심 원칙**: "복붙"이 아니라 "디자인 이식". 킷의 **시각 구조**(2-pane 네비, `Row`/`RowGroup`/`Select`/`SegmentedControl`/`Button`/`StatusPill` 프리미티브, 섹션 헤더 타이포)만 옮기고, 현재 `.tsx`의 **데이터 연결·타입·실제 mutation·i18n**은 100% 보존한다.
- **⚠️ 가장 중요한 전제 — 킷 Settings는 "구버전"**: 킷에는 우리가 최근 추가한 **엔티티 그래프 토글, LLM 모델 선택, 엔티티 추출 모델 선택**이 **전혀 없다**. 반대로 킷에는 현재 코드에 **없는 가짜 기능**(Streaming/Guardian 토글, Theme/Library 뷰 설정, Password/Sessions/Delete account, Diagnostics 등)이 목업으로 가득하다. **단순 교체하면 entity/LLM 기능이 사라진다.** 따라서 킷 레이아웃(좌측 네비 + Row 기반 우측 패널)은 채택하되, **현재 기능을 전부 보존**해서 킷 섹션에 **매핑**해야 한다.
- **범위**:
  - 킷의 2-pane IA(좌측 섹션 레일 Account/Workspace/Models/Desktop/About + 우측 스크롤 패널) 시각 구조 이식
  - 킷의 재사용 프리미티브(`SectionHeader`/`RowGroup`/`Row`/`Select`/`SegmentedControl`/`Button`/`StatusPill`/`Toast`) TS로 이식
  - 현재의 모든 데이터 훅·mutation·IPC·상태를 적절한 킷 섹션에 배치(아래 매핑표)
  - 킷의 `feedback` Toast 패턴 채택(현재는 인라인 피드백 박스 → 킷 스타일 Toast로)
- **제외**:
  - 킷의 **가짜/목업 기능**: Streaming 토글, Guardian 세그먼트, Theme 토글, Library default view/sort, Password 변경, Active sessions, Delete account, Diagnostics(Export bundle/log folder). → **백엔드 미구현이므로 이식하지 않음**(아래 [킷 목업 미채택] 참조). 단 일부는 "비활성 placeholder"로 둘지 사용자 확인.
  - 데이터 계층/IPC/스토어/타입 변경 — 일절 없음
  - 다른 화면 — 이번 범위 아님

---

## 보존 대상 (절대 건드리지 않는 로직/훅) — 이식의 핵심 체크리스트

킷에는 아래가 전혀 없다(목업 + `React.useState`만). 이식 중 **반드시 살아있어야 하는** 현재 자산. (현재 `SettingsView.tsx` 줄 번호 기준)

### 1. 인증 / 계정 (`@/lib/auth`)
- `useAuthSession()` → `session.user.{name,email,workspaceName,planLabel}` (`SettingsView.tsx:34`)
- `useSignOut()` → 로그아웃 mutation (`:35`, 버튼 `:151-171`)

### 2. 데스크탑 런타임 / IPC (`@/lib/desktop`)
- `useDesktopRuntime()` → `{available,platform,version,libraryPath}` (`:36`)
- `useDesktopPdfSelection()` → PDF 선택 다이얼로그 (`:37`, `handleSelectPdfFiles:62`)
- `useCreateDesktopBackup()` → 백업 생성 (`:38`, `handleCreateBackup:76`)
- `useRevealInExplorer()` → 탐색기 열기 (`:39`, `handleReveal:86`)
- `window.redouDesktop.pipeline.requeueAll()` → 전체 재추출 (`handleRequeueAll:100`)

### 3. LLM 모델 선택 (`@/lib/chatQueries`) — **킷엔 없는 현재 기능**
- `useLlmModels()` → `OllamaModel[]` (`:44`)
- `useActiveLlmModel()` → `LlmModelInfo | null` (`:45`, `source: user/env/default` 표시)
- `useSetLlmModel()` → 모델 변경 mutation (`:46`)
- `refetchModels()` → 모델 목록 새로고침 (`:44`, 버튼 `:299`)

### 4. 엔티티 그래프 (`@/lib/chatQueries`) — **킷엔 없는 현재 기능 (회귀 최고위험)**
- `useEntityGraphEnabled()` / `useSetEntityGraphEnabled()` → opt-in 토글(기본 OFF) (`:51-52`, 체크박스 `:360-373`)
- `useActiveEntityModel()` / `useSetEntityModel()` → 엔티티 추출 모델(+`inherit`/`llm` fallback) (`:47-48`)
- `useEntityBackfillStatus()` / `refetchEntityStatus()` → 진행률/대기열 (`:49`)
- `useStartEntityBackfill()` → 수동 백필 mutation (`:50`, `handleEntityBackfill:123`) — **토글과 무관하게 항상 동작**(feature-status 명시)

### 5. UI 스토어 / i18n
- `useUIStore()` → `{locale, setLocale}` (`:33`)
- `localeText(locale, en, ko)` + `localeOptions` (`@/lib/locale`) — `const t = (en,ko) => localeText(locale,en,ko)` 패턴 유지. **킷은 한국어 하드코딩**(예: `"엔티티 추출을 시작했습니다."`)이므로 이식 시 전부 `t("...","...")`로 감싼다.

### 6. 로컬 상태 (보존)
- `feedback`, `selectedFiles`, `latestBackupPath`, `requeuePending` (`:40-43`) — 킷의 `feedback` Toast 패턴과 통합하되, `selectedFiles`/`latestBackupPath` 같은 현재 고유 상태는 유지.

### 7. 타입 (TypeScript)
- `OllamaModel`, `LlmModelInfo`, `EntityModelInfo`, `EntityBackfillStatus`, `AuthSession`, `DesktopSnapshot` — `any` 도입 금지, 전부 타입 유지. 특히 `EntityModelInfo.source: "user"|"llm"|"default"`, `fallbackModel?`.

---

## [중대 결정] 킷 목업 미채택 항목 — 사용자 확인 필요

킷 SettingsView는 **디자인 시안**이라 백엔드 없는 가짜 컨트롤이 많다. 아래는 **현재 코드/IPC에 대응 기능이 없어** 그대로 이식하면 "동작하지 않는 가짜 버튼"이 된다. **기본 방침: 미이식**(또는 "준비 중" 비활성 placeholder). 사용자 결정 필요.

| 킷 목업 컨트롤 | 킷 위치 | 현재 백엔드 | 처리 방안 |
|------|------|------|------|
| **Streaming On/Off** | Models 섹션 (`SettingsView.jsx:416`) | 없음(스트리밍은 항상 ON, 하드코딩) | **미이식** (또는 비활성 "always on" 표시) |
| **Guardian verification Off/Warn/Strict** | Models (`:427`) | 없음(Guardian은 항상 비동기 샘플링, 설정 불가) | **미이식** (또는 비활성 "strict" 표시) |
| **Theme Light/Dark** | Workspace (`:325`) | 없음(라이트 전용) | **미이식** (또는 비활성 "Light only") |
| **Library default view Grid/List, default sort** | Workspace (`:338-364`) | 없음(라이브러리 뷰 설정 미구현) | **미이식** |
| **Password Change** | Account (`:283`) | 없음 | **미이식** (또는 비활성) |
| **Active sessions Manage** | Account (`:287`) | 없음 | **미이식** |
| **Delete account** | Account danger zone (`:294`) | 없음(계정 삭제 API 없음) | **미이식** (danger zone 자체 생략) |
| **Diagnostics: Export bundle / Open log folder** | About (`:582`) | 없음 | **미이식** |
| **About: Version/Electron/React/Services 상태** | About (`:567-580`) | 부분(버전은 `useDesktopRuntime`로 일부, 서비스 health는 미구현) | **부분 이식**: `desktop.version`만 실제 값, 나머지 정적 메타/StatusPill은 **하드코딩 또는 생략**(서비스 health-check IPC 없음) |
| **Identity 아바타 이니셜(`김`)** | Account (`:262`) | 없음(아바타 컬럼 없음) | `session.user.name` 첫 글자로 동적 생성(데이터 보존), 아바타 자체는 시각 요소로 유지 가능 |

> **[가정]** 위 목업은 **전부 미이식**을 기본 전제로 계획한다. 단, 디자인 완성도를 위해 "준비 중"(disabled) placeholder로 남기길 원하면 승인 시 명시. **특히 Account의 "Delete account"(danger zone)는 실수 위험이 크므로 생략 권장.**

---

## 현재 vs 킷 — 구조/시각 차이

| 측면 | 현재 `.tsx` | 킷 `.jsx` |
|------|-------------|-----------|
| 최상위 구조 | **1-pane 스크롤** + 카드 그리드(`repeat(auto-fit, minmax(280px,1fr))`) + 하단 2열 그리드 | **2-pane**: 좌측 섹션 레일(width 224) + 우측 스크롤 패널(maxWidth 720) |
| 탐색 | 한 화면에 모든 카드 나열(스크롤) | 좌측 네비로 섹션 전환(Account/Workspace/Models/Desktop/About) |
| 설정 단위 | 카드(`panelCardStyle`) 안에 컨트롤 | `RowGroup`(소제목) > `Row`(label+description+control) 행 단위 |
| 헤더 | 상단 `h2`(20px) + 부제 + 우측 Sign out 버튼 | 섹션별 `SectionHeader`(`h1` 24px, weight 700, letterSpacing -0.02em) + 부제 |
| 피드백 | 인라인 `feedbackStyle` 박스(Desktop Actions 카드 내부) | 화면 하단 중앙 고정 `Toast`(2.5초 자동 소멸) |
| 컨트롤 | 네이티브 `<select>`/체크박스/버튼(인라인 style) | `Select`/`SegmentedControl`/`Button`/`StatusPill` 프리미티브(인라인 style) |
| 모델 카드 | LLM 카드 + Entity 카드 **분리** | Models 섹션 1개에 **통합**(Chat&table / Knowledge graph RowGroup) |
| 진행률 | `InfoRow` 텍스트(`12/18`) | `Row` + 하단 **프로그레스 바**(`width 67%` 등) |
| 아이콘 | `lucide-react` named import(이미 사용 중) | CDN `window.lucide` + `Icon.jsx` 래퍼 |

---

## 기능 → 킷 섹션 매핑표 (핵심)

킷의 5개 섹션(Account/Workspace/Models/Desktop/About)에 현재 기능을 **빠짐없이** 배치한다.

| 킷 섹션 | 배치할 현재 기능 (보존) | 사용 훅/상태 | 킷에서 가져올 시각 | 비고 |
|------|------|------|------|------|
| **Account** | 계정 정보(name/email/workspace/plan), 로그아웃 | `useAuthSession`, `useSignOut` | Identity strip(아바타+이름+메타+Sign out 버튼) | 킷의 Security/Danger zone(Password/Sessions/Delete)은 **미이식** |
| **Workspace** | 표시 언어(en/ko) | `useUIStore.locale/setLocale`, `localeOptions` | `SegmentedControl`(English/한국어) | 킷의 Theme/Library view/sort는 **미이식** |
| **Models** | **LLM 모델 선택** + **엔티티 그래프 토글** + **엔티티 모델** + **백필** | `useLlmModels`/`useActiveLlmModel`/`useSetLlmModel`/`refetchModels` + `useEntityGraphEnabled`/`useSetEntityGraphEnabled` + `useActiveEntityModel`/`useSetEntityModel` + `useEntityBackfillStatus`/`useStartEntityBackfill` | Status strip(Ollama 연결+Refresh) / RowGroup "Chat&table" / RowGroup "Knowledge graph" / 진행 프로그레스 바 | **회귀 최고위험 구역.** 킷의 Streaming/Guardian Row는 **미이식**. 킷엔 없는 **entity 토글**을 Knowledge graph RowGroup 최상단에 신규 배치 |
| **Desktop** | 런타임 정보, PDF 선택, 백업 생성/열기, 라이브러리 열기, 전체 재추출, 선택 PDF 목록 | `useDesktopRuntime`, `useDesktopPdfSelection`, `useCreateDesktopBackup`, `useRevealInExplorer`, `requeueAll`, `selectedFiles`/`latestBackupPath` | Runtime card(2x2 KV 그리드) / RowGroup "File actions" / "Backup" / "Pipeline" | 킷 Runtime card는 정적 목업 → 실제 `desktop.*` 값 바인딩. 백업 경로/선택 PDF는 실제 상태로 |
| **About** | 데스크탑 버전(실제) | `useDesktopRuntime.version` | Build/Services RowGroup + StatusPill | 버전만 실제, 서비스 health/Diagnostics는 **미이식 또는 정적**(IPC 없음) |

### entity 기능 배치 상세 (Models > Knowledge graph RowGroup)
1. **엔티티 그래프 사용 토글**(`entityGraphEnabled`/`setEntityGraphEnabled`) — 킷엔 없음. `Row`(label "Enable entity graph (opt-in)" + 긴 설명 + `SegmentedControl` On/Off 또는 체크박스). 현재의 상세 경고문("기본 꺼짐. import당 ~100초...")을 `t()`로 보존.
2. **엔티티 추출 모델**(`activeEntityModel`/`setEntityModel`) — 킷의 "Entity extraction model" `Select`(`inherit` 옵션 = "채팅 모델 사용" + 모델 목록). `EntityModelInfo.source`(`user`/`llm`/`default`) 표시 보존.
3. **백필 버튼 + 진행률**(`startEntityBackfill`/`entityStatus`) — 킷의 "Backfill all papers" Row + 프로그레스 바. `processedPapers/totalPapers` + `queued/running/failed` 실제 값 바인딩. `desktopReady` 가드 보존(비-Electron 시 비활성).

---

## 설계

### DB 변경
변경 없음.

### Electron (Backend)
변경 없음. 새 IPC 채널 없음. 기존 `window.redouDesktop`(pipeline/file/backup/llm/entity) + Supabase 훅만 사용.
`CURRENT_EXTRACTION_VERSION` 범프: **불필요**(추출 로직 무변경).

### 디자인 토큰 / CSS (`frontend/src/styles/tokens.css`)
FiguresView 이식 때 이미 `--shadow-xs`, `--font-mono`를 추가했고 현재 `tokens.css`에 존재 확인됨(`tokens.css:33-34`). 킷 SettingsView가 추가로 쓰는 토큰:
- `--radius-xs`(3px) — 존재 ✅ (`tokens.css:23`)
- `--shadow-md` — 존재 ✅ (Toast 그림자)
- `--transition-fast` — 존재 ✅
- `--color-accent-subtle` — 존재 ✅ (네비 active 배경)
- `--color-danger` — 존재 ✅
→ **신규 토큰 추가 불필요.** (danger zone 미이식 시 `--color-danger`는 거의 미사용.)

**킷 CSS 클래스 처리** (FiguresView에서 확립한 규칙):
- 킷은 `className="eyebrow"`, `className="scroll-y"`를 쓰지만 **프로젝트 CSS(`tokens.css`)에 이 클래스가 정의돼 있지 않다**(전 코드베이스 확인 — `tokens.css`만 존재, `.eyebrow`/`.scroll-y` 미정의).
- **선례**: `paperDetail/paperDetailStyles.ts`에 `eyebrowStyle: CSSProperties` 인라인 객체로 정의해 `className="eyebrow"` 대신 `style={eyebrowStyle}` 사용. FiguresView는 `className="scroll-y"`에 인라인 `overflowY:"auto"` **fallback 병기**.
- **이식 방침**: 킷 `.eyebrow`(11px, muted, letterSpacing 0.08em, uppercase) → 로컬 `eyebrowStyle` 인라인 객체 재사용/정의. `.scroll-y` → 인라인 `overflowY:"auto", overflowX:"hidden"` 직접 지정. **킷의 className 의존 방식은 이식하지 않는다.**

### Frontend

**타입** (`types/`)
- 변경 없음. `OllamaModel`/`LlmModelInfo`/`EntityModelInfo`/`EntityBackfillStatus`/`AuthSession`/`DesktopSnapshot` 그대로 사용.

**데이터 계층** (`lib/`)
- 변경 없음. 위 [보존 대상]의 훅 전부 재사용.

**아이콘 (lucide)**
- 킷은 CDN `window.lucide` + `Icon name="..."` 래퍼. **현재 프로젝트는 `lucide-react` named import**(현재 SettingsView `:1-2`에서 이미 사용).
- 킷 아이콘명 → `lucide-react` 컴포넌트 매핑:
  - `user-round`→`UserRound`, `globe-2`→`Globe2`, `brain-circuit`→`BrainCircuit`, `laptop-minimal`→`LaptopMinimal`, `info`→`Info`, `log-out`→`LogOut`, `refresh-cw`→`RefreshCw`, `check-circle-2`→`CheckCircle2`, `folder-open`→`FolderOpen`, `external-link`→`ExternalLink`, `hard-drive-download`→`HardDriveDownload`, `network`→`Network`(entity 토글용, 현재 사용 중).
  - 미이식 목업 아이콘(`key-round`/`monitor`/`trash-2`/`bug`)은 불필요.
- **`Icon.jsx`/CDN 방식은 이식하지 않는다.**

**컴포넌트** (`features/settings/SettingsView.tsx` 재구성)
- `SettingsView`(top-level): 2-pane. 좌측 `<aside>` 섹션 레일 + 우측 스크롤 컨테이너. 상태: `section`(현재 섹션 id, 기본 `"account"` 또는 `"models"`), 기존 `feedback`/`selectedFiles`/`latestBackupPath`/`requeuePending` 유지. `flash(msg)` 헬퍼(Toast 2.5초) 도입.
- **재사용 프리미티브**(킷 → TS, props 타입 명시):
  - `SectionHeader({title, subtitle})`
  - `RowGroup({title, children})`
  - `Row({label, description?, control, danger?})`
  - `Select({value, onChange, options, disabled?, width?})` — 현재 네이티브 select 로직 대체
  - `SegmentedControl({value, onChange, options})` — 언어/토글용
  - `Button({children, onClick, variant?, disabled?, icon?})` — `icon`은 lucide 컴포넌트로 변경(킷은 string name)
  - `Toast({text})`
  - `StatusPill({status})` — About에서만(또는 생략)
- **섹션 컴포넌트**(킷 구조 + 현재 데이터):
  - `AccountSection` — `useAuthSession`/`useSignOut`. Identity strip(아바타=name 이니셜). Security/Danger zone **미이식**.
  - `WorkspaceSection` — `locale`/`setLocale` + `SegmentedControl`. Theme/Library **미이식**.
  - `ModelsSection` — **현재 LLM + Entity 카드를 통합**. Status strip(Ollama 연결+`refetchModels`). RowGroup "Chat & table"(LLM `Select` + source 표시). RowGroup "Knowledge graph"(entity 토글 + entity 모델 `Select` + 백필 Row + 프로그레스 바). Streaming/Guardian **미이식**.
  - `DesktopSection` — Runtime card(실제 `desktop.*`). RowGroup File actions/Backup/Pipeline(`handleSelectPdfFiles`/`handleCreateBackup`/`handleReveal`/`handleRequeueAll`). 선택 PDF 목록 + 최근 백업 경로 표시 유지.
  - `AboutSection` — Build(버전 실제 + 정적 메타). Services/Diagnostics **미이식 또는 정적**.
- **제거**: 현재의 `panelCardStyle`/`InfoCard`/`InfoRow`/`ActionButton`/카드 그리드 레이아웃(킷 `Row`/`RowGroup`로 대체). 단 정보는 전부 새 구조로 이전.

**네비게이션**
- 변경 없음. AppShell `case "settings"`(`AppShell.tsx:32-33`) 그대로.

---

## 데이터 매핑 — 킷 목업 → 현재 실제

| 킷 목업 (`SettingsView.jsx`) | 현재 실제 | 매핑 방법 |
|------|------|------|
| `MOCK_MODELS`(하드코딩 5개) | `useLlmModels()` → `OllamaModel[]` | 실제 목록. `role` 구분 없음 → 전체 표시(현재도 Guardian/OCR 제외는 백엔드 처리) |
| `llmModel` state | `useActiveLlmModel().model` + `useSetLlmModel()` | `Select` value/onChange를 mutation에 연결 |
| `entityModel`(`"inherit"`+목업) | `useActiveEntityModel().model` + `useSetEntityModel()` | `inherit` 옵션 의미 보존(`EntityModelInfo.source==="llm"` ≈ 채팅 모델 상속). 옵션에 실제 모델 목록 주입 |
| Models status strip "Ollama 연결됨 · N models" | `modelsError`/`llmModels.length`/`modelsLoading` | 실제 연결 상태. 에러 시 현재 에러 문구(`"Ollama 연결에 실패..."`) 보존 |
| `flash(msg)` Toast | 현재 `setFeedback` | Toast로 통합. 현재 setFeedback 호출부 전부 `flash()`로 |
| Account 아바타 `김` + `김연구`/`researcher@lab.org` | `session.user.name`/`email`/`workspaceName`/`planLabel` | 실제 세션. 아바타=`name[0]`. 세션 없으면 섹션/카드 숨김(현재 `session ?` 가드 보존) |
| Desktop Runtime card 정적값(`Electron 35.1.4`/`darwin·arm64`/`~/Library/...`) | `desktop.{version,platform,libraryPath,available}` | 실제 바인딩. `desktopLoading`/`desktopReady` 가드 보존 |
| Backfill "진행 12/18 · 대기 6, 실행 1" + 67% 바 | `entityStatus.{processedPapers,totalPapers,queuedJobs,runningJobs,failedJobs}` | 실제 값. 바 width = `processed/total*100`. null 시 "Unavailable" |
| About 서비스 StatusPill(up/warn) | 없음(health-check IPC 미존재) | **정적 표시 또는 생략**(가짜 상태 노출 금지) |
| About 버전 `0.1.0·main@3799fd2`/`35.1.4`/`19.0.0` | `desktop.version`만 실제 | 나머지 정적 또는 생략 |

---

## 작업 분해 (develop)

1. [x] 프리미티브 이식 — `SectionHeader`/`RowGroup`/`Row`/`Select`/`SegmentedControl`/`Button`/`Toast`/`ComingSoonPill`를 킷에서 TS로 포팅. `Button.icon`을 string→lucide 컴포넌트(`LucideIcon`)로 변경. props 타입 명시(`any` 0). `.eyebrow`→인라인 `eyebrowStyle`. (`StatusPill`은 서비스 health IPC 없어 미채택.)
2. [x] `SettingsView` 셸 재구성 — 2-pane(좌측 `<aside>` 224px 섹션 레일 + 우측 스크롤 maxWidth 720). `section` 상태 + 섹션 스위칭. `.scroll-y`→인라인 overflow. `feedback` 유지 + `flash()` Toast 헬퍼. (`selectedFiles`/`latestBackupPath`/`requeuePending`는 `DesktopSection` 내부 로컬 상태로 이동 — 아래 변경 사항 2.)
3. [x] 섹션 레일 — `SECTIONS` 배열(Account/Workspace/Models/Desktop/About) + lucide 아이콘. active 스타일(accent-subtle 배경). 라벨 `t()`.
4. [x] `AccountSection` — `useAuthSession`/`useSignOut`. Identity strip(아바타=name 이니셜, email/workspace/plan). `session` null 가드. **Security/Danger zone 미이식**. 문구 `t()`.
5. [x] `WorkspaceSection` — `locale`/`setLocale` + `SegmentedControl`(English/한국어) + `flash`. Theme=준비 중 placeholder. **Library 미이식**. 문구 `t()`.
6. [x] `ModelsSection` (회귀 최고위험) — Status strip(Ollama 연결+`modelsError`/`length`+`refetchModels`). RowGroup "Chat & table": LLM `Select`(`useActiveLlmModel`/`useSetLlmModel`, `modelsLoading`/empty 분기, source 표시). Streaming/Guardian=준비 중 placeholder.
7. [x] `ModelsSection` > Knowledge graph RowGroup — entity 토글(`useEntityGraphEnabled`/`useSetEntityGraphEnabled` On/Off SegmentedControl + 상세 경고문) + entity 모델 `Select`(`useActiveEntityModel`/`useSetEntityModel`, `inherit`↔`source==="llm"` 매핑) + 백필 Row(`useStartEntityBackfill`, `desktopReady` 가드) + 프로그레스 바(`useEntityBackfillStatus`, `processed/total`). 문구 `t()`.
8. [x] `DesktopSection` — Runtime card(실제 `desktop.*` + `desktopLoading`/`desktopReady`). RowGroup File actions(`handleSelectPdfFiles`/`handleReveal`)/Backup(`handleCreateBackup`/최근 백업 reveal)/Pipeline(`handleRequeueAll`). 선택 PDF 목록 + 최근 백업 경로 유지. 모든 `desktopReady` 가드 보존.
9. [x] `AboutSection` — Build(버전 실제 + 런타임 + 정적 스택 메타). **Services health/Diagnostics 미이식**(가짜 상태 금지).
10. [x] i18n 스윕 — 킷 한국어 하드코딩 전부 `t(en, ko)`. 영어 문구는 현재 SettingsView의 기존 영어 카피 재사용.
11. [x] 빌드/타입 통과 — `cd frontend && npm run build`(tsc -b + vite build) 0 에러 + `npm run test`(vitest 28건) 통과. ESLint는 `/test` 단계(미설치 확인).

## 구현 중 변경 사항

1. **킷 목업 = "준비 중" 비활성 placeholder (사용자 develop 단계 승인)**: 계획서 기본 방침은 "전부 미이식"이었으나, 디자인 완성도를 위해 **백엔드가 명백히 always-on/고정인 컨트롤**(Models의 Streaming·Guardian verification, Workspace의 Theme)은 `ComingSoonPill`("준비 중") **비활성 칩으로 자리만 표시**(동작 로직 미연결). 반대로 **실수 위험·기능 부재가 큰 항목**(Account의 Password/Active sessions/**Delete account danger zone**, Workspace의 Library 뷰·정렬, About의 서비스 health StatusPill·Diagnostics)은 **완전 미이식**. 특히 Delete account는 danger zone 자체를 렌더하지 않음(삭제 로직 절대 미도입).
2. **`selectedFiles`/`latestBackupPath`/`requeuePending` + 데스크톱 핸들러를 `DesktopSection` 내부로 이동**: 킷 2-pane는 섹션별 컴포넌트 분리 구조라, 데스크톱 전용 상태/핸들러(`handleSelectPdfFiles`/`handleCreateBackup`/`handleReveal`/`handleRequeueAll`)를 top-level이 아닌 `DesktopSection`에 캡슐화. 로직·가드는 100% 동일(이전 단일 컴포넌트 → 섹션 컴포넌트로 위치만 이동). `feedback`/`flash`는 top-level 유지(Toast가 전 섹션 공유).
3. **entity 모델 `inherit` 매핑**: 킷 `entityModel==="inherit"` 의미를 보존하되 실제 백엔드와 연결 — `EntityModelInfo.source==="llm"`(채팅 모델 상속)일 때 Select value를 `"inherit"`로, 그 외엔 `activeEntityModel.model`로 표시. 선택 시 `setEntityModel.mutate("inherit"|모델명)`.
4. **`StatusPill` 미포팅**: 계획서에서 "About에서만 또는 생략"이었는데, 서비스 health-check IPC가 없어 가짜 상태 노출 금지 원칙에 따라 프리미티브 자체를 포팅하지 않음.
5. **`Button.onClick` optional**: About의 정적 행 등 onClick 없는 사용처를 위해 `onClick?`로 타입 정의(킷은 필수였음).

---

## 영향 범위

- **수정되는 기존 파일**:
  - `frontend/src/features/settings/SettingsView.tsx` (대규모 재구성 — 1-pane 카드 → 2-pane 섹션)
- **변경 없음(확인)**: `frontend/src/styles/tokens.css`(필요 토큰 전부 존재), `lib/chatQueries.ts`, `lib/desktop.ts`, `lib/auth.ts`, `lib/locale.ts`, `stores/uiStore.ts`, `types/*`, `app/AppShell.tsx`, Electron 전체, DB.
- `CURRENT_EXTRACTION_VERSION` 범프: 불필요.
- 새 IPC: 없음. 새 DB 테이블: 없음. 새 컴포넌트: 있음(섹션 5개 + 프리미티브 7~8개, 단 단일 파일 내).
- 화이트리스트(`DB_QUERY_TABLES`/`DB_MUTATE_TABLES`) 갱신: 불필요.

---

## 리스크 & 대안 (기능 회귀 포인트)

| 리스크 | 영향 | 대안 |
|------|------|------|
| **entity 토글/모델/백필 회귀** (킷엔 없어 누락 위험 최고) | opt-in 그래프 제어 불능, 백필 불능 → 핵심 기능 손실 | Models>Knowledge graph RowGroup에 **3개 다 명시 배치**(작업 7). 4개 entity 훅 전부 보존. `desktopReady` 가드·토글-백필 독립성 유지. 리뷰 필수 체크 |
| **LLM 모델 선택 회귀** | 채팅/테이블 모델 변경 불능 | Models>Chat&table에 명시(작업 6). `source` 표시·`refetchModels`·에러 분기 보존 |
| **킷 목업(Streaming/Guardian/Theme/Delete 등)을 그대로 이식 → 동작 안 하는 가짜 버튼** | 사용자 혼란, "버튼 눌러도 안 됨" | **미이식** 기본 방침(작업 6/9). 승인 시 "준비 중" disabled placeholder 여부 확정 |
| **Delete account(danger zone) 이식 시 사고 위험** | 실수로 데이터 삭제 시도(백엔드 없어도 UX 혼란) | **생략 권장**. 승인 전 확정 |
| **About 서비스 StatusPill을 가짜 "Up"으로 표시** | health-check 없는데 정상으로 오인 | health IPC 없음 → 정적/생략. 가짜 상태 노출 금지 |
| **`session` null일 때(브라우저 미리보기/미로그인) Account 섹션 크래시** | 화이트 스크린 | 현재 `session ?` 가드 패턴 보존. null 시 섹션 빈/안내 |
| **킷 className(`.eyebrow`/`.scroll-y`) 미정의 → 스타일 silent 누락** | 스크롤 안 됨/소제목 스타일 빠짐 | 인라인 style로 직접 지정(FiguresView 선례). className 의존 금지 |
| **킷 한국어 하드코딩 → 영어 모드 한글 노출** | i18n 깨짐 | 작업 10 i18n 스윕. 리뷰 체크리스트 |
| **Toast(`position: fixed`)가 AppShell 토스트(z-index 40)/인스펙터(20)와 충돌** | 겹침/가림 | 킷 Toast z-index 100. AppShell job 토스트는 우하단(`right 26 bottom 24`), 킷 Toast는 중앙 하단 → 위치 분리. 단 z-index 100 < drag overlay 9999는 OK. 동시 표출 시 위치만 확인 |
| **`Select` 프리미티브가 네이티브 select 접근성/키보드 유지 못함** | a11y 저하 | 킷 `Select`는 실제 `<select>` 래퍼(네이티브 유지). 그대로 채택하면 안전 |

---

## 비주얼 검증 방법 (현재 ↔ 이식본 비교)

- `frontend/`에서 `npm run dev` 후 Settings 탭 진입.
- **킷 원본 미리보기**: `Redou Design System/ui_kits/redou/index.html`을 브라우저로 열어 좌측 섹션 레일·Row 레이아웃·Toast·프로그레스 바 대조.
- 체크 항목:
  1. 좌측 네비 5개(Account/Workspace/Models/Desktop/About) 전환 동작 + active 스타일
  2. **Models 섹션에 LLM 모델 Select가 실제 Ollama 모델 목록**으로 채워지고 변경 시 `setLlmModel` 호출 + source 표시
  3. **Models 섹션에 엔티티 그래프 토글**이 있고 켜기/끄기 시 `setEntityGraphEnabled` 반영(회귀 핵심)
  4. **엔티티 모델 Select + 백필 버튼 + 진행률/프로그레스 바**가 실제 `entityStatus`로 동작(`desktopReady` 비활성 가드 포함)
  5. Desktop 섹션 Runtime card가 실제 `desktop.{version,platform,libraryPath}` 표시(브라우저 미리보기 시 "Browser preview")
  6. PDF 선택/백업 생성/탐색기 열기/전체 재추출이 기존과 동일 동작 + Toast 피드백
  7. Account 섹션이 실제 세션(name/email/workspace/plan) 표시 + Sign out 동작. 미로그인 시 크래시 없음
  8. 영어/한국어 토글 시 모든 문구 전환(하드코딩 한글 없음)
  9. **미이식 목업(Streaming/Guardian/Theme/Delete/Diagnostics)이 화면에 없음**(또는 의도적 disabled placeholder)
- **회귀 확인(최우선)**: 이식 전 현재 SettingsView의 **LLM 모델 변경 / entity 토글 / entity 모델 변경 / 백필 시작**이 이식 후에도 100% 동일 동작하는지.

---

## 규모 판단 — develop (대규모)

| 기준 | 판단 |
|------|------|
| 수정 파일 수 | 1개 (`SettingsView.tsx` 전면 재구성). tokens.css는 필요 토큰 전부 존재 → 무변경 |
| DB 변경 | 없음 |
| 새 IPC | 없음 |
| 새 컴포넌트 | 있음 (섹션 5개 + 프리미티브 7~8개, 단일 파일 내) |
| 구조 변경 | **큼** (1-pane 카드 그리드 → 2-pane 섹션 네비, 모든 컨트롤을 Row/프리미티브로 재작성, LLM+Entity 카드 통합) |

→ 파일은 1개지만 **단일 화면 전면 재구성 + 새 프리미티브 8개 + 1→2-pane IA 전환 + 회귀 위험 높은 entity/LLM 설정 재배치**로 **`/develop` 대상**. (FiguresView 이식과 동일 규모/패턴.)

---

## 가정 사항 (승인 전 사용자 확인 필요)

1. **[필수] 킷 목업 미채택 확정**: Streaming/Guardian/Theme/Library view·sort/Password/Active sessions/**Delete account**/Diagnostics를 **전부 미이식**(기본 방침) vs 일부를 "준비 중" disabled placeholder로 유지. 특히 **Delete account(danger zone)는 생략 권장**.
2. **[필수] entity 기능 배치 위치**: 본 계획은 **Models 섹션 내 "Knowledge graph" RowGroup**에 entity 토글+모델+백필을 배치. (대안: 별도 섹션으로 분리.) Models 통합이 킷 의도에 부합.
3. **About 섹션 처리**: 버전만 실제(`desktop.version`) + 나머지(서비스 health/Diagnostics) 미이식/정적. 서비스 health-check IPC가 없으므로 가짜 StatusPill은 표시하지 않음. About 섹션 자체를 최소화할지(버전만) 확인.
4. **기본 진입 섹션**: 킷 기본은 `account`. 현재 사용 빈도상 `models`(설정 핵심)로 바꿀지, 킷대로 `account` 유지할지.
5. **Identity 아바타**: 킷의 원형 그라데이션 아바타(이니셜)를 시각 요소로 유지(데이터는 `session.user.name`) vs 제거.
