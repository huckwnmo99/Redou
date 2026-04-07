# CRAG 자가 검증 루프

> 상태: 💡 아이디어 | 등록일: 2026-04-06 | 출처: [RAG 설계 제안서](../01-Idea/Rag_design_report.md#idea7)

## 배경
현재 `granite-guardian`으로 groundedness 체크는 하지만, 검색 결과가 부족하면 재검색하는 루프가 없음.

## 핵심 아이디어
- 검색 결과를 LLM이 평가 → CORRECT / AMBIGUOUS / INCORRECT 분류
- CORRECT → 바로 생성
- AMBIGUOUS → 쿼리 분해 후 재검색
- INCORRECT → 다른 전략으로 재검색

## Redou 기존 자산
- `llm-chat.mjs`의 `checkGroundedness()` 확장 가능
- `llm-orchestrator.mjs`가 이미 의도 분석 → 검색 → 생성 파이프라인 보유

## 예상 영향
- Electron: `llm-chat.mjs` 또는 새 모듈에 CRAG 루프 추가
- 응답 시간: 재검색 시 증가 (하지만 품질 보장)

## 참고
- Yan et al. (2024): CRAG가 QA 벤치마크에서 일관된 성능 향상
