// Value back-matching verifier (table-semantics-hardening Phase 2, slice 02).
//
// Makes Stage 4 verification *deterministic* where possible. Stage 3a already
// parsed the OCR tables into `parsedMatrices` — the numeric values the LLM later
// copied into the generated table literally exist in those matrices. So for a
// large fraction of cells we can re-find ("back-match") the value in code and
// mark it "code-verified" without asking the LLM at all. Only cells we cannot
// find in any parsed matrix are handed to the Guardian (LLM), and there only with
// narrow MeasHalu-typed questions (unit / condition / value fabrication).
//
// This module is pure (no DB, no LLM, no I/O). See
// docs/tasks/table-semantics-hardening/planned/02_2026-07-03_value-backmatch-guardian-narrowing.md

/**
 * Normalize a raw cell/matrix value to a bare numeric string for exact matching.
 *
 * Strips reference tags ("[1]"), surrounding units, and whitespace, then extracts
 * the first numeric token (optionally signed, decimal, or scientific). Examples:
 *   "8.69 [1]"   -> "8.69"
 *   "25 mg"      -> "25"
 *   "-1.2e-3"    -> "-1.2e-3" (lowercased exponent)
 *   "N/A"        -> null
 *   "Langmuir"   -> null
 *
 * Exact-match philosophy (assumption A): we do NOT approximate. If the generated
 * cell and the parsed matrix disagree even slightly, back-match returns none and
 * the cell falls through to Guardian — a safe (under-verify, never over-verify)
 * direction. Numeric-token extraction only tolerates the reference tag and a
 * trailing/leading unit, which the E2E ground-truth confirmed line up digit-for-digit.
 *
 * @param {unknown} raw
 * @returns {string | null} bare numeric string, or null when non-numeric
 */
export function normalizeNumericValue(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw);
  // Drop bracketed reference tags first so "8.69 [1]" -> "8.69 ".
  const withoutRefs = text.replace(/\[\d+\]/g, " ");
  // First signed/decimal/scientific number token. Thousands separators are NOT
  // assumed (scientific tables rarely use them and a comma is ambiguous).
  const match = withoutRefs.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (!match) return null;
  return match[0].toLowerCase();
}

/**
 * Extract the "table N" numeric token from a caption or source_hint so the two
 * can be compared (assumption B). Handles "Table 3", "TABLE 3.", "Table 3: ...",
 * "Tab. 3", etc. Returns null when no table number is present (e.g. a figure
 * caption or a free-form hint), which makes the caller fall back to any-matrix scope.
 *
 * @param {unknown} text
 * @returns {string | null} e.g. "3", or null
 */
export function extractTableToken(text) {
  if (text === null || text === undefined) return null;
  const match = String(text).toLowerCase().match(/tab(?:le|\.)?\s*(\d+)/);
  return match ? match[1] : null;
}

/**
 * Build an index of every parsed-matrix numeric value for back-matching.
 *
 * @param {Array<{tables: Array<{caption?: string, rows: string[][]}>}>|null|undefined} parsedMatrices
 * @returns {{ byTable: Map<string, Set<string>>, all: Set<string> }}
 *   byTable: table-number token ("3") -> Set of normalized values in that table
 *   all:     every normalized value across all matrices
 */
export function buildMatrixValueIndex(parsedMatrices) {
  const byTable = new Map();
  const all = new Set();
  if (!Array.isArray(parsedMatrices)) return { byTable, all };

  for (const pm of parsedMatrices) {
    const tables = Array.isArray(pm?.tables) ? pm.tables : [];
    for (const table of tables) {
      const tableToken = extractTableToken(table?.caption);
      let bucket = null;
      if (tableToken) {
        bucket = byTable.get(tableToken);
        if (!bucket) {
          bucket = new Set();
          byTable.set(tableToken, bucket);
        }
      }
      const rows = Array.isArray(table?.rows) ? table.rows : [];
      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) {
          const value = normalizeNumericValue(cell);
          if (value === null) continue;
          all.add(value);
          if (bucket) bucket.add(value);
        }
      }
    }
  }

  return { byTable, all };
}

/**
 * Back-match a single generated cell against the parsed-matrix value index.
 *
 * Scope precedence (strongest first):
 *   "source_hinted" — value found in the specific table its source_hint points to
 *   "any_matrix"    — value found in some parsed matrix (source_hint absent/mismatched)
 *   "none"          — value not found anywhere (-> hand to Guardian)
 *
 * Non-numeric cells (identity/model names, "N/A") return { matched:false, scope:"none" }
 * so the caller skips them entirely (they are never numeric-verified here).
 *
 * @param {{ cellValue: unknown, sourceHint?: unknown, valueIndex: { byTable: Map<string, Set<string>>, all: Set<string> } }} params
 * @returns {{ matched: boolean, scope: "source_hinted" | "any_matrix" | "none" }}
 */
