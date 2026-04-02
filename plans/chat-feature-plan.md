# LLM 기반 연구 데이터 비교 테이블 생성 채팅 기능

> **검토 이력**
> - 초안: Claude Code (claude-opus-4-6) 설계
> - 평가: Claude Code (claude-sonnet-4-6) 코드베이스 교차 검증 (2026-03-27)
> - 확정: Claude Code (claude-opus-4-6) 평가 오류 정정 및 해결책 반영 (2026-03-27)
> - 개선: Claude Code (claude-sonnet-4-6) HuggingFace 서치 반영 (2026-03-28)
>   - Granite Guardian 3.3 8B → gpt-oss 자기 검증 교체 (독립 팩트체커, LLM-AggreFact 3위)
>   - Ollama JSON Schema `format` 파라미터 → 테이블 regex 파싱 교체
>
> 심각도: 🔴 즉시 오류 / 🟡 조건부 오류 / 🟢 UX 개선 | ✅ 해결됨 / ❌ 평가 오류

## Context
여러 논문에 흩어진 수치 데이터(흡착량, 전환율, 물성 등)를 LLM이 비교 테이블로 자동 정리. 사용자가 요청하면 LLM이 명확화 질문 → RAG 검색 → 테이블 생성 → 할루시네이션 검증까지 수행. 멀티턴 대화 지원.

## 핵심 기술 스택
- **LLM**: `gpt-oss:120b` (Ollama localhost:11434, 131K context, MXFP4)
- **검증**: `granite3.3-guardian:8b` (Ollama localhost:11434) — 독립 팩트체커, LLM-AggreFact 3위(76.5%), RAG Groundedness 특화
- **테이블 출력**: Ollama `format` JSON Schema 강제 → regex 파싱 불필요, 스키마 불일치 원천 차단
- **RAG**: 기존 `match_chunks` + `match_figures` RPC (pgvector 2048-dim)
- **스트리밍**: Ollama `stream: true` → `broadcastToWindows()` → IPC 이벤트 (명확화 단계), 테이블 생성은 `stream: false` + JSON Schema
- **DB**: Supabase (신규 테이블 3개)

> ~~⚠️ **평가 Agent — 🔴 `match_figures` 임베딩 차원 불일치 (384 vs 2048)**~~
> ❌ **평가 오류** — `embedding-worker.mjs`는 이전 세션에서 이미 `nvidia/llama-nemotron-embed-vl-1b-v2` (2048-dim)으로 교체 완료됨. `EMBEDDING_GENERATE_QUERY` IPC 핸들러도 이 워커를 사용하므로 쿼리 임베딩 = 2048-dim, `match_figures` RPC = vector(2048). 완전 일치. 문제 없음.

## 전체 흐름
```
사용자 요청
  → gpt-oss:120b 명확화 질문 스트리밍 (최대 6개, stream: true)
  → 사용자 답변
  → RAG 검색 (match_chunks + match_figures)
  → gpt-oss:120b 테이블 생성 (stream: false, format: JSON Schema)
      → 구조화된 JSON 직접 수신 (regex 파싱 불필요)
  → CHAT_COMPLETE 즉시 전송 (UI 잠금 해제, 테이블 렌더링)
  → [백그라운드] granite3.3-guardian:8b 셀 단위 Groundedness 검증
      → 각 데이터 셀 × 원문 청크 → safe / unsafe 판정
  → CHAT_VERIFICATION_DONE (셀 색상 업데이트)
  → 사용자 후속 요청 (멀티턴)
```

---

## 구현 단계 (10단계)

### 1단계: DB 마이그레이션
**파일**: `supabase/migrations/20260328010000_add_chat_tables.sql` (신규)

```sql
CREATE TABLE chat_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL,
  title           text NOT NULL DEFAULT 'New Chat',
  phase           text NOT NULL DEFAULT 'clarifying', -- 'clarifying' | 'follow_up'
  scope_folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  scope_all       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()  -- 핸들러에서 명시적 UPDATE (Method B)
);

CREATE TABLE chat_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role             text NOT NULL,       -- 'user' | 'assistant'
  content          text NOT NULL,
  message_type     text NOT NULL DEFAULT 'text', -- 'text' | 'table_report' | 'error'
  metadata         jsonb,               -- source_chunk_ids, referenced_paper_ids 등
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id, created_at);

CREATE TABLE chat_generated_tables (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  table_title      text,
  headers          jsonb NOT NULL,
  rows             jsonb NOT NULL,
  source_refs      jsonb,               -- [{refNo, paperId, title, authors, year}]
  verification     jsonb,               -- [{row, col, status, evidence}] — 비동기로 채워짐
  created_at       timestamptz NOT NULL DEFAULT now()
);
```

