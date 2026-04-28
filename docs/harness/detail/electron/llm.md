# LLM 모듈
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-22

## 개요
Ollama 기반 LLM 채팅 스트리밍, 비교 테이블 생성 오케스트레이션, Q&A 응답, Granite Guardian 검증을 담당한다. 사용자가 Settings에서 모델을 변경할 수 있다.

## 핵심 파일
| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `apps/desktop/electron/llm-chat.mjs` | 스트리밍 채팅 + Guardian + 모델 관리 | ~159 |
| `apps/desktop/electron/llm-orchestrator.mjs` | Orchestrator + Table Agent + Extraction Agent + NULL Recovery Agent | ~660 |
| `apps/desktop/electron/llm-qa.mjs` | Q&A 시스템 프롬프트 + 응답 생성 + 출처 귀속 | ~121 |
| `apps/desktop/electron/html-table-parser.mjs` | HTML 테이블 → headers/rows 파싱 (코드) | ~312 |

## 주요 함수/컴포넌트

### llm-chat.mjs
| 함수 | 역할 |
|------|------|
| `streamChat(messages, abortSignal)` | Ollama NDJSON 스트리밍 (async generator) |
| `checkGroundedness(sourceText, claim)` | Guardian: "Yes"=ungrounded, "No"=grounded |
| `isLlmAvailable()` | 현재 모델 가용 확인 |
| `isGuardianAvailable()` | granite3-guardian 가용 확인 |
| `getActiveModel()` / `setActiveModel(model)` | 런타임 모델 변경 |

### llm-orchestrator.mjs
| 함수 | 역할 |
|------|------|
| `generateOrchestratorPlan(history, papers, prevTable, signal)` | 의도 분석 → {action, search_queries, table_spec, keyword_hints} |
| `generateTableFromSpec(tableSpec, ragContext, paperMeta, signal)` | Table Agent: RAG → 테이블 JSON (single-call fallback) |
| `extractMatrixFromHtml(htmlSnippet, signal)` | Extractor Agent: HTML → {headers, rows} (LLM 폴백) |
| `extractColumnsFromPaper(tableSpec, context, title, signal)` | Per-paper Extraction Agent (SRAG 3b) |
| `extractNullCellsFromPaper(tableSpec, nullColumns, context, title, signal)` | NULL Recovery Extraction Agent (SRAG 3d) |

### llm-qa.mjs
| 함수 | 역할 |
|------|------|
| `generateQaResponse(ragContext, history, paperMeta, signal)` | Q&A 스트리밍 응답 (streamChat 래핑) |
| `formatSourceAttribution(text, paperMeta)` | [1], [2] 참조번호 → paperId 매핑 |

## LLM 에이전트 구조

| 에이전트 | 모델 | 응답 형식 | 온도 | 용도 |
|----------|------|-----------|------|------|
| Orchestrator | 활성 모델 | JSON (ORCHESTRATOR_SCHEMA) | 0.2 | 의도 분석, 쿼리/테이블 사양 설계 |
| Table Agent | 활성 모델 | JSON (TABLE_OUTPUT_SCHEMA) | 0.1 | RAG → 비교 테이블 JSON |
| Extraction Agent | 활성 모델 | JSON (PAPER_EXTRACTION_SCHEMA) | 0.1 | 단일 논문 데이터 추출 (SRAG) |
| NULL Recovery Agent | 활성 모델 | JSON (PAPER_EXTRACTION_SCHEMA) | 0.1 | Stage 3d에서 NULL 컬럼만 재추출 |
| Extractor Agent | 활성 모델 | JSON (EXTRACTOR_OUTPUT_SCHEMA) | 0.0 | HTML 테이블 파싱 (LLM 폴백) |
| Q&A Agent | 활성 모델 | 스트리밍 텍스트 | 0.3 | RAG 기반 질의응답 |
| Guardian | granite3-guardian:8b | "Yes"/"No" | 0.0 | groundedness 검증 |

## Orchestrator action 흐름