export function backMatchCell({ cellValue, sourceHint, valueIndex }) {
  const value = normalizeNumericValue(cellValue);
  if (value === null) return { matched: false, scope: "none" };

  const index = valueIndex ?? { byTable: new Map(), all: new Set() };
  const tableToken = extractTableToken(sourceHint);
  if (tableToken) {
    const bucket = index.byTable?.get(tableToken);
    if (bucket && bucket.has(value)) return { matched: true, scope: "source_hinted" };
  }
  if (index.all?.has(value)) return { matched: true, scope: "any_matrix" };
  return { matched: false, scope: "none" };
}

// ============================================================
// MeasHalu-typed narrow Guardian claims
// ============================================================

/**
 * MeasHalu (ACL 2026) hallucination categories we ask the Guardian about, narrowed
 * from the old free-form "For X the value of Y is Z". Chosen per cell tuple:
 *   - unit_mismatch      when the tuple carries a unit
 *   - condition_mismatch when the tuple carries a measurement condition
 *   - value_fabrication  the base case (does this number exist in the source at all)
 */
export const MEASHALU_CHECK_TYPES = {
  UNIT_MISMATCH: "unit_mismatch",
  CONDITION_MISMATCH: "condition_mismatch",
  VALUE_FABRICATION: "value_fabrication",
};

/**
 * Decide which MeasHalu check type best fits a cell, given its tuple. Prefers the
 * most specific check the tuple can support: condition > unit > fabrication.
 * (A wrong condition is the D1 defect this whole effort targets, so it wins.)
 *
 * @param {{ unit?: string, condition?: string } | null | undefined} tuple
 * @returns {"unit_mismatch" | "condition_mismatch" | "value_fabrication"}
 */
export function pickCheckType(tuple) {
  if (tuple && typeof tuple.condition === "string" && tuple.condition.trim()) {
    return MEASHALU_CHECK_TYPES.CONDITION_MISMATCH;
  }
  if (tuple && typeof tuple.unit === "string" && tuple.unit.trim()) {
    return MEASHALU_CHECK_TYPES.UNIT_MISMATCH;
  }
  return MEASHALU_CHECK_TYPES.VALUE_FABRICATION;
}

/**
 * Join the leading identity columns of a row into a claim subject (e.g. "KACa, CO2").
 * Uses up to the first two columns, but never the value column itself (valueCol) so a
 * narrow 2-column table does not put the number in its own subject.
 */
function buildIdentity(headers, row, valueCol) {
  if (!Array.isArray(headers) || !Array.isArray(row)) return "";
  const parts = [];
  for (let idx = 0; idx < headers.length && parts.length < 2; idx++) {
    if (idx === valueCol) continue;
    const cell = row[idx];
    if (!cell || !String(cell).trim() || String(cell).trim() === "N/A") continue;
    parts.push(String(cell).replace(/\[\d+\]/g, "").trim());
  }
  return parts.join(", ");
}

/**
 * Build a narrow, MeasHalu-typed Guardian claim for a cell that back-matching could
 * not confirm. The claim embeds the cell tuple's unit/condition so the Guardian is
 * asked a focused yes/no question instead of a broad restatement.
 *
 * @param {{ headers: string[], row: string[], col: number, cleanValue: string }} cell
 * @param {{ unit?: string, condition?: string } | null | undefined} tuple
 * @param {string} checkType — one of MEASHALU_CHECK_TYPES
 * @returns {string} claim text for checkGroundedness
 */
export function buildNarrowGuardianClaim(cell, tuple, checkType) {
  const headers = Array.isArray(cell?.headers) ? cell.headers : [];
  const row = Array.isArray(cell?.row) ? cell.row : [];
  const column = headers[cell?.col] ?? "the value";
  const value = cell?.cleanValue ?? "";
  const identity = buildIdentity(headers, row, cell?.col);
  const subject = identity ? `${identity}` : column;

  if (checkType === MEASHALU_CHECK_TYPES.CONDITION_MISMATCH && tuple?.condition) {
    return `For ${subject}, ${column} = ${value} was measured ${tuple.condition.trim()}`;
  }
  if (checkType === MEASHALU_CHECK_TYPES.UNIT_MISMATCH && tuple?.unit) {
    return `For ${subject}, ${column} = ${value} is reported in ${tuple.unit.trim()}`;
  }
  // value_fabrication (default / safety net for back-match failures).
  return identity
    ? `For ${subject}, the value ${value} for ${column} appears in the source`
    : `The value ${value} for ${column} appears in the source`;
}