> ✅ **평가 Agent 2차 — 🔴 `updated_at` 자동 갱신 — 해결됨 (Method B 선택)**
> **방법 B** 채택: 4단계 `CHAT_SEND_MESSAGE` 핸들러에서 assistant 메시지 INSERT 직후 명시적 UPDATE.
> 마이그레이션 변경 불필요, 기존 main.mjs 패턴과 일치, 트리거보다 흐름 추적이 쉬움.
> ```javascript
> // 7단계: assistant 메시지 INSERT 후 대화 updated_at 갱신
> await supabase.from("chat_conversations")
>   .update({ updated_at: new Date().toISOString() })
>   .eq("id", conversationId);
> ```
> `ChatSidebar`의 `updatedAt DESC` 정렬이 정상 동작함.

> ✅ **🟡 `owner_user_id` 소스 — 해결됨**
> 로컬 단일 사용자 데스크탑 앱이므로 service_role 키로 `app_users` 테이블에서 첫 번째 유저를 가져옴:
> ```javascript
> const { data: appUser } = await supabase.from("app_users").select("id").limit(1).single();
> const ownerId = appUser?.id ?? "00000000-0000-0000-0000-000000000000";
> ```
> 멀티유저 확장 시 프론트에서 userId를 IPC params로 전달하는 방식으로 변경.

> ✅ **🟢 대화 제목 자동 생성 — 해결됨**
> 신규 대화 INSERT 시 `title`을 첫 메시지 앞 40자로 설정:
> ```javascript
> const title = message.slice(0, 40) + (message.length > 40 ? "…" : "");
> await supabase.from("chat_conversations").insert({ ..., title });
> ```

> ✅ **🔴 대화 단계 판별 로직 — 해결됨 (phase 기반 전환)**
> `phase` 컬럼으로 판별. 전환 규칙:
> - 신규 대화: `phase = 'clarifying'`
> - `clarifying` 단계에서 LLM이 질문 대신 충분한 정보가 있다고 판단하면 → 핸들러가 RAG 검색 + `generateTableJson()` 호출 → 테이블 JSON 반환 성공 시 `UPDATE phase = 'follow_up'`
> - 이후 모든 메시지: `'follow_up'` → RAG + 생성 프롬프트 직행 (멀티턴)
>
> 전환 트리거: `generateTableJson()`이 유효한 테이블을 반환한 시점 (JSON Schema 방식이므로 `|---|` 마크다운 감지 불필요).

### 2단계: IPC 채널 등록
**파일**: `apps/desktop/electron/types/ipc-channels.mjs` (수정)

```javascript
// IPC_CHANNELS에 추가:
CHAT_SEND_MESSAGE: 'chat:send-message',
CHAT_ABORT: 'chat:abort',
CHAT_EXPORT_CSV: 'chat:export-csv',

// IPC_EVENTS에 추가:
CHAT_TOKEN: 'chat:token',
CHAT_COMPLETE: 'chat:complete',
CHAT_VERIFICATION_DONE: 'chat:verification-done',  // 검증 완료 별도 이벤트
CHAT_ERROR: 'chat:error',
```

**파일**: `apps/desktop/electron/preload.mjs` (수정)

> ✅ **🔴 `preload.mjs` 이중 정의 — 해결됨**
> `preload.mjs`는 `ipc-channels.mjs`를 import하지 않고 채널 이름을 내부에 직접 하드코딩함 (3~35줄). **두 파일을 독립적으로 각각 수정해야 함.** 구현 시 `ipc-channels.mjs` 수정 후 `preload.mjs`에도 동일 문자열을 반드시 추가할 것.

```javascript
// preload.mjs에 추가할 내용 (ipc-channels.mjs와 문자열 일치시킬 것):

// IPC_CHANNELS 하드코딩 블록에 추가:
CHAT_SEND_MESSAGE: "chat:send-message",
CHAT_ABORT: "chat:abort",
CHAT_EXPORT_CSV: "chat:export-csv",

// IPC_EVENTS 하드코딩 블록에 추가:
CHAT_TOKEN: "chat:token",
CHAT_COMPLETE: "chat:complete",
CHAT_VERIFICATION_DONE: "chat:verification-done",
CHAT_ERROR: "chat:error",

// contextBridge.exposeInMainWorld에 추가:
chat: {
  sendMessage: (args) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND_MESSAGE, args),
  abort: (args) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_ABORT, args),
  exportCsv: (args) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_EXPORT_CSV, args),
},
onChatToken: (callback) => {
  const handler = (_event, data) => { try { callback(data); } catch (e) { console.error(e); } };
  ipcRenderer.on(IPC_EVENTS.CHAT_TOKEN, handler);
  return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_TOKEN, handler);
},
onChatComplete: (callback) => {
  const handler = (_event, data) => { try { callback(data); } catch (e) { console.error(e); } };
  ipcRenderer.on(IPC_EVENTS.CHAT_COMPLETE, handler);
  return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_COMPLETE, handler);
},
onChatVerificationDone: (callback) => {
  const handler = (_event, data) => { try { callback(data); } catch (e) { console.error(e); } };
  ipcRenderer.on(IPC_EVENTS.CHAT_VERIFICATION_DONE, handler);
  return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_VERIFICATION_DONE, handler);
},
onChatError: (callback) => {
  const handler = (_event, data) => { try { callback(data); } catch (e) { console.error(e); } };
  ipcRenderer.on(IPC_EVENTS.CHAT_ERROR, handler);
  return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_ERROR, handler);
},
```

