# SRAG 스타일 2단계 추출 (추출 → 조립 분리) 구현

> 유형: feature | 상태: 계획 | 작성일: 2026-04-08

## 개요
- **목적**: 단일 LLM 호출로 전체 RAG 컨텍스트를 처리하는 방식을, 논문별 독립 추출(Stage 3b) + 코드 병합(Stage 3c)으로 분리하여 데이터 정확도 대폭 향상
- **범위**: `llm-orchestrator.mjs` Per-paper Extraction Agent 추가, `main.mjs` Stage 3 파이프라인 교체, Frontend 파이프라인 스테이지 확장
- **제외**: Agentic 재검색 (Step 4), CRAG 검증 (Step 4)

## 현재 → 변경 후

```
현재:
  Stage 3a: OCR 파싱 (논문별)
  Stage 3:  assembleRagContext(전체) → generateTableFromSpec(단일 LLM 호출)

변경:
  Stage 3a: OCR 파싱 (논문별) — 유지
  Stage 3b: Per-paper Extraction (논문별 독립 LLM 호출, N회)
  Stage 3c: Merge + Table Assembly (코드 병합, LLM 호출 없음)
```

## 설계 상세

### 1. Per-paper Extraction Agent (Stage 3b)

#### JSON 스키마
```json
{
  "paper_title": "string",
  "data_rows": [{
    "values": { "column_name": "value" | null },
    "confidence": "high|medium|low",
    "source_hint": "Table 3"
  }],
  "notes": "string"
}
```
- `null` = 해당 데이터를 논문에서 찾을 수 없음 (명시적)
- 한 논문에서 여러 실험 조건 → 여러 행 추출

#### 추출 프롬프트 핵심 규칙
1. column_definitions에 맞는 데이터만 추출
2. 이 논문의 데이터만 (다른 논문 추측 금지)
3. 없는 열은 반드시 null
4. 수치와 단위는 원본 그대로
5. OCR 테이블 > 본문 텍스트 우선순위

#### 새 함수: `extractColumnsFromPaper()` (llm-orchestrator.mjs)
- 입력: tableSpec, paperContext (1개 논문), paperTitle
- Ollama `format` 파라미터로 JSON 스키마 강제
- temperature: 0.1 (정확도 우선)
- JSON 파싱 실패 시 1회 재시도

### 2. 논문별 컨텍스트 조립: `assemblePerPaperContext()` (main.mjs)
- 기존 `assembleRagContext()`의 논문별 버전
- Section 1: 파싱된 매트릭스 (TSV)
- Section 2: OCR HTML 테이블
- Section 3: 텍스트 청크
- 논문당 30K chars 예산

### 3. 병합: `mergeExtractionResults()` (main.mjs)
- LLM 호출 없음 — 순수 코드
- 각 논문 extraction.data_rows를 열 정의에 맞게 병합
- null → "N/A" 표시
- 참조번호 자동 부여: "0.45" → "0.45 [1]"
- N/A가 행의 50% 초과 시 행 제거
- `nullSummary` 생성 → Step 4 Agentic 재검색 트리거 (향후)

### 4. Fallback 전략 (3단계)
1. 정상: per-paper 추출 성공 → mergeExtractionResults()
2. 부분 실패: 실패 논문은 빈 결과, 성공 논문만 병합
3. 전체 실패: 기존 generateTableFromSpec() 단일 호출 fallback

### 5. LLM 호출 관리
- **순차 실행**: Ollama 단일 인스턴스, 순차가 최적
- 논문당 최대 60초 타임아웃
- JSON 파싱 실패 시 1회 재시도

#### 성능 예측
| 논문 수 | 현재 | SRAG | 비고 |
|---------|------|------|------|
| 3편 | ~15-30s | ~30-60s | 정확도 대폭 향상 |
| 5편 | ~20-40s | ~50-100s | 진행률 UI로 체감 완화 |
| 10편 | ~30-60s | ~100-200s | 논문당 컨텍스트 축소로 각 호출 빨라짐 |

### 6. Frontend 변경
- `ChatPipelineStage`에 `"extracting"` 추가
- `TABLE_STAGES`에 "논문별 데이터 추출 중..." 스테이지 추가
- 진행률: "논문별 데이터 추출 중... (2/5)" 실시간 표시

### 7. DB 변경
- `chat_generated_tables`에 `metadata` JSONB 컬럼 추가
- nullSummary, 추출 모드, 타이밍 등 저장

## 작업 분해

1. [ ] DB 마이그레이션 — `chat_generated_tables.metadata` JSONB
2. [ ] `llm-orchestrator.mjs` — SRAG 추출 에이전트
   - PAPER_EXTRACTION_SCHEMA
   - EXTRACTION_AGENT_SYSTEM_PROMPT
   - extractColumnsFromPaper()
3. [ ] `main.mjs` — assemblePerPaperContext(), groupBy()
4. [ ] `main.mjs` — Stage 3b/3c 파이프라인 교체 + mergeExtractionResults() + fallback
5. [ ] `main.mjs` — import 업데이트
6. [ ] Frontend — ChatPipelineStage + TABLE_STAGES 수정
7. [ ] 통합 테스트

## 영향 범위
| 파일 | 변경 |
|------|------|
| `llm-orchestrator.mjs` | 신규 스키마 + 프롬프트 + 함수 (~80줄) |
| `main.mjs` | Stage 3 교체 + 신규 함수 3개 (~150줄) |
| `frontend/src/types/desktop.ts` | ChatPipelineStage에 1개 추가 |
| `frontend/src/features/chat/ChatPipelineStatus.tsx` | TABLE_STAGES에 1개 추가 |
| `supabase/migrations/` | 마이그레이션 1개 |
| CURRENT_EXTRACTION_VERSION 범프 | **불필요** |

## 리스크 & 대안
- LLM이 JSON 스키마 미준수 → Ollama format 파라미터 + 1회 재시도
- 10편+ 시 시간 과다 → 진행률 UI + 향후 병렬화
- column_definitions와 values 키 불일치 → 프롬프트 명시 + fuzzy matching
- data_rows 과다 (100+) → 논문당 50행 제한

## Step 4 연결점
`nullSummary.details` 배열이 Agentic 재검색의 직접적 입력:
```
[{ paperId, paperTitle, column: "T (K)", rowIndex: 2 }, ...]
```
SRAG 파이프라인 수정 없이 후속 단계만 추가하면 됨.
