# Tool A/B Adoption — MinerU 3.4 + docling / LangExtract 도입

## Purpose

파싱·추출 도구를 **측정 기반으로** 업그레이드/도입한다. 두 축:

1. **파싱(3a)**: 현재 MinerU **2.7.6**(실행 이미지, 3개월 구식)을 **3.4.0**으로 올려 A/B 기준선을 세우고, **docling**(IBM, MIT)을 표 파싱 보조로 얹을지 A/B로 결정한다.
2. **추출(3b)**: **LangExtract**(Google, Apache-2.0, Ollama 백엔드)를 Stage 3b 대안 추출기로 A/B한다.

배경 방향은 사용자 확정(backlog/18) — MinerU 유지 + docling 하이브리드(표+bbox provenance ① + 그림 분류·설명 ③ + 수식 보강 ④ 비동기, ②스캔OCR은 3.4 확인 후 재평가). 이 ledger는 그 방향의 **선행 조건(3.4 업그레이드)부터 A/B, 조건부 채택**까지를 슬라이스로 나눈다.

## A/B 게이트 원칙 (이 ledger의 핵심 규칙)

> **시험은 확정, 전면 채택은 측정이 결정한다.**

- 도구를 **얹어 보는 것**(사이드카·A/B 측정)은 사용자 확정 사항 → 진행한다.
- 도구를 **프로덕션 파이프라인에 채택**하는 것은 A/B 결과가 이긴 경우에만 → 조건부 슬라이스(03·05)는 게이트를 명시하고, 게이트 미통과 시 실행하지 않는다.
- **심판은 하나로 고정**: `table_fidelity` eval(`apps/desktop/scripts/e2e-table-fidelity.mjs` + `tests/fixtures/evals/adsorption-groundtruth-v0.json`) + 슬라이스 02의 검증 주체 분포 축. A/B는 **동일 fixture·동일 논문 5편·동일 LLM 모델**로만 공정하다(리스크 참조).

## Current Status

- Status: **슬라이스 01·02·04 완료 (A/B 3건 판정 완료)**. 채택 슬라이스 03·05는 조건부 대기.
  - **04 LangExtract A/B → GATE HOLD** (2026-07-05/06): grounding·qualifier 역량은 스모크로 실재 확인(char offset match_exact)이나, 실 dense 청크에서 gemma-4:31b(Ollama)가 strict JSON을 못 만들어 전 청크 파싱 실패 → 0 추출. "LangExtract 열세"가 아닌 **로컬 모델×strict-JSON 미스매치**. incumbent(SRAG+셀 튜플+역매칭)가 이미 in-scope 88.6%. 상세 `completed/04`.
  - **02 docling A/B → GATE PASS** (2026-07-04): docling 우위는 셀 bbox 100% vs 0%·캡션 연결뿐, 골든 재발견 **동률 100%=100%**(값 품질 아님). 승리 축 = provenance/UX. 상세 `completed/02`.
- **완료(2026-07-04)**: MinerU **2.7.6→3.4.2** 업그레이드. 실 3.4.2 응답 265요소 실측 → 파서 3.4 대응(`chart`→figures, `list`→본문[ref_text 제외], `header`/`footer`/`page_number`/`page_footnote`→명시 무시) + `CURRENT_EXTRACTION_VERSION` 25→26 범프 + 신규 테스트 7건(147/147). `mineru-client.mjs`·`main.mjs`(1줄)·`verify-mineru-api.mjs`(계약 동기) 수정, docker·커밋 없음(브랜치 main).
- 실측(3.4.2, 2026-07-04): backend enum 3.4에서 5종(`pipeline` 유효) → backend 값 무변경. 기존 계약(8필드·`/file_parse`·table_body/caption/img_path/image_caption·el.text) 전부 PASS, 신규 타입 6종·필드 7종만 추가. 신규 API 경로 `/health`·`/tasks*`(현 코드 미사용).
- fidelity 기준선: 2.7.6 = **44.2%**(19/43) → **3.4.2 = 67.4%(29/43), +23.2%p** (동일 gemma4:31b·fixture. 논문1 40.7→77.8% — 조건 세트 양쪽 추출. misattr·fabrication 0 유지. 검증 130/132=code 130/Guardian 2. 런 변동 ±2~3%p를 크게 상회 = 파서 효과 확실). **A/B(02·04)의 공정 기준선 = 이 67.4%.**
- 재추출(2026-07-04): 5편 전부 v26, 실패 0. chunks 207(임베딩 100%), tables 30, figures 112(차트 구조 포함), equations 54.
- 스캔 PDF 확인(backlog/18 ②): **보류** — 현 라이브러리 5편 전부 정상 텍스트 PDF(청크 29~48)라 스캔 샘플 부재. 사용자 스캔 샘플 확보 시 3.4 OCR로 재평가.
- 도구 버전(2026-07 조사): docling v2.108.0(2026-07-01)·LangExtract v1.6.0(150KB wheel, 모델 무동봉, Ollama 지원)·MinerU 3.4(OCR +11%·속도 2배 PP-OCRv6) 모두 활발.

