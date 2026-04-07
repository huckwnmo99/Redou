# HyDE (Hypothetical Document Embedding)

> 상태: 💡 아이디어 | 등록일: 2026-04-06 | 출처: [RAG 설계 제안서](../01-Idea/Rag_design_report.md#idea6)

## 배경
짧고 기술적인 쿼리("PSA H₂ purity")는 임베딩 공간에서 관련 청크와 거리가 멀 수 있음.

## 핵심 아이디어
- 쿼리 → LLM이 "가상의 이상적인 답변 문단" 생성 → 그 문단을 임베딩하여 검색
- 쿼리의 의미 공간을 확장하여 recall 향상

## 예상 영향
- Electron: 검색 파이프라인에 HyDE 단계 추가 (LLM 호출 1회 추가)
- 응답 시간: LLM 생성 시간만큼 증가 (캐싱으로 완화 가능)

## 선행 조건
- Hybrid Search 구축 후 적용이 효과적
- LLM 모델 전환 (Gemma 4) 후 진행 권장

## 참고
- ARAGOG (2024): HyDE + LLM Reranking이 검색 정밀도 1위