### 3단계: LLM 채팅 모듈
**파일**: `apps/desktop/electron/llm-chat.mjs` (신규, ~400줄)

**핵심 함수:**
```javascript
// 명확화 단계 — 스트리밍 (사용자가 응답 생성을 실시간으로 봄)
export async function* streamChat(messages, abortSignal)

// 테이블 생성 단계 — 비스트리밍 JSON Schema 강제
export async function generateTableJson(messages)
// → { title, headers, rows, references, notes } (JSON Schema 직접 파싱, regex 불필요)

// 프롬프트 빌더
export function buildClarificationPrompt(history)
export function buildGenerationPrompt(history, ragContext, paperMetadata)

// Granite Guardian 셀 단위 검증
export async function checkGroundedness(sourceChunk, claim)
// → { status: "safe" | "unsafe", details: string }

// 상태 체크
export async function isLlmAvailable()      // gpt-oss:120b
export async function isGuardianAvailable() // granite3.3-guardian:8b
```

> ✅ **🔴 NDJSON 스트리밍 버퍼링 — 해결됨**
> 청크 경계에서 JSON 줄이 잘릴 수 있으므로 라인 버퍼 패턴 필수 적용:
> ```javascript
> export async function* streamChat(messages, abortSignal) {
>   const res = await fetch("http://localhost:11434/api/chat", {
>     method: "POST",
>     headers: { "Content-Type": "application/json" },
>     body: JSON.stringify({
>       model: "gpt-oss:120b",
>       messages,
>       stream: true,
>       options: { num_ctx: 131072, temperature: 0.3 }
>     }),
>     signal: abortSignal,
>   });
>   if (!res.ok) throw new Error(`Ollama error ${res.status}`);
>
>   const reader = res.body.getReader();
>   const decoder = new TextDecoder();
>   let buffer = "";
>
>   while (true) {
>     const { done, value } = await reader.read();
>     if (done) break;
>     buffer += decoder.decode(value, { stream: true });
>     const lines = buffer.split("\n");
>     buffer = lines.pop();              // 미완성 줄 보존
>     for (const line of lines) {
>       if (!line.trim()) continue;
>       const json = JSON.parse(line);   // 완전한 줄만 파싱
>       if (json.message?.content) yield json.message.content;
>       if (json.done) return;
>     }
>   }
> }
> ```

**시스템 프롬프트 (명확화):**
```
당신은 연구 논문 데이터를 비교 테이블로 정리하는 어시스턴트입니다.

사용자 요청을 분석하여 정확한 테이블을 만들기 위한 질문을 최대 6개 하세요:
- 비교 축: 행/열에 무엇을 놓을 것인가
- 데이터 범위: 온도, 압력, 농도 등 조건 제한
- 단위: 선호하는 단위
- 포함/제외 조건: 특정 물질/촉매/조건
- 출력 형식: 오차범위, 실험방법 등 추가 정보
- 기타 명확히 해야 할 사항

이미 명확한 부분은 질문하지 마세요.
충분한 정보가 있으면 질문 없이 바로 테이블을 생성해도 됩니다.
한국어로 답변하세요. 질문은 번호 목록으로 작성하세요.
```

**시스템 프롬프트 (테이블 생성) + JSON Schema:**
```
당신은 연구 데이터 테이블 생성기입니다.

규칙:
1. 소스 자료에 직접 명시된 데이터만 포함. 추측 금지.
2. 모든 데이터 셀에 참조 번호 [1], [2] 등을 표기.
3. 단위 변환 시 notes 필드에 변환 과정 명시.
4. 소스에 없는 데이터는 "N/A" 표시.
5. 지정된 JSON 형식으로만 출력하세요.
6. 한국어로 설명, 수치/단위는 원본 유지.
```

