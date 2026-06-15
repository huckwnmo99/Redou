# 테이블 생성 RAG 개선 제안서

> 작성일: 2026-04-07 | 최종 갱신: 2026-04-07
> 목적: LLM 테이블 생성 품질 향상을 위한 RAG 파이프라인 개선
> 핵심 목표: **사용자가 원하는 데이터 테이블을 정확하게 구성**

## 현재 파이프라인

```
사용자 요청 → 오케스트레이터(의도 분석) → 벡터 검색(1회) → 청크 전달 → LLM 테이블 생성 → Guardian 검증
```

### 이미 잘 되어 있는 것
- OCR 추출된 테이블을 `parseAllHtmlTables` + `extractMatrixFromHtml`로 파싱
- `assembleRagContext()`에서 파싱된 테이블 데이터를 최우선 배치
- 텍스트 청크를 보충 데이터로 활용

### 문제점

| 문제 | 원인 | 증상 |
|------|------|------|
| 데이터 누락 | 벡터 검색만으로는 구체적 수치/키워드를 놓침 | 테이블 빈 셀, 일부 논문 누락 |
| 부정확한 수치 | 관련 없는 청크가 노이즈로 섞임 | 다른 논문/섹션의 수치가 혼입 |
| 논문 누락 | 전체 청크에서 한 번에 검색하여 일부 논문이 묻힘 | 라이브러리에 있는 논문인데 결과에 없음 |
| 단일 시도 | 검색 1회 후 검증 없이 테이블 생성 | 부족한 데이터로 그냥 생성 |

---

## 설계 원칙: Table RAG와 Q&A RAG 분리

테이블 생성과 Q&A는 검색 요구사항이 완전히 다르다. 저장 데이터(청크, 임베딩)는 공유하되, **검색 전략만 분리**한다.

| 관점 | Table RAG | Q&A RAG |
|------|-----------|---------|
| 핵심 목표 | 정확한 수치 추출 | 맥락 이해 + 자연어 답변 |
| BM25 비중 | 높게 (수치, 키워드) | 낮게 |
| Vector 비중 | 보통 | 높게 (의미 유사도) |
| 검색 단위 | 논문 단위 추출 (SRAG) | 질문 단위 |
| 우선 소스 | 논문 원본 테이블 | 본문 텍스트 |
| 검증 | 셀별 원문 대조 | 출처 귀속 |
| 문맥 필요성 | 낮음 (정확한 값) | 높음 (앞뒤 맥락) |

```
PDF 임포트 → 청크 + 임베딩 (1벌, 공유)
  ├── Table RAG: BM25↑ + 테이블 우선 + SRAG 논문별 추출 + NULL 재검색
  └── Q&A RAG:   Vector↑ + Sentence Window + Contextual Chunking + 2단계 검색
```

---

## Table RAG 개선 아이디어

### 1. Hybrid Search (BM25 + Vector)

**현재**: 벡터 유사도 검색만 사용
**개선**: BM25 키워드 매칭 + 벡터 의미 검색을 결합

```
사용자 쿼리
  ├── BM25 검색 → 키워드 정확 매칭 (수치, 고유명사, 약어)
  └── Vector 검색 → 의미적 유사도 매칭
  → RRF(Reciprocal Rank Fusion)로 결과 통합
```

**기대 효과**: "PSA density 3.5 g/cm³" 같은 구체적 수치를 놓치지 않음
**구현 난이도**: 중 — PostgreSQL tsvector 활용, 별도 서비스 불필요
**Table RAG에서의 역할**: BM25 비중을 높여서 수치/키워드 정확 매칭 강화
**의존성**: 없음 (독립 구현 가능)

---

### 2. Reranker

**현재**: 검색 결과를 유사도 점수 순서 그대로 사용
**개선**: Cross-encoder 모델로 쿼리-문서 쌍의 관련성을 재평가

```
검색 결과 (Top-50) → Reranker (Cross-encoder) → 재정렬된 결과 (Top-10)
```

