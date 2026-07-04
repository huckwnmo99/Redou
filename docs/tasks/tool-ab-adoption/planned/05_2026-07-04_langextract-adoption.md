# 슬라이스 05: LangExtract 채택 구현 (조건부 — 04 게이트 승리 시에만)

> 유형: 대규모 (develop). **게이트: 슬라이스 04의 A/B에서 LangExtract가 승리한 경우에만 착수.** 패배 시 현 SRAG + 셀 튜플 유지 + 이 파일 archive.
> 상태: 계획(조건부) | 의존: 04 게이트 통과 | 작성일: 2026-07-04

## 게이트 (착수 전 필수)

`completed/04`의 A/B 리포트가 LangExtract 승리(fidelity 비열세 + char-offset grounding이 셀→원문 하이라이트로 실효)로 판정된 경우에만 진행. 미통과 시 현 Stage 3b(SRAG per-paper + 셀 튜플) 유지 + 이 파일 archive.

## 목적

- Stage 3b(현 `runPerPaperExtraction`)를 LangExtract 경로로 전환 또는 병행 — 추출물마다 원문 char-offset grounding 확보(D3를 추출 시점에 구조적으로 해결).
- 셀→원문 하이라이트를 char-offset 기반으로(현 source_hint 문자열 대비 정밀).

## 설계 (초안 — 착수 시 정밀화)

### DB 변경
- char-offset를 셀 튜플에 추가 저장: `chat_generated_tables.metadata`(JSONB, 이미 셀 튜플 보유 — table-semantics 슬라이스 02)에 offset 필드 부가 → **무마이그레이션 우선**.
- 하이라이트 연결이 `highlights` 테이블과 엮이면 그때 검토.

### Electron (Backend)
- `langextract-client.mjs`(04 어댑터 승격): 측정 전용 → 프로덕션.
- `chat/table-extraction.mjs`/`table-pipeline.mjs` Stage 3b: LangExtract 추출을 대안 경로로 배선(feature flag 또는 도메인 조건). 병합(Stage 3c)은 코드 기준 유지(경로 C 아님 — 병합 제거는 장기 보류).
- LangExtract 스키마를 흡착 도메인 사전(`chat/adsorption-domain.mjs`)과 통합.
- `CURRENT_EXTRACTION_VERSION`: 채팅/추출 경로 변경이라 **범프 불필요 가능성 높음**(table-semantics Phase 1/2 선례 — 채팅 경로는 무범프). 추출 산출물 스키마가 아니라 채팅 런타임이면 무범프.

### Frontend
- 셀 hover/클릭 시 char-offset로 원문 위치 점프(현 source_hint 표시 확장). `ChatTableReport.tsx` 셀 인터랙션.

## 작업 분해 (착수 시 상세화 — 개략)

1. [ ] langextract-client 프로덕션 승격
2. [ ] Stage 3b LangExtract 경로 배선(flag/도메인 조건, 기존 SRAG와 선택)
3. [ ] 스키마 ↔ 흡착 도메인 사전 통합
4. [ ] char-offset를 셀 튜플 metadata에 저장(무마이그레이션 우선)
5. [ ] Frontend: 셀→원문 offset 점프

## 영향 범위 (예상)

- 대규모: LangExtract 상시 사이드카 + Stage 3b 경로 배선 + metadata offset + Frontend. `CURRENT_EXTRACTION_VERSION`은 채팅 경로면 무범프.
- 착수 시 **자체 상세 계획(planned/05 재작성 or 서브 슬라이스)** 필요 — 지금은 게이트 조건부 골격.

## 리스크

- LangExtract 상시화 = Python 사이드카 운영 부담(가벼우나 프로세스·포트 추가).
- Ollama 백엔드 경합(채팅·Guardian·OCR과 같은 11434 공유) — 추출 시 큐잉/부하.
- Stage 3b 경로 이원화(SRAG vs LangExtract) 유지보수 — flag 조건 명확히.
- 병합(3c)은 그대로라 D1/D2 잔여 결함은 table-semantics 처방에 계속 의존(이 슬라이스는 D3 grounding 위주).

## 가정 사항

- **[가정]** char-offset 저장은 `chat_generated_tables.metadata`(무마이그레이션).
- **[가정]** `CURRENT_EXTRACTION_VERSION` 무범프(채팅 런타임 경로 — table-semantics 선례).
- **[가정]** SRAG 완전 대체가 아니라 **병행/선택**(리스크 완화) — 착수 시 전면 전환 여부 결정.
- **[결정 필요]** 착수 시 서브 슬라이스 분할(경로 배선 / 스키마 통합 / offset 저장 / Frontend 점프) — 규모상 분할 권장.
