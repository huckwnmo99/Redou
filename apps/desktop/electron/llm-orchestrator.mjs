// LLM Orchestrator Module — Multi-agent pipeline for Redou chat
// Orchestrator: analyzes intent, generates RAG queries, defines table spec
// Table Agent: extracts data from RAG results into structured tables

const OLLAMA_BASE_URL = process.env.OLLAMA_HOST || "http://localhost:11434";
const LLM_MODEL = process.env.REDOU_LLM_MODEL || "gpt-oss:120b";
const LLM_CTX = parseInt(process.env.REDOU_LLM_CTX, 10) || 131072;

function safeParseLlmJson(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[LLM] JSON parse failed (${context}):`, raw?.slice(0, 300));
    throw new Error(`LLM이 유효하지 않은 JSON을 반환했습니다 (${context}).`);
  }
}

// ============================================================
// JSON Schema — Orchestrator output
// ============================================================
const ORCHESTRATOR_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["clarify", "generate_table", "modify_table"],
    },
    clarification_response: { type: "string" },
    search_queries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          intent: { type: "string" },
        },
        required: ["query"],
      },
    },
    table_spec: {
      type: "object",
      properties: {
        title: { type: "string" },
        row_axis: { type: "string" },
        column_definitions: { type: "array", items: { type: "string" } },
        inclusion_criteria: { type: "string" },
        exclusion_criteria: { type: "string" },
      },
    },
    keyword_hints: { type: "array", items: { type: "string" } },
  },
  required: ["action"],
};

// ============================================================
// JSON Schema — Table Agent output (same as TABLE_JSON_SCHEMA in llm-chat.mjs)
// ============================================================
const TABLE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    headers: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    references: {
      type: "array",
      items: {
        type: "object",
        properties: {
          refNo: { type: "string" },
          paperId: { type: "string" },
          title: { type: "string" },
          authors: { type: "string" },
          year: { type: "integer" },
        },
        required: ["refNo", "paperId", "title", "authors", "year"],
      },
    },
    notes: { type: "string" },
  },
  required: ["title", "headers", "rows", "references"],
};

// ============================================================
// System Prompts
// ============================================================

const ORCHESTRATOR_SYSTEM_PROMPT = `당신은 "Redou"라는 로컬 논문 관리 앱의 **플래닝 에이전트**입니다.
사용자가 직접 수집한 연구 논문들이 데이터베이스에 저장되어 있습니다. 저작권 문제는 없습니다.

당신의 역할: 사용자의 요청을 분석하고, 최적의 검색 전략과 테이블 사양을 설계하는 것입니다.
실제 데이터 추출은 별도의 Agent들이 수행합니다. 당신은 계획만 세웁니다.

JSON으로 응답하세요. action 필드는 반드시 다음 중 하나:

**action = "clarify"** — 사용자의 요청을 더 정확히 이해하기 위해 질문
- clarification_response: 한국어로 명확화 질문 (2~4개, 번호 목록)
- **첫 번째 메시지에서는 반드시 clarify를 선택하세요.** 사용자의 의도를 정확히 파악해야 좋은 테이블을 만들 수 있습니다.
- 논문 목록을 참고하여 구체적인 질문을 하세요:
  - 비교 대상: "어떤 파라미터를 비교하고 싶으신가요?" (구체적 후보를 제시)
  - 데이터 범위: "특정 온도/압력/물질로 제한할까요?"
  - 테이블 구조: "행에 무엇을, 열에 무엇을 놓을까요?"
- 사용자가 "다 해줘" "알아서 해줘" 등 포괄적으로 답하면, 논문 제목에서 핵심 데이터 유형을 파악하여 2-3개 구체적 방향을 제안하세요.
- 사용자가 답변하여 충분한 정보가 모이면 generate_table로 전환하세요.
- 단, 사용자가 매우 구체적인 요청을 한 경우(열, 조건, 범위를 모두 명시)에는 바로 generate_table 가능.

**action = "generate_table"** — 충분한 정보가 있어 테이블 생성 가능 (보통 1~2회 clarify 후)
**action = "modify_table"** — 이전 테이블의 수정 요청

generate_table / modify_table일 때 반드시 포함:
- **search_queries**: 2~5개의 검색 쿼리. 각 쿼리는 데이터베이스에서 관련 텍스트를 찾기 위한 것.
  - 일반적인 요청을 그대로 복사하지 말고, **구체적인 과학 용어와 수치 파라미터명**을 사용하세요.
  - 다양한 각도로 검색: 파라미터명, 실험 조건, 물질명, 모델명
  - **"요약/비교 테이블"을 찾는 쿼리**를 반드시 1개 이상 포함 (시계열 raw data 말고 파라미터 테이블)
- **table_spec**: 테이블 사양
  - title: 테이블 제목
  - row_axis: 각 행이 무엇을 나타내는지
  - column_definitions: 열 목록 (아래 규칙 참조)
  - inclusion_criteria: 포함 조건
  - exclusion_criteria: 제외 조건
- **keyword_hints**: 검색 결과 재정렬용 핵심 키워드 (과학 용어, 물질명, 파라미터명)

=== column_definitions 설계 규칙 (매우 중요) ===

1. **4~8개로 유지.** 너무 적으면 정보 부족, 너무 많으면 N/A 투성이.
2. **각 열에 단위를 포함하세요.** 예: "T (K)", "P (kPa)", "α [-]"
3. **모호한 열 이름 금지:**
   ✗ "Kinetic Model & Parameters" — 무엇이 들어가는지 불명확
   ✗ "Rate Constant k (unit) ± Error" — 단위도 모호, 파라미터도 모호
   ✗ "Results" / "Data" / "Properties" — 너무 포괄적
   ✓ "α [-]" — 명확한 하나의 파라미터
   ✓ "D_app/R² [10⁻²·s⁻¹]" — 명확한 하나의 파라미터 + 단위
4. **열 1~2개는 식별 열** (Adsorbent, Gas 등), 나머지는 **수치 데이터 열.**
5. **Source / Paper / Reference 열을 넣지 마세요** — 셀 안에 [1], [2] 참조번호가 자동으로 붙습니다.
6. **논문 제목에서 추출 가능한 파라미터만 포함.** 추측하지 마세요.

=== search_queries 설계 규칙 ===

1. **파라미터 요약 테이블을 찾는 쿼리**: "kinetic parameters summary table α β D/R²" — 논문의 요약 테이블을 타겟
2. **시계열 raw data가 아닌 정리된 값**: "fitted parameters" "model parameters" "equilibrium constants"
3. **물질/조건별 검색**: "zeolite 13X CO2 adsorption parameters" 등 구체적
4. 각 쿼리는 영어로 작성 (논문이 영어이므로)

=== Few-shot 예시 ===

**예시 1**: 사용자 "zeolite kinetic 정리해줘" + "모든 것 다"
→ search_queries:
  - {query: "kinetic model fitting parameters alpha beta D/R² diffusivity zeolite", intent: "파라미터 요약 테이블"}
  - {query: "adsorption rate constant pseudo-first-order pseudo-second-order zeolite", intent: "속도 상수"}
  - {query: "intraparticle diffusion coefficient effective diffusivity adsorbent", intent: "확산 계수"}
→ table_spec:
  title: "Zeolite 흡착 Kinetic 파라미터 비교"
  row_axis: "물질-가스-온도-압력 조합별 데이터 포인트"
  column_definitions: ["Adsorbent", "Gas", "T (K)", "P (kPa)", "α [-]", "β [-]", "D_app/R² [10⁻²·s⁻¹]"]
  exclusion_criteria: "시계열 raw uptake 데이터 제외 (time vs uptake). 모델 피팅 파라미터만 포함"
→ keyword_hints: ["alpha", "beta", "d/r²", "diffusivity", "kinetic", "fitting", "parameter"]

**예시 2**: 사용자 "CO2 흡착 등온선 비교해줘"
→ search_queries:
  - {query: "CO2 adsorption isotherm parameters Langmuir Freundlich maximum capacity", intent: "등온선 모델 파라미터"}
  - {query: "CO2 uptake capacity mmol/g equilibrium temperature pressure", intent: "흡착량 데이터"}
→ table_spec:
  title: "CO₂ 흡착 등온선 파라미터 비교"
  row_axis: "물질-온도 조합별 등온선 파라미터"
  column_definitions: ["Adsorbent", "T (K)", "Model", "q_max (mmol/g)", "K_L (kPa⁻¹)", "n [-]", "R²"]
  exclusion_criteria: "raw isotherm 데이터포인트(P vs q) 제외. 피팅된 모델 파라미터만"
→ keyword_hints: ["langmuir", "freundlich", "q_max", "capacity", "isotherm", "fitting"]

**예시 3**: 사용자 "촉매 성능 비교해줘"
→ search_queries:
  - {query: "catalyst performance conversion selectivity yield reaction conditions", intent: "반응 성능 지표"}
  - {query: "turnover frequency TOF activation energy catalyst comparison", intent: "활성 비교"}
→ table_spec:
  title: "촉매 반응 성능 비교"
  row_axis: "촉매-반응조건 조합별"
  column_definitions: ["Catalyst", "Reaction", "T (°C)", "Conversion (%)", "Selectivity (%)", "TOF (h⁻¹)"]
  exclusion_criteria: "시간별 전환율 데이터 제외. 최종/최적 성능 지표만"
→ keyword_hints: ["conversion", "selectivity", "yield", "tof", "performance"]

규칙:
1. column_definitions 설계 규칙을 반드시 따르세요.
2. keyword_hints는 소문자 영어로 작성하세요.
3. 수정 요청(modify_table)이면 이전 테이블 정보를 참고하여 변경 사항만 반영하세요.
4. **row_axis는 세밀하게** (예: "물질-가스-온도-압력 조합마다 1행"). 데이터가 많이 추출되도록 유도.
5. **exclusion_criteria에 "시계열/raw data 제외"를 명시하세요** — 시간별 데이터, P vs q 원시 데이터포인트는 대부분 의미 없음. 피팅된 파라미터/요약값만 유용.`;

const TABLE_AGENT_SYSTEM_PROMPT = `당신은 "Redou"라는 로컬 논문 관리 앱의 **데이터 추출 에이전트**입니다.
사용자가 직접 수집한 논문의 텍스트가 아래에 제공됩니다. 저작권 문제가 없습니다.

당신의 역할: 주어진 **테이블 사양(table_spec)**에 따라 소스 데이터에서 수치를 추출하여 테이블을 채우는 것입니다.

**데이터 소스 우선순위:**
1. "=== OCR 추출 테이블 ===" — 논문 원본 테이블의 OCR 결과(HTML). **가장 정확하고 중요한 수치 소스.**
   - HTML <table> 태그 안의 각 <tr> 행을 출력 테이블의 행으로 변환하세요.
   - **OCR 테이블의 모든 데이터 행을 빠짐없이 추출하세요.** 요약하거나 대표값만 선택하지 마세요.
   - 예: OCR 테이블에 20행이 있으면 20행 모두 출력해야 합니다.
2. "=== 관련 텍스트 ===" — 텍스트 청크. 맥락 이해 및 보조 데이터용.

**핵심 원칙: 최대한 많은 데이터를 추출하세요.**
- 행 수를 줄이지 마세요. 데이터가 100행이면 100행을 출력하세요.
- 한 논문에만 집중하지 말고, **모든 논문의 관련 테이블에서 데이터를 수집**하세요.
- 같은 파라미터가 다른 조건(온도, 압력, 가스 종류)에서 측정되었으면 각각 별도의 행으로.

규칙:
1. **table_spec의 column_definitions를 headers로 사용하세요.** 열을 추가하거나 제거하지 마세요.
2. 소스에 명시된 수치를 **빠짐없이** 추출하세요. 추측 금지.
3. **참조 번호는 논문 목록 순서대로 [1], [2], [3]...을 사용하세요.** 논문 목록의 첫 번째 논문이 [1], 두 번째가 [2] 입니다.
   - 수치 데이터 셀에 해당 출처의 참조 번호를 붙이세요. 예: "0.0140 [1]"
   - 한 셀에 여러 출처면 여러 번호: "0.015 [1][3]"
4. 소스에 없는 데이터만 "N/A". N/A가 행의 절반 이상이면 해당 행을 제거.
5. **각 행에는 반드시 하나 이상의 수치 데이터가 있어야 합니다.**
6. headers에 UUID를 포함하지 마세요.
7. **references 필드는 필수입니다.** 데이터를 추출한 모든 논문을 포함하세요.
   - refNo는 "1", "2", "3" 등 순번 문자열
   - paperId는 논문 목록에 제공된 UUID를 그대로 복사
   - title, authors, year 모두 기입
8. inclusion_criteria와 exclusion_criteria를 엄격히 따르세요.
9. **수치와 단위는 원본 그대로 유지하세요.** 숫자를 변형하지 마세요:
   - 원본이 "303"이면 "303"으로, "303.15"이면 "303.15"로 그대로 출력
   - 앞에 불필요한 소수점을 붙이지 마세요 (예: ".303" ✗ → "0.303" 또는 "303" ✓)
   - 소수점 앞의 0을 생략하지 마세요 (예: ".25" ✗ → "0.25" ✓)
   - 숫자 뒤 불필요한 소수점 금지 (예: "303." ✗ → "303" ✓)
10. **OCR 테이블에서 colspan/rowspan으로 병합된 헤더는 각 데이터 행에 적절히 매핑하세요.** (예: "293.15 K" colspan 아래의 값들은 T=293.15K)`;

// ============================================================
// Orchestrator — intent analysis + RAG query generation
// ============================================================

/**
 * Run the Orchestrator agent to analyze user intent and plan the pipeline.
 * @param {Array<{role: string, content: string}>} history — conversation messages
 * @param {Array<{title: string, authors: string, year: number}>} paperList — available papers
 * @param {object} [previousTable] — previous generated table for modify_table context
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<{action: string, clarification_response?: string, search_queries?: object[], table_spec?: object, keyword_hints?: string[]}>}
 */
export async function generateOrchestratorPlan(history, paperList, previousTable, abortSignal) {
  let systemContent = ORCHESTRATOR_SYSTEM_PROMPT;

  if (paperList && paperList.length > 0) {
    const list = paperList
      .map((p, i) => `${i + 1}. ${p.title} — ${p.authors || "N/A"} (${p.year || "N/A"})`)
      .join("\n");
    systemContent += `\n\n=== 사용자의 논문 목록 (${paperList.length}편) ===\n${list}`;
  }

  if (previousTable) {
    systemContent += `\n\n=== 이전에 생성한 테이블 ===\n제목: ${previousTable.table_title || "N/A"}\n헤더: ${JSON.stringify(previousTable.headers)}\n행 수: ${previousTable.rows?.length || 0}`;
  }

  const messages = [
    { role: "system", content: systemContent },
    ...history,
  ];

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      stream: false,
      format: ORCHESTRATOR_SCHEMA,
      options: { num_ctx: LLM_CTX, temperature: 0.2 },
    }),
    signal: abortSignal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Orchestrator error (${res.status}): ${text}`);
  }

  const json = await res.json();
  const plan = safeParseLlmJson(json.message.content, "Orchestrator");

  // Validate required fields for generate/modify
  if ((plan.action === "generate_table" || plan.action === "modify_table") && (!plan.search_queries || plan.search_queries.length === 0)) {
    // Fallback: generate a basic search query from the last user message
    const lastUser = history.filter((m) => m.role === "user").pop();
    plan.search_queries = [{ query: lastUser?.content || "", intent: "primary_data" }];
  }

  return plan;
}

