# 외부 서비스
> 하네스 버전: v1.3 | 최종 갱신: 2026-07-04

## 개요
Redou가 의존하는 로컬 서비스 6개(프로덕션) + docling 표-파싱 사이드카 1개(**측정 전용·비상시**, tool-ab-adoption 슬라이스 02). 모두 Docker 또는 로컬 프로세스로 실행. 인터넷 불필요 (HuggingFace 모델 초기 다운로드 제외).

## 서비스 상세

### 1. Supabase (PostgreSQL + pgvector)
| 항목 | 값 |
|------|------|
| 포트 | 55321 |
| URL | `http://127.0.0.1:55321` (REDOU_SUPABASE_URL) |
| 인증 | service_role key (Electron), anon key (프론트엔드 + RLS) |
| 시작 | `supabase start` (Docker) |
| 확인 | `docker exec supabase_db_Supabase_Redou psql -U postgres` |
| 용도 | 모든 데이터 저장, 벡터 검색 (pgvector), BM25 검색 (tsvector) |
| 코드 ���조 | main.mjs:81-84, supabasePaperRepository.ts |

### 2. vLLM (임베딩 서버)
| 항목 | 값 |
|------|------|
| 포트 | 8100 |
| URL | `http://localhost:8100` (VLLM_BASE_URL in embedding-worker.mjs) |
| 모델 | nvidia/llama-nemotron-embed-vl-1b-v2 (VL, 2048-dim) |
| API | OpenAI-compatible `/v1/embeddings` (messages 기반) |
| Health check | `GET /health` |
| 용도 | 텍스트/이미지 임베딩 생성 |
| 코드 참조 | embedding-worker.mjs:11 |

### 3. Ollama (LLM + OCR)
| 항목 | 값 |
|------|------|
| 포트 | 11434 |
| URL | `http://localhost:11434` (OLLAMA_HOST) |
| 모델 | 사용자 선택 (기본: gpt-oss:120b), granite3-guardian:8b, glm-ocr |
| API | `/api/chat` (NDJSON 스트리밍), `/api/tags` (모델 목록) |
| Health check | `GET /api/tags` (200 OK + 모델 목록) |
| 용도 | LLM 채팅, Orchestrator, Table Agent, Guardian 검증, GLM-OCR |
| 코드 참조 | llm-chat.mjs:4, ocr-extraction.mjs |

### 4. MinerU (PDF 구조화)
| 항목 | 값 |
|------|------|
| 버전 | **3.4.2** (2.7.6→3.4 업그레이드, 2026-07-04. `Dockerfile.mineru` 핀 `mineru[core]>=3.4,<3.5`) |
| 포트 | 8001 (호스트) → 8000 (컨테이너 내부) |
| URL | `http://localhost:8001` (REDOU_MINERU_URL) |
| API | `POST /file_parse` (multipart/form-data, PDF). 3.4 추가 경로: `/tasks`, `/tasks/{id}`, `/tasks/{id}/result`, **`/health`**(신규) |
| Health check | `isMineruAvailable()` — `GET /docs` 200 (mineru-client.mjs:24). 3.4는 별도 `GET /health`도 제공(현 코드 미사용, `/docs`로 확인) |
| backend enum | 3.4에서 `["pipeline","vlm-engine","hybrid-engine","vlm-http-client","hybrid-http-client"]` — 클라이언트가 쓰는 `"pipeline"` 유효(무변경) |
| 실행 이미지 | 로컬 빌드 `mineru:latest`/`mineru:3.4` (Dockerfile.mineru), 컨테이너 `mineru-api` (compose.mineru.yaml `api` 프로필) |
| 용도 | PDF → 마크다운 + 구조화 JSON (content_list) + 이미지 (Pipeline V2) |
| content_list 타입 | 3.4 세분화: text/table/equation/image + `chart`·`list`·`header`·`footer`·`page_number`·`page_footnote`(신규)·discarded. 파서 매핑은 `pdf-pipeline.md` 참조 |
| 코드 참조 | mineru-client.mjs:45 (health), :62 (parsePdf `/file_parse`), :115 (parseMineruResult 3.4 매핑) |
| 비고 | 미가용 시 PDF 임포트/추출 실패. 재검증 스크립트 `scripts/verify-mineru-api.mjs`(3.4.2 Check 1·2·3 전부 PASS) |

### 5. UniMERNet (수식 OCR, 현재 V2 파이프라인 미사용)
| 항목 | 값 |
|------|------|
| 포트 | 8010 |
| URL | `http://localhost:8010` |
| API | `POST /predict` (base64 이미지) |
| Health check | 현재 `main.mjs`에서 호출하지 않음 |
| 용도 | legacy 수식 이미지 → LaTeX 변환 후보 |
| 코드 참조 | 없음 (V2 단일 파이프라인에서 호출자 없음) |
| 비고 | 현재 V2 PDF 파이프라인에서는 사용하지 않음 |

