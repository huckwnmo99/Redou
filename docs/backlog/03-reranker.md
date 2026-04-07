# Reranker 추가 (bge-reranker-v2-m3)

> 상태: 💡 아이디어 | 등록일: 2026-04-06 | 출처: [RAG 설계 제안서](../01-Idea/Rag_design_report.md#idea6)

## 배경
벡터 검색은 의미적 유사도만 측정. Cross-encoder reranker로 검색 결과를 재정렬하면 정밀도가 크게 향상됨.

## 핵심 아이디어
- 초기 검색 k=10~20 → Reranker로 top 3~5 선별
- `BAAI/bge-reranker-v2-m3`: 경량 + 고성능
- 대안: `cross-encoder/ms-marco-MiniLM-L-6-v2` (더 빠름)

## Redou 기존 자산
- Electron에서 `@xenova/transformers` 이미 사용 중 → 같은 방식으로 reranker 로드 가능

## 예상 영향
- Electron: 새 모듈 (`reranker-worker.mjs`) 또는 `embedding-worker.mjs` 확장
- 검색 파이프라인: 기존 검색 결과를 reranker 통과 후 반환
- Frontend: 변경 최소 (검색 결과 품질만 향상)

## 참고
- Wang et al. (2024): monoT5 reranker가 성능-효율 최적 균형점
- Hybrid Search와 조합 시 효과 극대화
