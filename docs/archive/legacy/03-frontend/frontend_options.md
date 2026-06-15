# Frontend Options for Windows Research Support App

이 문서는 Windows 기반 Research Support Application의 프론트엔드 관련 선택지를 정리한 초안이다.  
목적은 "무슨 기술을 쓸 수 있는가"를 나열하는 것보다, **이 프로젝트 성격에 맞는 후보와 trade-off를 빠르게 비교**하는 데 있다.

전제:
- Windows 데스크톱 앱
- 로컬 파일(PDF) 업로드, 드래그 앤 드롭 필요
- PDF 뷰어와 메모 UI가 핵심
- 장기적으로 RAG, figure search, Ollama 연동 가능성 있음
- MVP는 개인 사용 중심, 이후 팀 공유 가능성은 열어둠

---

## 1. 가장 먼저 정해야 하는 것

프론트엔드에서 먼저 정해야 할 큰 축은 아래 5개다.

1. 데스크톱 앱 껍데기: `Electron / Tauri / Native`
2. UI 프레임워크: `React / Vue / Svelte`
3. 상태 관리와 데이터 흐름
4. PDF/figure/메모 UI를 어떤 라이브러리로 구성할지
5. 디자인 시스템을 직접 만들지, 기존 컴포넌트 세트를 쓸지

---

## 2. 데스크톱 앱 방식

### Option A. Electron

설명:
- Chromium + Node.js 기반 데스크톱 앱

장점:
- JavaScript/TypeScript 생태계가 가장 풍부함
- PDF, 파일 처리, drag and drop, 로컬 연동 자료가 많음
- React/Vite와 조합이 안정적임
- 초반 MVP를 가장 빠르게 만들기 쉬움

단점:
- 앱 용량이 큼
- 메모리 사용량이 비교적 큼
- 네이티브 느낌은 약할 수 있음

이 프로젝트 적합도:
- 매우 높음
- 이유: PDF 중심 앱, 빠른 MVP, JS 생태계 활용에 유리

### Option B. Tauri

설명:
- Rust 백엔드 + WebView 프론트엔드 기반 데스크톱 앱

장점:
- Electron보다 가볍고 배포 크기가 작음
- 성능과 보안 측면에서 장점이 있음
- 웹 프론트엔드 기술을 그대로 활용 가능

단점:
- Rust 이해가 필요할 수 있음
- Node 기반 데스크톱 예제보다 자료가 적음
- 파일 시스템, 네이티브 기능 연동 시 러닝커브가 생길 수 있음

이 프로젝트 적합도:
- 높음
- 이유: 장기적으로는 좋은 선택이지만 초반 구현 속도는 Electron보다 느릴 수 있음

### Option C. Native Windows UI (WPF / WinUI)

설명:
- C#/.NET 기반 Windows 네이티브 앱

장점:
- Windows에 가장 자연스럽게 맞음
- 네이티브 UI/파일 처리/성능에서 강점
- 기업/기관 환경에서 친화적일 수 있음

단점:
- 웹 기반 라이브러리 재사용성이 낮음
- PDF/에디터/빠른 프로토타이핑에서 웹보다 불리할 수 있음
- 나중에 크로스플랫폼 가능성이 낮아짐

이 프로젝트 적합도:
- 중간
- 이유: Windows-only를 아주 강하게 고정한다면 가능하지만, AI/웹 생태계 활용성은 Electron/Tauri 쪽이 더 좋음

### 현재 권장

- 빠른 MVP 우선: `Electron`
- 가벼운 앱과 장기 유지보수 우선: `Tauri`

---

## 3. UI 프레임워크

### Option A. React

장점:
- 생태계가 가장 크고 참고 자료가 많음
- PDF.js, 상태관리, 테이블, 에디터 등 조합이 풍부함
- 장기적으로 팀 협업 시 인력 수급이 쉬움

단점:
- 자유도가 큰 대신 선택지가 많아 설계가 흔들릴 수 있음

이 프로젝트 적합도:
- 매우 높음

