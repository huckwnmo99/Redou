# 학술 논문 RAG 시스템 설계 제안서 v2
### (최신 연구 문헌 기반 업데이트)

> 작성 목적: PSA 수소 정제 등 화학공학 분야 논문을 대상으로 한 고성능 RAG 파이프라인 설계 아이디어 제시  
> 업데이트: 2026-04-06 | 참고 연구: arXiv 2501.07391, arXiv 2407.01219, ARAGOG (2024), TREC RAG Track (2025), RAGFlow 2024 Review 등

---

## 목차

1. [연구 문헌 기반 핵심 발견 요약](#findings)
2. [아이디어 1 — 계층적 멀티레벨 청킹 + 섹션 인식 파이프라인](#idea1)
3. [아이디어 2 — 메타데이터 중심 검색 강화 전략](#idea2)
4. [아이디어 3 — 지식 그래프 하이브리드 RAG (GraphRAG Fusion)](#idea3)
5. [아이디어 4 — 인용 네트워크 기반 연쇄 검색 (Citation-aware RAG)](#idea4)
6. [아이디어 5 — 쿼리 분해 + 멀티홉 추론 RAG](#idea5)
7. [아이디어 6 — HyDE + Hybrid Search + Reranking 파이프라인 ★NEW](#idea6)
8. [아이디어 7 — CRAG (Corrective RAG): 검색 품질 자가 검증 ★NEW](#idea7)
9. [아이디어 8 — Agentic RAG: 동적 다단계 검색 에이전트 ★NEW](#idea8)
10. [최신 연구 기반 파라미터 최적화 가이드 ★NEW](#params)
11. [통합 아키텍처 제안](#integration)
12. [현실적인 구현 로드맵](#roadmap)

---

<a name="findings"></a>
## 연구 문헌 기반 핵심 발견 요약

아래 내용은 2024–2025년 주요 RAG 연구에서 실험적으로 검증된 결과들이다.

| 연구 | 핵심 발견 |
|------|----------|
| Li et al., COLING 2025 | Focus Mode(문장 수준 검색)와 쿼리 확장이 응답 품질을 유의미하게 향상 |
| Wang et al., arXiv 2407.01219 | 쿼리 분류 → 리랭킹(monoT5) → Reverse Repacking 조합이 성능-효율 최고 |
| ARAGOG (2024) | HyDE + LLM Reranking이 Naive RAG 대비 검색 정밀도 최고 수준; Sentence Window Retrieval이 Classic VDB 전부를 능가 |
| NStarX (2025) | Hybrid Search + Reranking으로 검색 정밀도 15–30% 향상 확인 |
| RAGFlow 2024 Review | GraphRAG, RAPTOR, Contextual Retrieval이 복잡 쿼리 처리에서 두각 |
| TREC RAG Track 2025 | 멀티홉 추론과 attribution(출처 귀속) 검증이 2025년 핵심 평가 기준으로 부상 |

> **결론**: 단일 기법보다 **Hybrid Search + Reranking + 계층적 청킹**의 조합이 가장 일관된 성능을 보인다.

---

<a name="idea1"></a>
## 아이디어 1 — 계층적 멀티레벨 청킹 + 섹션 인식 파이프라인

### 핵심 개념

논문은 **계층적 구조**를 가진다. 이 구조를 그대로 청킹 설계에 반영하면 검색 품질이 크게 향상된다.

```
논문 (Document)
  └─ 섹션 (Section): Abstract / Introduction / Methods / Results / Discussion / Conclusion
       └─ 문단 (Paragraph)
            └─ 시맨틱 서브청크 (Semantic Sub-chunk)
                 └─ 문장 (Sentence) — 검색 최소 단위
```

### 동작 방식

| 레벨 | 역할 | 저장 방식 |
|------|------|----------|
| 섹션 (Parent) | LLM에 전달할 맥락 | 벡터 + 전체 텍스트 저장 |
| 시맨틱 서브청크 (Child) | 검색 단위 | 벡터 임베딩 저장 |
| 문장 | 정밀 하이라이트 | 선택적 저장 |

### 연구 근거

ARAGOG (2024) 실험에서 **Sentence Window Retrieval**이 모든 Classic VDB 방식을 정밀도에서 압도했다. 문장 단위로 검색 후 주변 윈도우를 함께 반환하는 방식이 핵심이다.

```python
# Sentence Window Retrieval 핵심 설정
from llama_index.node_parser import SentenceWindowNodeParser

parser = SentenceWindowNodeParser.from_defaults(
    window_size=3,           # 앞뒤 3문장을 함께 반환
    window_metadata_key="window",
    original_text_metadata_key="original_text"
)
```

### PSA 논문 적용 효과

- `Results` 섹션에서만 H₂ purity 수치 검색 가능
- 문장 단위로 정확한 위치 찾기 → 섹션 전체를 LLM에 전달
- 섹션 필터링으로 노이즈 청크 제거, 정밀도 향상

---

<a name="idea2"></a>
## 아이디어 2 — 메타데이터 중심 검색 강화 전략

### 핵심 개념

논문에는 **구조적 메타데이터**가 풍부하게 존재한다. Wang et al. (2024)은 메타데이터 필터링이 검색 관련성을 크게 높인다는 것을 실험적으로 검증했다.

### 제안하는 메타데이터 구조

```python
metadata = {
    # 문서 수준
    "paper_id":        "DOI or filename",
    "title":           "논문 제목",
    "year":            2023,
    "journal":         "International Journal of Hydrogen Energy",
    "keywords":        ["PSA", "hydrogen purification", "zeolite 5A"],

    # 청크 수준
    "section":         "results",
    "has_equation":    True,
    "has_table":       False,
    "claim_type":      "quantitative",   # qualitative / quantitative / procedural
    "confidence":      "high",

    # 수치 데이터
    "mentions_h2_purity":   True,
    "numerical_values":     [99.99, 85.3],
}
```

### 검색 전략: Hybrid Filtering

```python
results = vectorstore.similarity_search(
    query="H2 purity 99.99% adsorption conditions",
    filter={
        "section": {"$in": ["results", "discussion"]},
        "has_table": True,
        "mentions_h2_purity": True,
        "year": {"$gte": 2018}
    },
    k=5
)
```

---

<a name="idea3"></a>
## 아이디어 3 — 지식 그래프 하이브리드 RAG (GraphRAG Fusion)

### 핵심 개념

PSA 논문에는 공정 변수들 사이의 **인과관계**가 명확히 존재한다.

```
흡착 압력 ──[상승]──→ H₂ 순도 ──[반비례]──→ H₂ 회수율
흡착제 (Zeolite 5A) ──[선택성]──→ CO 제거율
```

### 연구 근거

Microsoft가 2024년 GraphRAG를 오픈소스화한 후 GitHub 별 1만 개를 넘으며 급속 확산되었다. RAGFlow 리뷰(2024)는 GraphRAG가 **semantic gap** 해소에 가장 효과적인 방법임을 확인했다. 단, 그래프 구축 비용이 일반 RAG 대비 **3–5배** 높다는 점을 감안해야 한다.

### 검색 흐름

```
질문
 ├─ 벡터 검색 → 관련 청크 (k=5)
 └─ 그래프 탐색 → 연관 엔티티/관계 경로
         ↓
   두 결과 병합 (Fusion)
         ↓
   LLM 최종 답변 생성
```

| 질문 유형 | 일반 RAG | GraphRAG |
|----------|----------|----------|
| "H₂ 순도 99.99% 달성 조건?" | ✅ | ✅ |
| "흡착 압력과 회수율의 관계?" | ❌ 단편적 | ✅ 관계 추론 |
| "Zeolite 5A 전체 공정 영향?" | ❌ | ✅ 경로 탐색 |

---

<a name="idea4"></a>
## 아이디어 4 — 인용 네트워크 기반 연쇄 검색 (Citation-aware RAG)

### 핵심 개념

**"A [23]에 따르면"** 형태의 인용을 추적하면 검색 결과의 신뢰도와 깊이가 높아진다.

```
현재 논문 청크 → 인용 [23] 감지 → 인용 논문 자동 수집
                                  → 해당 논문 관련 청크 연쇄 검색
```

### 인용 추적 파이프라인

```python
def citation_expanded_search(query, vectorstore, depth=1):
    primary_results = vectorstore.similarity_search(query, k=3)
    expanded_results = []
    for chunk in primary_results:
        for citation in chunk.metadata.get("citations", []):
            if citation["relevance"] == "high":
                sub_results = vectorstore.similarity_search(
                    query,
                    filter={"paper_doi": citation["doi"]},
                    k=2
                )
                expanded_results.extend(sub_results)
    return primary_results + expanded_results
```

### 기대 효과

- 주장의 **근거 논문**까지 자동 추적
- 리뷰 논문 작성 시 자동 근거 체인 구성
- TREC RAG 2025에서 강조한 **attribution(출처 귀속) 검증** 자동화

---

<a name="idea5"></a>
## 아이디어 5 — 쿼리 분해 + 멀티홉 추론 RAG

### 핵심 개념

복잡한 질문을 서브 질문으로 분해하고 각각 검색한 뒤 통합한다.

**예시 질문:**
> "Zeolite 5A를 사용한 PSA 7단계 사이클이 5단계보다 에너지 효율이 좋은 이유는?"

**분해:**
```
Q1: Zeolite 5A의 흡착 특성?
Q2: PSA 5단계 사이클 에너지 소비?
Q3: PSA 7단계 사이클 구성?
Q4: 사이클 단계 수와 에너지 효율 관계?
Q5: 두 사이클 H₂ 회수율 비교?
```

### 연구 근거

KRAGEN (Matsumoto et al., 2024)은 **graph-of-thoughts 프롬프팅**으로 복잡한 쿼리를 서브 문제로 분해하여 멀티홉 추론을 구현했다. LQR(Layered Query Retrieval, Huang et al., 2024)도 멀티홉 질문에서 계층적 플래닝을 통해 유의미한 성능 개선을 확인했다.

| 질문 복잡도 | 전략 |
|------------|------|
| 단순 사실 | 일반 RAG (1회 검색) |
| 비교 | 2회 병렬 검색 |
| 인과 관계 | 쿼리 분해 + 멀티홉 |
| 종합 분석 | 멀티홉 + GraphRAG |

---

<a name="idea6"></a>
## ★ 아이디어 6 — HyDE + Hybrid Search + Reranking 파이프라인 (NEW)

### 핵심 개념

2024–2025년 연구에서 **가장 일관되게 성능 향상이 검증된** 기법 조합이다. 특히 논문처럼 쿼리가 짧고 기술적인 경우 효과가 극대화된다.

### 3단계 파이프라인

```
[1단계] HyDE (Hypothetical Document Embedding)
  질문 → LLM으로 "가상의 이상적인 답변 문단" 생성
       → 그 가상 문단을 임베딩하여 검색
  효과: 짧은 쿼리의 의미 공간 확장, recall 향상

[2단계] Hybrid Search (BM25 + Vector)
  BM25 (키워드 매칭) + Dense Vector (의미 유사도) 병렬 검색
  → Reciprocal Rank Fusion (RRF)으로 결과 통합
  효과: 정확한 용어("Zeolite 5A", "99.99%")와 의미 모두 포착

[3단계] Reranking (Cross-encoder)
  검색된 상위 k개를 Cross-encoder 모델로 재정렬
  효과: 벡터 유사도의 한계 극복, 최종 정밀도 향상
```

### 구현 코드

```python
# Step 1: HyDE
from langchain.chains import HypotheticalDocumentEmbedder

hyde_embeddings = HypotheticalDocumentEmbedder.from_llm(
    llm=llm,
    base_embeddings=base_embeddings,
    custom_prompt="다음 질문에 대한 이상적인 학술 논문 답변 문단을 작성하세요:\n{question}"
)

# Step 2: Hybrid Search (BM25 + Vector)
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

bm25_retriever = BM25Retriever.from_documents(docs, k=10)
vector_retriever = vectorstore.as_retriever(search_kwargs={"k": 10})

ensemble = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.4, 0.6]   # 논문에선 BM25 가중치를 높일수록 정확한 용어 매칭 강화
)

# Step 3: Reranking
from langchain.retrievers import ContextualCompressionRetriever
from langchain_community.cross_encoders import HuggingFaceCrossEncoder
from langchain.retrievers.document_compressors import CrossEncoderReranker

reranker_model = HuggingFaceCrossEncoder(model_name="BAAI/bge-reranker-v2-m3")
compressor = CrossEncoderReranker(model=reranker_model, top_n=5)

final_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=ensemble
)
```

### 연구 근거

- **ARAGOG (2024)**: HyDE + LLM Reranking이 모든 실험 조건 중 검색 정밀도 1위
- **NStarX (2025)**: Hybrid Search + Reranking으로 기업 배포 환경에서 정밀도 **15–30% 향상** 확인
- **Wang et al. (2024)**: monoT5 reranker가 성능-효율 최적 균형점
- **Data Nucleus (2026)**: Hybrid Search + Reranking이 2025년 기준 **de facto 표준**으로 자리잡음

### 추천 모델

| 컴포넌트 | 추천 모델 | 특징 |
|---------|---------|------|
| 임베딩 | `BAAI/bge-m3` | 한영 모두 강함, 로컬 실행 |
| Reranker | `BAAI/bge-reranker-v2-m3` | 경량 + 고성능 |
| 대안 Reranker | `cross-encoder/ms-marco-MiniLM-L-6-v2` | 매우 빠름 |

---

<a name="idea7"></a>
## ★ 아이디어 7 — CRAG (Corrective RAG): 검색 품질 자가 검증 (NEW)

### 핵심 개념

기존 RAG는 검색된 문서가 엉뚱해도 그대로 LLM에 전달한다. **CRAG (Yan et al., 2024)**는 검색 결과를 LLM이 먼저 평가하고, 품질이 낮으면 재검색하거나 외부 웹 검색으로 보완한다.

```
질문
  ↓
검색 (Retrieve)
  ↓
평가 (Evaluate): 관련성 점수 산출
  ├─ [CORRECT] → 바로 생성
  ├─ [AMBIGUOUS] → 분해-재조합 후 생성
  └─ [INCORRECT] → 웹 검색으로 보완 → 생성
```

### 구현 예시 (LangGraph 활용)

```python
from langgraph.graph import StateGraph

def evaluate_retrieval(state):
    docs = state["documents"]
    question = state["question"]

    # LLM이 검색 결과 품질 평가
    eval_prompt = f"""
    질문: {question}
    검색된 문서: {docs[0].page_content[:500]}
    
    이 문서가 질문에 답하기에 충분한가? (yes/no/ambiguous)
    """
    result = llm.invoke(eval_prompt).content.strip().lower()
    return {"retrieval_quality": result}

def conditional_route(state):
    quality = state["retrieval_quality"]
    if quality == "yes":
        return "generate"
    elif quality == "ambiguous":
        return "decompose_and_retrieve"
    else:
        return "web_search"

# 그래프 구성
workflow = StateGraph(GraphState)
workflow.add_node("retrieve", retrieve)
workflow.add_node("evaluate", evaluate_retrieval)
workflow.add_node("generate", generate)
workflow.add_node("web_search", web_search_fallback)
workflow.add_conditional_edges("evaluate", conditional_route)
```

### 논문 RAG에서의 활용

PSA 논문처럼 수치 데이터가 중요한 경우, 검색된 청크가 실제로 관련 수치를 포함하는지 CRAG가 자동 검증한다. **할루시네이션 방지**와 **출처 신뢰도 보장**에 특히 효과적이다.

### 연구 근거

- **Chen et al., arXiv 2401.15884**: CRAG가 여러 QA 벤치마크에서 기존 RAG 대비 일관된 성능 향상
- **NStarX (2025)**: "Self-RAG reduces hallucinations by making retrieval conditional"
- **Neo4j RAG Guide (2025)**: CRAG를 법률/규정준수 등 고위험 도메인의 필수 구성 요소로 권장

---

<a name="idea8"></a>
## ★ 아이디어 8 — Agentic RAG: 동적 다단계 검색 에이전트 (NEW)

### 핵심 개념

2025년 RAG 트렌드의 핵심은 **Agentic RAG**다. 단순히 검색하고 생성하는 것이 아니라, LLM 에이전트가 **스스로 검색 계획을 세우고, 중간 결과를 반성하고, 전략을 수정**한다.

```
질문
  ↓
에이전트 계획 수립 (Plan)
  ↓
Tool 선택 (키워드 검색 / 시맨틱 검색 / 그래프 탐색 / 청크 읽기)
  ↓
중간 결과 반성 (Reflect)
  ↓
충분하면 → 답변 생성
부족하면 → 전략 수정 후 재검색 (Loop)
```

### 구현 (LangGraph 추천)

```python
from langgraph.graph import StateGraph
from langgraph.prebuilt import ToolNode

# 에이전트가 사용할 검색 도구 정의
tools = [
    keyword_search_tool,      # BM25 키워드 검색
    semantic_search_tool,     # 벡터 유사도 검색
    graph_traversal_tool,     # 지식 그래프 탐색
    chunk_reader_tool,        # 특정 청크 전체 읽기
    citation_lookup_tool,     # 인용 논문 조회
]

# LangGraph로 에이전트 루프 구성
workflow = StateGraph(AgentState)
workflow.add_node("agent", call_model)
workflow.add_node("tools", ToolNode(tools))
workflow.add_conditional_edges("agent", should_continue)
```

### 연구 근거

- **aishwaryanr/awesome-generative-ai-guide (2025)**: 계층적 검색 인터페이스를 에이전트에게 노출하는 Agentic RAG가 HotpotQA **94.5%**, 2WikiMultiHop **89.7%** 달성
- **RAGFlow Mid-2025**: 2025년 RAG의 3대 키워드는 **추론(Reasoning), 메모리(Memory), 멀티모달(Multimodal)**이며 에이전트와 결합이 핵심
- **LangGraph**: 2025년 엔터프라이즈 RAG 프레임워크 1위 (CRAG, Adaptive RAG 패턴 내장)

### HGMem (2025 최신): 하이퍼그래프 메모리

RAG의 메모리를 단순 저장소가 아닌 **하이퍼그래프**로 구성하여, 여러 사실이 연결되는 고차원 추론을 가능하게 하는 최신 기법이다.

```
기존: 메모리 = 벡터 저장소 (수동적)
HGMem: 메모리 = 하이퍼그래프 (동적, 사실 간 고차원 연결)
```

---

<a name="params"></a>
## ★ 최신 연구 기반 파라미터 최적화 가이드 (NEW)

Li et al. (COLING 2025)과 Wang et al. (2024) 실험 결과를 기반으로 한 실용적 설정값이다.

### 청크 크기

```
최적 청크 크기: 256–512 토큰 (Li et al., 2025)
  - 너무 작으면 (< 128): 맥락 손실
  - 너무 크면 (> 1024): 노이즈 증가, 검색 정밀도 저하
  - Overlap: 청크 크기의 10–20% 권장 (예: 512 토큰 → 50–100 토큰 overlap)
```

### 검색 개수 (top-k)

```
초기 검색 (before reranking): k = 10–20
최종 LLM 전달 (after reranking): k = 3–5

이유: 많이 검색 후 reranker로 걸러야 recall과 precision 동시 확보 가능
```

### 문서 정렬 (Document Repacking)

```
Wang et al. (2024) 권장: "Reverse" 방식
  → 가장 관련성 낮은 문서를 중간에, 높은 문서를 양쪽 끝에 배치
  → LLM의 "lost in the middle" 현상 방지 (Liu et al., 2024)
```

### 임베딩 모델 선택

| 상황 | 추천 모델 | 이유 |
|------|----------|------|
| 로컬 실행 (한영) | `BAAI/bge-m3` | 다국어 강함, 무료 |
| 고성능 필요 | `text-embedding-3-large` | OpenAI API |
| 빠른 프로토타입 | `text-embedding-3-small` | 저비용 |

### 쿼리 확장

```
Focus Mode (Li et al., 2025): 문장 수준으로 관련 컨텍스트 검색
  → 단순 키워드 쿼리보다 응답 품질 유의미하게 향상

HyDE: 기술적이고 짧은 쿼리에 특히 효과적
  → "PSA H₂ purity" 같은 짧은 쿼리 → 가상 답변 문단 생성 후 검색
```

---

<a name="integration"></a>
## 통합 아키텍처 제안

8가지 아이디어를 통합한 최종 파이프라인:

```
┌──────────────────────────────────────────────────────────────────┐
│                   논문 수집 & 전처리                              │
│  PDF → PyMuPDF → 섹션 파싱 → 메타데이터 추출                    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
   ┌─────────────────┐          ┌──────────────────┐
   │  벡터 DB        │          │  지식 그래프 DB   │
   │  계층적 청킹     │          │  (Neo4j)          │
   │  + 메타데이터   │          │  Entity & Relation│
   └────────┬────────┘          └────────┬──────────┘
            │                            │
            └─────────────┬──────────────┘
                          ▼
            ┌─────────────────────────────┐
            │      쿼리 처리 레이어        │
            │  1. 쿼리 분류               │
            │  2. HyDE (짧은 쿼리)        │
            │  3. 쿼리 분해 (복잡 쿼리)   │
            │  4. Hybrid Search           │
            │  5. Reranking               │
            │  6. CRAG 품질 검증          │
            └─────────────┬───────────────┘
                          ▼
            ┌─────────────────────────────┐
            │   Agentic RAG 루프          │
            │  (필요 시 재검색/재계획)    │
            └─────────────┬───────────────┘
                          ▼
            ┌─────────────────────────────┐
            │   LLM 최종 답변 생성        │
            │   + Attribution 출처 태깅   │
            └─────────────────────────────┘
```

### 기술 스택 (2025 기준 추천)

| 구성 요소 | 추천 도구 | 비고 |
|----------|----------|------|
| PDF 파싱 | PyMuPDF + pdfplumber | - |
| 임베딩 | `BAAI/bge-m3` | 로컬, 한영 |
| 벡터 DB | ChromaDB → Qdrant | 규모 커지면 Qdrant |
| Reranker | `BAAI/bge-reranker-v2-m3` | 로컬 |
| 그래프 DB | Neo4j Community | - |
| 오케스트레이션 | **LangGraph** (2025 엔터프라이즈 1위) | CRAG, Adaptive RAG 내장 |
| LLM | Claude claude-sonnet-4-20250514 | API |
| 평가 | RAGAS | 자동 평가 프레임워크 |

---

<a name="roadmap"></a>
## 현실적인 구현 로드맵

### Phase 1 — 즉시 구현 가능 (1–2일)
> **효과 대비 노력이 가장 좋음**
- Hybrid Search (BM25 + Vector) 구성
- 섹션 기반 청킹 + 메타데이터 태깅
- ChromaDB + `bge-m3` 로컬 임베딩

### Phase 2 — 단기 (1–2주)
> **검색 품질 큰 폭 향상**
- `bge-reranker-v2-m3` Reranker 추가
- HyDE 적용 (짧은 기술 쿼리 대상)
- Sentence Window Retrieval 도입
- RAGAS로 평가 파이프라인 구성

### Phase 3 — 중기 (1–2개월)
> **고급 추론 기능**
- CRAG 자가 검증 루프 구성 (LangGraph)
- 인용 네트워크 구축
- 지식 그래프 구축 (Neo4j)

### Phase 4 — 장기 (논문 제출 후)
> **연구실 공용 시스템**
- Agentic RAG 에이전트 구성
- 쿼리 분해 + 멀티홉 추론
- 전체 파이프라인 통합

---

> **현실적 조언**: 논문 완성이 최우선이다. **Phase 1만으로도** 참고문헌 관리와 리뷰 작업에서 체감 효과가 크다. Phase 2(Reranking 추가)까지 하면 검색 품질이 크게 도약한다. 논문 제출 후 Phase 3, 4를 진행하는 것을 권장한다.

---

### 참고 문헌

- Li et al. (2025). *Enhancing RAG: A Study of Best Practices*. COLING 2025. [arXiv:2501.07391]
- Wang et al. (2024). *Searching for Best Practices in RAG*. [arXiv:2407.01219]
- Eibich et al. (2024). *ARAGOG: Advanced RAG Output Grading*. [arXiv:2404.01037]
- Yan et al. (2024). *Corrective RAG (CRAG)*. [arXiv:2401.15884]
- Jeong et al. (2024). *Adaptive-RAG*. KAIST. [arXiv:2403.14403]
- RAGFlow. (2024). *The Rise and Evolution of RAG in 2024*. ragflow.io
- NStarX. (2025). *The Next Frontier of RAG: 2026–2030*. nstarxinc.com
- TREC RAG Track. (2025). Overview. [arXiv:2603.09891]
