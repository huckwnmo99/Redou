/**
 * LangExtract sidecar client — MEASUREMENT ONLY (tool-ab-adoption slice 04).
 *
 * Talks to the LangExtract Stage-3b sidecar (apps/langextract-server, port 8012)
 * and normalizes its response so the A/B harness (scripts/ab-langextract.mjs) can
 * compare the CURRENT Stage 3b (SRAG per-paper extraction) vs LangExtract on the
 * same paper text, scored by the SAME table_fidelity eval.
 *
 * NOT wired into the production chat/extraction pipeline. main.mjs /
 * chat/table-pipeline.mjs / chat/table-extraction.mjs are untouched; nothing here
 * runs during a real chat/table request. This module exists only so the A/B script
 * can drive LangExtract output and quantify its char-offset grounding (D3).
 *
 * Sidecar: POST /extract { text, prompt_description, examples[], model_id? } →
 *          { extractions:[{property,value,unit,condition,char_start,char_end,
 *            alignment_status,...}], grounded_extractions, ... }.
 * Port: 8012 (REDOU_LANGEXTRACT_URL).
 */

const LANGEXTRACT_BASE = process.env.REDOU_LANGEXTRACT_URL || "http://localhost:8012";
const LANGEXTRACT_TIMEOUT_MS = 600_000; // 10분 (LLM 백엔드 왕복 상한, MinerU/docling과 동일)

// ─── Health Check ───────────────────────────────────────────────