### Option B. Vue

장점:
- 문법이 직관적이고 입문 장벽이 낮음
- 단일 파일 컴포넌트 방식이 정리하기 편함

단점:
- 이 프로젝트에서 필요한 특수 라이브러리 선택폭은 React보다 좁을 수 있음

이 프로젝트 적합도:
- 중간 이상

### Option C. Svelte

장점:
- 코드가 간결하고 빠름
- 작은 앱에서 개발 경험이 좋음

단점:
- 생태계와 사례가 React보다 적음
- 복잡한 PDF/에디터/데스크톱 조합에서 자료가 적을 수 있음

이 프로젝트 적합도:
- 중간

### 현재 권장

- `React`

이유:
- PDF 뷰어, 노트 에디터, 검색 UI, figure 관리, 복잡한 패널 레이아웃에 가장 안전하다.

---

## 4. 스타일링 방식

### Option A. Tailwind CSS

장점:
- 빠르게 화면을 만들 수 있음
- 복잡한 레이아웃 구성 속도가 빠름
- 디자인 토큰과 CSS 변수 조합이 쉬움

단점:
- 클래스가 길어질 수 있음
- 디자인 원칙 없이 쓰면 화면이 지저분해질 수 있음

적합도:
- 높음

### Option B. CSS Modules

장점:
- 컴포넌트별 스타일 분리가 명확함
- CSS를 비교적 정석적으로 관리 가능

단점:
- 빠른 반복 제작 속도는 Tailwind보다 느릴 수 있음

적합도:
- 높음

### Option C. Styled Components / Emotion

장점:
- JS 안에서 스타일 관리 가능
- 동적 스타일 작성이 편함

단점:
- 런타임 비용이 있음
- 최근에는 선호도가 예전보다 낮음

적합도:
- 중간

### 현재 권장

- 빠른 MVP: `Tailwind CSS + CSS variables`
- 장기적으로 단정한 유지보수: `CSS Modules + design tokens`

---

## 5. UI 컴포넌트 전략

### Option A. 완전 커스텀 디자인 시스템

장점:
- 제품 정체성을 강하게 만들 수 있음
- 논문 앱에 맞는 독특한 패널/카드/reader UI를 설계 가능

단점:
- 시간이 많이 듦
- 초반 생산성이 떨어질 수 있음

적합도:
- 중간

### Option B. Radix Primitives 기반 커스텀 UI

장점:
- 접근성 좋은 primitive를 바탕으로 직접 조합 가능
- 완성형 UI 라이브러리보다 자유도가 높음

단점:
- 직접 스타일링해야 함

적합도:
- 매우 높음

### Option C. MUI / Mantine / Ant Design 같은 완성형 라이브러리

장점:
- 빠르게 화면을 만들 수 있음
- 기본 컴포넌트가 풍부함

단점:
- 화면이 평범해지기 쉬움
- 제품 고유감이 약해질 수 있음

적합도:
- 높음

### Option D. Fluent UI

장점:
- Windows 친화적인 느낌
- Microsoft 스타일과 잘 맞음

단점:
- 시각적으로 다소 기업형/무난한 느낌이 강함
- 논문 리더 특화 화면은 결국 커스텀이 필요함

적합도:
- 중간 이상

### 현재 권장

- `Radix Primitives + custom styling`

보조 선택:
- 정말 빠른 시제품이 필요하면 `Mantine`

---

## 6. 상태 관리

### Option A. Zustand

장점:
- 단순하고 가벼움
- 데스크톱 앱의 로컬 상태 관리에 잘 맞음
- 학습 비용이 낮음

단점:
- 구조를 잘 잡지 않으면 store가 커질 수 있음

적합도:
- 매우 높음

### Option B. Redux Toolkit

장점:
- 상태 흐름이 명확함
- 큰 프로젝트에서 규칙성이 좋음

단점:
- 초기 보일러플레이트가 상대적으로 많음

적합도:
- 높음

### Option C. Jotai