// ============================================================
// Table Agent — focused data extraction
// ============================================================

/**
 * Run the Table Agent to extract data from RAG results into a structured table.
 * @param {object} tableSpec — from Orchestrator: {title, row_axis, column_definitions, inclusion_criteria, exclusion_criteria}
 * @param {string} ragContext — assembled OCR tables + text chunks
 * @param {Array<{paperId: string, title: string, authors: string, year: number, journal: string}>} paperMetadata
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<{title: string, headers: string[], rows: string[][], references?: object[], notes?: string}>}
 */
export async function generateTableFromSpec(tableSpec, ragContext, paperMetadata, abortSignal) {
  const metaSection = paperMetadata
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title} — ${p.authors} (${p.year}), ${p.journal || "N/A"} [paperId: ${p.paperId}]`
    )
    .join("\n");

  const specSection = `=== 테이블 사양 (Table Spec) ===
제목: ${tableSpec.title || "자동 생성"}
행 축: ${tableSpec.row_axis || "각 데이터 포인트"}
열 정의: ${JSON.stringify(tableSpec.column_definitions || [])}
포함 조건: ${tableSpec.inclusion_criteria || "없음"}
제외 조건: ${tableSpec.exclusion_criteria || "없음"}`;

  const contextMessage = `${specSection}

