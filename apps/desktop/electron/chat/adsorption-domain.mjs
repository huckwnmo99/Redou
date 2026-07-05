// Adsorption domain dictionary (Phase 1, table-semantics-hardening D2)
// ============================================================
// A small, self-contained domain module (ADR 0002 module ownership) that lets the
// table pipeline apply adsorption-specific extraction rules WITHOUT hard-coding
// domain knowledge in the generic pipeline. Everything here is gated behind
// `detectAdsorptionDomain()` so non-adsorption papers are completely unaffected.
//
// Grounded in NIST AIF (Adsorption Information File) / ISODB conventions: an
// isotherm is a set of raw (pressure, loading) points, distinct from the *fitted*
// parameters (saturation capacity, affinity constant, heterogeneity exponent,
// enthalpy) derived from them. Conflating the two is defect D2.

// ------------------------------------------------------------
// Domain detection
// ------------------------------------------------------------

// Signals that a table spec / paper is about gas adsorption. Lower-cased,
// substring-matched against column names, title, and (optionally) captions.
const ADSORPTION_SIGNALS = [
  "isotherm",
  "adsorb",
  "adsorption",
  "adsorbent",
  "adsorbate",
  "uptake",
  "loading",
  "langmuir",
  "freundlich",
  "toth",
  "sips",
  "q_max",
  "qmax",
  "q_sat",
  "qsat",
  "q_m",
  "mmol/g",
  "mmol g",
  "mol/kg",
  "cm3/g",
  "breakthrough",
  "selectivity",
  "henry constant",
  "heat of adsorption",
  "isosteric",
];

// Minimum number of distinct signals required to treat the spec as adsorption.
// Kept conservative (>= 2) so a lone word like "selectivity" or "loading" in an
// unrelated (e.g. catalysis) table does not trip the domain (risk R-4).
const DETECTION_THRESHOLD = 2;

/**
 * Decide whether a table spec (and optional paper metadata) is in the gas-adsorption
 * domain. Returns true only when at least DETECTION_THRESHOLD distinct signals appear.
 *
 * @param {object} [tableSpec] — { title?, row_axis?, column_definitions?, inclusion_criteria?, exclusion_criteria? }
 * @param {object} [paperMetadata] — { title?, captions?: string[] } (optional extra text)
 * @returns {boolean}
 */
export function detectAdsorptionDomain(tableSpec, paperMetadata) {
  const parts = [];
  if (tableSpec) {
    if (typeof tableSpec.title === "string") parts.push(tableSpec.title);
    if (typeof tableSpec.row_axis === "string") parts.push(tableSpec.row_axis);
    if (typeof tableSpec.inclusion_criteria === "string") parts.push(tableSpec.inclusion_criteria);
    if (typeof tableSpec.exclusion_criteria === "string") parts.push(tableSpec.exclusion_criteria);
    if (Array.isArray(tableSpec.column_definitions)) {
      for (const col of tableSpec.column_definitions) parts.push(String(col ?? ""));
    }
  }
  if (paperMetadata) {
    if (typeof paperMetadata.title === "string") parts.push(paperMetadata.title);
    if (Array.isArray(paperMetadata.captions)) {
      for (const cap of paperMetadata.captions) parts.push(String(cap ?? ""));
    }
  }

  const haystack = parts.join(" ┃ ").toLowerCase();
  if (!haystack.trim()) return false;

  const matched = new Set();
  for (const signal of ADSORPTION_SIGNALS) {
    if (haystack.includes(signal)) matched.add(signal);
    if (matched.size >= DETECTION_THRESHOLD) return true;
  }
  return false;
}

// ------------------------------------------------------------
// AIF field taxonomy — parameter vs raw_data separation (D2 answer schema)
// ------------------------------------------------------------

/**
 * NIST-AIF-inspired field taxonomy. `parameters` are single fitted/summary values;
 * `rawData` are per-point measurements that must NOT be poured into a parameter
 * column; `conditions` identify the measurement context. Used to build the prompt
 * hint and as a reference for semantic-type judgement.
 */
export const ADSORPTION_AIF_FIELDS = {
  parameters: [
    "q_sat / q_max (saturation capacity)",
    "K_L (Langmuir affinity constant)",
    "K_F (Freundlich constant)",
    "n (heterogeneity exponent)",
    "b (affinity)",
    "Henry constant",
    "isosteric heat of adsorption / enthalpy (ΔH)",
    "selectivity (single fitted value)",
  ],
  rawData: [
    "pressure point (P)",
    "loading / uptake at a given pressure q(P)",
    "time-series uptake q(t)",
    "individual isotherm data point (P, q)",
  ],
  conditions: [
    "temperature (T)",
    "pressure range",
    "adsorbent / material",
    "adsorbate / gas",
    "isotherm model name (Langmuir / Freundlich / Toth / Sips)",
  ],
};