장점:
- atom 기반으로 세밀한 상태 분리가 가능
- 복잡한 UI 패널 상태에 유용할 수 있음

단점:
- 설계 스타일이 팀에 따라 호불호가 있음

적합도:
- 중간 이상

### 현재 권장

- `Zustand`

이유:
- 논문 목록, 선택된 paper, 필터, 뷰 모드, 업로드 상태, 검색 상태 등을 다루기에 가장 간단하다.

---

## 7. 폼과 검증

### Option A. React Hook Form + Zod

장점:
- 성능이 좋고 생태계가 안정적임
- 메타데이터 수정 폼, 태그 편집, 설정 화면에 적합

단점:
- 특별히 큰 단점은 없음

적합도:
- 매우 높음

### Option B. Formik

장점:
- 익숙한 사람이 많음

단점:
- 최근에는 React Hook Form 쪽이 더 선호되는 편

적합도:
- 중간

### 현재 권장

- `React Hook Form + Zod`

---

## 8. PDF Viewer 선택지

### Option A. PDF.js 직접 사용

장점:
- 가장 표준적이고 유연함
- 페이지 렌더링, 텍스트 레이어, 하이라이트, 좌표 연결 등에 유리
- 커스터마이징 자유도가 높음

단점:
- 직접 구현해야 할 부분이 많음

적합도:
- 매우 높음

### Option B. react-pdf

장점:
- React에서 쓰기 편함
- PDF.js 기반이라 접근성이 좋음

단점:
- 세밀한 커스터마이징은 결국 내부 구조를 더 만져야 할 수 있음

적합도:
- 높음

### Option C. 상용 PDF SDK

장점:
- 주석, 검색, 고급 뷰어 기능이 강력할 수 있음

단점:
- 비용이 큼
- MVP에 과할 수 있음

적합도:
- 중간

### 현재 권장

- `PDF.js 기반`
- React 사용 시 `react-pdf` 또는 직접 래핑

이유:
- section, chunk, figure 위치 연결과 provenance UI를 만들기 좋다.

---

## 9. 메모 에디터 선택지

### Option A. Plain textarea + Markdown preview

장점:
- 가장 단순함
- 빠르게 구현 가능
- 연구 메모에는 오히려 충분할 수 있음

단점:
- 구조화된 편집 경험은 약함

적합도:
- 매우 높음 for MVP

### Option B. TipTap

장점:
- 확장성이 좋음
- 하이라이트, 태그, 링크, 구조화 블록을 붙이기 좋음

단점:
- 초기 세팅이 더 필요함

적합도:
- 높음

### Option C. Lexical

장점:
- 성능이 좋고 구조화에 강함

단점:
- TipTap보다 생태계 체감이 적을 수 있음

적합도:
- 중간 이상

### 현재 권장

- MVP: `Plain textarea or Markdown editor`
- 2차 확장: `TipTap`

---

## 10. 데이터 테이블 / 리스트

### Option A. TanStack Table

장점:
- 유연함
- 논문 리스트, 태그 필터, 정렬, 컬럼 설정에 적합

단점:
- 스타일은 직접 구성해야 함

적합도:
- 매우 높음

### Option B. AG Grid

장점:
- 강력한 표 기능

단점:
- 다소 무거울 수 있음
- 이 앱의 핵심은 일반 데이터 그리드보다 카드/리더 혼합 UI에 가까움

적합도:
- 중간

### 현재 권장

- `TanStack Table`

---

## 11. Drag and Drop

### Option A. Native drag events

장점:
- 의존성이 적음

단점:
- 세부 UX를 직접 다뤄야 함

### Option B. react-dropzone

장점:
- 구현이 빠름
- 파일 업로드 UX를 정리하기 좋음

단점:
- 아주 복잡한 상호작용은 직접 보완해야 할 수 있음

### 현재 권장

- `react-dropzone`

---

## 12. 라우팅 방식

### Option A. React Router

장점:
- 안정적이고 익숙함
- 설정/라이브러리/검색 결과 페이지 분리에 충분함

