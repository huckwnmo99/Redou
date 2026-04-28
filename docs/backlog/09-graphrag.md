# 지식 그래프 (GraphRAG)

> 상태: 💡 아이디어 | 등록일: 2026-04-06 | 출처: [RAG 설계 제안서](../01-Idea/Rag_design_report.md#idea3)

## 배경
PSA 논문에는 공정 변수 간 인과관계(압력→순도→회수율)가 있지만, 벡터 검색으로는 관계 추론이 어려움.

## 핵심 아이디어
- 논문에서 엔티티 + 관계 추출 → 지식 그래프 구축
- 벡터 검색 + 그래프 탐색 결과를 Fusion
- 관계 추론 질문에 강력한 성능

## 예상 영향
- 새 서비스: Neo4j Community (Docker)
- Electron: 그래프 구축 모듈, 그래프 탐색 모듈
- DB: 엔티티/관계 저장 (Neo4j 또는 PostgreSQL)
- Frontend: 그래프 시각화 컴포넌트 (선택)

## 주의사항
- 그래프 구축 비용이 일반 RAG 대비 3-5배 (Microsoft GraphRAG 기준)
- Phase 3 이후 진행 권장
