# 표 데이터 추출의 의미 보존 — 오픈소스·학술 조사

> 상태: 💡 조사 완료 | 등록일: 2026-07-03 | 출처: 테이블 파이프라인 ground-truth 검증(수치 충실도 우수, 의미 매핑 4결함) 후속 리서치

## 요약 (핵심 결론)

1. Redou의 4개 결함(조건 소실, 파라미터/데이터점 혼동, provenance 폐기, 파편·라벨 오염)은 학계에서 이미 명명된 실패 모드다 — "numeric misattribution", "binding drift", "instance compression" (IRCDL 2026), qualifier 추출 실패 (MeasEval).
2. 공통 처방은 **스키마가 의미를 소유하게 하라**: 셀 값을 스칼라가 아닌 `값+단위+조건(qualifier)+출처 span` 튜플로 다루고, 병합은 LLM이 아닌 코드가 스키마 기준으로 수행.
3. 오픈소스 유력 후보는 **LangExtract**(추출 단계: 문자 오프셋 grounding + attributes 스키마, Ollama 지원)와 **docling**(파싱 단계: 셀 단위 bbox provenance, MIT). 둘 다 2026년 7월 현재 활발히 유지된다.
4. 흡착 도메인은 **NIST ISODB/AIF**라는 성숙한 표준 스키마가 존재 — "등온선 원시 점"과 "핏 파라미터"를 애초에 별개 엔티티로 규정하므로 결함 2의 정답지 역할.
5. 단기는 셀 스키마·병합 계약 보강(코드), 중기는 LangExtract/docling 시험 도입, 장기는 '표 생성' 중심에서 '측정 튜플 저장소' 중심으로 전환이 현실적 경로다.

## 기준점: 이번 검증에서 확인된 결함 4건

| ID | 결함 | 발생 단계 (chat-table 파이프라인) |
|----|------|--------------------------------|
| D1 | 측정 조건이 다른 두 파라미터 세트가 구분 열 없이 혼입 (qualifier 소실) | Stage 1 table_spec + Stage 3b 추출 |
| D2 | "q_max(포화 용량)" 열에 압력별 원시 데이터점 주입 (파라미터 vs 데이터점 구분 실패) | Stage 3b 추출 |
| D3 | 행별 source_hint("Table 4")가 병합에서 폐기 (provenance 소실) | Stage 3c 병합 |
| D4 | LLM 출력 파편의 셀 유입 + NULL 채움 시 그럴듯한 오답 라벨 | Stage 3c 정화 / Stage 4 검증 |

## 1. 오픈소스 후보

