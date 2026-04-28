# Fix: Ollama fetch undici 헤더 타임아웃

> 유형: fix | 작성일: 2026-04-10

## 문제
- **증상**: 큰 컨텍스트(긴 대화 히스토리, RAG 결과 등)를 Ollama에 전달할 때 `UND_ERR_HEADERS_TIMEOUT` 에러 발생
- **원인 추정**: Node.js undici의 기본 헤더 타임아웃(~30초)이 너무 짧음. 모델이 큰 컨텍스트를 처리하는 동안 첫 응답 바이트를 30초 안에 보내지 못하면 타임아웃
- **근거**:
  - `apps/desktop/electron/llm-orchestrator.mjs:255` — `fetch(OLLAMA_BASE_URL + /api/chat, ...)` dispatcher 없음
  - `apps/desktop/electron/llm-orchestrator.mjs:326` — 동일
  - `apps/desktop/electron/llm-orchestrator.mjs:383` — 동일
  - `apps/desktop/electron/llm-orchestrator.mjs:524` — 동일
  - `apps/desktop/electron/llm-chat.mjs:34` — `fetch(OLLAMA_BASE_URL + /api/chat, ...)` dispatcher 없음
  - `apps/desktop/electron/llm-chat.mjs:84` — 동일

## 수정 방안
| 파일 | 수정 내용 |
|------|-----------|
| `apps/desktop/electron/llm-orchestrator.mjs` | 파일 상단에 `import { Agent } from 'undici'` 및 `ollamaDispatcher` 선언 추가. 4개 fetch 호출에 `dispatcher: ollamaDispatcher` 옵션 추가 |
| `apps/desktop/electron/llm-chat.mjs` | 파일 상단에 `import { Agent } from 'undici'` 및 `ollamaDispatcher` 선언 추가. /api/chat 관련 2개 fetch 호출에 `dispatcher: ollamaDispatcher` 옵션 추가 (/api/tags 호출은 이미 AbortSignal.timeout(3000) 있으므로 동일하게 dispatcher 추가) |

### dispatcher 설정값
```js
import { Agent } from 'undici';

const ollamaDispatcher = new Agent({
  headersTimeout: 300_000,   // 5분
  bodyTimeout: 600_000,      // 10분
  connectTimeout: 10_000,    // 10초
});
```

## 영향 범위
- 수정 파일: 2개
- 사이드 이펙트: 없음 (기존 AbortSignal/signal 옵션은 그대로 유지하므로 사용자 abort 동작 변경 없음)

## 검증 방법
- `node --check apps/desktop/electron/llm-orchestrator.mjs`
- `node --check apps/desktop/electron/llm-chat.mjs`