```
action = "clarify"
  → clarification_response → 스트리밍 반환 (토큰 분할)

action = "generate_table" / "modify_table"
  → search_queries: 2~5개 (영어, 과학 용어)
  → table_spec: { title, row_axis, column_definitions(4~8), inclusion/exclusion }
  → keyword_hints: 소문자 영어 키워드
```

## Stage 3d Agentic NULL Recovery

테이블 생성의 SRAG 경로에서 `mergeExtractionResults()`가 `nullSummary`를 만든 직후, `cleanCellValue()` 전에 실행된다. `single_call_fallback` 경로는 `nullSummary`가 없으므로 건너뛴다.

핵심 흐름:
- `shouldTriggerAgenticRecovery()`가 NULL 비율 5% 이상, 남은 NULL details, 테이블 row 존재 여부를 확인한다.
- `groupNullsByPaper()`가 `nullSummary.details`를 논문별로 묶고, `buildRecoveryQueries()`가 LLM 없이 컬럼명/단위/keyword_hints 기반 복구 검색 쿼리를 만든다.
- `runPaperScopedRecoverySearch()`는 기존 `runMultiQueryRag()`를 단일 paperId 범위로 호출한다.
- Gate 1: 기존 Stage 2/3b 컨텍스트에 없던 `chunk_id` 또는 `figure_id`가 하나도 없으면 `extractNullCellsFromPaper()`를 호출하지 않는다.
- Gate 2: `applyRecoveredValues()`는 `confidence === "high"`인 결과만 기존 `N/A` 셀에 채운다.
- 전체 `runAgenticNullRecovery()`는 fail-soft이며 오류/timeout/abort 시 원본 `tableJson`과 `nullSummary`를 반환하고 `agenticRecovery` metadata만 기록한다.

## 모델 설정
- 기본: `gpt-oss:120b` (환경변수 `REDOU_LLM_MODEL`)
- 사용자 변경: `user_workspace_preferences.llm_model` 컬럼
- 런타임: `setActiveModel()` → `_activeModel` 전역 변수
- 모델 목록: Ollama `/api/tags` (granite3-guardian, glm-ocr 제외)
- 컨텍스트: `num_ctx` = 131072 (환경변수 `REDOU_LLM_CTX`)

## 의존성
- 사용: Ollama API (port 11434)
- 사용됨: main.mjs (채팅 파이프라인), embedding-worker.mjs는 별도 (vLLM)

## 현재 상태
- 구현 완료: 스트리밍 채팅, Orchestrator, Table Agent, Extraction Agent (SRAG), Stage 3d Agentic NULL Recovery, Q&A, Guardian, 모델 선택
- JSON 스키마 강제 모드 사용 (Ollama format 파라미터)
- 1회 재시도: extractColumnsFromPaper에서 JSON 파싱 실패 시

### 알려진 이슈

1. **R² 인코딩 깨짐** — Orchestrator가 `column_definitions`에 `R²`를 넣으면 `R짼`로 깨짐. Ollama JSON 응답에서 ² (U+00B2) 등 유니코드 특수문자가 인코딩 손실됨. SRAG 추출 시 해당 열이 모두 null로 반환. → `sanitizeColumnNames()` 정규화 함수로 수정 (main.mjs Stage 3b 직전).

### 수정 완료 (2026-04-10)

2. ~~**Orchestrator clarify 과다**~~ — 프롬프트에서 "반드시 clarify" 강제 삭제, 포괄적 요청 시 합리적 기본값으로 진행하도록 변경, 2회 이상 clarify 시 진행 가드레일 추가. main.mjs에 코드 가드레일(history에서 3회 이상 clarify면 강제 generate_table) 추가.
3. ~~**LLM 한글 출력 인코딩 깨짐**~~ — EXTRACTION_AGENT_SYSTEM_PROMPT / TABLE_AGENT_SYSTEM_PROMPT에서 notes 필드 영어 작성 강제. paper_title도 원본 영어 제목 사용 명시.
4. ~~**Guardian 검증 0/42**~~ — checkGroundedness()를 표준 Ollama /api/chat 프로토콜로 전환 (role: "system" + role: "user"). combinedSource 길이 최적화 (figure 1000자, chunk 800자, 전체 12000자). claim에 식별 열(Adsorbent, Gas 등) 포함.
