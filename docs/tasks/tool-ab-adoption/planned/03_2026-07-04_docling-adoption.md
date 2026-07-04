# 슬라이스 03: docling 채택 구현 (조건부 — 02 게이트 승리 시에만)

> 유형: 대규모 (develop). **게이트: 슬라이스 02의 A/B에서 docling이 승리한 경우에만 착수.** 패배 시 이 슬라이스는 archive로.
> 상태: 계획(조건부) | 의존: 02 게이트 통과 | 작성일: 2026-07-04

## 게이트 (착수 전 필수)

`completed/02`의 A/B 리포트가 docling 승리(표 구조/셀 bbox/캡션 중 명확 우위 + fidelity 비열세)로 판정된 경우에만 진행한다. 미통과 시 MinerU 3.4 단독 유지 + 이 파일 archive.

## 목적 (backlog/18 채택 방향 구현)

- **표 하이브리드**: 표 파싱만 docling(TableFormer)으로 단일화 — 표 HTML + **셀 bbox** 저장. 나머지(텍스트·섹션·그림·수식)는 MinerU 3.4 유지.
- **① bbox provenance**: 요소(문단·제목·그림·표)의 페이지+좌표 보존 → 검색/인용 클릭 시 PDF 정확 위치 점프(현재 페이지 단위 anchor).
- **③ 그림 분류·설명** + **④ 수식 LaTeX 보강**: **비차단 후속 job**(entity 패턴)으로 분리 — 핵심 임포트 속도 보존.

## 설계 (초안 — 착수 시 정밀화)

### DB 변경
- **셀/요소 bbox 저장 위치 결정** (backlog/18 미결):
  - 옵션 A: `figures.metadata`(JSONB, 이미 존재) — 마이그레이션 없음. 표 셀 bbox를 metadata에.
  - 옵션 B: 신규 컬럼(`figures.bbox` 등) — 조회/인덱스 유리하나 마이그레이션 필요.
  - **[가정] 옵션 A 우선**(무마이그레이션, table-semantics가 metadata 재사용 선례). 요소 bbox provenance가 청크 단위로 필요하면 `paper_chunks`에도 위치 정보 컬럼 검토 → 이때만 마이그레이션.
- ③④ 후속 job 타입: `processing_jobs.job_type` enum에 신규 값 필요할 수 있음(예: `classify_figures`·`enhance_equations`) → 마이그레이션. [실사] 기존 enum(`extract_entities` 등) 재사용 가능 여부.

### Electron (Backend)
- `docling-client.mjs`(02 어댑터 승격): 측정 전용 → 프로덕션 파서로. `parsePdfDocling` 표 결과를 `parseMineruResult`의 tables 자리에 주입.
- `main.mjs` `processWithMineruGrobid`: MinerU 파싱 후 **표만 docling 결과로 교체**(하이브리드 병합). MinerU/docling 병렬 실행(backlog/18 — 체감=느린 쪽).
- ③④ 후속 job: embedding job 큐 패턴 복제(비차단). 그림 분류(로컬 VLM)·수식 폴백을 별도 job으로.
- `CURRENT_EXTRACTION_VERSION` 범프(표 파서 교체 = 추출 산출물 변경) → 재추출.

### 새 IPC 채널
- ③④ job 상태/결과 노출용 채널 필요 시(그림 분류 결과 갤러리 필터). [실사] 기존 figure 조회 채널 확장 가능 여부 우선.

### Frontend
- 그림 갤러리: ③ 분류 결과로 필터 세분화(등온선/SEM/도식). `FiguresView` 필터칩 확장.
- bbox provenance: 검색/인용 클릭 시 PDF 좌표 점프 — 리더 anchor를 페이지→좌표로. `PdfReaderWorkspace` 점프 로직.

## 작업 분해 (착수 시 상세화 — 개략)

1. [ ] bbox 저장 위치 확정(metadata vs 컬럼) + 필요 시 마이그레이션
2. [ ] docling-client 프로덕션 승격 + 하이브리드 병합(표=docling)
3. [ ] `CURRENT_EXTRACTION_VERSION` 범프 + 재추출
4. [ ] ③ 그림 분류·설명 비차단 job(로컬 VLM — 기존 Ollama 모델 재사용 검토)
5. [ ] ④ 수식 LaTeX 보강 비차단 job
6. [ ] Frontend: 갤러리 필터 세분화 + bbox 점프

## 영향 범위 (예상)

- 대규모: docling 상시 사이드카 + main.mjs 파이프라인 병합 + 후속 job 2종 + DB(bbox·job enum) + `CURRENT_EXTRACTION_VERSION` 범프 + 재추출 + Frontend(갤러리·리더).
- 이 슬라이스는 착수 시점에 **자체 상세 계획(planned/03 재작성 or 서브 슬라이스 분할)** 필요 — 지금은 게이트 조건부 골격만.

## 리스크

- docling 상시화 = GPU/메모리 상시 점유(ocr-server·MinerU와 3-way 경합). 자원 예산 재검토.
- 하이브리드 병합: docling 표 ↔ MinerU 캡션/그림 매칭 정합(같은 표를 둘이 다르게 셀지 조율).
- ③ VLM 설명 = 그림 수 비례 시간 → 반드시 비차단(핵심 임포트 지연 금지).
- 재추출 비용(전체 라이브러리).

## 가정 사항

- **[가정]** bbox는 `figures.metadata`(JSONB) 우선 저장(무마이그레이션).
- **[가정]** ③ 그림 분류는 기존 Ollama VLM 재사용(신규 모델 도입 회피) — backlog/18 미결.
- **[결정 필요]** 착수 시 이 슬라이스를 서브 슬라이스(하이브리드 병합 / ③ / ④ / bbox 점프)로 쪼갤지 — 규모상 분할 권장.