**Ollama `format` JSON Schema (테이블 생성 전용):**
```javascript
const TABLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    headers: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    references: {
      type: "array",
      items: {
        type: "object",
        properties: {
          refNo: { type: "string" },   // "[1]"
          paperId: { type: "string" }, // UUID (RAG 검색 결과에서 매핑)
          title: { type: "string" },
          authors: { type: "string" },
          year: { type: "integer" }
        },
        required: ["refNo", "title"]
      }
    },
    notes: { type: "string" }  // 단위 변환 등 부연 설명
  },
  required: ["title", "headers", "rows"]
};

export async function generateTableJson(messages) {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model: "gpt-oss:120b",
      messages,
      stream: false,
      format: TABLE_JSON_SCHEMA,
      options: { num_ctx: 131072, temperature: 0.1 }  // 낮은 temperature로 정확도 향상
    })
  });
  const json = await res.json();
  return JSON.parse(json.message.content);  // 스키마 강제로 파싱 실패 없음
}
```

**Granite Guardian 셀 단위 Groundedness 검증:**
```javascript
// granite3.3-guardian:8b — Groundedness 특화 팩트체커
// Document(원문) + Claim(셀 값) → safe(근거 있음) / unsafe(근거 없음)
export async function checkGroundedness(sourceChunk, claim) {
  const res = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model: "granite3.3-guardian:8b",
      messages: [
        {
          role: "user",
          content: `You are a fact-checking assistant. Determine if the claim is supported by the document.\n\nDocument:\n${sourceChunk}\n\nClaim:\n${claim}`
        }
      ],
      stream: false,
      options: { temperature: 0 }
    })
  });
  const json = await res.json();
  const content = json.message.content.toLowerCase().trim();
  // Granite Guardian 출력: "safe" 또는 "unsafe"
  return {
    status: content.startsWith("safe") ? "verified" : "unverified",
    details: json.message.content
  };
}
```

> ✅ **🟡 검증 신뢰도 개선 — gpt-oss 자기 검증 → Granite Guardian 독립 검증**
> 기존: gpt-oss:120b가 자신이 만든 테이블을 자신이 검증 → confirmation bias
> 변경: **granite3.3-guardian:8b** (독립 팩트체커) → 각 셀 × 원문 청크 교차 검증
> - LLM-AggreFact 3위 (76.5%), RAGTruth 82.2%
> - `parseVerificationJson()` 방어 파싱 불필요 — Granite Guardian은 "safe"/"unsafe" 단어로 출력
> - 기존 `buildVerificationPrompt()` 불필요 — 검증 로직이 `checkGroundedness()` 함수로 단순화

### 4단계: Main.mjs IPC 핸들러
**파일**: `apps/desktop/electron/main.mjs` (수정, ~230줄 추가)