| 이름 | URL | 라이선스 | 무엇을 하나 | Redou 적용 지점 | 도입비용 | 판단 |
|------|-----|---------|------------|----------------|---------|------|
| LangExtract (Google) | https://github.com/google/langextract | Apache-2.0 | LLM 구조화 추출: 추출물마다 원문 문자 오프셋 grounding, few-shot 스키마 + attributes(qualifier), 청킹·멀티패스. 37k★, v1.6.0 (2026-07) | **추출(3b)**: 물성+조건 스키마 강제, 셀→원문 span 자동 보존. Ollama 백엔드 지원으로 기존 스택 유지 | 중 (Python 사이드카) | **유력** |
| docling (IBM/LF AI) | https://github.com/docling-project/docling | MIT | PDF→구조화 문서(DoclingDocument JSON/MD): TableFormer 표 구조 인식, 항목별 페이지·bbox provenance, 완전 로컬 실행. 62.6k★, v2.108.0 (2026-07). 기술보고서 https://arxiv.org/abs/2501.17887 | **파싱(3a 이전)**: MinerU 보조/대체 파서. 표 셀 provenance를 하류로 전달 | 중 (Python 사이드카, MinerU와 A/B 필요) | **유력** |
| NIST ISODB + AIF | https://adsorption.nist.gov / https://github.com/NIST-ISODB | 공공 데이터·MIT 도구 | 흡착 등온선 32,000건 DB + 표준 파일 포맷 AIF(등온선 점+메타데이터: 온도·흡착질·활성화 조건). 파서는 pyGAPS 등 | **스키마 참조 + 검증(4)**: 파라미터/원시 점 분리 스키마의 정답지, 추출값 대조 검증용 외부 DB | 소 (스키마 참조만이면 0) | **유력** (도메인 표준) |
| ChemDataExtractor2 | https://github.com/CambridgeMolecularEngineering/chemdataextractor2 | MIT | 화학 문헌 물성 추출: 규칙+NLP로 물성-값-단위-오차 해소, 중첩 모델(측정 조건 포함), 표 파서(TableDataExtractor) 내장. 201★, v2.4.0 (2025-03), Python 3.9–3.11 | **추출(3b) 참조 설계**: '물성=값+단위+조건' 중첩 모델 정의 방식. 직접 탑재보다 스키마 설계 참고 | 대 (규칙 기반, 도메인 사전 작성 필요) | 참고 |
| L2M3 (KAIST) | https://github.com/Yeonghun1675/L2M3 | MIT | MOF 문헌 마이닝 3-에이전트(분류→포함 판정→추출→표준화), 본문+표 모두 처리, 논문 4만 편 DB화. 56★, 2024-10 이후 정체. 논문: JACS https://pubs.acs.org/doi/abs/10.1021/jacs.4c11085 | **파이프라인 설계 참조**: 속성 사전+단위 정규화를 추출 전에 정의하는 구조. GPT 의존 코드라 직접 탑재 부적합 | 대 | 참고 |
| paper-qa (FutureHouse) | https://github.com/Future-House/paper-qa | Apache-2.0 | 과학 문헌 agentic RAG: 청크별 문맥 요약+점수화(RCS) 후 인용 grounding 답변. LiteLLM 기반, Ollama 지원. 8.8k★, v2026.03.18 | **QA 파이프라인 참조**: 인용 계약(요약→점수→인용) 패턴. 표 생성에는 미특화 | 중 | 참고 |
| PP-StructureV3 (PaddleOCR) | https://github.com/PaddlePaddle/PaddleOCR | Apache-2.0 | 문서 파싱 파이프라인: 표 셀 좌표 포함 JSON/MD 출력, OmniDocBench 상위. 84.6k★, v3.7.0 (2026-06). 보고서 https://arxiv.org/abs/2507.05595 | **파싱(3a 이전)**: MinerU 대체 후보군. 셀 좌표 = provenance 원천 | 중 | 참고 |
| Marker (Datalab) | https://github.com/datalab-to/marker | GPL-3.0 + 모델 가중치 상용 제한(수익 $2M 초과 시 유료) | PDF→MD/JSON, LLM 하이브리드 모드 시 표 0.907(FinTabNet), bbox 보존. 37.1k★, v1.10.2 (2026-01) | 파싱 대안이나 가중치 라이선스 제약 | 중 | 참고 (라이선스 주의) |
| unstructured | https://github.com/Unstructured-IO/unstructured | Apache-2.0 | 범용 문서 파티셔닝(기업 문서 지향). 15.1k★, 활발 | 과학 표 의미 보존 목적에는 특화점 없음 | 중 | 부적합 |
| Table Transformer (MS) | https://github.com/microsoft/table-transformer | MIT | 표 감지/구조 인식 모델 + PubTables-1M 데이터셋 + GriTS 지표. 2.9k★, 마지막 유의미 활동 2023-08 | 표 구조 인식은 이미 MinerU/OCR가 담당. 데이터셋·GriTS 지표만 평가 참고 | 대 | 부적합 (정체) |
| Nougat (Meta) | https://github.com/facebookresearch/nougat | MIT(코드)/CC-BY-NC(가중치) | 학술 PDF→MD OCR 모델. 10k★, 2023-08 이후 정체 | 후속 도구(docling·Marker)가 대체 | 대 | 부적합 (정체) |

## 2. 학술자료

1. **MeasEval — SemEval-2021 Task 8** (Harper et al.) — https://github.com/harperco/MeasEval
   과학 텍스트의 측정 추출을 5단계 관계 과제로 정식화: 수량 → 단위·modifier → 측정 대상(entity/property) → **qualifier** → 관계. 시사점: "수치 = 값+단위+qualifier+대상 물성" 튜플이 이 분야의 표준 스키마. Redou 셀 스키마에 qualifier 필드가 없는 것이 D1의 구조적 원인.

2. **Diagnosing Structural Failures in LLM-Based Evidence Extraction** (IRCDL 2026) — https://arxiv.org/abs/2602.10881
   5개 과학 도메인에서 LLM 증거 추출의 실패 유형학 도출: role reversal, cross-analysis **binding drift**, **instance compression**(구분되는 결과의 붕합), **numeric misattribution**(수치를 다른 조건·그룹에 배정). 집계 파이프라인에서 오류 증폭, 메타분석 튜플은 신뢰도 거의 0. 시사점: D1·D2와 정확히 같은 실패가 재현·명명됨. 결론도 동일 — 구조 바인딩은 LLM 자유 생성이 아닌 스키마 제약으로 유지해야.