// A compact prompt snippet appended to the per-paper extraction prompt ONLY when the
// domain is detected. Keeps the generic prompt untouched for non-adsorption papers.
export const ADSORPTION_EXTRACTION_HINT = `\n\n=== 흡착(adsorption) 도메인 추가 규칙 (NIST AIF 기준) ===
이 표는 기체 흡착 데이터입니다. 다음을 엄격히 구분하세요:
- **피팅 파라미터(parameter)** — 포화 용량 q_sat/q_max, Langmuir K_L, Freundlich K_F, 불균일지수 n, Henry 상수, 등임율적 흡착열(ΔH). 각각 **하나의 대표값**만 있습니다.
- **원시 데이터(raw_data)** — 압력별 흡착량 q(P), 시계열 uptake q(t), 개별 등온선 점 (P, q).
- **규칙: q_max·K_L 같은 파라미터 열에 압력별 q(P) 원시점을 채우지 마세요.** 피팅된 요약값과 원시 측정점은 서로 다릅니다.
- **압력 범위별 세트를 각각 행으로.** 같은 물질·모델이라도 저압 피팅(예: ≤100 kPa)과 전 범위 피팅(예: ≤1000 kPa)은 **서로 다른 파라미터 세트**입니다. 한 세트만 고르지 말고 각 압력 범위 세트를 별개의 행으로 출력하세요.
- **온도 범위에서 피팅된 파라미터(ΔH, 등임율적 흡착열, Arrhenius류 등)는 T 열에 단일 값 대신 범위를 "303–343" 형식으로 쓰고 cell_meta.condition에 "fitted over 303–343 K"를 기록하세요.** 온도의존 값을 null로 버리지 마세요.
- 각 값이 측정된 온도·압력 범위가 있으면 cell_meta.condition에 기입하세요 (예: "at 298 K", "0-100 kPa").`;

/**
 * Build the domain-conditional prompt hint. Returns "" when not in the adsorption
 * domain so the caller can unconditionally append the result with no effect.
 *
 * @param {object} [tableSpec]
 * @param {object} [paperMetadata]
 * @returns {string}
 */
export function buildAdsorptionPromptHint(tableSpec, paperMetadata) {
  return detectAdsorptionDomain(tableSpec, paperMetadata) ? ADSORPTION_EXTRACTION_HINT : "";
}

// ------------------------------------------------------------
// Unit normalization (additive — never mutates the original cell value)
// ------------------------------------------------------------

// Loading/capacity conversions expressed as a factor into a canonical base unit.
// Canonical loading base: mmol/g. Canonical pressure base: kPa.
const LOADING_TO_MMOL_G = {
  "mmol/g": 1,
  "mmolg": 1,
  "mmol g-1": 1,
  "mol/kg": 1, // 1 mol/kg = 1 mmol/g (both are amount-of-substance per mass)
  "molkg": 1,
  "mmol/kg": 0.001,
};

const PRESSURE_TO_KPA = {
  kpa: 1,
  pa: 0.001,
  bar: 100,
  mbar: 0.1,
  atm: 101.325,
  mmhg: 0.133322,
  torr: 0.133322,
};

function canonicalUnitKey(unit) {
  return String(unit ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/⁻¹/g, "-1")
    .trim();
}

/**
 * Compute a canonical-unit companion for an adsorption value. Does NOT change the
 * caller's original value/unit; returns a small object the caller can stash next to
 * the cell tuple. Returns null when the unit is unknown or the value is non-numeric.
 *
 * @param {string|number} value
 * @param {string} unit
 * @returns {{ canonicalValue: number, canonicalUnit: string } | null}
 */
export function normalizeAdsorptionUnit(value, unit) {
  const num = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(/[^\d.eE+-]/g, ""));
  if (!Number.isFinite(num)) return null;

  const key = canonicalUnitKey(unit);
  if (key in LOADING_TO_MMOL_G) {
    return { canonicalValue: num * LOADING_TO_MMOL_G[key], canonicalUnit: "mmol/g" };
  }
  if (key in PRESSURE_TO_KPA) {
    return { canonicalValue: num * PRESSURE_TO_KPA[key], canonicalUnit: "kPa" };
  }
  return null;
}