## Next Action

슬라이스 04 커밋·리뷰(/test→/review→PR, 브랜치 `feature/tool-ab-04-langextract`). A/B 3건 완료로 **도구 트랙의 실험 단계 종료**. 남은 채택 슬라이스는 둘 다 조건부 보류:
- **03 docling 채택**: 게이트 PASS이나 값 품질 동률 — 효과가 provenance/UX(셀 좌표 점프·캡션). 착수 시점 사용자 결정.
- **05 LangExtract 채택**: 게이트 HOLD — 미착수. 재검토 조건은 더 강한 로컬 모델 또는 provenance 우선순위화(`completed/04`).

다음은 **품질 종합 리뷰**(그간 전 측정 취합) 후 사용자와 방향 결정.

이후 순서: 02(docling 사이드카 + 표 A/B, **게이트 산출**) → [게이트 승리 시] 03(docling 채택 구현) / 04(LangExtract A/B, 02·03과 독립·병행 가능) → [게이트 승리 시] 05(LangExtract 채택 구현).

## Success Criteria

- **01**: 3.4 이미지가 `mineru-api`로 뜨고 health/파싱 성공, `mineru-client.mjs` 무수정(또는 최소 수정)으로 논문 5편 재추출 성공, 3.4 기준선 fidelity 수치 기록(2.7.6 44.2%와 비교), 스캔 PDF 1편 처리 결과 확인. `CURRENT_EXTRACTION_VERSION` 범프 여부 결정·기록.
- **02**: docling 사이드카가 뜨고 논문 5편 표를 파싱, MinerU 3.4 vs docling 표를 **표 구조·수식 LaTeX·캡션 연결·셀 bbox·파싱 시간** 5축 + `table_fidelity` eval로 대조한 **A/B 리포트**(승/패 판정 + 근거) 산출. **프로덕션 파이프라인 무변경**(도입 판단용 최소 사이드카).
- **03(조건부)**: 02 게이트 승리 시에만. 표 하이브리드(표=docling, 나머지 MinerU) + 요소 bbox 저장 + ③④ 비동기 job. `CURRENT_EXTRACTION_VERSION` 범프 + 재추출. 대규모.
- **04**: LangExtract 사이드카(최소)로 동일 논문·쿼리를 기존 추출 vs LangExtract 추출로 `table_fidelity` 대조(특히 grounding 오프셋 활용성). A/B 리포트 산출. 프로덕션 무변경.
- **05(조건부)**: 04 게이트 승리 시에만. Stage 3b를 LangExtract 경로로. 대규모.
- 공통: harness 갱신(`services/external.md` MinerU 버전·API 정정 포함) + `VERSION.md` 범프.

## Documents To Read

- `planned/01_2026-07-04_mineru-34-upgrade.md` — 첫 슬라이스 상세(이미지 갱신·API 재검증·범프 판단·재측정 절차).
- `planned/02_2026-07-04_docling-sidecar-table-ab.md` — docling 사이드카 + 표 A/B(게이트 산출).
- `planned/03_2026-07-04_docling-adoption.md` — docling 채택 구현(조건부, 게이트 명시).
- `planned/04_2026-07-04_langextract-stage3b-ab.md` — LangExtract Stage 3b A/B(독립).
- `planned/05_2026-07-04_langextract-adoption.md` — LangExtract 채택 구현(조건부).
- 방향 근거: `../../backlog/18-docling-hybrid-adoption.md`(채택 방향·선행 조건) + `../../backlog/17-table-extraction-semantics-research.md`(경로 B·도구 조사).
- 로드맵·심판: `../table-semantics-hardening/README.md`(Phase 3 정의 + fidelity eval이 A/B 심판 + baseline).
- 파이프라인 현황: `../../harness/detail/electron/pdf-pipeline.md`·`../../harness/detail/services/external.md`.