3. **DTBench: Document-to-Table 추출 벤치마크** (KDD 2026) — https://arxiv.org/abs/2602.13812
   목표 스키마에 따른 문서→표 추출을 5대분류 13하위 능력(추론·충실성·**충돌 해소** 등)으로 평가. 주요 LLM 모두 "정확히 구조화된 표" 생성에 큰 격차. 시사점: 병합(3c)의 충돌 해소는 측정 가능한 독립 능력 — Redou eval(ADR 0007)에 축으로 추가 가능.

4. **SCITAB: 과학 표 주장 검증 벤치마크** (EMNLP 2023) — https://arxiv.org/abs/2305.13186
   실제 논문 유래 1.2K 주장을 표 근거로 검증. GPT-4 제외 전 모델이 랜덤 수준, CoT도 무효; 표 grounding·주장 모호성이 병목. 시사점: Guardian(Stage 4)이 하는 "표 대 원문 검증"은 본질적으로 어려운 과제 — 검증을 자유 QA가 아니라 표-주장 대조(claim verification) 형식으로 좁혀야 신뢰 가능.

5. **Dagdelen et al., "Structured information extraction from scientific text with LLMs"** (Nature Communications 15, 2024) — https://www.nature.com/articles/s41467-024-45563-x
   NER+관계 추출을 LLM 파인튜닝(JSON 스키마 출력)으로 통합, 재료화학 3과제(도펀트-호스트, MOF, 조성/상/응용) 검증. 시사점: 수백 문단 수준의 도메인 어노테이션만으로 스키마 준수 추출이 크게 개선 — Redou도 ground-truth 검증 데이터를 축적하면 로컬 모델 파인튜닝 자산이 된다.

6. **L2M3 / Kang et al.** (JACS 2025) — https://pubs.acs.org/doi/abs/10.1021/jacs.4c11085
   MOF 논문 4만 편에서 합성 조건·물성을 3-에이전트 체인(분류→포함 판정→추출)으로 DB화, 속성 사전과 단위 정규화를 추출 앞단에 배치. 시사점: "무엇이 유효한 속성·단위·조건인가"를 도메인 사전으로 먼저 고정하는 설계가 대규모에서 작동함을 실증.

7. **MeasHalu: 측정 환각 완화** (ACL 2026) — https://arxiv.org/abs/2604.16929
   수량·단위·modifier·관계의 환각을 유형 분류하고, 유형별 페널티를 주는 보상 커리큘럼 + 추론 파인튜닝으로 MeasEval 성능 개선. 시사점: D4의 "그럴듯한 오답"은 환각 유형 체크리스트(단위 불일치·조건 불일치·값 조작)로 분해해 Guardian 프롬프트에 반영 가능.

8. **SemTab Challenge 2024–2025 (ISWC)** — https://sem-tab-challenge.github.io/2025/
   표→지식그래프 매칭(열 타입 CTA·셀 엔티티 CEA·열 속성 CPA)의 연례 벤치마크, 2025년부터 LLM 전용 트랙. 시사점: "이 열이 의미상 무엇인가"(파라미터인가 원시 데이터인가)는 독립 과제(CTA)로 다뤄진다 — Redou도 열 의미 타입 판정을 명시적 단계로 분리할 근거.

9. **SciEx: 과학 정보 추출 프레임워크** (AAAI 2026 KGML bridge) — https://arxiv.org/abs/2512.10004
   파싱·멀티모달 검색·추출·**집계**를 분리한 모듈형 스키마 주도 설계, 3개 도메인 검증. 시사점: Redou의 3a/3b/3c 분리는 방향이 맞음 — 스키마(desired attributes+타입+단위)를 컴포넌트 간 계약으로 명문화하는 부분이 Redou에 빠져 있다.

10. **NIST AIF + 흡착 보고 모범규준** — AIF: "A Universal Standard Archive File for Adsorption Data" (Adsorption, 2021) https://www.researchgate.net/publication/348577335 / Siderius et al., Angew. Chem. 2025 https://onlinelibrary.wiley.com/doi/full/10.1002/anie.202513606
    CIF에서 영감을 받은 흡착 데이터 표준 포맷(AIF)과 보고 모범규준: 등온선 원시 점과 메타데이터(온도·압력 범위·흡착질·활성화 조건)를 분리된 필드로 규정. 시사점: D2(파라미터 vs 데이터점)의 도메인 정답 스키마가 이미 존재 — 흡착 논문에 한해 이 스키마로 추출을 제약하면 혼입이 구조적으로 불가능.

## 3. Redou 적용 제안 — 3경로

### 경로 A — 단기: 셀 스키마·병합 계약 보강 (코드 수정, 라이브러리 불요)

근거: D1·D2·D3은 전부 "스키마에 놓을 자리가 없어서" 생긴 손실이다 (MeasEval의 qualifier, IRCDL 2026의 binding, DTBench의 schema adherence).