### 6. GROBID (메타데이터)
| 항목 | 값 |
|------|------|
| 포트 | 8070 |
| URL | `http://localhost:8070` (REDOU_GROBID_URL) |
| API | `POST /api/processFulltextDocument` (multipart PDF) → TEI XML |
| Health check | `isGrobidAvailable()` — `GET /api/isalive` |
| 용도 | PDF → 제목, 저자, DOI, 연도, 저널, 초록, 참고문헌 추출 |
| 코드 참조 | grobid-client.mjs:21 |
| 비고 | 미가용 시 메타데이터/참고문헌 일부 누락 degraded mode로 진행 |

### 7. docling 표-파싱 사이드카 (측정 전용 · 비상시, tool-ab-adoption 슬라이스 02)
| 항목 | 값 |
|------|------|
| 상태 | **측정 전용** — MinerU 3.4 vs docling 표 A/B에만 사용. **프로덕션 import 파이프라인 무배선**(main.mjs 미참조). 채택/상시화는 슬라이스 03 게이트 결과에 따름 |
| 포트 | 8011 |
| URL | `http://localhost:8011` (REDOU_DOCLING_URL) |
| 이미지 | 로컬 빌드 `docling-table-sidecar:latest` (`apps/docling-server/Dockerfile.docling`, docling>=2.108,<3) |
| API | `POST /parse` (multipart PDF) → 표 중심 JSON(표별 셀 grid + **셀별 bbox** + 캡션 + caption_ref + HTML + 수식 LaTeX + figure 수 + 파싱시간) |
| Health check | `isDoclingAvailable()` — `GET /health` (docling-client.mjs) |
| 실행 | `docker compose -f apps/docling-server/compose.docling.yaml up -d docling`(기본 CPU) / `--profile gpu up docling-gpu`(GPU 옵션). **별도 compose 파일**(compose.mineru.yaml·docker-compose.yml 무침범), `restart:no` A/B 임시 |
| 용도 | docling DoclingDocument 표 구조(TableFormer 셀 bbox)를 MinerU와 대조(도입 판단) |
| 코드 참조 | docling-client.mjs (isDoclingAvailable/parsePdfDocling), scripts/ab-docling-tables.mjs (5축 A/B + 게이트) |
| 비고 | GPU 1장을 ocr-server/MinerU가 점유 중이라 기본 CPU 실행. A/B 기간에만 기동 후 해제 |

## 환경변수 요약
| 변수 | 기본값 | 서비스 |
|------|--------|--------|
| `REDOU_SUPABASE_URL` | `http://127.0.0.1:55321` | Supabase |
| `REDOU_SUPABASE_SERVICE_KEY` | (필수) | Supabase |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama |
| `REDOU_LLM_MODEL` | `gpt-oss:120b` | Ollama (LLM) |
| `REDOU_GUARDIAN_MODEL` | `granite3-guardian:8b` | Ollama (Guardian) |
| `REDOU_LLM_CTX` | `131072` | Ollama (컨텍스트 윈도우) |
| `REDOU_MINERU_URL` | `http://localhost:8001` | MinerU |
| `REDOU_GROBID_URL` | `http://localhost:8070` | GROBID |
| `REDOU_DOCLING_URL` | `http://localhost:8011` | docling 사이드카 (측정 전용) |
| `REDOU_RENDERER_URL` | `http://127.0.0.1:4173` | 프론트엔드 |

## 서비스 가용��� 확인 (코드 기반)
| 함수 | 파일 | 대상 |
|------|------|------|
| `isModelLoaded()` | embedding-worker.mjs:134 | vLLM |
| `isLlmAvailable()` | llm-chat.mjs:121 | Ollama (현재 모델) |
| `isGuardianAvailable()` | llm-chat.mjs:140 | Ollama (Guardian) |
| `isOllamaAvailable()` | ocr-extraction.mjs:81 | Ollama (GLM-OCR) |
| `isMineruAvailable()` | mineru-client.mjs:22 | MinerU |
| `isGrobidAvailable()` | grobid-client.mjs:21 | GROBID |
| `isDoclingAvailable()` | docling-client.mjs | docling 사이드카 (측정 전용) |

## 의존성
- 필수: Supabase (데이터 저장), vLLM (임베딩), MinerU (V2 PDF 파이프라인)
- 강력 권장: Ollama (채��/OCR)
- 선택: GROBID (메타데이터 품질 향상)
- 보류/미사용: UniMERNet (현재 V2 PDF 파이프라인 호출자 없음)
- 측정 전용(비상시): docling 사이드카 (tool-ab-adoption 슬라이스 02 A/B 기간에만 기동, 프로덕션 무배선)
