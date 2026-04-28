# Fix: 코드 리뷰 Critical 이슈 2건 수정

> 유형: fix | 작성일: 2026-04-15 | 수정 완료: 2026-04-15

## 문제

코드 리뷰에서 발견된 Critical 등급 이슈 2건:

### Critical 1: 안전하지 않은 `.single()` 호출 4곳

**증상**: `.single()`이 에러를 반환해도 무시하고 진행, null 접근 시 런타임 크래시 가능

**근거**: `main.mjs` 4곳에서 `{ data }` 만 구조분해하고 `error`를 무시:
| 위치 | Line | 컨텍스트 | 현재 방어 |
|------|------|---------|-----------|
| equation 중복체크 | ~1504 | figures 테이블 조회 | `existing?.caption` optional chaining |
| 임베딩 논문 제목 | ~1663 | papers 테이블 조회 | `paperMeta?.title ?? "Untitled"` |
| 문서 임베딩 | ~1725 | papers 테이블 조회 | `if (paper && ...)` |
| CSV 내보내기 | ~3971 | chat_generated_tables 조회 | `if (!table)` |

**원인**: `unwrapSingle()` 헬퍼 도입 시 8곳만 전환하고 4곳을 누락

### Critical 2: `ollamaSignal()` 함수 중복

**증상**: 동일한 함수가 두 파일에 독립 정의 — 한쪽만 수정하면 동작 불일치 발생 위험

**근거**:
- `llm-chat.mjs` line 5-9: `ollamaSignal()` 정의
- `llm-orchestrator.mjs` line 10-14: 동일 함수 복사 정의
- 두 파일은 이미 import 관계 존재: `llm-orchestrator.mjs`가 `llm-chat.mjs`에서 `getActiveModel`, `OLLAMA_BASE_URL` import

## 수정 방안

### 1. `.single()` → `unwrapSingle()` 전환 (4곳)

기존 헬퍼 (`main.mjs` line 290-295):
```js
function unwrapSingle({ data, error }, label) {
  if (error) throw new Error(`[supabase] ${label}: ${error.message}`);
  if (!data) throw new Error(`[supabase] ${label}: no row returned`);
  return data;
}
```

#### Line ~1504 (equation 중복체크)
```js
// Before
const { data: existing } = await supabase
  .from("figures").select("caption")
  .eq("paper_id", job.paper_id)
  .eq("figure_no", eq.figureNo)
  .eq("item_type", "equation")
  .single();
if (existing?.caption) {

// After
let existing = null;
try {
  existing = unwrapSingle(await supabase
    .from("figures").select("caption")
    .eq("paper_id", job.paper_id)
    .eq("figure_no", eq.figureNo)
    .eq("item_type", "equation")
    .single(), "equation-duplicate-check");
} catch { /* 행 없음 = 중복 아님 */ }
if (existing?.caption) {
```
**참고**: 이 사이트는 행이 없을 수 있는 정상 케이스이므로 try/catch로 감싸야 함.

#### Line ~1663 (임베딩 논문 제목)
```js
// Before
const { data: paperMeta } = await supabase
  .from("papers").select("title")
  .eq("id", job.paper_id)
  .single();
const paperTitle = paperMeta?.title ?? "Untitled";

// After
let paperTitle = "Untitled";
try {
  const paperMeta = unwrapSingle(await supabase
    .from("papers").select("title")
    .eq("id", job.paper_id)
    .single(), "embedding-paper-title");
  paperTitle = paperMeta.title ?? "Untitled";
} catch (e) {
  console.warn("[Embedding] paper title lookup failed:", e.message);
}
```

#### Line ~1725 (문서 임베딩)
```js
// Before
const { data: paper } = await supabase
  .from("papers").select("title, abstract, embedding")
  .eq("id", job.paper_id)
  .single();
if (paper && !paper.embedding) {

// After
let paper = null;
try {
  paper = unwrapSingle(await supabase
    .from("papers").select("title, abstract, embedding")
    .eq("id", job.paper_id)
    .single(), "doc-embedding-paper");
} catch (e) {
  console.warn("[Embedding] paper lookup failed:", e.message);
}
if (paper && !paper.embedding) {
```

#### Line ~3971 (CSV 내보내기)
```js
// Before
const { data: table } = await supabase
  .from("chat_generated_tables")
  .select("table_title, headers, rows, source_refs")
  .eq("id", tableId)
  .single();
if (!table) return { success: false, error: "Table not found" };

// After
let table;
try {
  table = unwrapSingle(await supabase
    .from("chat_generated_tables")
    .select("table_title, headers, rows, source_refs")
    .eq("id", tableId)
    .single(), "csv-export-table");
} catch (e) {
  return { success: false, error: e.message };
}
```

### 2. `ollamaSignal()` 중복 제거

기존 패턴에 따라 `llm-chat.mjs`를 원본으로 유지하고 export:

```js
// llm-chat.mjs — export 목록에 ollamaSignal 추가
export {
  OLLAMA_BASE_URL,
  DEFAULT_MODEL,
  GUARDIAN_MODEL,
  ollamaSignal,        // ← 추가
};
```

```js
// llm-orchestrator.mjs — import에 추가, 로컬 정의 삭제
import { getActiveModel, OLLAMA_BASE_URL, ollamaSignal } from "./llm-chat.mjs";
// (line 10-14의 ollamaSignal 함수 정의 삭제)
```

## 영향 범위

| 파일 | 변경 |
|------|------|
| `main.mjs` | 4곳 `.single()` → `unwrapSingle()` 전환 |
| `llm-chat.mjs` | `ollamaSignal` export 추가 (1줄) |
| `llm-orchestrator.mjs` | import 수정 + 로컬 함수 삭제 (6줄 제거, 1줄 수정) |

- DB 변경: 없음
- IPC 변경: 없음
- 기능 동작 변경: 없음 (에러 처리 강화만)

## 검증 방법

### 1. 문법 체크
```bash
node --check apps/desktop/electron/main.mjs
node --check apps/desktop/electron/llm-chat.mjs
node --check apps/desktop/electron/llm-orchestrator.mjs
```

### 2. 잔존 확인
```bash
# main.mjs에서 unwrapSingle 미사용 .single() 확인
grep -n "\.single()" apps/desktop/electron/main.mjs
# 모든 .single() 호출이 unwrapSingle로 감싸져 있거나 maybeSingle()인지 확인

# ollamaSignal 중복 확인
grep -rn "function ollamaSignal" apps/desktop/electron/
# llm-chat.mjs에만 1곳 존재해야 함
```

### 3. 수동 테스트
- 앱 시작 → 논문 임포트 (equation 있는 PDF) → 임베딩 완료 확인
- 채팅에서 테이블 생성 → CSV 내보내기
- 채팅에서 Q&A 질문 → 응답 정상 확인

## 메모
- Warning/Info 이슈 8+6건은 별도 계획서로 분리 (비-Critical)
- `safeParseLlmJson()`도 두 파일에 중복 존재하지만, 구현이 다를 수 있으므로 이번 범위에서 제외
