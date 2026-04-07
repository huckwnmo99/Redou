# 임베딩 모델 전환 (bge-m3)

> 상태: 💡 아이디어 | 등록일: 2026-04-06 | 출처: [RAG 설계 제안서](../01-Idea/Rag_design_report.md#params)

## 배경
현재 `all-MiniLM-L6-v2` (384-dim) 사용 중. 한국어 성능이 약하고, 임베딩 차원이 작아 정밀도 한계.

## 핵심 아이디어
- `BAAI/bge-m3`로 전환: 한영 모두 강함, 로컬 실행 가능
- 또는 Ollama 내장 임베딩 모델 활용 가능

## 예상 영향
- `embedding-worker.mjs`: 모델 교체
- DB: 기존 임베딩 전부 재생성 필요 (CURRENT_EXTRACTION_VERSION 범프)
- 임베딩 차원 변경 시 `chunk_embeddings`, `highlight_embeddings` 테이블 영향

## 주의사항
- 기존 논문 전체 재처리 필요 (시간 소요)
- Hybrid Search와 동시에 진행하면 효율적