=== 논문 목록 (references에 반드시 포함할 것) ===
아래 논문에서 데이터를 추출합니다. references 필드에 사용한 논문의 refNo, paperId, title, authors, year를 **반드시** 포함하세요.
${metaSection}

${ragContext}`;

  const messages = [
    { role: "system", content: TABLE_AGENT_SYSTEM_PROMPT },
    { role: "user", content: contextMessage },
  ];

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      stream: false,
      format: TABLE_OUTPUT_SCHEMA,
      options: { num_ctx: LLM_CTX, temperature: 0.1 },
    }),
    signal: abortSignal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Table Agent error (${res.status}): ${text}`);
  }

  const json = await res.json();
  return safeParseLlmJson(json.message.content, "TableAgent");
}

// ============================================================
// Extractor Agent — HTML table → clean matrix (fallback for code parser)
// ============================================================

const EXTRACTOR_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    headers: { type: "array", items: { type: "string" } },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
  },
  required: ["headers", "rows"],
};

const EXTRACTOR_SYSTEM_PROMPT = `You are a precise HTML table parser. Convert the given HTML <table> into a JSON object.

Output format:
- "headers": array of column header strings (flatten multi-row headers with " / " separator)
- "rows": array of arrays, each inner array is one data row

Rules:
1. Expand colspan/rowspan: each cell occupies exactly one position in the output grid.
2. Preserve ALL numbers EXACTLY as they appear. Do not round, convert, or modify any digit.
3. Strip HTML tags but keep text content.
4. Include ALL data rows — do not summarize, aggregate, or skip any row.
5. Empty cells should be empty strings "".
6. Multi-row headers: flatten into single header row using " / " separator.
   Example: "303K" (colspan group) + "uptake(5kPa)" → "303K / uptake(5kPa)"`;

/**
 * Fallback: use LLM to parse HTML table when code parser fails.
 * @param {string} htmlSnippet — raw HTML containing <table>
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<{headers: string[], rows: string[][]}>}
 */
export async function extractMatrixFromHtml(htmlSnippet, abortSignal) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: EXTRACTOR_SYSTEM_PROMPT },
        { role: "user", content: `Parse this HTML table:\n\n${htmlSnippet}` },
      ],
      stream: false,
      format: EXTRACTOR_OUTPUT_SCHEMA,
      options: { num_ctx: LLM_CTX, temperature: 0 },
    }),
    signal: abortSignal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Extractor Agent error (${res.status}): ${text}`);
  }

  const json = await res.json();
  return safeParseLlmJson(json.message.content, "ExtractorAgent");
}

// (Mapper Agent removed — Table Agent handles column mapping directly)

// ============================================================
// Exports
// ============================================================

export {
  ORCHESTRATOR_SCHEMA,
  TABLE_OUTPUT_SCHEMA,
  EXTRACTOR_OUTPUT_SCHEMA,
  ORCHESTRATOR_SYSTEM_PROMPT,
  TABLE_AGENT_SYSTEM_PROMPT,
  EXTRACTOR_SYSTEM_PROMPT,
};
