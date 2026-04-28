# 인용 네트워크 연쇄 검색

> 상태: 💡 아이디어 | 등록일: 2026-04-06 | 출처: [RAG 설계 제안서](../01-Idea/Rag_design_report.md#idea4)

## 배경
GROBID로 `paper_references`를 이미 추출하고 있지만, 검색 시 인용 논문까지 연쇄적으로 탐색하지 않음.

## 핵심 아이디어
- 검색 결과에서 인용 "[23]" 감지 → 인용 논문의 관련 청크까지 연쇄 검색
- 주장의 근거 논문 자동 추적
- TREC RAG 2025: attribution(출처 귀속) 검증 자동화

## Redou 기존 자산
- `paper_references` 테이블 (GROBID 추출)
- `linkedPaperId` 필드로 기존 논문과 연결 가능

## 예상 영향
- DB: `paper_references`에 인덱스 추가 정도
- Electron: 검색 파이프라인에 citation expansion 단계 추가
- Frontend: 검색 결과에 인용 체인 시각화 (선택)
