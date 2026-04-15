# 외부 서비스
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 개요
Redou가 의존하는 로컬 서비스 6개. 모두 Docker 또��� 로컬 프로세스로 실행. 인터넷 불필요 (HuggingFace 모델 초기 다운로드 제외).

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
| 포트 | 8001 |
| URL | `http://localhost:8001` (REDOU_MINERU_URL) |
| API | `POST /predict` (multipart PDF) |
| Health check | `isMineruAvailable()` — /predict에 타임아웃 요청 |
| 용도 | PDF → 마크다��� + 구조화 JSON + 이미지 (Pipeline V2) |
| 코드 참조 | mineru-client.mjs:22 |
| 비고 | 가용하지 않으면 V1 파이프라인으로 폴백 |

### 5. UniMERNet (수식 OCR)
| 항목 | 값 |
|------|------|
| 포트 | 8010 |
| URL | `http://localhost:8010` |
| API | `POST /predict` (base64 이미지) |
| Health check | `isUniMERNetAvailable()` — /predict에 더미 요청 |
| 용도 | 수식 이미지 → LaTeX 변환 (고품질) |
| 코드 참조 | ocr-extraction.mjs:538 |
| 비고 | ��가 시 GLM-OCR LaTeX만 사용 |

### 6. GROBID (메타데이터)
| 항목 | 값 |
|------|------|
| 포트 | 8070 |
| URL | `http://localhost:8070` (REDOU_GROBID_URL) |
| API | `POST /api/processFulltextDocument` (multipart PDF) → TEI XML |
| Health check | `isGrobidAvailable()` — `GET /api/isalive` |
| 용도 | PDF → 제목, 저자, DOI, 연도, 저널, 초록, 참고문헌 추출 |
| 코드 참조 | grobid-client.mjs:21 |
| 비고 | 불가 시 pdfjs 메타데이터 + 휴리스틱 사용 |

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
| `REDOU_RENDERER_URL` | `http://127.0.0.1:4173` | 프론트엔드 |

## 서비스 가용��� 확인 (코드 기반)
| 함수 | 파일 | 대상 |
|------|------|------|
| `isModelLoaded()` | embedding-worker.mjs:134 | vLLM |
| `isLlmAvailable()` | llm-chat.mjs:121 | Ollama (현재 모델) |
| `isGuardianAvailable()` | llm-chat.mjs:140 | Ollama (Guardian) |
| `isOllamaAvailable()` | ocr-extraction.mjs:94 | Ollama (GLM-OCR) |
| `isMineruAvailable()` | mineru-client.mjs:22 | MinerU |
| `isUniMERNetAvailable()` | ocr-extraction.mjs:538 | UniMERNet |
| `isGrobidAvailable()` | grobid-client.mjs:21 | GROBID |

## 의존성
- 필수: Supabase (데이터 저장), vLLM (임베딩)
- 강력 권장: Ollama (채��/OCR), MinerU (V2 파이프라인)
- 선택: GROBID (메타데이터 품질 향상), UniMERNet (수식 LaTeX 품질 향상)
