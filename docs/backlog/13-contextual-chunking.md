# Contextual Chunking (Anthropic 기법)

> 상태: 💡 아이디어 | 등록일: 2026-04-07 | 출처: [Table RAG 개선 제안서](../01-Idea/Table_RAG_improvement_report.md#3-contextual-chunking-anthropic-기법)

## 배경
현재 각 청크가 독립적으로 임베딩되어 "이 수치가 어떤 논문의 어떤 섹션에서 나왔는지" 맥락이 손실됨.

## 핵심 아이디어
- 각 청크 앞에 논문 제목 + 섹션명을 접두어로 추가한 후 임베딩
- Anthropic "Contextual Retrieval" (2024) — Kapa.ai 벤치마크에서 검색 정확도 ~18% 향상
- 구현 비용 매우 낮음 (임베딩 시 접두어 추가만)

## Redou 기존 자산
- `embedding-worker.mjs`에서 청크 텍스트 처리
- 논문 메타데이터(제목, 섹션 헤딩) 이미 추출 완료

## 예상 영향
- Electron: `embedding-worker.mjs` 수정 (청크 텍스트에 접두어 추가)
- DB: 기존 임베딩은 재생성 필요 (CURRENT_EXTRACTION_VERSION 범프)
- Table/Q&A 양쪽 모두에 효과

## 주의사항
- 기존 논문 전체 재임베딩 필요
- 접두어 길이가 임베딩 모델 토큰 한도를 넘지 않도록 주의