**`CHAT_SEND_MESSAGE` 핸들러 (수정된 플로우):**
```
입력: { conversationId?, message, scopeFolderId?, scopeAll? }

[신규 대화]
1a. chat_conversations INSERT:
    - title = message.slice(0, 40)
    - owner_user_id = app_users에서 조회
    - phase = 'clarifying'

[기존 대화]
1b. chat_conversations SELECT → phase, scope 확인

2. 사용자 메시지 → chat_messages INSERT

3. 대화 기록 전체 로드 (chat_messages SELECT, role+content)

4. phase에 따라 분기:

[공통] RAG 검색 (phase='follow_up' 또는 clarifying→follow_up 전환 시):
5a. 쿼리 임베딩 생성: generateEmbedding(message + 대화요약, "query")
5b. paper_ids 수집: scopeAll ? 전체 papers.id : getPaperIdsInFolderTree(scopeFolderId)
5c. match_chunks(limit=60, threshold=0.30, filter_paper_ids)
5d. match_figures(filter_item_types=['table'], limit=20, filter_paper_ids)
5e. 논문 메타데이터 수집 (title, authors, year, journal_name)
5f. RAG 컨텍스트 문자열 조립, sourceChunks 보관 (검증용)

[경로 A — 명확화 단계: phase='clarifying']
6a. buildClarificationPrompt(history) → streamChat() [stream: true]
    let fullResponse = "";
    for await (const token of streamChat(messages, abortController.signal)) {
      fullResponse += token;
      broadcastToWindows(CHAT_TOKEN, { conversationId, token })
    }
7a. assistant 메시지 INSERT:
    const { data: msg } = await supabase.from("chat_messages")
      .insert({ conversation_id: conversationId, role: "assistant",
                content: fullResponse, message_type: "text" })
      .select("id").single();
8a. CHAT_COMPLETE 전송 (명확화 — 테이블 없음):
    broadcastToWindows(CHAT_COMPLETE, { conversationId, messageId: msg.id, hasTable: false })

[경로 B — 테이블 생성 단계: phase='follow_up']
6b. broadcastToWindows(CHAT_TOKEN, { conversationId, token: "⏳ 테이블 생성 중..." })
    RAG 검색 (5a~5f) 실행
    const tableJson = await generateTableJson(messages)  // JSON Schema 강제, 파싱 실패 없음
7b. assistant 메시지 INSERT:
    const { data: msg } = await supabase.from("chat_messages")
      .insert({ conversation_id: conversationId, role: "assistant",
                content: JSON.stringify(tableJson), message_type: "table_report",
                metadata: { source_chunk_ids: sourceChunks.map(c => c.chunk_id) } })
      .select("id").single();
8b. CHAT_COMPLETE 전송 (테이블 있음):
    broadcastToWindows(CHAT_COMPLETE, { conversationId, messageId: msg.id, hasTable: true, tableJson })

[공통] updated_at 갱신 (Method B):
    await supabase.from("chat_conversations")
      .update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

9. 테이블 생성 시 → Granite Guardian 백그라운드 검증 (fire-and-forget):
   a. phase UPDATE → 'follow_up' (아직 clarifying이었다면)
   b. chat_generated_tables INSERT + ID 캡처:
      const { data: tableRow } = await supabase.from("chat_generated_tables")
        .insert({ message_id: msg.id, conversation_id: conversationId,
                  table_title: tableJson.title, headers: tableJson.headers,
                  rows: tableJson.rows, references: tableJson.references ?? null })
        .select("id").single();
      const tableId = tableRow.id;
   c. setImmediate(async () => {
        try {
          const verification = [];
          for (let r = 0; r < tableJson.rows.length; r++) {
            for (let c = 0; c < tableJson.rows[r].length; c++) {
              const cellValue = tableJson.rows[r][c];
              if (!cellValue || cellValue === "N/A" || cellValue.trim() === "") continue;
              // 참조 번호 제거 후 수치만 추출
              const cleanValue = cellValue.replace(/\[\d+\]/g, "").trim();
              if (!cleanValue) continue;
              // 해당 셀과 가장 유사한 소스 청크 선택
              const bestChunk = sourceChunks.find(ch => ch.text.includes(cleanValue))
                ?? sourceChunks[0];
              const claim = `${tableJson.headers[c]}: ${cleanValue}`;
              const result = await checkGroundedness(bestChunk.text, claim);
              verification.push({ row: r, col: c, ...result });
            }
          }
          await supabase.from("chat_generated_tables")
            .update({ verification }).eq("id", tableId);
          broadcastToWindows(CHAT_VERIFICATION_DONE, { conversationId, tableId, verification });
        } catch { /* non-fatal */ }
      });
```

> ✅ **🟢 CHAT_COMPLETE 타이밍 — 해결됨**
> 스트리밍 완료 즉시(8단계) CHAT_COMPLETE 전송 → UI 잠금 해제.
> 검증은 `setImmediate`로 백그라운드 실행.
> 완료 시 `CHAT_VERIFICATION_DONE` 이벤트 → 프론트가 셀 색상만 업데이트.

**`CHAT_ABORT` 핸들러:**
```javascript
// 대화별 AbortController 관리
const chatAbortControllers = new Map(); // conversationId → AbortController

ipcMain.handle(IPC_CHANNELS.CHAT_ABORT, (_event, { conversationId }) => {
  const ctrl = chatAbortControllers.get(conversationId);
  if (ctrl) { ctrl.abort(); chatAbortControllers.delete(conversationId); }
  return { success: true };
});
```

> ✅ **평가 Agent 2차 — 🟢 `chatAbortControllers` Map 정리 — 해결됨**
> 스트리밍 try/catch의 **`finally` 블록**에서 삭제. 정상 완료와 에러/abort 모두 처리됨:
> ```javascript
> try {
>   // ... Ollama 스트리밍 ...
> } catch (err) {
>   // ... 에러 처리 ...
> } finally {
>   chatAbortControllers.delete(conversationId);  // 항상 정리
> }
> ```
> `CHAT_ABORT` 핸들러에는 이미 `chatAbortControllers.delete(conversationId)`가 있으므로 finally에서 중복 삭제해도 안전 (Map.delete는 없는 키도 허용).

**`CHAT_EXPORT_CSV` 핸들러:**
```javascript
// chat_generated_tables 조회 → CSV 생성 (BOM \uFEFF) → dialog.showSaveDialog → fs.writeFile
```

**DB 테이블 허용 목록 추가:**
- `DB_QUERY_TABLES`에 `"chat_conversations"`, `"chat_messages"`, `"chat_generated_tables"` 추가
- `DB_MUTATE_TABLES`에 동일 추가

**폴더 재귀 paper_id 수집:**

> ~~⚠️ **평가 Agent — 🟡 `paper_folders`(M:N) vs `papers.folder_id`(1:1) 혼재**~~
> ❌ **평가 오류** — DB 직접 확인 결과 `papers` 테이블에 `folder_id` 컬럼이 존재하지 않음. `paper_folders`(M:N)가 유일한 source of truth. 프론트엔드의 `paper.folderId`는 JOIN 결과를 가공한 파생값. 헬퍼가 `paper_folders`를 사용하는 것이 정확하며 혼재 문제 없음.

