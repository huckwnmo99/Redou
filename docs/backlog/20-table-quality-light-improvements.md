# 테이블 품질 잔여 결함 6건 — 단순성 보존 해법 조사

> 상태: 💡 조사 완료 | 등록일: 2026-07-04 | 출처: fidelity eval 실측(67.4%, 골든 43셀) 후 잔여 결함 D-a~f 리서치
> 제약: **중간 계산 복잡화 금지** — 스테이지 추가·LLM 호출 증가를 피하고 ①결정적 코드 ②스키마/프롬프트 ③기존 스테이지 내 개선으로 해결

복잡도 등급: ◎ 코드만·스테이지 무추가 / ○ 프롬프트·스펙 수정 / △ LLM 호출 +1 / ✕ 스테이지 추가(권장 안 함)

## 요약

1. 6건 모두 **스테이지 추가 없이** 해결 가능 — 4건(D-b/c/d/e)은 결정적 코드, 2건(D-a/f)은 프롬프트·스펙 수정이 주 수단이다.
2. 최대 결손인 D-a(missing 14/43셀)는 "반복 엔티티의 완전 열거는 LLM의 알려진 약점"(LlamaIndex·LangExtract 공통 진단)이며, 처방은 열거 지시 강화 + 커버리지 카운터(코드)다. 무거운 처방(멀티패스)은 이미 tool-ab-adoption 슬라이스 04(A/B)로 계획돼 있어 중복 불요.
3. D-b는 이미 저장 중인 cellTuples.condition을 병합 단계에서 열로 펼치는 **순수 코드 pivot**(tidy data 원칙)으로 충분 — LLM 0회.
4. D-d는 RRF 후보 40개에서 논문별 최소 할당(quota floor)을 코드로 보장 — Elastic diversified sampler(per-field 상한)의 거울상 패턴.
5. 우선순위 top 3: **D-a(○) → D-b(◎) → D-f(○)** — 실측 eval 축(missing·conflictHandling)에 직결되면서 전부 스테이지 무추가.

---

## D-a. 커버리지/선택 편향 — 논문당 한 파라미터 세트만 추출 (missing 14/43)

**조사된 기법**
- LLM은 "반복되는 엔티티의 완전 열거(exhaustive enumeration)"에 구조적으로 약하다 — LlamaIndex는 이를 명시하고 세그먼트당 1~5개 엔티티로 나눠 추출하는 처방을 제시한다. https://www.llamaindex.ai/blog/extracting-repeating-entities-from-documents
- LangExtract(Google)는 같은 문제를 `extraction_passes=3` 멀티패스로 풀며 "Improves recall through multiple passes"를 공식 문서에 명시(Ollama 백엔드 지원 확인). https://github.com/google/langextract , https://developers.googleblog.com/introducing-langextract-a-gemini-powered-information-extraction-library/
- SciEx 프레임워크는 행 단위 이분 매칭(bipartite matching)으로 recall을 측정 — GPT-4o도 recall 0.476~0.609에 그쳐, "행 누락"이 보편적 실패 모드임을 확인. https://arxiv.org/html/2512.10004v2

**Redou 적용안** (Stage 1 스키마 + Stage 3b 프롬프트 + Stage 3c 코드)
1. (스키마) `ORCHESTRATOR_SCHEMA.table_spec`에 `completeness: "all_sets" | "representative"` enum 추가, 기본 `all_sets`. 오케스트레이터 프롬프트에 "사용자가 '대표만'이라 하지 않는 한 all_sets" 규칙 1줄 — "모든 세트 vs 대표만" 의도를 스펙으로 명문화.
2. (프롬프트) `EXTRACTION_AGENT_SYSTEM_PROMPT` 규칙 5를 열거-후-추출로 강화: "값을 쓰기 전에 이 논문에 존재하는 파라미터 세트(조건 조합: 온도×압력×모델×물질)를 먼저 세고, **세트마다 정확히 1행**을 출력하라. notes에 세트 수를 기재하라." (LlamaIndex 진단의 프롬프트판 — 세그먼트 분할 없이 열거를 명시적 서브태스크로 만듦)
3. (코드) `mergeExtractionResults`에서 논문별 `data_rows 수 vs 파싱 행렬(parsedMatrices) 행 수`를 `perPaperReasons`에 커버리지 지표로 기록 — 편향 재발을 결정적으로 관측(측정만, 동작 무변경).
4. (기계획 참조) 멀티패스(△, 호출 +N)는 `docs/tasks/tool-ab-adoption/planned/04`(LangExtract Stage 3b A/B)가 이미 심판 예정 — 여기서 중복 도입하지 않음.