/** docling-client의 isDoclingAvailable()·mineru-client의 isMineruAvailable()과 대칭. */
export async function isLangExtractAvailable() {
  try {
    const res = await fetch(LANGEXTRACT_BASE + "/health", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    // /health returns status:"error" when the wheel failed to import — treat as down.
    const body = await res.json().catch(() => ({}));
    return body?.status !== "error";
  } catch {
    return false;
  }
}

// ─── 추출 ───────────────────────────────────────────────────────

/**
 * 논문 텍스트 → LangExtract 물성/조건 추출(각 추출물에 원문 char offset).
 * @param {string} text — 추출 대상 원문(청크 결합 또는 표 TSV).
 * @param {object} [opts]
 * @param {string} [opts.promptDescription]
 * @param {Array}  [opts.examples] — few-shot ExampleData(JSON): { text, extractions:[{extraction_class,extraction_text,attributes}] }
 * @param {string} [opts.modelId] — Ollama 모델(기본은 서버가 gemma4:31b).
 * @param {number} [opts.maxCharBuffer]
 * @param {number} [opts.extractionPasses]
 * @returns {Promise<{
 *   extractions: { extractionClass:string, extractionText:string, property:string,
 *     value:string, unit:string, condition:string, attributes:object,
 *     charStart:number|null, charEnd:number|null, alignmentStatus:string }[],
 *   numExtractions:number, groundedExtractions:number, modelId:string,
 *   langextractVersion:string, serverProcessingTime:number, processingTime:number
 * }>}
 */
export async function extractLangExtract(text, opts = {}) {
  const t0 = Date.now();

  const payload = {
    text: String(text ?? ""),
    prompt_description: opts.promptDescription ?? "",
    examples: Array.isArray(opts.examples) ? opts.examples : [],
  };
  if (opts.modelId) payload.model_id = opts.modelId;
  if (Number.isFinite(opts.maxCharBuffer)) payload.max_char_buffer = opts.maxCharBuffer;
  if (Number.isFinite(opts.extractionPasses)) payload.extraction_passes = opts.extractionPasses;

  const res = await fetch(LANGEXTRACT_BASE + "/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(LANGEXTRACT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`langextract API error ${res.status}: ${errText}`);
  }

  const raw = await res.json();
  const rawExtractions = Array.isArray(raw.extractions) ? raw.extractions : [];
  const extractions = rawExtractions.map((e) => ({
    extractionClass: String(e.extraction_class ?? ""),
    extractionText: String(e.extraction_text ?? ""),
    property: String(e.property ?? ""),
    value: String(e.value ?? ""),
    unit: String(e.unit ?? ""),
    condition: String(e.condition ?? ""),
    attributes: e.attributes && typeof e.attributes === "object" ? e.attributes : {},
    charStart: e.char_start ?? null,
    charEnd: e.char_end ?? null,
    alignmentStatus: String(e.alignment_status ?? ""),
  }));

  return {
    extractions,
    numExtractions: Number(raw.num_extractions ?? extractions.length),
    groundedExtractions: Number(raw.grounded_extractions ?? extractions.filter((e) => e.charStart != null).length),
    modelId: String(raw.model_id ?? ""),
    langextractVersion: String(raw.langextract_version ?? "unknown"),
    serverProcessingTime: Number(raw.processing_time_ms ?? 0),
    processingTime: Date.now() - t0,
  };
}

// ─── A/B 스키마 (흡착 물성+조건, few-shot) ──────────────────────
//
// LangExtract few-shot examples aligned with the adsorption domain dictionary
// (chat/adsorption-domain.mjs — NIST AIF fields: q_sat/q_max, K_L, K_F, n,
// Henry, ΔH; conditions = T / pressure range / adsorbent / adsorbate / model).
// Kept here (not in the domain module) because it is A/B-only. The schema mirrors
// the fidelity fixture's {identity, column(=property), value, unit, condition}
// shape so the A/B can fold LangExtract output into a table and score it with the
// SAME table_fidelity eval as the current pipeline.
//
// This is the D1(qualifier=condition)·D2(parameter vs data-point via property
// naming) test: does forcing property/value/unit/condition at EXTRACTION time
// keep the pressure-range condition on each q_m the way the fixture requires?

export const ADSORPTION_PROMPT_DESCRIPTION =
  "Extract gas-adsorption isotherm PARAMETERS (fitted/summary values), not raw " +
  "isotherm data points. For each parameter, capture: property (e.g. q_m / " +
  "q_max saturation capacity, K_L Langmuir affinity, K_F Freundlich, n " +
  "heterogeneity exponent, Henry constant, isosteric heat ΔH, MAPE error), value " +
  "(the number, exactly as printed), unit, and condition. The condition MUST " +
  "identify the measurement context that distinguishes otherwise-identical " +
  "parameters: the adsorbent, the adsorbate/gas, the temperature, and ESPECIALLY " +
  "the pressure range the parameter was fitted over (e.g. '<=1000 kPa' vs " +
  "'<=100 kPa', '~600 kPa' vs '~100 kPa'). Use the exact text from the source; " +
  "do not paraphrase, translate, or overlap extractions.";

export const ADSORPTION_EXAMPLES = [
  {
    text:
      "Table 3. Langmuir isotherm parameters (pressures <=1000 kPa). For KACa, " +
      "CO2 at 293.15 K the saturation capacity qm,L = 8.69 mol/kg and the " +
      "affinity constant K_L = 0.42 1/kPa. At 100 kPa (Table 4) the same KACa " +
      "CO2 293.15 K qm,L = 4.45 mol/kg.",
    extractions: [
      {
        extraction_class: "parameter",
        extraction_text: "8.69",
        attributes: {
          property: "q_m",
          value: "8.69",
          unit: "mol/kg",
          condition: "KACa, CO2, 293.15 K, <=1000 kPa",
        },
      },
      {
        extraction_class: "parameter",
        extraction_text: "0.42",
        attributes: {
          property: "K_L",
          value: "0.42",
          unit: "1/kPa",
          condition: "KACa, CO2, 293.15 K, <=1000 kPa",
        },
      },
      {
        extraction_class: "parameter",
        extraction_text: "4.45",
        attributes: {
          property: "q_m",
          value: "4.45",
          unit: "mol/kg",
          condition: "KACa, CO2, 293.15 K, <=100 kPa",
        },
      },
    ],
  },
  {
    text:
      "Table 4. Dual-site Langmuir (DSL) and Sips parameters for ethane on " +
      "zeolite 13X. Over ~600 kPa the DSL saturation capacity qm1 = 2.400 mol/kg " +
      "with MAPE = 16.585 %; refit over ~100 kPa gives qm1 = 2.328 mol/kg, MAPE = 8.242 %.",
    extractions: [
      {
        extraction_class: "parameter",
        extraction_text: "2.400",
        attributes: {
          property: "q_m",
          value: "2.400",
          unit: "mol/kg",
          condition: "Ethane, DSL, ~600 kPa",
        },
      },
      {
        extraction_class: "parameter",
        extraction_text: "16.585",
        attributes: {
          property: "MAPE",
          value: "16.585",
          unit: "%",
          condition: "Ethane, DSL, ~600 kPa",
        },
      },
      {
        extraction_class: "parameter",
        extraction_text: "2.328",
        attributes: {
          property: "q_m",
          value: "2.328",
          unit: "mol/kg",
          condition: "Ethane, DSL, ~100 kPa",
        },
      },
    ],
  },
];

// ─── 그라운딩: char offset → Redou 청크 좌표 매핑 ───────────────

/**
 * LangExtract char offset(제출 텍스트 기준)를 Redou 청크(startCharOffset 기반,
 * mineru-client buildChunks)로 매핑 — 셀→원문 하이라이트 활용성(D3)의 전제.
 *
 * 제출 텍스트가 청크들을 순서대로 연결한 것일 때, 각 청크가 연결 텍스트에서 차지하는
 * [절대 시작, 끝) 구간을 알면 추출물의 char offset이 어느 청크에 떨어지는지 역산된다.
 * A/B 스크립트는 (a) 청크를 `separator`로 이어 붙여 서버에 넣고 (b) 이 함수로 각
 * 추출물을 청크로 되돌려 grounding 정밀도(청크 적중률)를 측정한다.
 *
 * @param {number|null} charStart — 추출물의 제출 텍스트 내 시작 오프셋.
 * @param {{ chunkOrder:number, startCharOffset:number, absStart:number, absEnd:number }[]} chunkSpans
 *   — 각 청크의 연결 텍스트 내 절대 구간(absStart/absEnd). buildChunkSpans로 생성.
 * @returns {{ chunkOrder:number|null, offsetInChunk:number|null }}
 */
export function mapOffsetToChunk(charStart, chunkSpans) {
  if (charStart == null || !Array.isArray(chunkSpans)) return { chunkOrder: null, offsetInChunk: null };
  for (const span of chunkSpans) {
    if (charStart >= span.absStart && charStart < span.absEnd) {
      return {
        chunkOrder: span.chunkOrder,
        // 원 청크(startCharOffset 좌표계) 내 상대 오프셋으로 환산.
        offsetInChunk: (span.startCharOffset ?? 0) + (charStart - span.absStart),
      };
    }
  }
  return { chunkOrder: null, offsetInChunk: null };
}

/**
 * 청크 배열을 지정 separator로 연결한 텍스트와, 각 청크의 절대 구간 스팬을 만든다.
 * A/B 스크립트가 LangExtract 입력 텍스트와 grounding 역매핑 좌표를 동시에 얻는다.
 *
 * @param {{ chunkOrder?:number, text:string, startCharOffset?:number }[]} chunks
 * @param {string} [separator] — 청크 사이 구분자(기본 "\n\n").
 * @returns {{ text:string, spans:{ chunkOrder:number, startCharOffset:number, absStart:number, absEnd:number }[] }}
 */
export function buildChunkSpans(chunks, separator = "\n\n") {
  const list = Array.isArray(chunks) ? chunks : [];
  const spans = [];
  let cursor = 0;
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const text = String(c.text ?? "");
    const absStart = cursor;
    const absEnd = absStart + text.length;
    spans.push({
      chunkOrder: c.chunkOrder ?? i + 1,
      startCharOffset: c.startCharOffset ?? 0,
      absStart,
      absEnd,
    });
    parts.push(text);
    cursor = absEnd + separator.length;
  }
  return { text: parts.join(separator), spans };
}
