# Fix: PDF 줌이 앱 UI 전체로 새는 문제

> 유형: fix | 작성일: 2026-06-24 | 규모: 소규모 (1파일, DB/IPC/컴포넌트 무변경)

## 문제

- **증상**: PDF를 확대(Ctrl+휠 또는 Ctrl+= )할 때, PDF 자체 확대는 자연스러운데 "리더 열기" 같은 UI 요소까지 옆으로 밀려나며 앱 전체가 확대·이동해 보인다.
- **원인 확정**: Electron의 기본 **webContents 줌**(앱 전체 줌)을 막는 코드가 어디에도 없어서, PDF 리더의 자체 줌 가드가 닿지 않는 영역(PDF scroll container 밖)이나 PDF 탭이 아닐 때 Ctrl+휠/Ctrl+= 가 Electron 기본 줌을 발동시킨다. 그 결과 헤더·버튼·사이드바를 포함한 렌더러 전체가 `zoomFactor`로 확대된다.

## 진단 근거 (코드로 검증 완료)

### (a) Electron 기본 webContents 줌이 막혀 있지 않다 — 원인 확정
- `apps/desktop/electron/` 전체에서 `zoom` / `setVisualZoom` / `zoomFactor` / `webFrame` / `setZoomLevel` grep **0건**.
- `apps/desktop/electron/main.mjs:231-243` `createMainWindow()` 의 `webPreferences`는 `contextIsolation` + `preload` **뿐**. `setVisualZoomLevelLimits` / `zoomFactor` / `before-input-event` 모두 **없음**.
  ```js
  // main.mjs:232-243
  mainWindow = new BrowserWindow({
    width: 1480, height: 980, minWidth: 1200, minHeight: 760,
    backgroundColor: "#eef1f4", title: "Redou",
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, "preload.mjs") },
  });
  ```
- 보조 창(`window:detach-panel` 핸들러, `main.mjs:1962-1970`)도 동일하게 줌 제어 없음.
- 렌더러(`frontend/src`)에도 전역 `zoom`/`ctrlKey+wheel` 가드 grep **0건** → 줌을 막는 유일한 코드는 `PdfReaderWorkspace.tsx`뿐.

### (b) PdfReaderWorkspace 줌 가드는 PDF 영역만 커버, 그 밖은 빈다 — 확정
- 자체 줌은 React `scale` state 기반(`PdfReaderWorkspace.tsx:585`, `PageSlot`이 `page.getViewport({ scale })` 사용, line 339). webContents 줌과 무관 → **보존 대상**.
- **Ctrl+휠** 핸들러는 `scrollRef`(PDF scroll container)에만 `{ passive:false }`로 바인딩(`PdfReaderWorkspace.tsx:765-776`):
  ```js
  const el = scrollRef.current; // PDF scroll container only
  el.addEventListener("wheel", handler, { passive: false });
  ```
  → PDF scroll container **밖**(상단 헤더·여백)에서의 Ctrl+휠은 preventDefault되지 않아 Electron 기본 줌으로 샌다.
- **Ctrl +/-** 키보드 핸들러는 `window`에 걸리지만(`PdfReaderWorkspace.tsx:755-762`), **PdfReaderWorkspace가 마운트된 동안만**(=PDF 탭에서만) 유효 → 라이브러리·검색·노트 등 **다른 화면**에서는 가드가 없어 Electron 기본 줌이 앱 전체를 확대.
- "리더 열기" 버튼(`PaperDetailView.tsx:103`, `Open Reader`)은 PDF 탭 상단 **헤더**에 위치하며 이 헤더는 `scrollRef` 바깥(`PaperPdfTab.tsx:339-374`의 `flex:1` PDF 컨테이너 밖) → 사용자가 본 "리더 열기가 옆으로 넘어가는" 현상과 정확히 일치.

### (c) BrowserWindow 생성부에 줌 관련 설정 없음 — 확정
- 메인 창(`main.mjs:239-242`)·보조 창(`main.mjs:1966-1969`) 모두 `webPreferences`에 줌 항목 부재(위 (a) 코드 참조).

**결론**: 1차 진단 3가지(a·b·c) 모두 코드로 확정. 근본 원인은 **Electron webContents 줌이 비활성화되지 않은 것**이며, 가장 깔끔한 수정 지점은 렌더러 전역 가드가 아니라 **메인 프로세스 BrowserWindow webContents**다(모든 화면·창에 일괄 적용, PDF 리더 자체 줌과 독립).

## 수정 방안

두 방향을 검토했고 **방안 A(메인 프로세스)** 를 채택한다.

### 방안 A (채택) — main.mjs webContents에서 앱 전체 줌 비활성화
한 곳에서 모든 화면/창에 적용되고, 리더의 React scale 줌과 물리적으로 독립이라 회귀 위험이 가장 낮다.