## Planned

- `planned/01_2026-07-04_mineru-34-upgrade.md` — MinerU 2.7.6→3.4 업그레이드 + 기준선 재측정. **선행(모든 A/B의 공정 기준).**
- `planned/02_2026-07-04_docling-sidecar-table-ab.md` — docling 사이드카 + 표 A/B. 01 의존. **게이트 산출.**
- `planned/03_2026-07-04_docling-adoption.md` — docling 채택(표 하이브리드 + bbox + ③④). **02 게이트 승리 조건부.** 대규모.
- `planned/04_2026-07-04_langextract-stage3b-ab.md` — LangExtract Stage 3b A/B. 01 의존(동일 기준선), 02·03과 **독립·병행 가능.** 게이트 산출.
- `planned/05_2026-07-04_langextract-adoption.md` — LangExtract 채택(Stage 3b 대안 경로). **04 게이트 승리 조건부.** 대규모.

의존성 그래프:
```
01 (3.4 업그레이드·기준선)
 ├─ 02 (docling 표 A/B) ──[승리]──> 03 (docling 채택)
 └─ 04 (LangExtract A/B) ─[승리]──> 05 (LangExtract 채택)
02·03 와 04·05 는 서로 독립(병행 가능). 03·05 는 게이트 조건부.
```

## In Progress

- `planned/02_2026-07-04_docling-sidecar-table-ab.md` — **Phase A 완료(2026-07-04, developer)**: docling 사이드카 정의 3종(`apps/docling-server/`: `Dockerfile.docling`·`docling-server.py`·`requirements.txt`) + 별도 `compose.docling.yaml`(포트 8011, 기본 CPU/GPU 프로필) + `electron/docling-client.mjs`(측정 전용, mineru 대칭) + `scripts/ab-docling-tables.mjs`(5축 A/B: 표구조·수식·캡션·셀bbox·시간 + 골든 43셀 재발견 + 게이트 verdict). 자기검증: node --check 2 PASS, py_compile PASS, compose config VALID, 기존 테스트 148 pass/0 fail(프로덕션 무변경). **docker build/run·fidelity E2E 미실행 = Phase B(오케스트레이터)**. 커밋 없음(브랜치 `feature/tool-ab-02-docling`).
- `planned/04_2026-07-04_langextract-stage3b-ab.md` — **Phase A 완료(2026-07-06, developer)**: LangExtract Stage-3b 사이드카 정의 3종(`apps/langextract-server/`: `Dockerfile.langextract`[**python:3.11-slim, CUDA·torch 없음** — 모델 무동봉·원격 Ollama], `langextract-server.py`[FastAPI `POST /extract`→{property,value,unit,condition,char_start/end,alignment_status}, `/health`, 1.x API 드리프트 방어], `requirements.txt`[`langextract>=1.6`]) + 별도 `compose.langextract.yaml`(**포트 8012**, GPU 예약 없음, `host.docker.internal:11434`+`host-gateway`, `gemma4:31b`) + `electron/langextract-client.mjs`(측정 전용: `isLangExtractAvailable`/`extractLangExtract` + 흡착 few-shot 스키마 `ADSORPTION_PROMPT_DESCRIPTION`/`ADSORPTION_EXAMPLES` + grounding 매핑 `buildChunkSpans`/`mapOffsetToChunk`) + `scripts/ab-langextract.mjs`(A/B: (a) 현 SRAG 실 파이프라인 vs (b) LangExtract → **동일 fixture·동일 LLM·기본 metric=capacity**로 fidelity + misattr + fab + **grounding(char_offset→청크)** + 사전 게이트 verdict). **갱신 기준 반영**: 공정 기준선 in-scope 88.6%(capacity), `GRADING_OPTIONS` 양쪽 동일. 신규 테스트 10건(`langextract-client.test.mjs`, grounding 좌표 math + 스키마). 자기검증: `node --check` 3 PASS, `py_compile` PASS, compose config VALID, `node --test` **218 pass/0 fail**(기존 208 + 신규 10, 프로덕션 무변경). fold 로직 실 fixture 검증(perfect 3추출→3매치·misattr 0·fab 0). **docker build/run·실 LLM A/B 미실행 = Phase B(오케스트레이터)**. 커밋 없음(브랜치 `feature/tool-ab-04-langextract`).

