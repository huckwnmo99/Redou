export function extractKeyTerms(text) {
  const terms = new Set();
  const source = String(text || "");
  const alphaNum = source.match(/[a-zA-Z]+\d+[a-zA-Z]*/gi) || [];
  alphaNum.forEach((term) => terms.add(term.toLowerCase()));
  const numAlpha = source.match(/\d+[a-zA-Z]+/gi) || [];
  numAlpha.forEach((term) => terms.add(term.toLowerCase()));
  const engWords = source.match(/[a-zA-Z]{4,}/gi) || [];
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "been",
    "have", "has", "had", "will", "would", "could", "should", "about", "which", "their",
    "data", "table", "paper", "make", "please", "want", "need", "also", "than", "them",
    "into", "some", "each", "other", "more", "most", "only", "very", "both", "such",
  ]);
  engWords.forEach((term) => {
    const lower = term.toLowerCase();
    if (!stopWords.has(lower)) terms.add(lower);
  });
  return [...terms];
}

export function sanitizeColumnNames(columns) {
  if (!Array.isArray(columns)) return columns;
  const replacements = [
    [/²/g, "2"],
    [/³/g, "3"],
    [/⁻¹/g, "-1"],
    [/⁻/g, "-"],
    [/⁰/g, "0"],
    [/¹/g, "1"],
    [/⁴/g, "4"],
    [/⁵/g, "5"],
    [/⁶/g, "6"],
    [/⁷/g, "7"],
    [/⁸/g, "8"],
    [/⁹/g, "9"],
    [/₀/g, "0"],
    [/₁/g, "1"],
    [/₂/g, "2"],
    [/₃/g, "3"],
    [/₄/g, "4"],
    [/°/g, "deg"],
    [/±/g, "+-"],
    [/×/g, "x"],
    [/·/g, "."],
    [/α/g, "alpha"],
    [/β/g, "beta"],
    [/γ/g, "gamma"],
    [/δ/g, "delta"],
    [/Δ/g, "Delta"],
    [/μ/g, "mu"],
    [/π/g, "pi"],
  ];
  return columns.map((column) => {
    let value = String(column);
    for (const [regex, replacement] of replacements) value = value.replace(regex, replacement);
    return value;
  });
}

export function normalizeColumnKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\s_\-\(\)\[\]{}.,;:/\\]+/g, "")
    .trim();
}

// Phase 1 (table-semantics-hardening D4): the "N/A" sentinel a cell falls back to
// when its raw value is rejected as a fragment. Exported so callers (merge) and
// tests share a single source of truth.
export const CELL_NA = "N/A";

// Max plausible length for a single scientific table cell. Values longer than this
// are almost always a leaked JSON blob / concatenated fragment, not a real datum.
const MAX_CELL_LENGTH = 60;

// Control characters (excluding normal whitespace \t\n\r) never appear in a
// legitimate cell: \x00-\x08, \x0b-\x0c, \x0e-\x1f, \x7f.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/**
 * Validate a raw cell value before it is written into the merged table (D4).
 *
 * The per-paper extraction LLM occasionally leaks JSON fragments into a cell —
 * e.g. the E2E-observed `" uma T (K) : \"308.15\",  "` — which then render as a
 * plausible-looking but wrong label. This gate blocks such fragments so the cell
 * falls back to the "N/A" sentinel (and stays a Stage 3d recovery target) instead
 * of surfacing a fabricated value.
 *
 * Blocks: embedded double-quotes / curly braces (JSON structure), `key : value`
 * fragment signatures, control characters, and over-length blobs. Passes: pure
 * numbers, numbers with units, reference tags like "5.05 [1]", model/material
 * names, and the "N/A" sentinel.
 *
 * @param {unknown} raw
 * @returns {{ ok: boolean, cleaned: string, reason?: string }}
 */
export function validateCellValue(raw) {
  if (raw === null || raw === undefined) {
    return { ok: true, cleaned: CELL_NA };
  }
  if (typeof raw !== "string") {
    // Numbers/booleans coerced by the LLM — accept the string form.
    return { ok: true, cleaned: String(raw) };
  }

  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === CELL_NA) {
    return { ok: true, cleaned: CELL_NA };
  }

  if (CONTROL_CHAR_RE.test(trimmed)) {
    return { ok: false, cleaned: CELL_NA, reason: "control_char" };
  }
  if (trimmed.length > MAX_CELL_LENGTH) {
    return { ok: false, cleaned: CELL_NA, reason: "too_long" };
  }
  // JSON structural residue: a real cell never contains a double-quote or a brace.
  if (/["{}]/.test(trimmed)) {
    return { ok: false, cleaned: CELL_NA, reason: "json_fragment" };
  }
  // `key : value` fragment signature — text with a colon flanked by whitespace,
  // then more content. Legit ratios like "1:2" or times like "12:30" have no
  // spaces around the colon, so they pass.
  if (/\s:\s|\s:|:\s/.test(trimmed) && /[a-zA-Z]/.test(trimmed)) {
    return { ok: false, cleaned: CELL_NA, reason: "kv_fragment" };
  }

  return { ok: true, cleaned: trimmed };
}