```javascript
async function getPaperIdsInFolderTree(folderId) {
  const { data: allFolders } = await supabase.from("folders").select("id, parent_folder_id");
  const folderIds = [folderId];
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const f of allFolders) {
      if (f.parent_folder_id === current) { folderIds.push(f.id); queue.push(f.id); }
    }
  }
  const { data: links } = await supabase.from("paper_folders").select("paper_id").in("folder_id", folderIds);
  return [...new Set((links ?? []).map(l => l.paper_id))];
}
```

### 5단계: 프론트엔드 타입
**파일**: `frontend/src/types/chat.ts` (신규)
- `ChatConversation` (phase 포함), `ChatMessage`, `ChatGeneratedTable`
- `TableReference`, `CellVerification`
- `ChatTokenEvent`, `ChatCompleteEvent`, `ChatVerificationDoneEvent`, `ChatErrorEvent`

**파일**: `frontend/src/types/paper.ts` (수정)
- `NavItem`에 `"chat"` 추가

**파일**: `frontend/src/types/desktop.ts` (수정)
- `RedouDesktopApi`에 `chat` 네임스페이스 추가
- `onChatToken`, `onChatComplete`, `onChatVerificationDone`, `onChatError` 리스너 타입 추가

### 6단계: 상태 관리 + 데이터 레이어
**파일**: `frontend/src/stores/chatStore.ts` (신규)
```typescript
interface ChatState {
  activeConversationId: string | null;
  streamingContent: string;          // 스트리밍 중 토큰 누적
  streamingMessageId: string | null;
  isStreaming: boolean;
  scopeFolderId: string | null;      // null = 전체 라이브러리
  // actions: setActiveConversationId, appendToken, startStreaming, finishStreaming, setScopeFolderId
}
```

**파일**: `frontend/src/lib/chatQueries.ts` (신규)
- `useChatConversations()`, `useChatMessages(convId)`, `useChatTable(tableId)`
- `useSendChatMessage()`, `useDeleteConversation()`, `useRenameConversation()`
- `useChatStreamBridge()` — `onChatToken` + `onChatComplete` + `onChatVerificationDone` + `onChatError` 구독. 기존 `useDesktopJobBridge` 패턴 (`frontend/src/lib/desktop.ts` 참조).

> ✅ **평가 Agent 2차 — 🔴 `CHAT_VERIFICATION_DONE` 수신 후 처리 — 해결됨**
> `useChatStreamBridge()` 구현 스펙에 `queryClient.invalidateQueries` 호출을 명시:
> ```typescript
> const unsubVerification = api.onChatVerificationDone((event: ChatVerificationDoneEvent) => {
>   // 검증 완료 → DB 갱신된 verification 컬럼을 재조회하도록 invalidate
>   queryClient.invalidateQueries({ queryKey: ['chat-table', event.tableId] });
>   // 대화 목록도 invalidate (불필요하지 않으나 보험)
>   queryClient.invalidateQueries({ queryKey: ['chat-messages', event.conversationId] });
> });
> return () => { unsubToken(); unsubComplete(); unsubVerification(); unsubError(); };
> ```
> 흐름: `CHAT_VERIFICATION_DONE` 수신 → `invalidateQueries` → `useChatTable(tableId)` 재조회 → `ChatTableReport` 리렌더링 → 셀 색상(초록/빨강) 표시.

### 7단계: UI 컴포넌트
**파일**: `frontend/src/features/chat/ChatView.tsx` (신규, 메인)
```
┌────────────────────────────────────────────────┐
│ [대화 목록]  │  대화 제목       [CSV 내보내기]  │
│              │                                  │
│ ● Zeolite    │  👤 "zeolite 5A 흡착량 비교..."  │
│   CLWS 촉매  │  🤖 명확화 질문 1~6              │
│              │  👤 답변들                       │
│ + 새 대화    │  🤖 [테이블 보고서]              │
│              │      [검증 배지 — 비동기 업데이트]│
│ 📁 범위:전체 │                                  │
│              │  ┌──────────────────────────────┐│
│              │  │ 요청을 입력하세요...          ││
│              │  └──────────────────────────────┘│
└────────────────────────────────────────────────┘
```

**파일**: `frontend/src/features/chat/ChatSidebar.tsx` (신규)
- "새 대화" 버튼, 대화 목록 (updatedAt DESC), 우클릭: 이름변경/삭제
- 폴더 범위 선택기 (전체 / 특정 폴더, 하위 폴더 포함)