적합도:
- 높음

### Option B. TanStack Router

장점:
- 타입 안정성이 좋음

단점:
- React Router보다 익숙하지 않을 수 있음

적합도:
- 중간 이상

### Option C. 라우터 없이 단일 레이아웃

장점:
- 데스크톱 앱에서는 하나의 화면 안에서 패널 전환만으로 충분할 수 있음

단점:
- 나중에 구조가 커지면 정리가 어려울 수 있음

### 현재 권장

- 단순 MVP면 `라우터 없이 패널 기반`
- 화면이 늘어나면 `React Router`

---

## 13. 프론트엔드 테스트

### Option A. Vitest + Testing Library

장점:
- React 컴포넌트 테스트에 적합
- 빠름

적합도:
- 매우 높음

### Option B. Playwright

장점:
- 실제 업로드, 검색, 카드 편집 흐름을 E2E로 검증 가능

적합도:
- 매우 높음

### 현재 권장

- 단위/컴포넌트: `Vitest + Testing Library`
- 핵심 사용자 플로우: `Playwright`

---

## 14. 이 프로젝트에 맞는 권장 조합

### 권장안 A. 가장 무난한 빠른 MVP

- Desktop shell: `Electron`
- Frontend: `React + Vite + TypeScript`
- Styling: `Tailwind CSS + CSS variables`
- UI primitives: `Radix Primitives`
- State: `Zustand`
- Forms: `React Hook Form + Zod`
- PDF Viewer: `PDF.js / react-pdf`
- Table/List: `TanStack Table`
- Note editor: `Plain textarea or Markdown editor`
- Tests: `Vitest + Playwright`

이 조합이 좋은 이유:
- 가장 빠르게 구현 가능
- 자료가 많고 문제를 해결하기 쉬움
- PDF 중심 연구 앱에 필요한 대부분의 조합이 안정적임

### 권장안 B. 더 가볍고 장기적인 구조

- Desktop shell: `Tauri`
- Frontend: `React + Vite + TypeScript`
- Styling: `Tailwind CSS + CSS variables`
- UI primitives: `Radix Primitives`
- State: `Zustand`
- Forms: `React Hook Form + Zod`
- PDF Viewer: `PDF.js`
- Table/List: `TanStack Table`
- Note editor: `Plain textarea -> later TipTap`
- Tests: `Vitest + Playwright`

이 조합이 좋은 이유:
- 앱이 더 가벼움
- 장기적으로 배포 효율이 좋음
- 다만 초반 생산성은 Electron보다 약간 떨어질 수 있음

---

## 15. 추천 결론

현재 이 프로젝트 성격을 기준으로 하면 아래처럼 정리할 수 있다.

### 가장 현실적인 1차 선택

- `Electron + React + TypeScript + Zustand + Tailwind + Radix + PDF.js`

이유:
- 논문 PDF 처리와 리더 UI가 핵심인 앱은 웹 프론트엔드 생태계를 쓰는 편이 빠르다.
- Windows 앱이어도 초반에는 생산성과 라이브러리 조합 안정성이 더 중요하다.
- 나중에 RAG, figure link, provenance UI를 붙이기에도 이 구성이 유리하다.

### 만약 더 네이티브스럽고 가볍게 가고 싶다면

- `Tauri + React`

이 경우 확인할 것:
- Rust를 어느 정도 받아들일 수 있는가
- 파일 처리와 Ollama 연동을 어디까지 프론트엔드에서 다룰 것인가

---

## 16. 지금 바로 결정하면 좋은 항목

아래 6개만 먼저 확정하면 프론트엔드 방향이 거의 잡힌다.

1. Electron으로 갈지 Tauri로 갈지
2. React를 사용할지
3. PDF viewer를 PDF.js 계열로 갈지
4. 메모 입력을 plain editor로 시작할지
5. 상태관리를 Zustand로 할지
6. UI를 커스텀 중심으로 갈지, 완성형 라이브러리를 섞을지