**복잡도**: ○ (1·2) + ◎ (3) | **예상 효과**: missing 14 → 대폭 감소 = fidelity 67.4% 상승의 최대 지렛대

## D-b. 조건 열 부재 — 감지·기록만 하고 표에 파생하지 않음 (conflictHandling 0/2)

**조사된 기법**
- Tidy data 원칙(Wickham): "각 변수는 자기 열을 가진다" — 측정 조건은 변수이므로 셀 부속물이 아니라 **열**이어야 한다. 흔한 안티패턴이 "한 변수(조건)가 여러 열/셀 안에 숨는 것"이고, 교정은 pivot 계열의 결정적 재구조화다. https://r4ds.hadley.nz/data-tidy.html , https://cran.r-project.org/web/packages/tidyr/vignettes/tidy-data.html
- pivot_wider/longer는 전부 코드 변환 — LLM 개입 지점이 없다. https://tidyr.tidyverse.org/reference/pivot_wider.html

**Redou 적용안** (Stage 3c 병합, 순수 코드)
- `detectConditionConflicts`가 열 X의 조건 혼재를 잡으면(이미 구현·기록됨), **같은 자리에서 파생 열을 삽입**: `cellTuples[r][x].condition`을 값으로 갖는 "측정 조건" 열을 headers/rows/cellTuples에 나란히 추가(조건 없는 셀은 N/A). 데이터는 이미 저장돼 있으므로 LLM 0회·DB 무변경(headers/rows JSONB에 열 하나 추가일 뿐).
- 파생 열의 `column_semantic_types`는 "condition"으로 기록, `metadata.conditionConflicts`에 `derivedColumnIndex` 필드 추가 — 렌더러가 "자동 파생" 배지를 달 수 있게.
- 전제: 조건 튜플 충전율. D-f의 범위 규약과 기존 규칙 12(cell_meta.condition 의무)가 충전율을 올려 상호 보강.

**복잡도**: ◎ 코드만 | **예상 효과**: conflictHandling 0/2 → 작동, misattribution 예방(조건이 표면화되므로)

## D-c. 열 이름 grounding — 원문에 없는 지표명 발명 (예: MAPE→"R2")

**조사된 기법**
- Closed-world grounding: LLM 출력을 "원문에 실재하는(attested) 필드"로 제한하면 스키마 환각이 구조적으로 차단된다. https://arxiv.org/pdf/2606.05415 (Executable Schema Contracts)
- Anchor-constrained 추출: 먼저 원문에서 앵커(용어·값) 사전을 만들고 그 어휘 안에서만 생성 — provenance 부재가 환각의 근원이라는 진단. https://www.mdpi.com/2073-431X/15/3/178
- 통제 어휘(controlled vocabulary)를 프롬프트에 직접 넣어 열 헤더를 분류/제약하는 접근. https://arxiv.org/html/2403.00884v2

**Redou 적용안** (Stage 1 직후 결정적 검증 + 프롬프트 1줄)
1. (코드) plan 수신 직후: `column_definitions` 각 열의 기저 명칭(단위 괄호 제거, normalizeColumnKey 재사용)을 **캡션 어휘**(`loadTableSetup`이 이미 로드하는 tableCaptions) + keyword_hints와 대조. 미근거 열은 `metadata.columnGrounding: [{column, grounded: false}]`로 기록 — 오케스트레이터 규칙 7("캡션에 없는 파라미터 금지")을 소프트 지시에서 **검증 가능한 계약**으로 승격.
2. (코드, 더 강한 근거) Stage 3a 파싱 후 실제 원문 테이블 헤더 어휘로 재대조해 플래그 확정 → 렌더러가 미근거 헤더에 경고 표시.
3. (프롬프트) 규칙 7에 "지표 명칭은 캡션·원문 표기 그대로(축약·유사 지표로 재작명 금지)" + R²/MAPE 혼동 few-shot 1개.

