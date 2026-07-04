// Phase 2.5 slice 10-D: conservative column-name grounding / snap.
//
// The orchestrator invents column names (e.g. "R2") that may not match the metric
// as printed in the source table ("MAPE"). Slice 09 handles condition mixing but not
// header misnaming, which sinks fidelity (a golden cell fails to bind to a wrongly
// named column). This module snaps a spec column name to the source table's own
// wording — but only on a STRONG, unambiguous match — and records a grounding flag
// otherwise. It is a pure function (no LLM, no stage, no I/O) so it can run between
// Stage 3a parsing and extraction and be unit-tested directly.
//
// Matching reuses `normalizeColumnKey` (lower-case, strip separators/punctuation), so
// the bar is "normalized exact match", not fuzzy similarity — a deliberately narrow
// bar so we never rename one metric to a different one (e.g. R2 -> MAPE is NOT a
// normalized match, so it is left as-is and flagged grounded:false for the caller to
// surface later; a frontend warning badge is out of scope for this slice).

import { normalizeColumnKey } from "./extraction-utils.mjs";

/**
 * Build a vocabulary of source-table header wordings keyed by normalized column key.
 * A key maps to the set of DISTINCT original spellings seen across all parsed tables.
 * When a key has more than one distinct spelling it is ambiguous and must not drive a
 * snap (we cannot pick a canonical wording safely).
 *
 * @param {Array<{tables?: Array<{headers?: string[]}>}>} parsedMatrices
 * @returns {Map<string, Set<string>>} normalizedKey -> set of original header strings
 */
export function buildHeaderVocabulary(parsedMatrices) {
  const vocab = new Map();
  if (!Array.isArray(parsedMatrices)) return vocab;
  for (const pm of parsedMatrices) {
    const tables = Array.isArray(pm?.tables) ? pm.tables : [];
    for (const table of tables) {
      const headers = Array.isArray(table?.headers) ? table.headers : [];
      for (const header of headers) {
        const original = String(header ?? "").trim();
        if (!original) continue;
        const key = normalizeColumnKey(original);
        if (!key) continue;
        if (!vocab.has(key)) vocab.set(key, new Set());
        vocab.get(key).add(original);
      }
    }
  }
  return vocab;
}

/**
 * Snap spec column names to the source table's own wording where a strong,
 * unambiguous match exists; otherwise leave the name untouched and record whether it
 * is grounded in the parsed headers at all.
 *
 * Rules (conservative):
 *   - A spec column whose normalized key matches exactly ONE distinct source wording:
 *     grounded=true. If that wording differs from the spec spelling, replace it
 *     (snappedFrom = the original spec spelling).
 *   - Normalized key present but under MULTIPLE distinct wordings (ambiguous):
 *     grounded=true, but NO snap (we cannot choose safely).
 *   - Normalized key absent from the vocabulary: grounded=false, no snap.
 *   - Empty vocabulary (no parsed tables): every column grounded=false, no snap
 *     (nothing to ground against) — a fail-soft no-op.
 *
 * @param {object} args
 * @param {string[]} args.columnDefinitions — spec column names (may be undefined).
 * @param {Array<{tables?: Array<{headers?: string[]}>}>} args.parsedMatrices
 * @returns {{
 *   columns: string[],
 *   grounding: Array<{ column: string, grounded: boolean, snappedFrom?: string }>,
 *   snappedCount: number,
 * }}
 */
export function snapColumnsToParsedHeaders({ columnDefinitions, parsedMatrices }) {
  const columns = Array.isArray(columnDefinitions)
    ? columnDefinitions.map((c) => String(c ?? ""))
    : [];
  const vocab = buildHeaderVocabulary(parsedMatrices);

  const grounding = [];
  const outColumns = [];
  let snappedCount = 0;

  for (const original of columns) {
    const key = normalizeColumnKey(original);
    const wordings = key ? vocab.get(key) : undefined;

    if (!wordings || wordings.size === 0) {
      // Not grounded in any parsed header — leave untouched, flag for the caller.
      grounding.push({ column: original, grounded: false });
      outColumns.push(original);
      continue;
    }

    if (wordings.size > 1) {
      // Grounded but ambiguous (same normalized key, different spellings) — do not snap.
      grounding.push({ column: original, grounded: true });
      outColumns.push(original);
      continue;
    }

    const [canonical] = wordings;
    if (canonical !== original) {
      // Strong single-match with different wording -> snap to the source spelling.
      grounding.push({ column: canonical, grounded: true, snappedFrom: original });
      outColumns.push(canonical);
      snappedCount += 1;
    } else {
      // Already matches the source wording exactly.
      grounding.push({ column: original, grounded: true });
      outColumns.push(original);
    }
  }

  return { columns: outColumns, grounding, snappedCount };
}