`createMainWindow()`(및 detached 창)의 `webContents`에 다음을 건다:
1. **핀치/제스처 줌 차단**: `webContents.setVisualZoomLevelLimits(1, 1)` — `did-finish-load` 이후 호출(로드 전 호출은 무효일 수 있어 이벤트 안에서).
2. **키보드 줌 차단**: `webContents.on("before-input-event", (event, input) => { ... })` 에서 `(input.control || input.meta) && ["=", "+", "-", "0"].includes(input.key)` 이면 `event.preventDefault()`. (Ctrl+0 리셋도 함께 차단해 webContents 줌 상태가 절대 바뀌지 않게 한다.)
3. **Ctrl+휠 줌 차단(가드레일)**: webContents 줌이 변하지 않도록 `webContents.on("zoom-changed", () => { webContents.setZoomFactor(1); })` 로 고정하거나, `webContents.setZoomFactor(1)`를 `did-finish-load`에 명시. (1·2로 대부분 차단되나, 마우스 Ctrl+휠 경로 가드로 추가.)

공통 적용을 위해 작은 헬퍼(예: `lockWebContentsZoom(webContents)`)를 두고 메인 창과 detached 창 양쪽에서 호출한다.

> 주의: `PdfReaderWorkspace`의 Ctrl+휠/Ctrl+= 는 **PDF 영역 안에서는** 자기 `preventDefault`로 먼저 처리되므로, before-input-event 차단을 추가해도 리더 자체 줌은 그대로 동작한다(자체 줌은 `event.preventDefault()` 후 React `setScale`만 수행, webContents 줌은 애초에 쓰지 않음).

### 방안 B (대안, 미채택) — 렌더러 전역(window) 가드
`frontend`에서 전역으로 Ctrl+휠/Ctrl+= 를 `preventDefault`. 단, (1) PDF 영역 안쪽은 리더가 처리해야 하므로 영역 판별 로직이 필요해 복잡, (2) 각 BrowserWindow(detached 포함)마다 보장 어려움, (3) 메인 프로세스 한 줄로 끝낼 일을 렌더러로 분산. → A보다 표면적이 넓고 회귀 위험이 커 미채택.

## 수정 대상

| 파일 | 수정 내용 |
|------|-----------|
| `apps/desktop/electron/main.mjs` | `lockWebContentsZoom(webContents)` 헬퍼 추가(`setVisualZoomLevelLimits(1,1)` + `before-input-event` 키 차단 + `setZoomFactor(1)`/`zoom-changed` 고정). `createMainWindow()`의 `mainWindow.webContents`와 `window:detach-panel`의 `win.webContents`에서 각각 호출. |

## 영향 범위

- 수정 파일: **1개** (`main.mjs`).
- DB 변경: 없음. 새 IPC: 없음. 새 컴포넌트/모듈: 없음. 마이그레이션: 없음.
- `CURRENT_EXTRACTION_VERSION` 범프: **불필요**(추출 로직 무관).
- 사이드 이펙트: 앱 전체 webContents 줌(접근성 확대) 기능이 비활성화됨 — 단, 현재 앱은 이를 의도 기능으로 쓰지 않으며(가드도 없는 상태) PDF 확대는 리더 자체 줌으로 제공되므로 사용자 영향 없음. detached 패널 창도 동일하게 webContents 줌 비활성화(일관성 향상).
- 리더 자체 줌(`PdfReaderWorkspace` scale): **무변경·보존**.

## 검증 방법

빌드/문법:
- `node --check apps/desktop/electron/main.mjs`
- `cd apps/desktop && npm run build` (tsc --noEmit + vite) 회귀 통과

수동(Electron 실행):
1. PDF 탭 **헤더 영역**(리더 열기 버튼 근처)에서 Ctrl+휠 → 앱 UI가 확대/이동하지 **않아야** 함.
2. 라이브러리/검색/노트 화면에서 Ctrl+= , Ctrl+- → 앱 전체 확대 **없어야** 함.
3. PDF **영역 안**에서 Ctrl+휠/Ctrl+= → PDF만 자연스럽게 확대(리더 toolbar % 변화 확인), 헤더/사이드바는 고정.
4. detached 패널 창에서 Ctrl+= → webContents 줌 발동 **없어야** 함.

## 가정 사항

- [가정] 앱 전체 webContents 줌(브라우저식 페이지 확대)은 의도된 기능이 아니다(현재 가드/설정이 전혀 없고, 확대는 PDF 리더 자체 줌으로 제공). 만약 향후 "앱 글로벌 확대"를 정식 기능으로 원하면 별도 작업으로 분리한다.
- [가정] `before-input-event`에서 Ctrl+0(줌 리셋)까지 차단해도 무방하다(webContents 줌을 1로 고정 유지하는 것이 목표).