**파일**: `frontend/src/features/chat/ChatMessageList.tsx` (신규)
- 메시지 스크롤 + auto-scroll to bottom
- `text` → 마크다운, `table_report` → ChatTableReport, `error` → 재시도 버튼

**파일**: `frontend/src/features/chat/ChatTableReport.tsx` (신규)
- HTML 테이블 렌더링
- 검증 전: 셀 기본 색상 / 검증 후: 초록(verified), 빨강(unverified) — Granite Guardian 이진 판정
- 참조문헌 섹션 (클릭 → `setSelectedPaperId` + `openPaperDetail`)
- CSV 내보내기 버튼

**파일**: `frontend/src/features/chat/ChatInput.tsx` (신규)
- textarea auto-resize, Enter 전송, Shift+Enter 줄바꿈
- 스트리밍 중: "중단" 버튼 (CHAT_ABORT IPC 호출)
- 범위 표시 배지 (전체 / 폴더명)

**의존성 추가**: `react-markdown` + `remark-gfm` (명확화 단계 텍스트 마크다운 렌더링용 — 테이블은 JSON에서 직접 렌더링)

### 8단계: 네비게이션 통합
- `frontend/src/app/LeftSidebar.tsx`: `navItems`에 `{ id: "chat", label: "채팅", icon: MessageSquare }` 추가, `WorkspaceSidebar`에 `if (activeNav === "chat") return <ChatSidebar />;`
- `frontend/src/app/AppShell.tsx`: `case "chat": return <ChatView />;`

### 9단계: 검증 에이전트 (Granite Guardian 3.3 8B)
- `main.mjs` CHAT_SEND_MESSAGE 핸들러 내 `setImmediate` 백그라운드 실행
- 각 데이터 셀 × 소스 청크 → `checkGroundedness(chunk, claim)` 순차 호출
- Granite Guardian 출력: `"safe"` (근거 있음) / `"unsafe"` (근거 없음)
- `buildVerificationPrompt()` 불필요 — 검증 로직이 `checkGroundedness()` 내부에 캡슐화됨
- `parseVerificationJson()` 불필요 — Granite Guardian은 단어로 직접 출력
- 결과 → `chat_generated_tables.verification` UPDATE → `broadcastToWindows(CHAT_VERIFICATION_DONE, ...)`
- **셀 색상**: `verified` → 초록, `unverified` → 빨강 (기존 uncertain/orange 제거, 이진 판정)

### 10단계: CSV 내보내기
- `CHAT_EXPORT_CSV` IPC 핸들러
- BOM `\uFEFF` 프리픽스 (한글 Excel 호환)
- `dialog.showSaveDialog` → `fs.writeFile`

---

## 변경 파일 요약

| 파일 | 작업 |
|------|------|
| `supabase/migrations/20260328010000_add_chat_tables.sql` | 신규 |
| `apps/desktop/electron/llm-chat.mjs` | 신규 (~400줄, Granite Guardian + JSON Schema 포함) |
| `apps/desktop/electron/types/ipc-channels.mjs` | 수정 (7개 채널 추가) |
| `apps/desktop/electron/preload.mjs` | 수정 (chat 네임스페이스 + 4개 이벤트) |
| `apps/desktop/electron/main.mjs` | 수정 (~230줄 추가) |
| `frontend/src/types/chat.ts` | 신규 |
| `frontend/src/types/paper.ts` | 수정 (NavItem에 "chat") |
| `frontend/src/types/desktop.ts` | 수정 (chat API 타입) |
| `frontend/src/stores/chatStore.ts` | 신규 |
| `frontend/src/lib/chatQueries.ts` | 신규 |
| `frontend/src/features/chat/ChatView.tsx` | 신규 |
| `frontend/src/features/chat/ChatSidebar.tsx` | 신규 |
| `frontend/src/features/chat/ChatMessageList.tsx` | 신규 |
| `frontend/src/features/chat/ChatTableReport.tsx` | 신규 |
| `frontend/src/features/chat/ChatInput.tsx` | 신규 |
| `frontend/src/app/LeftSidebar.tsx` | 수정 |
| `frontend/src/app/AppShell.tsx` | 수정 |
| `frontend/package.json` | 수정 (react-markdown, remark-gfm) |

## RAG 컨텍스트 전략
- 131K 토큰 중 ~30K 사용: chunks 18K + figures 4K + 메타데이터 2K + 프롬프트 2K + 대화 4K
- `match_chunks`: limit=60, threshold=0.30
- `match_figures`: filter_item_types=['table'], limit=20

> ~~⚠️ **평가 Agent — 🔴 `match_figures` 차원 문제 재확인**~~
> ❌ **평가 오류 (중복)** — 기술 스택 섹션 참조. 쿼리 임베딩과 match_figures 모두 2048-dim. 문제 없음.

