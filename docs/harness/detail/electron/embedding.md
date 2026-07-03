# 임베딩 모듈
> 하네스 버전: v1.15 | 최종 갱신: 2026-07-03

## 개요
vLLM 서버의 nvidia/llama-nemotron-embed-vl-1b-v2 모델로 텍스트/이미지 임베딩(2048-dim)을 생성한다. 청크, 논문, Figure/Table/Equation에 대해 임베딩을 생성하고 pgvector에 저장한다.

> 엔티티 임베딩(`entities.embedding`)은 같은 모델을 쓰되 별도 경로(`entity-extractor.mjs` persistEntities, opt-in) — `entity-graph.md` 참고.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `apps/desktop/electron/embedding-worker.mjs` | vLLM 임베딩 API 클라이언트 | ~143 |
| `apps/desktop/electron/main.mjs` | processEmbeddingJob (임베딩 작업 실행) | 1592~1859 |

## 주요 함수

### embedding-worker.mjs
| 함수 | 역할 | 입출력 |
|------|------|--------|
| `generateEmbedding(text, type)` | 단일 텍스트 임베딩 | type: "query"/"document" → number[2048] |
| `generateEmbeddings(texts, onProgress, type)` | 배치 텍스트 임베딩 | 동시성 8, 진행 콜백 |
| `generateImageEmbedding(imagePath, captionText)` | 이미지+캡션 VL 임베딩 | PNG/JPG → base64 → number[2048] |
| `isModelLoaded()` | vLLM 서버 health check | GET /health |

### main.mjs
| 함수 | 줄 | 역할 |
|------|------|------|
| `buildContextualText(title, section, text)` | 151 | Contextual Chunking 접두어 생성 |
| `processEmbeddingJob(job)` | 1592 | 임베딩 작업: 청크 + 논문 + Figure |
| `buildReferencePattern(figureNo)` | 1577 | Figure 참조 패턴 RegExp 생성 |

## 모델 스펙
| 항목 | 값 |
|------|------|
| 모델 | `nvidia/llama-nemotron-embed-vl-1b-v2` |
| 차원 | 2048 (고정) |
| 서버 | vLLM (port 8100, `VLLM_BASE_URL`) |
| API | OpenAI-compatible `/v1/embeddings` (messages 기반) |
| 동시성 | 8 (CONCURRENCY_LIMIT) |
| L2 정규화 | 적용 (normalizeVector) |

## Contextual Chunking
```
[Paper: {title} | Section: {sectionName}] {chunkText}
```
- `MAX_TITLE_LEN`: 200자
- `MAX_SECTION_LEN`: 100자
- 섹션 없으면: `[Paper: {title}] {chunkText}`

## 임베딩 작업 흐름 (processEmbeddingJob)

1. **청크 임베딩**: 미임베딩 청크 필터링 → contextual prefix → 배치 생성 → upsert (50개씩)
   - **부분 실패 격리 (A-R1)**: `generateEmbeddings`가 배치를 `Promise.allSettled`로 돌려 청크 1개 실패가 배치 전체를 죽이지 않음(실패 슬롯 undefined). 호출부는 성공분만 upsert하고 실패 개수를 로깅. 성공 ≥1이면 job=succeeded(그림 경로와 일관), 전부 실패면 throw로 job=failed→재큐. 재큐 시 미임베딩 청크 필터가 실패분만 재시도(성공분 재임베딩 없음).
2. **논문 단위 임베딩**: title + abstract → papers.embedding
3. **Figure/Table/Equation 임베딩**:
   - 이미지 있음: `generateImageEmbedding(imagePath, enrichedCaption)` (VL 모드)
   - 이미지 없음: plain_text 또는 summary_text → `generateEmbedding(text)` (텍스트 모드)
   - 참조 컨텍스트 보강: buildReferencePattern으로 청크에서 해당 Figure를 참조하는 텍스트를 찾아 캡션에 추가 (MAX_CONTEXT_CHARS: 2000)

## DB 저장 대상
| 테이블 | 컬럼 | 설명 |
|--------|------|------|
| `chunk_embeddings` | embedding vector(2048) | 청크 벡터 |
| `papers` | embedding vector(2048) | 논문 단위 벡터 |
| `figures` | embedding vector(2048) | Figure/Table/Equation 벡터 |
| `highlight_embeddings` | embedding vector(2048) | 하이라이트 벡터 (별도 경로) |

## 의존성
- 사용: vLLM 서버 (port 8100), Supabase DB
- 사용됨: main.mjs (processEmbeddingJob), IPC EMBEDDING_GENERATE_QUERY (검색 쿼리)

## 현재 상태
- 구현 완료: 텍스트/이미지/VL 임베딩, contextual chunking, 참조 컨텍스트 보강, 청크 배치 부분 실패 격리(A-R1)
- pgvector 2048-dim은 HNSW 인덱스 불가 (2000 제한) → exact search 사용 (데스크탑 규모에 충분)
- vLLM 임베딩 호출 타임아웃 부재(A-R4, `callVllmSingle` fetch에 signal 없음)는 별도 미해결 — 부분 실패는 격리되나 hang은 여전히 파이프라인을 막을 수 있음.