**복잡도**: ◎ (1·2) + ○ (3) | **예상 효과**: 헤더 오명명으로 골든 셀이 열 매칭에 실패해 missing으로 새는 것 차단(fidelity 보전) + 사용자 오해 방지

## D-d. 다논문 chunks 쏠림 — 논문별 최소 할당 부재 (감사 B-R4)

**조사된 기법**
- MMR(관련성-다양성 균형 재순위)은 RAG 표준 후처리 — top-K가 유사 문서로 쏠리는 문제의 고전적 처방. https://www.elastic.co/search-labs/blog/maximum-marginal-relevance-diversify-results
- Elastic diversified sampler: `max_docs_per_value`로 **필드(=출처)당 문서 수를 제한**하는 검색엔진 내장 패턴 — "출처별 상한"이 산업 표준이면 그 거울상인 "출처별 하한(quota floor)"도 같은 결정적 연산이다. https://www.elastic.co/guide/en/elasticsearch/reference/current/search-aggregations-bucket-diversified-sampler-aggregation.html
- Vendi-RAG: 다양성-품질 트레이드오프를 명시적으로 조정하면 multi-hop QA 품질이 오른다는 2025 연구(무거운 구현은 불요, 방향 근거로). https://arxiv.org/pdf/2502.11228

**Redou 적용안** (Stage 2 `runMultiQueryRag` 반환 직전, 순수 코드)
- reranked 15개를 논문별 집계 → scope 논문 중 청크 0개인 논문은 RRF 후보 40(`rankedChunks`)에서 해당 논문 최상위 `PER_PAPER_MIN_CHUNKS`(기본 2)개를 끌어올려 편입. 후보 40 안에도 없으면 그 논문 한정 `match_chunks` 1회(DB RPC — LLM 아님)로 보충.
- 상수는 `rag/config.mjs`에 추가(기존 튜닝 상수 중앙화 원칙 그대로). Stage 3b가 per-paper 추출이므로 "논문당 컨텍스트 0" 자체가 사라짐.

**복잡도**: ◎ 코드만 (보충 검색도 DB 쿼리일 뿐) | **예상 효과**: 다논문 요청에서 특정 논문의 전멸(missing 행 전체) 예방 — 현 2편 eval에는 중립, 논문 수 확장 시 회귀 방어

## D-e. NULL 재검색 미약 — 30초 타임아웃 잦은 중단, 회수 0~2셀