## Completed

- `completed/01_2026-07-04_mineru-34-upgrade.md` — MinerU 2.7.6→**3.4.2** (2026-07-04). Phase A(핀·harness 정정·검증 스크립트·컨테이너 실사) + Phase B(스키마 드리프트 대응: chart→figures·list→본문[ref_text 제외]·boilerplate 명시 무시, 범프 25→26, 테스트 147/147) + Phase C(재추출 5편 v26 실패 0, **3.4 기준선 fidelity 67.4% [+23.2%p]**, 스캔 확인은 샘플 부재로 보류).

## Last Updated

2026-07-06 — developer: 슬라이스 04 **Phase A**(빌드 비의존 구현, 프로덕션 무변경 측정 슬라이스). LangExtract Stage-3b 사이드카(`apps/langextract-server/`: `Dockerfile.langextract`[**python:3.11-slim**, docling/ocr-server와 달리 **CUDA·torch 없음** — LangExtract 모델 무동봉·원격 Ollama 호출로 이미지 극경량·build 수초], `langextract-server.py`[FastAPI lifespan, `POST /extract`{text+prompt_description+few-shot examples+model_id?}→{extractions:[{property,value,unit,condition,extraction_class,extraction_text,char_start,char_end,alignment_status}],grounded_extractions,...}, `/health`, **LangExtract 1.x API 드리프트 방어**: `model_url`↔`base_url` 순차 시도·`char_interval.start_pos/end_pos`↔flat getattr·ExampleData/Extraction 빌드·`fence_output=False`+`use_schema_constraints=False`(Ollama)·import 실패는 `/health` import_error로 보고], `requirements.txt`[`langextract>=1.6,<2`+fastapi+uvicorn, **torch/CUDA 없음**]) + `compose.langextract.yaml`(**별도 파일**, 기존 compose[mineru·docling] 무침범; **포트 8012**, **GPU 예약 없음**[모델은 상시 Ollama 실행], `REDOU_LANGEXTRACT_OLLAMA_URL`=host.docker.internal:11434 + `extra_hosts: host-gateway`[Linux 정합] + `REDOU_LANGEXTRACT_MODEL`=gemma4:31b[01 기준선 LLM 동일], `restart:no` A/B 임시). 어댑터 `electron/langextract-client.mjs`(`isLangExtractAvailable`[import 실패=down]/`extractLangExtract`, docling-client 대칭, 프로덕션 무배선 + 흡착 few-shot 스키마 `ADSORPTION_PROMPT_DESCRIPTION`·`ADSORPTION_EXAMPLES`[NIST AIF 필드 정합·압력범위 condition 강제·q_m 2조건 예시] + grounding 매핑 `buildChunkSpans`/`mapOffsetToChunk`[char_offset→Redou 청크 startCharOffset 좌표]). A/B `scripts/ab-langextract.mjs`((a) 현 Stage 3b = `runTableConversationPipeline` **e2e-table-fidelity 실 파이프라인 그대로**[SRAG] vs (b) LangExtract `/extract`[paper_chunks+OCR 표 HTML] → 양쪽 `evaluateTableFidelityFixture` **동일 fixture·동일 LLM·기본 metric=capacity**로 fidelity+misattr+fab + **grounding(offset 보유율·청크 적중률, D3 결정 축)** + **사전 게이트**[fidelity ≥ 기준선−5%p AND grounding offset의 ≥50% 청크 매핑 → PASS/HOLD verdict]). **갱신 기준 반영**: 공정 기준선 = **in-scope 88.6%(capacity, RUNS=3, gemma4:31b)**, `GRADING_OPTIONS` 양쪽 동일 적용(공정), `REDOU_AB_SKIP_BASELINE=1`로 (a) 생략+기록 기준선 재사용. **프로덕션(main.mjs·chat/*·mineru-client·DB·IPC·`CURRENT_EXTRACTION_VERSION`) 완전 무변경**. 신규 테스트 10건(`langextract-client.test.mjs`: buildChunkSpans/mapOffsetToChunk grounding 좌표 math + 흡착 스키마 계약). 자기검증: `node --check` 3파일 PASS + `python -m py_compile langextract-server.py` PASS + `docker compose config` VALID + `node --test` **218 pass/0 fail**(기존 208 + 신규 10, 회귀 0) + fold 로직 실 fixture 검증(perfect 3추출→3매치·misattr 0·fab 0). docker build/run·실 LLM A/B 미실행(Phase B 오케스트레이터). 커밋 없음(브랜치 `feature/tool-ab-04-langextract`). harness: external.md LangExtract 항목 추가·VERSION 범프. Next=Phase B(build→run→ab-langextract 실행→게이트 판정→`completed/04`).

2026-07-04 — developer: 슬라이스 02 **Phase A**(빌드 비의존 구현). docling 표-파싱 사이드카(`apps/docling-server/`: `Dockerfile.docling`[cuda12.8+torch cu128+docling>=2.108+`docling-tools models download`+uvicorn 8011], `docling-server.py`[FastAPI lifespan, `POST /parse` multipart→표 중심 JSON{셀 grid+셀별 bbox+캡션+caption_ref+수식 LaTeX+figure수+시간}, `/health`, docling API 드리프트 방어], `requirements.txt`) + `compose.docling.yaml`(**별도 파일**, 기존 compose 무침범; `docling` CPU 기본 + `docling-gpu` profile, 포트 8011, `restart:no` A/B 임시). 어댑터 `electron/docling-client.mjs`(`isDoclingAvailable`/`parsePdfDocling`, mineru-client 대칭, 프로덕션 무배선). A/B `scripts/ab-docling-tables.mjs`(`paper_files.stored_path`에서 5편 PDF 로드 → MinerU 3.4 vs docling **5축**[표구조+파서간 Jaccard+골든43셀재발견 / 수식 / 캡션 ref / 셀bbox / 시간] + **사전정의 게이트**[docling {표구조|bbox|캡션} ≥1 명확우위 + 골든 비열세 → PASS/HOLD verdict 출력]). 골든 fixture(`adsorption-groundtruth-v0.json` 43셀) 축①에 연동. **프로덕션(main.mjs·mineru-client.mjs·DB·IPC) 완전 무변경**. 자기검증: `node --check` 2파일 PASS + `python -m py_compile` PASS + `docker compose config` VALID + `node --test` **148 pass/0 fail**. docker build/run·13분 fidelity E2E 미실행(Phase B 오케스트레이터). 커밋 없음(브랜치 `feature/tool-ab-02-docling`). harness: external.md docling 항목 추가·VERSION 범프. Next=Phase B(build→run→A/B→verdict→`completed/02`).

2026-07-04 — fixer: 슬라이스 01 **Phase B**(3.4 스키마 드리프트 대응 + 범프). MinerU 3.4.2 라이브 응답 265요소 실측 후 `mineru-client.mjs` `parseMineruResult` 국소 확장: `chart`(38건)→figures(chart_caption/content 폴백), `list`→본문 수용하되 `sub_type=ref_text`(서지 68항목, GROBID 소유) 제외, `header`/`footer`/`page_number`/`page_footnote`→`IGNORED_BOILERPLATE_TYPES`로 명시 무시. `equation.text_format`·`image.image_footnote`·backend enum(5종, "pipeline" 유효)은 기존 계약 불변이라 무수정. `CURRENT_EXTRACTION_VERSION` 25→26(`main.mjs:116`). 신규 `tests/mineru-client.test.mjs` 7건 + fixture(실 응답 축약) → `node --test` **147/147**. `verify-mineru-api.mjs` 계약 미러 동기 + 3.4.2 Check 1·2·3 라이브 PASS. harness VERSION v1.23, pdf-pipeline.md v2.2, external.md v1.2, feature-status v1.23. docker·커밋 없음(브랜치 main). Next=오케스트레이터 재추출→3.4 기준선 재측정→스캔 확인.

2026-07-04 — planner: 신규 ledger bootstrap. 실행 이미지 MinerU 2.7.6 실측 + `/file_parse` 계약 확인 + docker 구조(ocr-server 사이드카 선례·`Dockerfile.mineru` 버전 미핀·`compose.mineru.yaml` openai-server 프로필) 실사 후 슬라이스 5개 계획. Next=슬라이스 01(MinerU 3.4 업그레이드). 코드·docker 무변경, 커밋 없음(계획만).