## 검증
1. `node --check apps/desktop/electron/main.mjs` + `node --check apps/desktop/electron/llm-chat.mjs`
2. DB 마이그레이션: `docker exec supabase_db_Supabase_Redou psql -U postgres -f migration.sql`
3. Ollama 모델 준비:
   ```bash
   ollama pull gpt-oss:120b           # 테이블 생성 LLM
   ollama pull granite3.3-guardian:8b # 검증 모델
   ```
4. 앱 시작 → 채팅 뷰 → 명확화 질문 스트리밍 확인
5. 시나리오: "zeolite 5A CO2 흡착량" → 질문 → 답변 → JSON 테이블 생성 → 검증 배지 (비동기)
6. Granite Guardian 검증: 정상 수치 셀 → 초록, 없는 수치 셀 → 빨강 확인
7. CSV → Excel 한글 깨짐 없음 확인
8. 멀티턴: "압력 컬럼 추가" → phase='follow_up' → 테이블 갱신

---

## 최종 검토 요약

| 항목 | 심각도 | 상태 |
|------|--------|------|
| `match_figures` 384 vs 2048 차원 불일치 | 🔴 | ❌ 평가 오류 — 이미 2048 통일 |
| 대화 단계 메시지 수 기반 판별 | 🔴 | ✅ phase 컬럼 + 테이블 감지로 해결 |
| preload.mjs 채널 이중 정의 | 🔴 | ✅ 두 파일 독립 수정 명시 + 전체 코드 추가 |
| NDJSON 스트리밍 버퍼링 없음 | 🔴 | ✅ 라인 버퍼 패턴 구현 코드 반영 |
| 검증 JSON.parse 크래시 | 🟡 | ✅ → Granite Guardian 도입으로 근본 해결 (LLM 자기 검증 + JSON 파싱 자체 제거) |
| owner_user_id 소스 미정 | 🟡 | ✅ app_users 테이블 조회로 해결 |
| paper_folders M:N vs 1:1 혼재 | 🟡 | ❌ 평가 오류 — papers에 folder_id 없음, paper_folders가 유일한 진실 |
| CHAT_COMPLETE 타이밍 UX | 🟢 | ✅ 검증 백그라운드 분리 + CHAT_VERIFICATION_DONE 이벤트 추가 |
| 대화 제목 자동 생성 없음 | 🟢 | ✅ 첫 메시지 40자 truncate로 해결 |
| `updated_at` 자동 갱신 트리거 없음 | 🔴 | ✅ 평가 2차 — Method B (핸들러 명시적 UPDATE) 채택 |
| `CHAT_VERIFICATION_DONE` 프론트 처리 미명시 | 🔴 | ✅ 평가 2차 — `queryClient.invalidateQueries` 명시 |
| `chatAbortControllers` Map 정리 누락 | 🟢 | ✅ 평가 2차 — `finally` 블록 정리 추가 |
| `react-markdown` 의존성 누락 (3차) | 🔴 | ❌ 평가 오류 — **플랜 L481**: "의존성 추가: react-markdown + remark-gfm", **L521**: 파일 요약 표 "frontend/package.json \| 수정(react-markdown, remark-gfm)" 이미 명시. 평가 에이전트가 미구현 상태를 플랜 누락으로 오인. |
| `NavItem`에 "chat" 미포함 (3차) | 🔴 | ❌ 평가 오류 — **플랜 L407**: "NavItem에 `"chat"` 추가", **L510**: 파일 요약 표 "types/paper.ts \| 수정(NavItem에 chat)" 이미 명시. 평가 에이전트가 미구현 상태를 플랜 누락으로 오인. |
| `DB_QUERY/MUTATE_TABLES` chat 테이블 누락 (3차) | 🔴 | ❌ 평가 오류 — **플랜 L375~377**: "DB_QUERY_TABLES에 chat_conversations, chat_messages, chat_generated_tables 추가 / DB_MUTATE_TABLES에 동일 추가" 이미 명시. 평가 에이전트가 미구현 상태를 플랜 누락으로 오인. |
| `broadcastToWindows()` 시그니처 (3차) | 🟢 | ✅ 평가 3차 — (channel, payload) 완전 일치 확인 |
| `useDesktopJobBridge()` queryClient 패턴 (3차) | 🟢 | ✅ 평가 3차 — `useQueryClient()` 훅 패턴 일치 확인 |
| 테이블 출력 regex 파싱 불안정 | 🟡 | ✅ HF 서치 반영 — Ollama JSON Schema `format` 파라미터로 근본 해결 |
| LLM 자기 검증 confirmation bias | 🔴 | ✅ HF 서치 반영 — granite3.3-guardian:8b 독립 검증으로 교체 (LLM-AggreFact 3위, RAG Groundedness 특화, Ollama 지원) |