- **셀 값을 튜플로**: Stage 3b 추출 JSON을 `{value, unit, condition, source_hint}`로 확장하고, Stage 3c 병합에서 `source_hint`·`condition`을 폐기하지 않고 `chat_generated_tables.metadata`(이미 evidence 구조 보유)에 셀 단위로 보존.
- **열 의미 타입 선언**: Stage 1 `table_spec.column_definitions`에 `semantic_type: "parameter" | "raw_data" | "condition"`을 추가(SemTab CTA에 해당). 3b 프롬프트에서 "parameter 열에 원시 데이터점 금지"를 타입 기반으로 강제하고, 3c에서 타입 불일치 값을 드롭.
- **조건 충돌 감지**: 병합 시 같은 열에 서로 다른 condition이 섞이면 열을 자동 분리하거나 condition 열을 파생(D1 직접 대응).
- **정화·NULL 규율**: 셀 밸리데이터(수치+단위 패턴, JSON 파편 감지)로 D4 파편 차단, 미발견 값은 "N/A" 고정 표기(backlog/16과 연계).
- **Guardian 항목 추가**: SCITAB식 표-주장 대조 + MeasHalu식 환각 유형 체크(단위·조건·값)로 Stage 4를 좁고 깊게.

### 경로 B — 중기: grounding 라이브러리 시험 도입 (몇 주)

근거: provenance(D3)는 사후 보존보다 추출 시점에 구조적으로 생성되는 편이 강건하다 (LangExtract char-offset, docling bbox).

- **LangExtract를 Stage 3b 대안 추출기로 A/B**: few-shot 예시로 물성+attributes(조건·단위) 스키마를 강제하고, 모든 추출물이 원문 문자 오프셋을 갖게 됨 → 셀→원문 하이라이트가 공짜. Ollama 백엔드로 기존 로컬 LLM 스택 유지. Apache-2.0. Python 사이드카는 기존 OCR 서버 패턴 재사용.
- **docling을 MinerU 보조 파서로 평가**: 표 셀 bbox provenance를 3a에 공급. MinerU 대비 표 구조 품질을 rag-table-eval(ADR 0007)로 비교 후 대체/병행 결정. MIT.
- 평가 축은 DTBench 유형학(충실성·충돌 해소)을 차용해 확장.

### 경로 C — 장기: '표 생성'에서 '측정 튜플 저장소'로 전환

근거: IRCDL 2026이 보인 대로 자유 병합은 구조 바인딩에서 체계적으로 실패한다. 병합을 없애는 것이 근본 해법.

- 추출 결과를 표가 아니라 **(물질, 물성, 값, 단위, 조건, 출처 span) 측정 튜플**로 DB에 적재(NIST AIF/ISODB 스키마, L2M3 속성 사전 참고). 비교 테이블은 튜플에 대한 질의·투영으로 생성 — 병합 단계의 의미 손실이 원천적으로 사라지고, 같은 튜플을 여러 테이블이 재사용.
- 흡착 도메인부터 파일럿: AIF 필드를 스키마로 채택하면 D1(조건)·D2(파라미터/원시점)가 스키마 수준에서 봉쇄된다. 이후 도메인 사전을 점진 확장.
- 축적된 ground-truth 검증 데이터는 Dagdelen식 로컬 모델 파인튜닝 자산으로 전환 가능.

## 4. 결함 4건 ↔ 자료 매핑

| 결함 | 직접 다루는 자료 | 처방 요지 |
|------|----------------|----------|
| D1 조건(qualifier) 혼입 | MeasEval(qualifier 스키마), IRCDL 2026(binding drift), ChemDataExtractor2(중첩 조건 모델), AIF(조건 필드) | 셀에 condition 필드 신설 + 병합 시 조건 충돌 감지 |
| D2 파라미터 vs 데이터점 | NIST AIF/ISODB(분리 스키마), SemTab CTA(열 의미 타입), L2M3(속성 사전), DTBench(스키마 준수) | 열 semantic_type 선언 + 타입 불일치 드롭 |
| D3 provenance 소실 | LangExtract(문자 오프셋 grounding), docling/PP-StructureV3(셀 bbox), paper-qa(인용 계약), DTBench(faithfulness) | source_hint를 병합 계약에 포함, 장기적으로 추출 시점 grounding |
| D4 파편 유입·오답 라벨 | MeasHalu(환각 유형 페널티), SCITAB(표-주장 검증), Dagdelen(스키마 출력 파인튜닝) | 셀 밸리데이터 + Guardian을 유형별 체크리스트로 |
