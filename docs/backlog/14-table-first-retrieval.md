# 테이블 우선 검색 (Table-first Retrieval)

> 상태: 💡 아이디어 | 등록일: 2026-04-07 | 출처: [Table RAG 개선 제안서](../01-Idea/Table_RAG_improvement_report.md#4-테이블-우선-검색-table-first-retrieval)

## 배경
현재 논문 본문 텍스트 청크와 테이블/figure를 동등하게 검색. 테이블 생성 시 논문에 이미 정리된 테이블 데이터를 우선 활용하면 정확도가 향상됨.

## 핵심 아이디어
- 1차: 논문 내 테이블 (figures 테이블, item_type='table') 우선 검색
- 2차: 본문 텍스트 청크로 보충
- 테이블 출처 데이터에 가산점 부여

## Redou 기존 자산
- `figures` 테이블에 item_type='table' 데이터 이미 존재
- `assembleRagContext()`에서 테이블 데이터를 이미 활용 중
- `parseAllHtmlTables`, `extractMatrixFromHtml` 유틸리티 존재

## 예상 영향
- Electron: 검색 로직 수정 (테이블 우선 쿼리)
- DB: figures 테이블에 대한 별도 검색 쿼리 추가

## 선행 조건
- Hybrid Search가 먼저 적용되면 시너지 극대화
