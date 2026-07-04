# 멀티턴 대화 시나리오 테스트 (clarify · modify_table)

> 상태: 💡 아이디어 | 등록일: 2026-07-04 | 출처: 사용자 관찰 — "테이블 요청은 보통 대화 몇 번으로 방향을 잡고 진행하는데, E2E 결과는 전부 단발로 보인다"

## 문제

현재 자동 검증은 전부 **1턴 고정**이다:
- fidelity eval(`e2e-table-fidelity.mjs`)은 측정 공정성을 위해 의도적으로 단발 쿼리(구체적 질문 → orchestrator가 clarify 없이 generate_table 직행).
- 단위 테스트는 파이프라인 내부만 커버.

그 결과 **대화 흐름 축이 무검증**: ①`clarify`(모호 질문 → 되물음 → 답변 → 생성) ②`modify_table`(생성 → "열 추가/논문 제외" 수정 지시 → 재생성) ③phase 전이(`follow_up`).

## 제안

스크립트화된 멀티턴 시나리오 테스트를 eval 하네스에 추가:
1. **clarify 시나리오**: 모호 쿼리("표 만들어줘") → clarify 발동 assert → 고정 답변 주입 → 표 생성 완주 assert.
2. **modify 시나리오**: 구체 쿼리로 표 생성 → 수정 지시 1회("X 열 추가") → modify_table 의도 + 표 변경 assert.
- 각 턴의 LLM 변동을 감안해 판정은 구조적 신호(의도 분기·메시지 타입·phase)로만, 내용 정합은 기존 fidelity 축 재사용.

## 관련

- 실사용 근거: orchestrator 3-분기(clarify/generate_table/modify_table)는 구현돼 있고, 과거 "clarify 과다" 수정 이력 존재(archive fix 06).
- 선행/독립: tool-ab-adoption A/B와 독립. table-semantics-hardening의 eval 인프라(ADR 0007) 확장으로 얹기 자연스러움.
