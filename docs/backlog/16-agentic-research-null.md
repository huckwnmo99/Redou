# Agentic 재검색 루프 (NULL 셀 기반)

> 상태: 💡 아이디어 | 등록일: 2026-04-07 | 출처: [Table RAG 개선 제안서](../01-Idea/Table_RAG_improvement_report.md#6-agentic-재검색-루프-null-셀-기반)

## 배경
현재 검색 1회 후 결과가 부족해도 그대로 테이블 생성. SRAG 추출 후 NULL 셀을 감지하면 해당 셀만 타겟하여 재검색 가능.

## 핵심 아이디어
- SRAG Step 1의 구조화 JSON에서 NULL 필드 감지
- NULL이 있는 셀만 타겟하여 재검색 (논문+컬럼 조합)
- 재검색 전략: 동의어/다른 키워드로 BM25, 다른 섹션(Methods, Supplementary) 탐색, 해당 논문 테이블 직접 탐색
- 그래도 못 찾으면 "N/A" 또는 "데이터 없음" 최종 표기
- **최대 1회 재검색** (호출 폭발 방지)

## backlog/11과의 차이
- **backlog/11 (Agentic RAG)**: 전체 파이프라인을 에이전트가 동적 제어 (Step 5 수준)
- **이 항목**: SRAG NULL 셀에 한정된 경량 재검색 루프 (Step 3 수준)

## 예상 영향
- Electron: 오케스트레이터에 NULL 감지 + 셀 단위 재검색 로직
- LLM 호출: NULL 셀 수만큼 추가 (최대 1회)

## 선행 조건
- SRAG가 선행되어야 함 (NULL 감지 기반)

## 주의사항
- 빈 셀 최소화가 목적 — 못 찾은 데이터는 명시적으로 "N/A" 표기
