# Sentence Window Retrieval

> 상태: 💡 아이디어 | 등록일: 2026-04-06 | 출처: [RAG 설계 제안서](../01-Idea/Rag_design_report.md#idea1)

## 배경
현재 청크 단위로 검색하지만, 문장 단위로 검색 후 주변 윈도우를 함께 반환하면 정밀도와 맥락 모두 확보 가능.

## 핵심 아이디어
- 문장 단위로 임베딩 + 검색 (정밀 매칭)
- 매칭된 문장의 앞뒤 N문장을 윈도우로 함께 반환 (맥락 보존)
- ARAGOG (2024): Sentence Window Retrieval이 모든 Classic VDB 방식을 압도

## 예상 영향
- DB: 문장 단위 테이블 또는 기존 chunks 세분화
- `pdf-heuristics.mjs`: 문장 분리 로직 추가
- 임베딩: 문장 수 증가 → 임베딩 시간/저장 공간 증가
- CURRENT_EXTRACTION_VERSION 범프

## 주의사항
- 임베딩 개수가 크게 증가하므로 성능 영향 평가 필요
- 임베딩 모델 전환과 동시에 진행하면 재처리 1회로 해결