**기대 효과**: 노이즈 제거, LLM에 전달되는 컨텍스트 품질 향상
**구현 난이도**: 중 — @xenova/transformers로 로컬 실행 가능
**의존성**: Hybrid Search 후 적용하면 시너지 극대화

---

### 3. Contextual Chunking (Anthropic 기법)

> 출처: Anthropic "Contextual Retrieval" (2024). Kapa.ai 벤치마크에서 검색 정확도 ~18% 향상.

**현재**: 각 청크가 독립적으로 임베딩되어 문맥 손실 발생
**개선**: 각 청크 앞에 문서/섹션 맥락을 접두어로 추가한 후 임베딩

```
현재 청크:
  "The adsorption capacity was 4.2 mmol/g at 298K and 1 bar."

Contextual 청크:
  "[Paper: Adsorption kinetics of CO2 on zeolite 13X | Section: Results] 
   The adsorption capacity was 4.2 mmol/g at 298K and 1 bar."
```

**기대 효과**: 
- "어떤 논문의 어떤 섹션인지"가 임베딩에 반영됨
- 같은 수치라도 논문/조건별로 구분 가능
- 구현 비용 매우 낮음 (임베딩 시 접두어만 추가)
**구현 난이도**: 낮음 — `embedding-worker.mjs`에서 청크 텍스트에 접두어 추가
**주의**: 기존 논문 전체 재임베딩 필요 (CURRENT_EXTRACTION_VERSION 범프)
**의존성**: 없음

---

### 4. 테이블 우선 검색 (Table-first Retrieval)

**현재**: 논문 본문 텍스트 청크와 테이블/figure를 동등하게 검색
**개선**: 검색 시 논문 원본 테이블을 우선순위로 올림

```
검색 순서:
  1차: 논문 내 테이블 (figures 테이블, item_type='table') → 정확한 수치
  2차: 본문 텍스트 청크 → 테이블에 없는 보충 데이터

결과 조합: 테이블 출처 데이터에 가산점 부여
```

**기대 효과**: 논문에 이미 정리된 테이블 데이터를 직접 활용하여 정확도 향상
**구현 난이도**: 중 — 기존 figures 테이블 활용, 검색 로직 수정
**의존성**: 없음 (독립 구현 가능)

---

### 5. SRAG 스타일 2단계 추출 (추출 → 조립 분리)

> 출처: SRAG (2025, arXiv:2503.01346). 비정형 텍스트를 관계형 테이블로 변환 후 SQL 추론. 다중 엔티티 QA에서 기존 RAG 압도.

**현재**: RAG 결과 → LLM이 한 번에 테이블 생성 (단일 호출)
**개선**: 2단계로 분리 — (1) 논문별 구조화 데이터 추출 → (2) 병합하여 테이블 조립

```
현재:
  RAG 컨텍스트 (전체) → LLM "이 데이터로 비교 테이블 만들어" → 테이블

개선:
  Step 1 — 논문별 추출 (각각 독립 LLM 호출):
    논문A 청크 → LLM "이 논문에서 {온도, 압력, 순도} 추출해" → {온도: 300K, 압력: 1atm, 순도: 99.5%}
    논문B 청크 → LLM "이 논문에서 {온도, 압력, 순도} 추출해" → {온도: 350K, 압력: 2atm, 순도: 98.1%}
    논문C 청크 → LLM "이 논문에서 {온도, 압력, 순도} 추출해" → {온도: NULL, 압력: 1.5atm, 순도: 97.3%}

  Step 2 — 병합 + 누락 감지:
    논문C의 온도가 NULL → 재검색 트리거 가능
    전체 JSON 병합 → 비교 테이블 생성
```

**기대 효과**: 
- 각 논문에 집중하여 데이터를 추출하므로 정확도 대폭 향상
- NULL 필드를 감지하여 누락 데이터를 명시적으로 파악
- 재검색 또는 사용자에게 "이 데이터를 찾지 못했습니다" 보고 가능
**구현 난이도**: 중상 — `llm-orchestrator.mjs`의 Table Agent 파이프라인 분할
**의존성**: Hybrid Search + Reranker가 선행되면 각 논문별 추출 정확도 향상

