# LLM 모델 선택 기능

> 유형: feature | 상태: 구현 완료 | 작성일: 2026-04-07

## 개요
- **목적**: 현재 `gpt-oss:120b`로 하드코딩된 LLM 모델을 사용자가 Settings UI에서 직접 선택할 수 있도록 변경
- **범위**: Ollama 모델 목록 조회 IPC, Settings UI 모델 선택 드롭다운, 선택한 모델의 영속 저장, llm-chat/orchestrator가 런타임에 선택된 모델 사용
- **제외**: Guardian 모델 선택(별도 유지), OCR 모델 변경, Ollama 서버 관리 UI

## 설계

### DB 변경

`user_workspace_preferences` 테이블에 `llm_model` 컬럼 추가:

```sql
ALTER TABLE user_workspace_preferences
  ADD COLUMN llm_model text;

COMMENT ON COLUMN user_workspace_preferences.llm_model IS '사용자 선택 LLM 모델명 (Ollama). NULL이면 환경변수 또는 기본값 사용';
```

마이그레이션 파일: `supabase/migrations/20260407010000_add_llm_model_preference.sql`

### 모델 우선순위 체인

```
사용자 선택 (DB: user_workspace_preferences.llm_model)
  → 환경변수 (REDOU_LLM_MODEL)
    → 기본값 ("gpt-oss:120b")
```

### Electron (Backend)

**새 IPC 채널:**
- `LLM_LIST_MODELS` (`llm:list-models`) — Ollama `/api/tags`에서 설치된 모델 목록 조회
- `LLM_GET_MODEL` (`llm:get-model`) — 현재 선택된 모델명 조회
- `LLM_SET_MODEL` (`llm:set-model`) — 모델 선택 저장 (DB + 런타임 변수 갱신)

**수정 대상:**
- `apps/desktop/electron/types/ipc-channels.mjs` — 3개 IPC 채널 추가
- `apps/desktop/electron/preload.mjs` — context bridge에 `llm` 네임스페이스 추가
- `apps/desktop/electron/main.mjs` — 3개 IPC 핸들러 등록 + 앱 시작 시 DB 모델 로드
- `apps/desktop/electron/llm-chat.mjs` — `LLM_MODEL` 상수를 `getActiveModel()`/`setActiveModel()` getter/setter 패턴
- `apps/desktop/electron/llm-orchestrator.mjs` — `LLM_MODEL` 상수 제거, `getActiveModel()` import
- `apps/desktop/electron/llm-qa.mjs` — 변경 없음 (streamChat 내부에서 자동 반영)

**핵심 리팩토링 — `llm-chat.mjs`:**
```js
const DEFAULT_MODEL = process.env.REDOU_LLM_MODEL || "gpt-oss:120b";
let _activeModel = DEFAULT_MODEL;
export function getActiveModel() { return _activeModel; }
export function setActiveModel(model) { _activeModel = model || DEFAULT_MODEL; }
```

Guardian 모델(`GUARDIAN_MODEL`)은 별도 상수로 유지.

**`main.mjs` IPC 핸들러:**
- `LLM_LIST_MODELS`: fetch Ollama `/api/tags` → Guardian/OCR 모델 제외 → 반환
- `LLM_GET_MODEL`: DB 조회 → 우선순위 체인 적용 → 반환
- `LLM_SET_MODEL`: DB upsert + `setActiveModel()` 호출

**앱 시작 시**: DB에서 모델 로드 → `setActiveModel()` 호출

### Frontend

**타입** (`types/desktop.ts`):
- `OllamaModel { name, size, modified_at, details? }`
- `LlmModelInfo { model, source }`
- `RedouDesktopApi.llm` 네임스페이스 (3개 메서드)

**데이터 계층**:
- `useLlmModels()` — 설치된 모델 목록 조회
- `useActiveLlmModel()` — 현재 선택된 모델 조회
- `useSetLlmModel()` — 모델 변경 mutation

**컴포넌트** (`features/settings/SettingsView.tsx`):
- LLM 모델 선택 카드: Ollama 연결 상태 + 모델 드롭다운 + 현재 선택 하이라이트

## 작업 분해

1. [x] DB 마이그레이션 작성
2. [x] `llm-chat.mjs` 리팩토링 — getActiveModel()/setActiveModel() 패턴
3. [x] `llm-orchestrator.mjs` 리팩토링 — getActiveModel() import
4. [x] `types/ipc-channels.mjs`에 3개 채널 추가
5. [x] `preload.mjs`에 `llm` 네임스페이스 추가
6. [x] `main.mjs`에 3개 IPC 핸들러 + 앱 시작 초기화
7. [x] Frontend 타입 정의
8. [x] Query 훅 추가
9. [x] Settings UI 모델 선택 카드 추가

## 영향 범위
- 수정: 8개 기존 파일
- 신규: 1개 마이그레이션
- CURRENT_EXTRACTION_VERSION 범프: 불필요

## 리스크 & 대안
- Ollama 꺼져있으면 빈 목록 → UI에 "Ollama 연결 실패" 표시
- 작은 모델 선택 시 JSON 품질 저하 → 경고 표시 (선택적)
- 모듈 수준 상수를 mutable 변수로 변경 → getter 함수로 매 호출 시 최신값 보장

## 가정 사항
- [가정] Guardian/OCR 모델은 범위 밖, 별도 유지
- [가정] 모델 선택은 전역 설정 (대화별 X)
- [가정] user_workspace_preferences 레코드 없으면 upsert로 생성
