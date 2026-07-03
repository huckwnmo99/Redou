# docling 하이브리드 도입 — 표 + provenance + 그림·수식 보강

> 상태: 💡 아이디어 (사용자 방향 확정 2026-07-03) | 출처: [17-table-extraction-semantics-research.md](17-table-extraction-semantics-research.md) 후속 논의

## 채택 방향 (사용자 선택)

MinerU를 유지하고 docling(IBM, MIT, 활발)을 **보조 파서**로 얹는 하이브리드. 전면 교체 아님.

| 기능 | 내용 | 시점 |
|------|------|------|
| 표 하이브리드 | 표 파싱을 docling(TableFormer)으로 단일화 — 표 HTML + **셀 bbox** 저장. 나머지(텍스트·섹션·그림·수식)는 MinerU 유지 | 핵심 임포트 |
| ① bbox provenance | 문단·제목·그림 등 전 요소의 페이지+좌표 보존 → 검색/인용 클릭 시 PDF 정확 위치 점프(현재는 페이지 단위 anchor) | 핵심 임포트 (파싱에 내재, 추가 비용 0) |
| ③ 그림 분류·설명 | 그림 유형 분류(등온선/SEM/도식 등) + 로컬 VLM 설명 생성 → 갤러리 필터 세분화·그림 임베딩 강화 | **비차단 후속 job** (entity 패턴) |
| ④ 수식 LaTeX 보강 | MinerU가 놓친 수식의 docling 폴백 | **비차단 후속 job** |
| ② 스캔 PDF OCR 구출 | 청크 0 시 docling(OCR) 재시도 + "조용한 실패→보이는 실패" 경고 (감사 A-R6 처방과 한 세트) | 옵션 (미확정) |

## 시간 영향 (구조 추정 — 실측 필요)

- 파싱 단계만 2배(순차 시). MinerU와 **병렬 실행하면 체감 = 둘 중 느린 쪽**.
- ①·표는 docling 파싱 1회에 내재(기능별 추가 비용 없음). ③④가 실제 추가 시간(③ VLM 설명은 그림 수 비례) → 비차단 후속 job으로 분리해 핵심 임포트 속도 보존.
- 임포트는 논문당 1회 배경 작업 — 검색/채팅/리더 속도 영향 0.

## 선행 조건 (순서)

1. **경로 A 먼저** (17번 문서): 셀 튜플·병합 계약 보강 — 결함 D1/D2/D4는 docling으로 해결 안 됨.
2. **로컬 MinerU 3.4.0 업그레이드** (현재 2026-03-25 빌드, OCR +11%·2배속) — A/B의 공정 기준선.
3. **A/B 실측** (논문 5편, rag-table-eval 재사용): 표 구조·수식 LaTeX(최대 검증 포인트)·캡션 연결·파싱 시간 — 최신 MinerU vs docling.

## 구현 시 규모

대규모(`/develop`): docling Python 사이드카(ocr-server 패턴) + docling-client 어댑터 + 셀/요소 bbox 저장 컬럼(마이그레이션 가능성) + `CURRENT_EXTRACTION_VERSION` 범프 + 기존 논문 재추출 + 후속 job 2종(③④).

## 미결

- ②(스캔 OCR 구출) 포함 여부 — A-R6 경고 처방은 파서와 무관하게 필요.
- 셀 bbox 저장 위치(figures.metadata JSONB vs 신규 컬럼).
- ③ 그림 설명용 로컬 VLM 선택(기존 Ollama 모델 재사용 가능성).
