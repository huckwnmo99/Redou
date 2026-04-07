# Roadmap

> 전체 작업 현황을 추적하는 마스터 인덱스.
> 최종 갱신: 2026-04-06
> 정렬 기준: 난이도 낮은 것부터 (쉬운 것 → 어려운 것)

## 상태 범례

| 상태 | 의미 |
|------|------|
| 💡 아이디어 | `docs/backlog/`에 등록됨, 토의 필요 |
| 📋 계획됨 | `/plan` 완료, `docs/features/`에 계획서 있음 |
| 🔧 진행 중 | `/develop` 또는 `/fix` 진행 중 |
| ✅ 완료 | 구현 + 리뷰 + merge 완료 |

## 넘버링 규칙
- backlog: `{번호}-{이름}.md` (등록 순서)
- features/new: `{번호}-{이름}.md` (계획 순서)
- features/fix: `{번호}-{이름}.md` (계획 순서)
- 다음 번호는 기존 최대 번호 + 1

---

## 진행 중


---

## Step 1 — 모델 전환 + 서비스 분리 (난이도: 낮음)

> 기존 코드 설정값 변경 + 리팩토링. 새 인프라 불필요.

- [ ] 📋 LLM 모델 선택 기능 → [계획서](features/new/02-llm-model-selector.md) | [backlog/04](backlog/04-gemma4-migration.md)
  - Settings UI에서 Ollama 모델 목록 조회 + 선택. 9개 파일 수정, IPC 3개 추가
- [ ] 📋 테이블 생성 / 논문 Q&A 서비스 분리 → [계획서](features/new/01-table-qa-separation.md) | [backlog/12](backlog/12-table-llm-separation.md)
  - 같은 모델, 프롬프트+검증 분리. 신규 모듈 llm-qa.mjs + DB conversation_type 추가

## Step 2 — 검색 기반 강화 (난이도: 중간)

> 기존 PostgreSQL + Electron 인프라 위에서 확장.

- [ ] 💡 Hybrid Search (BM25 + Vector) → [backlog/01](backlog/01-hybrid-search.md)
  - PostgreSQL tsvector 활용, 별도 서비스 불필요
- [ ] 💡 Reranker 추가 → [backlog/03](backlog/03-reranker.md)
  - @xenova/transformers로 로컬 실행 가능
- [ ] 💡 임베딩 모델 전환 (bge-m3) → [backlog/02](backlog/02-embedding-upgrade.md)
  - 모델 교체 + 전체 재임베딩 필요

## Step 3 — 검색 파이프라인 고도화 (난이도: 중상)

> 검색 흐름에 새 단계 추가. Step 2 위에서 동작.

- [ ] 💡 HyDE (가상 문서 임베딩) → [backlog/05](backlog/05-hyde.md)
  - LLM 호출 1회 추가, 캐싱 필요
- [ ] 💡 Sentence Window Retrieval → [backlog/06](backlog/06-sentence-window-retrieval.md)
  - 청킹 방식 변경 + DB 변경 + 재처리
- [ ] 💡 CRAG 자가 검증 루프 → [backlog/07](backlog/07-crag-verification.md)
  - 검색 결과 평가 → 재검색 루프

## Step 4 — 관계 추론 (난이도: 높음)

> 새 서비스(Neo4j) 도입 또는 대규모 파이프라인 변경.

- [ ] 💡 인용 네트워크 연쇄 검색 → [backlog/08](backlog/08-citation-network-rag.md)
  - 기존 paper_references 데이터 활용 가능
- [ ] 💡 지식 그래프 (GraphRAG) → [backlog/09](backlog/09-graphrag.md)
  - Neo4j 도입, 엔티티/관계 추출 파이프라인
- [ ] 💡 쿼리 분해 + 멀티홉 추론 → [backlog/10](backlog/10-multihop-reasoning.md)
  - 오케스트레이터 대폭 확장

## Step 5 — 통합 에이전트 (난이도: 최상)

> Step 1~4 전부 갖춰진 후 통합.

- [ ] 💡 Agentic RAG 동적 검색 에이전트 → [backlog/11](backlog/11-agentic-rag.md)
  - 전체 기능을 도구로 감싸는 에이전트 아키텍처

---

## 참고 문서
- [RAG 설계 제안서](01-Idea/Rag_design_report.md)

---

## 완료

(아직 없음)