**조사된 기법 / 판단 근거**
- 최근 RAG 연구의 합의는 "반복 검색 루프 추가"가 아니라 **필요할 때만·단일 패스로**: Adaptive-k는 반복 LLM 호출 없이 단일 패스 컨텍스트 선택으로 동급 성능을 보이고( https://arxiv.org/pdf/2506.08479 ), Adaptive RAG 라우팅 연구는 "검색이 이득일 때만 수행"을 경험 신호로 판단한다( https://arxiv.org/pdf/2604.03455 ). → 회수 기대값이 낮은 재검색은 **줄이는 쪽**이 문헌 방향과 일치.
- 코드 실측 근거: `NULL_RECOVERY_TIMEOUT_MS=30s`인데 내부 호출은 Stage 3b와 동일한 스키마·`num_ctx 131072` LLM 호출(`extractNullCellsFromPaper`) — Stage 3b엔 240s를 주면서 3d엔 30s만 주는 예산 비대칭이 중단의 직접 원인.

**Redou 적용안** (기존 Stage 3d 내부, 설정+게이트 코드 — 폐기보다 예산 재배분)
1. (게이트 강화) 회수 대상을 `column_semantic_types === "parameter"` 열의 null로 한정 + 논문당 기대 회수 셀 수 임계(예: ≥2) 미만이면 skip — 진입 자체를 줄여 총 지연 확보.
2. (예산 재배분) 논문별 30s 고정 대신 **스테이지 총 예산**(예: 90s)을 두고 진입 논문 수로 배분 — 시도하는 논문은 완주 가능하게, 총 지연은 상한 유지. 상수/env만.
3. (재측정 후 결정) 1·2 적용 후 fill-rate를 `agenticRecovery` 메타데이터(이미 기록 중)로 2주 관측 — 여전히 0~2셀이면 `REDOU_NULL_RECOVERY_OFF` 플래그로 스테이지 비활성이 정답(문헌 방향).

**복잡도**: ◎ 설정·코드만 | **예상 효과**: missing 소폭 감소 또는 (비활성 시) 파이프라인 지연 회수 — eval 축 직접 상승보다 시간 예산 회수가 주효과

## D-f. 조건 범위 표기 — 온도의존 파라미터의 T(K)가 N/A (원문 303–343 K)

**조사된 기법**
- MeasEval(SemEval-2021 Task 8): 측정치 주석 표준이 Quantity에 **value modifier**(범위 등)를 분류하고, 범위·조건류 문맥을 **Qualifier** span으로 별도 포착 — "단일 값이 아니면 범위+한정자"가 측정 추출의 표준 규약. https://aclanthology.org/2021.semeval-1.38/ , https://github.com/harperco/MeasEval
- AIF(Adsorption Information Format, IUPAC 프로젝트 2021-016-1-024): 등온선 데이터의 온도는 필수 메타데이터 필드 — 온도 없는 흡착 파라미터는 표준 위반. https://adsorptioninformationformat.com/ , https://pubs.acs.org/doi/10.1021/acs.langmuir.1c00122

**Redou 적용안** (Stage 3b 프롬프트 + 밸리데이터 테스트)
1. (프롬프트) `EXTRACTION_AGENT_SYSTEM_PROMPT`와 `ADSORPTION_EXTRACTION_HINT`에 범위 규약 1줄: "파라미터가 온도(또는 압력) **범위에서 피팅**된 값이면 T 열에 N/A 대신 `303–343` 형식의 범위를 기입하고, cell_meta.condition에 `fitted over 303–343 K`를 기록하라." + few-shot 예시 1개(ΔH·Arrhenius류).
2. (코드 확인) `validateCellValue`·`cleanCellValue`가 `303–343`(en-dash/hyphen) 값을 훼손·거부하지 않는지 단위 테스트 추가 — cleanCellValue의 숫자 정규식이 범위를 건드리지 않음을 고정.
3. (선택) `normalizeConditionKey`가 "303-343K" vs "303–343 K"를 동일 키로 접게 en/em-dash 정규화 1줄 — D-b 파생 열의 중복 조건 방지.

**복잡도**: ○ (프롬프트·스펙; 코드는 테스트 수준) | **예상 효과**: 실측 N/A였던 T(K) 셀 회복 → missing 감소, 조건 명시로 misattribution 예방. D-b의 조건 충전율도 동반 상승

---

## 우선순위 제안 Top 3 (효과 × 단순성)

| 순위 | 대상 | 복잡도 | 근거 |
|------|------|--------|------|
| 1 | **D-a 완전성 스펙 + 열거 프롬프트** | ○ (+◎ 지표) | missing 14/43이 fidelity 최대 결손 — 프롬프트·스키마만으로 최대 축 공략. 무거운 대안(멀티패스)은 슬라이스 04 A/B가 이미 심판 |
| 2 | **D-b 조건 열 코드 파생** | ◎ | 이미 저장 중인 cellTuples.condition 재사용, LLM 0회. 0점인 conflictHandling 축이 즉시 작동 |
| 3 | **D-f 범위 표기 규약** | ○ | 규칙 1줄+테스트로 실측 N/A 셀 즉시 회복. D-b의 조건 충전율까지 올리는 시너지 |

차순위: D-d(◎ — 효과가 현 43셀 eval에 안 잡히지만 다논문 방어로 가치), D-c(◎+○ — 헤더 신뢰), D-e(◎ — 게이트·예산 조정 후 재측정으로 존폐 결정).

세 항목 모두 스테이지 추가·LLM 호출 증가 없음. 착수 시 `/plan`으로 ledger 생성 후 진행(추출 프롬프트 변경은 `CURRENT_EXTRACTION_VERSION` 무관 — 채팅 파이프라인이므로 — 단, fidelity eval 재실행으로 전후 점수 비교 필수).
