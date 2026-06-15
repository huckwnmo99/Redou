# Reranker (Cross-encoder) 추가

> 유형: feature | 상태: 계획 | 작성일: 2026-04-08

## 개요
- **목적**: Hybrid Search (BM25 + Vector) RRF 결과에 Cross-encoder 재정렬을 추가하여 LLM 컨텍스트 품질 향상
- **범위**: 새 모듈 `reranker-worker.mjs`, `runMultiQueryRag()` 후처리 삽입, @huggingface/transformers ONNX 추론
- **제외**: Frontend 변경, 외부 API 서비스, GPU 필수 요구

## 설계

### 모델 선택 — `BAAI/bge-reranker-v2-m3`

| 모델 | 파라미터 | 정확도 | 속도 | 다국어 |
|------|---------|--------|------|--------|
| `cross-encoder/ms-marco-MiniLM-L-6-v2` | 22M | 중 | 매우 빠름 | 영어 전용 |
| **`BAAI/bge-reranker-v2-m3`** | **568M** | **상** | **보통** | **O** |
| `jinaai/jina-reranker-v1-turbo-en` | 137M | 중상 | 빠름 | 영어 주력 |

선택 이유: 정확도 상위, 다국어 지원, ONNX 변환 가능, 데스크톱 환경에서 실용적 속도.

### 추론 백엔드 — `@huggingface/transformers` (ONNX Runtime)

- CPU 추론 → GPU VRAM 추가 점유 없음
- Electron 메인 프로세스에서 직접 실행 (별도 서버 불필요)
- ONNX INT8 quantized → 메모리 ~300MB, 40개 청크 ~2-4초

### 새 모듈: `reranker-worker.mjs`

```js
RERANKER_MODEL = "Xenova/bge-reranker-v2-m3"
_pipeline       // 싱글턴 (lazy-loaded)
_loadPromise    // 중복 로딩 방지

initReranker()                        // 모델 로드
rerankChunks(query, chunks, topK)     // 청크 재정렬
isRerankerAvailable()                 // 상태 확인
```

**Lazy load + Singleton**: 첫 검색 시 모델 로드, 이후 메모리 유지.

### 파이프라인 통합

**변경 전:**
```
runMultiQueryRag() → rrfFusion() → top 40 → assembleRagContext() → LLM
```

**변경 후:**
```
runMultiQueryRag() → rrfFusion() → top 40 → rerankChunks() → top 15 → assembleRagContext() → LLM
```

위치: `runMultiQueryRag()` 내부, `rrfFusion()` 호출 직후.

### 후보/결과 개수

| 단계 | 개수 |
|------|------|
| BM25/Vector 각각 | 60개 |
| RRF fusion 후 | 40개 |
| **Reranker 출력 (table)** | **15개** |
| **Reranker 출력 (qa)** | **10개** |

### Graceful Degradation

모델 로딩/추론 실패 시 RRF 결과 그대로 반환 (현재 동작 유지):
```js
async function rerankChunksIfAvailable(query, chunks, topK) {
  try {
    if (!await isRerankerAvailable()) return chunks.slice(0, topK);
    return await rerankChunks(query, chunks, topK);
  } catch (err) {
    console.warn("[Reranker] Failed, falling back:", err.message);
    return chunks.slice(0, topK);
  }
}
```

### 성능 예측

- `bge-reranker-v2-m3` ONNX INT8, CPU: ~2-4초 (40개 청크)
- 전체 파이프라인 대비 ~10% 증가 (LLM 호출 10-30초에 비해 미미)
- 첫 호출 시 모델 로딩: ~10-30초 (일회성)

## 작업 분해

1. [ ] `@huggingface/transformers` 의존성 추가 — `apps/desktop/package.json`
2. [ ] `reranker-worker.mjs` 신규 모듈 생성 — initReranker, rerankChunks, isRerankerAvailable
3. [ ] `main.mjs` 수정 — import + `runMultiQueryRag()` 내부에 rerankChunksIfAvailable 삽입
4. [ ] 통합 테스트

## 영향 범위
- 신규: `apps/desktop/electron/reranker-worker.mjs` (1개)
- 수정: `apps/desktop/electron/main.mjs` (import + ~10줄)
- 수정: `apps/desktop/package.json` (의존성 1개)
- DB 변경: 없음, IPC 추가: 없음, Frontend 변경: 없음

## 리스크 & 대안
- ONNX Runtime + Electron 호환성 문제 → electron-rebuild 또는 WASM fallback
- 메모리 ~300MB 부담 → `ms-marco-MiniLM-L-6-v2` (22M, ~50MB)로 대체 가능
- 첫 호출 지연 → 앱 시작 시 백그라운드 프리로딩 (Optional)
- 청크 512토큰 제한 → 현재 청크 50-150단어이므로 대부분 수용

## 가정 사항
- [가정] `@huggingface/transformers`가 Electron 35 Node.js에서 정상 동작
- [가정] `Xenova/bge-reranker-v2-m3` ONNX 모델이 HuggingFace Hub에서 사용 가능
- [가정] 40개 청크 reranking이 CPU에서 5초 이내 완료
- [가정] Reranker 실패 시 RRF fallback이 UX에 영향 없음
