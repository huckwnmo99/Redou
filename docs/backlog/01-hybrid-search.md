# Hybrid Search (BM25 + Vector)

> 상태: 💡 아이디어 | 등록일: 2026-04-06 | 출처: [RAG 설계 제안서](../01-Idea/Rag_design_report.md#idea6)

## 배경
현재 Redou는 pgvector 순수 벡터 검색만 사용. 키워드 매칭("Zeolite 5A", "99.99%")이 누락되는 경우 발생.

## 핵심 아이디어
- BM25 (키워드) + Dense Vector (의미) 병렬 검색
- Reciprocal Rank Fusion (RRF)으로 결과 통합
- NStarX (2025): 정밀도 15-30% 향상 확인

## Redou 기존 자산
- pgvector + `match_chunks` RPC 이미 존재
- PostgreSQL `tsvector`로 BM25 구현 가능 (별도 서비스 불필요)

## 예상 영향
- DB: `paper_chunks`에 `tsvector` 컬럼 추가, 새 RPC 함수
- Electron: `embedding-worker.mjs` 또는 새 검색 모듈
- Frontend: `searchModel.ts` 검색 로직 변경

## 참고
- ARAGOG (2024): HyDE + LLM Reranking 조합이 검색 정밀도 1위
- Data Nucleus (2026): Hybrid Search + Reranking이 de facto 표준