---

### 6. Agentic 재검색 루프 (NULL 셀 기반)

> 출처: Agentic RAG 패턴 (Glean 2026, LlamaIndex). "계획-검색-반성-재검색" 에이전트 루프.

**현재**: 검색 1회 → 결과 부족해도 그대로 테이블 생성
**개선**: SRAG 추출 후 NULL 셀을 감지하고, 해당 셀만 타겟하여 재검색

```
SRAG 추출 결과:
  논문A → {온도: 300K, 압력: 1atm, 순도: 99.5%}  ← 완전
  논문B → {온도: 350K, 압력: NULL, 순도: 98.1%}   ← 압력 누락
  논문C → {온도: NULL, 압력: 1.5atm, 순도: NULL}   ← 2개 누락

→ NULL 셀 감지 → 해당 셀만 타겟 재검색:
  - "논문B pressure/adsorption pressure" 로 재검색
  - "논문C temperature/operating temperature" 로 재검색
  - "논문C purity/product purity" 로 재검색
→ 재검색 전략:
  - 다른 키워드/동의어로 BM25 검색
  - 다른 섹션(Methods, Supplementary, Supporting Info)에서 검색
  - 해당 논문의 테이블 데이터에서 직접 탐색
→ 그래도 못 찾으면: "N/A" 또는 "데이터 없음"으로 최종 표기
→ 최대 1회 재검색 (호출 폭발 방지)
```

**기대 효과**: 
- 빈 셀 최소화 — NULL이 있는 셀만 타겟하므로 효율적
- 못 찾은 데이터를 명시적으로 "N/A" 표기 → 사용자 신뢰도 향상 (빈 셀 vs 데이터 없음 구분)
**구현 난이도**: 중상 — 오케스트레이터에 NULL 감지 + 셀 단위 재검색 로직
**SRAG와의 결합**: SRAG Step 1의 구조화 JSON에서 NULL 필드가 곧 재검색 트리거. 별도 평가 로직 불필요.
**의존성**: SRAG가 선행되어야 함 (NULL 감지 기반이므로)

---

### 7. CRAG 자가 검증 (경량 버전)

**현재**: 테이블 생성 후 Guardian이 한 번 검증
**개선**: 생성된 테이블의 핵심 셀을 원문과 대조

```
테이블 생성 완료
  → 수치 데이터 셀만 선별 (텍스트 셀 제외)
  → 각 셀의 값을 원본 청크에서 확인
  → 불일치 발견 시:
    - 원본 값으로 교정 (명확한 경우)
    - 또는 "미확인" 마킹 (애매한 경우)
  → 최대 1회 검증 (호출 폭발 방지)
```

**기대 효과**: 잘못된 수치가 최종 테이블에 남는 확률 감소
**구현 난이도**: 중 — 기존 Guardian 검증 확장
**주의**: SRAG + CRAG를 동시에 적용하면 LLM 호출 증가. **경량 버전으로 제한**.
**의존성**: 없음 (독립 적용 가능)

---

## Q&A RAG 개선 아이디어

Q&A는 테이블과 다른 전략이 적합하다. Table RAG에서 제외된 아이디어들이 여기서 활용된다.

### Q1. Sentence Window Retrieval

**현재**: 고정 크기 청크 (전후 문맥 없음)
**개선**: 검색은 문장 단위로 하되, 전달 시 주변 ±N개 문장을 포함

```
저장: 문장 단위 임베딩 (세밀한 검색)
검색: 문장 매칭 → 해당 문장 ± 3~5개 문장을 컨텍스트로 전달
```

**기대 효과**: "Table 3 shows..." 같은 참조가 있을 때 앞뒤 문맥이 있어야 정확한 답변 가능
**Q&A에 적합한 이유**: 자연어 답변은 문맥이 풍부할수록 좋음. 테이블은 정확한 값만 필요해서 문맥 덜 중요.

