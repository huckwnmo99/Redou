# Contextual Chunking (Anthropic 기법) 구현

> 유형: feature | 상태: 계획 | 작성일: 2026-04-08

## 개요
- **목적**: 각 청크 임베딩 시 논문 제목 + 섹션명 접두어를 추가하여 "어떤 논문의 어떤 섹션인지" 맥락을 벡터에 반영
- **범위**: `main.mjs`의 `processEmbeddingJob()` 수정, `buildContextualText()` 헬퍼 추가, `CURRENT_EXTRACTION_VERSION` 범프
- **제외**: DB 스키마 변경, Frontend 변경, 검색 쿼리 변경

## 핵심 개념

```
현재:
  "The adsorption capacity was 4.2 mmol/g at 298K and 1 bar."

Contextual:
  "[Paper: Adsorption kinetics of CO2 on zeolite 13X | Section: Results]
   The adsorption capacity was 4.2 mmol/g at 298K and 1 bar."
```

Anthropic "Contextual Retrieval" (2024) — Kapa.ai 벤치마크에서 검색 정확도 ~18% 향상.

## 설계 결정

### 접두어 추가 위치: 임베딩 시점 (In-flight prefix)

- `paper_chunks.text`는 **원본 유지** (BM25 tsvector, LLM 컨텍스트, 표시용)
- `processEmbeddingJob()`에서 임베딩 직전에만 접두어를 붙여 `generateEmbeddings()`에 전달
- BM25 `fts` 컬럼은 `text`에서 자동 생성 → 영향 없음
- 별도 DB 컬럼/마이그레이션 불필요

### 접두어 형식

```
[Paper: {title} | Section: {section_name}] {chunk_text}
  — section_id가 NULL이면:
[Paper: {title}] {chunk_text}
```

제목 200자, 섹션명 100자로 truncate (안전장치).

### 쿼리 측: 변경 없음

Anthropic 원문대로 문서 측에만 접두어 추가, 쿼리는 그대로 유지.

## 수정 내용

### 1. `buildContextualText()` 함수 추가

```js
const MAX_TITLE_LEN = 200;
const MAX_SECTION_LEN = 100;

function buildContextualText(paperTitle, sectionName, chunkText) {
  const title = (paperTitle ?? "Untitled").slice(0, MAX_TITLE_LEN);
  if (sectionName) {
    const section = sectionName.slice(0, MAX_SECTION_LEN);
    return `[Paper: ${title} | Section: ${section}] ${chunkText}`;
  }
  return `[Paper: ${title}] ${chunkText}`;
}
```

### 2. `processEmbeddingJob()` 수정

변경 전:
```js
const { data: chunks } = await supabase
  .from("paper_chunks")
  .select("id, text")
  .eq("paper_id", job.paper_id)
  .order("chunk_order", { ascending: true });

const texts = chunksToEmbed.map((c) => c.text);
const embeddings = await generateEmbeddings(texts, onProgress);
```

변경 후:
```js
const { data: chunks } = await supabase
  .from("paper_chunks")
  .select("id, text, section_id")
  .eq("paper_id", job.paper_id)
  .order("chunk_order", { ascending: true });

// 논문 제목 + 섹션 맵 로드
const { data: paper } = await supabase
  .from("papers").select("title").eq("id", job.paper_id).single();
const paperTitle = paper?.title ?? "Untitled";

const { data: sections } = await supabase
  .from("paper_sections").select("id, section_name").eq("paper_id", job.paper_id);
const sectionMap = new Map((sections ?? []).map(s => [s.id, s.section_name]));

// Contextual prefix 추가한 텍스트로 임베딩
const texts = chunksToEmbed.map(c =>
  buildContextualText(paperTitle, sectionMap.get(c.section_id), c.text)
);
const embeddings = await generateEmbeddings(texts, onProgress);
```

### 3. `CURRENT_EXTRACTION_VERSION` 범프

```js
const CURRENT_EXTRACTION_VERSION = 24;  // was 23
```

기존 논문은 `requeueOutdatedPapers()`에 의해 자동 재처리됨.

## 작업 분해

1. [ ] `buildContextualText()` 함수 추가
2. [ ] `processEmbeddingJob()` 수정 — section_id 포함 쿼리, 논문 제목/섹션 로드, contextual text 생성
3. [ ] `CURRENT_EXTRACTION_VERSION` 23 → 24 범프

## 영향 범위
- 수정: `apps/desktop/electron/main.mjs` (1개 파일)
- DB 마이그레이션: 없음
- IPC 추가: 없음
- Frontend 변경: 없음
- **기존 논문 전체 재추출+재임베딩 필요** (버전 범프)

## 리스크 & 대안
- 접두어(~80토큰)가 임베딩 토큰 한도 초과 → nvidia 모델 32K 토큰 지원이므로 문제 없음
- 전체 재추출 부담 → 데스크톱 규모(수십~수백 편)에서 수용 가능
- section_id NULL인 청크 → 논문 제목만으로 접두어 생성 (여전히 효과 있음)

## 가정 사항
- [가정] nvidia/llama-nemotron-embed-vl-1b-v2가 접두어 형식을 의미적으로 처리 가능
- [가정] 쿼리 측 접두어 미추가가 검색 정확도에 부정적 영향 없음
- [가정] 기존 논문 재처리가 합리적 시간 내 완료