### Q2. 2단계 검색 (Coarse-to-Fine)

**현재**: 전체 청크 풀에서 한 번에 검색
**개선**: 논문 단위 → 청크 단위 2단계 검색

```
1단계: 관련 논문 Top-N 선택 (제목+초록 임베딩)
2단계: 선택된 논문 내부에서 상세 검색
```

**Q&A에 적합한 이유**: "이 주제에 대해 어떤 논문이 있어?" 같은 질문은 논문 수준 검색이 먼저 필요. Table RAG에서는 쿼리 분해가 이 역할을 대체.

### Q3. Contextual Chunking (공유)

Table RAG와 동일하게 적용. Q&A에서도 "어떤 논문의 어떤 섹션인지" 맥락이 중요.

---

## 전부 적용 시 위험 분석

| 조합 | 위험 | 판정 |
|------|------|------|
| Hybrid Search + Reranker | 없음 | **무조건 적용** |
| Contextual Chunking | 재임베딩 필요 외 없음 | **적용** |
| 테이블 우선 검색 | 본문 데이터 놓칠 위험 → 보충 검색으로 해결 | **적용** |
| SRAG + Agentic 재검색 | 자연스러운 결합 (SRAG의 NULL 셀이 곧 재검색 트리거) | **적용** |
| CRAG + SRAG | LLM 호출 증가 (셀수 × 검증) | **CRAG는 경량만** |
| 2단계 검색 (Table) | 1단계에서 논문 놓치면 복구 불가 | **Table에서 제거, Q&A만** |
| Sentence Window (Table) | 테이블 수치에 문맥 불필요 | **Table에서 제거, Q&A만** |
| 구조화 데이터 사전추출 | 현재 쿼리 시점에 이미 동일 작업 수행 중 | **제거 (중복)** |

---

## 추천 구현 순서

### Table RAG 파이프라인

```
Phase 1: 검색 기반 강화 (가장 체감 큼, 독립 구현 가능)
  ① Hybrid Search (BM25 + Vector, Table용 BM25 비중 높게)
  ② Reranker (Cross-encoder)
  ③ Contextual Chunking (청크에 논문/섹션 맥락 추가)

Phase 2: 테이블 특화 (테이블 생성에 직접적 효과)
  ④ 테이블 우선 검색 (figures item_type='table' 우선)
  ⑤ SRAG 2단계 추출 (논문별 구조화 추출 → 병합)

Phase 3: 완성도 강화
  ⑥ Agentic 재검색 (SRAG NULL 셀 기반 → 해당 셀만 타겟 재검색, 최대 1회)
  ⑦ CRAG 경량 검증 (수치 셀만 원문 대조)
```

### Q&A RAG 파이프라인

```
Phase 1: 공유 기반
  ① Hybrid Search (Q&A용 Vector 비중 높게)
  ② Reranker
  ③ Contextual Chunking (공유)

Phase 2: Q&A 특화
  ④ Sentence Window Retrieval (문맥 보강)
  ⑤ 2단계 검색 (논문 수준 → 청크 수준)
```

### 최종 목표 파이프라인

```
[Table 요청]
  사용자 → 오케스트레이터 → Hybrid Search(BM25↑) + 테이블 우선
  → Reranker → 논문별 SRAG 추출 (구조화 JSON)
  → NULL 셀 감지 → 해당 셀만 타겟 재검색 (최대 1회)
  → 병합하여 테이블 생성 → CRAG 경량 검증 → 최종 테이블

[Q&A 요청]
  사용자 → Hybrid Search(Vector↑) + 2단계 검색
  → Reranker → Sentence Window 확장
  → streamChat() 스트리밍 답변 → 출처 귀속
```

---

## 상업용 RAG 트렌드 참고

### 주요 동향 (2025-2026)

| 트렌드 | 핵심 | 적용 가능성 |
|--------|------|------------|
| **SRAG** | 비정형 텍스트 → 관계형 테이블 변환 → SQL 추론 | **높음** — 테이블 생성 핵심 |
| **Contextual Retrieval** (Anthropic) | 청크에 문서 맥락 접두어 추가, 정확도 18% 향상 | **높음** — 즉시 적용 가능 |
| **Agentic RAG** (Glean, LlamaIndex) | 계획-검색-반성-재검색 루프 | **높음** — 재검색 루프 |
| **ColPali/ColQwen** | VLM으로 PDF 이미지 자체를 검색 (OCR 불필요) | 중간 — 이미 OCR 파이프라인 존재 |
| **PageIndex** (VectifyAI) | 벡터 없이 문서 TOC 트리를 LLM이 탐색, FinanceBench 98.7% | 중간 — 논문 섹션 구조와 잘 맞음 |
| **Late Chunking** (Jina) | 전체 문서 임베딩 후 청크별 mean pooling | 중간 — Contextual Chunking과 유사 효과 |
| **CAG** (Cache-Augmented) | 소규모 코퍼스는 전체를 컨텍스트에 넣음 (RAG보다 40배 빠름) | 낮음 — 다수 논문에서는 비실용적 |
| **RAG-Anything** (HKUDS) | 텍스트/이미지/테이블/수식 통합 멀티모달 RAG, MinerU 사용 | 중간 — 참고 아키텍처 |
| **TreeRAG** | 문서를 계층적 트리 요약으로 구축 | 낮음 — 복잡도 대비 효과 불확실 |

### 핵심 인사이트

1. **"추출과 조립을 분리하라"** (SRAG) — 한 번에 테이블을 만들지 말고, 논문별로 먼저 추출한 뒤 조립
2. **"검색에 맥락을 넣어라"** (Contextual Retrieval) — 청크가 어디서 왔는지 임베딩에 반영
3. **"한 번에 포기하지 마라"** (Agentic RAG) — 첫 검색에서 못 찾으면 전략을 바꿔 재시도
4. **"용도별로 최적화하라"** (Table vs Q&A 분리) — 같은 데이터, 다른 검색 전략

---

## 참고 문서 & 출처

### 프로젝트 내부
- 기존 RAG 설계 제안서: [Rag_design_report.md](Rag_design_report.md)
- 현재 검색 구현: `apps/desktop/electron/main.mjs` (`runMultiQueryRag`, `assembleRagContext`)
- 현재 오케스트레이터: `apps/desktop/electron/llm-orchestrator.mjs`
- 현재 임베딩: `apps/desktop/electron/embedding-worker.mjs` (nvidia/llama-nemotron-embed-vl-1b-v2)
- Q&A 모듈: `apps/desktop/electron/llm-qa.mjs`

### 외부 논문 & 자료
- [SRAG: Structured RAG for Multi-Entity QA](https://arxiv.org/abs/2503.01346) (2025)
- [TabRAG: Improving Tabular Document QA](https://arxiv.org/abs/2511.06582) (2025)
- [ColPali: Efficient Document Retrieval with VLMs](https://arxiv.org/html/2407.01449v2) (ICLR 2025)
- [PageIndex: Vectorless Reasoning-based RAG](https://pageindex.ai/blog/pageindex-intro) (2025)
- [Late Chunking in Long-Context Embedding Models](https://jina.ai/news/late-chunking-in-long-context-embedding-models/) (Jina AI, 2025)
- [Anthropic: Contextual Retrieval](https://docs.anthropic.com) (2024-2025)
- [RAG-Anything: All-in-One Multimodal RAG](https://github.com/HKUDS/RAG-Anything) (HKUDS, 2025)
- [Glean: Emerging Agent Architecture 2026](https://www.glean.com/blog/emerging-agent-stack-2026)
- [RAGFlow: From RAG to Context Engineering](https://ragflow.io/blog/rag-review-2025-from-rag-to-context) (2025)
