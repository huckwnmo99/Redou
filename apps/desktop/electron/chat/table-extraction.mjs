import { CELL_NA, normalizeColumnKey, validateCellValue } from "./extraction-utils.mjs";
import { formatEvidenceLocation } from "./source-evidence.mjs";

const OCR_BUDGET = 70000;
const MATRIX_BUDGET = 35000;
const TOTAL_BUDGET = 120000;
const PER_PAPER_MATRIX_BUDGET = 12000;
const PER_PAPER_OCR_BUDGET = 14000;
const PER_PAPER_TOTAL_BUDGET = 30000;

// Reduced budget for the single-call fallback path (Stage 3c). The fallback is
// an emergency route invoked only when per-paper extraction yields nothing, and
// it sends the whole context to local Ollama in one request. A ~120K context
// frequently exceeds the 300s AbortSignal timeout, so we halve it here so the
// fallback can actually complete. See docs/features/fix/18-table-generation-timeout.md.
export const FALLBACK_RAG_BUDGET = {
  ocr: 30000,
  matrix: 20000,
  total: 60000,
};

export function cleanCellValue(cell) {
  if (typeof cell !== "string") return cell;
  let v = cell;
  v = v.replace(/(^|\s)\.(\d)/g, "$10.$2");
  v = v.replace(/(\d)\.\s/g, "$1 ");
  v = v.replace(/(\d)\.$/g, "$1");
  return v;
}

export function assembleRagContext(chunks, figures, paperRefMap, parsedMatrices, budget) {
  const ocrBudget = budget?.ocr ?? OCR_BUDGET;
  const matrixBudget = budget?.matrix ?? MATRIX_BUDGET;
  const totalBudget = budget?.total ?? TOTAL_BUDGET;

  let matrixStr = "";
  if (parsedMatrices && parsedMatrices.length > 0) {
    const parts = [];
    for (const pm of parsedMatrices) {
      const ref = paperRefMap.get(pm.paperId);
      const refLabel = ref ? `[${ref.refNo}] ${ref.paperTitle || pm.paperTitle}` : pm.paperTitle;
      for (const t of pm.tables) {
        const headerLine = t.headers.join(" | ");
        const rowLines = t.rows.map((r) => r.join(" | ")).join("\n");
        const entry = `[${t.caption} - ${refLabel}, ${formatEvidenceLocation(t)}]\n${headerLine}\n${rowLines}`;
        parts.push(entry);
      }
    }
    matrixStr = parts.join("\n\n");
    if (matrixStr.length > matrixBudget) {
      matrixStr = matrixStr.slice(0, matrixBudget) + "\n... (truncated)";
    }
  }

  const ocrEntries = figures
    .filter((f) => f.summary_text && f.summary_text.length > 30)
    .sort((a, b) => (b._rrfScore ?? 0) - (a._rrfScore ?? 0))
    .map((f) => {
      const ref = paperRefMap.get(f.paper_id);
      const refLabel = ref ? `[${ref.refNo}] ${ref.title}` : f.paper_id;
      return `[${f.figure_no} - ${refLabel}, ${formatEvidenceLocation(f)}]\n${f.caption ?? ""}\n${f.summary_text}`;
    });
  let ocrTables = "";
  for (const entry of ocrEntries) {
    if (ocrTables.length + entry.length > ocrBudget) break;
    ocrTables += (ocrTables ? "\n\n" : "") + entry;
  }

  const usedBudget = matrixStr.length + ocrTables.length;
  const chunkBudget = Math.max(10000, totalBudget - usedBudget);
  let textChunksStr = "";
  for (let i = 0; i < chunks.length; i++) {
    const ref = paperRefMap.get(chunks[i].paper_id);
    const refLabel = ref ? `[${ref.refNo}]` : chunks[i].paper_id;
    const entry = `[Chunk ${i + 1}, ${refLabel}, ${formatEvidenceLocation(chunks[i])}]\n${chunks[i].text}\n\n`;
    if (textChunksStr.length + entry.length > chunkBudget) break;
    textChunksStr += entry;
  }

  console.log(`[Chat/RAG] Context: matrices ${matrixStr.length} chars, OCR ${ocrTables.length} chars, chunks ${textChunksStr.length} chars`);

  let result = "";
  if (matrixStr) {
    result += `=== 파싱된 테이블 (정리된 수치 데이터 — 가장 정확한 소스) ===\n${matrixStr}\n\n`;
  }
  if (ocrTables) {
    result += `=== OCR 추출 테이블 (원본 HTML — 파싱 테이블에 없는 데이터 확인용) ===\n${ocrTables}\n\n`;
  }
  result += `=== 관련 텍스트 (테이블에 없는 보충 데이터) ===\n${textChunksStr}`;
  return result;
}

export function assemblePerPaperContext({ chunks, figures, parsedTables, paperTitle }) {
  let matrixStr = "";
  if (parsedTables && parsedTables.length > 0) {
    const parts = [];
    for (const t of parsedTables) {
      const headerLine = (t.headers ?? []).join(" | ");
      const rowLines = (t.rows ?? []).map((r) => (Array.isArray(r) ? r.join(" | ") : String(r))).join("\n");
      const entry = `[${t.caption || ""}, ${formatEvidenceLocation(t)}]\n${headerLine}\n${rowLines}`;
      parts.push(entry);
    }
    matrixStr = parts.join("\n\n");
    if (matrixStr.length > PER_PAPER_MATRIX_BUDGET) {
      matrixStr = matrixStr.slice(0, PER_PAPER_MATRIX_BUDGET) + "\n... (truncated)";
    }
  }

  const ocrEntries = (figures ?? [])
    .filter((f) => f.summary_text && f.summary_text.length > 30)
    .sort((a, b) => (b._rrfScore ?? 0) - (a._rrfScore ?? 0))
    .map((f) => `[${f.figure_no || ""}, ${formatEvidenceLocation(f)}]\n${f.caption ?? ""}\n${f.summary_text}`);
  let ocrTables = "";
  for (const entry of ocrEntries) {
    if (ocrTables.length + entry.length > PER_PAPER_OCR_BUDGET) break;
    ocrTables += (ocrTables ? "\n\n" : "") + entry;
  }

  const usedBudget = matrixStr.length + ocrTables.length;
  const chunkBudget = Math.max(3000, PER_PAPER_TOTAL_BUDGET - usedBudget);
  let textChunksStr = "";
  const sortedChunks = (chunks ?? []).slice().sort((a, b) => (b._rrfScore ?? 0) - (a._rrfScore ?? 0));
  for (let i = 0; i < sortedChunks.length; i++) {
    const entry = `[Chunk ${i + 1}, ${formatEvidenceLocation(sortedChunks[i])}]\n${sortedChunks[i].text}\n\n`;
    if (textChunksStr.length + entry.length > chunkBudget) break;
    textChunksStr += entry;
  }

  let result = "";
  if (matrixStr) {
    result += `=== 파싱된 테이블 (TSV — 가장 정확한 소스) ===\n${matrixStr}\n\n`;
  }
  if (ocrTables) {
    result += `=== OCR 추출 테이블 (HTML — 파싱 테이블에 없는 데이터 확인용) ===\n${ocrTables}\n\n`;
  }
  if (textChunksStr) {
    result += `=== 관련 텍스트 (본문 청크 — 보조 데이터) ===\n${textChunksStr}`;
  }

  console.log(
    `[Chat/PerPaper] "${(paperTitle || "").slice(0, 40)}" context: matrices ${matrixStr.length}, OCR ${ocrTables.length}, chunks ${textChunksStr.length} chars`,
  );

  return result;
}

export function normalizeFallbackTableToSpec(tableJson, tableSpec) {
  const requestedHeaders = Array.isArray(tableSpec?.column_definitions)
    ? tableSpec.column_definitions.map((header) => String(header ?? "").trim()).filter(Boolean)
    : [];
  const generatedHeaders = Array.isArray(tableJson?.headers)
    ? tableJson.headers.map((header) => String(header ?? "").trim()).filter(Boolean)
    : [];
  const rows = Array.isArray(tableJson?.rows)
    ? tableJson.rows.filter((row) => Array.isArray(row))
    : [];
  const rowWidthsBefore = rows.map((row) => row.length);

  if (requestedHeaders.length === 0) {
    return {
      tableJson: {
        ...(tableJson ?? {}),
        headers: [],
        rows: [],
      },
      diagnostics: {
        requestedHeaders,
        generatedHeaders,
        rowWidthsBefore,
        rowWidthsAfter: [],
        headerMatchesSpec: false,
        rowWidthsMatchSpec: true,
        normalizedToSpec: true,
        blockedUnspecifiedFallback: true,
        skippedReason: "missing_requested_headers",
      },
    };
  }

  const requestedKeys = requestedHeaders.map((header) => normalizeColumnKey(header));
  const requestedKeySet = new Set(requestedKeys);
  const generatedIndexByKey = new Map();
  generatedHeaders.forEach((header, index) => {
    const key = normalizeColumnKey(header);
    if (key && !generatedIndexByKey.has(key)) {
      generatedIndexByKey.set(key, index);
    }
  });

  const headerMatchesSpec = generatedHeaders.length === requestedHeaders.length
    && requestedKeys.every((key, index) => key === normalizeColumnKey(generatedHeaders[index]));
  const normalizedRows = rows.map((row) => requestedKeys.map((key) => {
    const sourceIndex = generatedIndexByKey.get(key);
    if (sourceIndex === undefined) return "N/A";
    const value = row[sourceIndex];
    if (value === null || value === undefined || String(value).trim() === "") return "N/A";
    return value;
  }));
  const rowWidthsAfter = normalizedRows.map((row) => row.length);
  const rowWidthsMatchedSpecBefore = rowWidthsBefore.every((width) => width === requestedHeaders.length);

  return {
    tableJson: {
      ...(tableJson ?? {}),
      headers: requestedHeaders,
      rows: normalizedRows,
    },
    diagnostics: {
      requestedHeaders,
      generatedHeaders,
      rowWidthsBefore,
      rowWidthsAfter,
      headerMatchesSpec,
      rowWidthsMatchSpec: rowWidthsAfter.every((width) => width === requestedHeaders.length),
      normalizedToSpec: !headerMatchesSpec || !rowWidthsMatchedSpecBefore,
      missingHeaders: requestedHeaders.filter((_, index) => !generatedIndexByKey.has(requestedKeys[index])),
      droppedHeaders: generatedHeaders.filter((header) => !requestedKeySet.has(normalizeColumnKey(header))),
    },
  };
}

// Phase 2.5 slice 10-A (measured defect: cell_meta key collapse). The per-paper
// extraction LLM (observed with gemma) sometimes stuffs several meta fields into the
// `unit` string as an embedded "key: value, key: value" blob instead of using the
// separate keys, e.g. real DB row:
//   { unit: "unit: mmol/g, condition: at 293.15 K, pressure <= 1000 kPa", ... }
// The `condition` field is then absent, which silently defeats the slice-09 condition
// pivot (no condition to pivot) and misleads fidelity eval / D-f range recording.
//
// `normalizeCellMeta` deterministically re-splits such a blob back into unit /
// condition / source_hint using ONLY the known key labels, and is deliberately
// conservative:
//   - It only acts when a string field *starts* with a known label (`unit:` /
//     `condition:` / `source_hint:` / `source:`). A normal value ("mmol/g",
//     "at 293 K") never starts with a known label, so it is returned unchanged.
//   - Segments are split on the known labels only. An unknown label such as
//     "pressure <=" is NOT a boundary, so it stays glued to the preceding segment
//     (here the condition keeps "at 293.15 K, pressure <= 1000 kPa" intact).
//   - A re-split value is written into a target field only if that field is still
//     empty, so a correctly-populated field is never overwritten.
// It is a pure function (no LLM, no stage) exported for unit testing.
const KNOWN_META_KEYS = ["unit", "condition", "source_hint", "source"];
// Match the START of a string that opens with a known key label, e.g. "unit:" /
// "source_hint :". Anchored so only a leading label triggers re-splitting.
const LEADING_META_LABEL_RE = /^\s*(unit|condition|source_hint|source)\s*:/i;
// Global label matcher used to carve a collapsed blob into labelled segments.
const META_LABEL_G_RE = /(unit|condition|source_hint|source)\s*:/gi;

function reSplitCollapsedMeta(raw) {
  const str = String(raw);
  const segments = {};
  const matches = [...str.matchAll(META_LABEL_G_RE)];
  if (matches.length === 0) return segments;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const key = m[1].toLowerCase() === "source" ? "source_hint" : m[1].toLowerCase();
    const valueStart = m.index + m[0].length;
    const valueEnd = i + 1 < matches.length ? matches[i + 1].index : str.length;
    let value = str.slice(valueStart, valueEnd).trim();
    // Drop a trailing comma/semicolon that separated this segment from the next.
    value = value.replace(/[,;]\s*$/, "").trim();
    // First label wins for a given field (do not clobber an earlier segment).
    if (value && !(key in segments)) segments[key] = value;
  }
  return segments;
}

/**
 * Re-split a collapsed cell_meta object whose `unit`/`condition`/`source_hint`
 * string field embeds several "key: value" pairs (slice 10-A). Returns a new object;
 * a well-shaped meta object is returned as-is (shallow copy). Conservative: only the
 * three string fields are inspected, only known labels split, and a field is filled
 * only when it was empty.
 *
 * @param {unknown} meta — a cell_meta value object, or null/undefined.
 * @returns {Record<string, unknown> | null}
 */
export function normalizeCellMeta(meta) {
  if (!meta || typeof meta !== "object") return meta ?? null;
  const out = { ...meta };
  for (const field of ["unit", "condition", "source_hint"]) {
    const value = out[field];
    if (typeof value !== "string") continue;
    if (!LEADING_META_LABEL_RE.test(value)) continue; // not collapsed — leave untouched
    const parts = reSplitCollapsedMeta(value);
    for (const key of KNOWN_META_KEYS) {
      const targetKey = key === "source" ? "source_hint" : key;
      const parsed = parts[targetKey];
      if (!parsed) continue;
      const existing = out[targetKey];
      const existingEmpty = typeof existing !== "string" || existing.trim() === "";
      // Overwrite the field being re-split (its own value was the collapsed blob);
      // for the OTHER fields, fill only when they were empty.
      if (targetKey === field || existingEmpty) out[targetKey] = parsed;
    }
  }
  return out;
}

// Phase 1 (table-semantics-hardening D1): normalize a per-cell condition string so
// that trivially different spellings ("at 293 K" vs "293K") are treated as equal and
// do not raise a false conflict.
// Phase 2.5 slice 09 (D-f): also fold en-dash / em-dash / minus-sign into a plain
// hyphen so a range written "303–343 K" and "303-343K" collapse to one key (a
// range value must not read as two distinct conditions during pivot / conflict).
function normalizeConditionKey(condition) {
  return String(condition ?? "")
    .toLowerCase()
    .replace(/[‒–—―−]/g, "-")
    .replace(/\s+/g, "")
    .replace(/[.,;]+/g, "")
    .trim();
}

/**
 * Detect condition conflicts within a single column (D1). A conflict is when the same
 * "parameter" column carries cells measured under two or more *different* non-empty
 * conditions — i.e. differently-conditioned parameter sets were merged into one column
 * without a distinguishing column. We report (not auto-split, per assumption D) so the
 * caller can annotate the table and the renderer can flag the header.
 *
 * Only "parameter" columns are checked (raw_data columns legitimately vary per point;
 * condition/identity columns ARE the conditions). When semanticTypes is absent, every
 * column is checked (fail-soft — better a heads-up than silence).
 *
 * @param {Array<Array<{condition?: string}|null>>} cellTuples — [rowIndex][colIndex]
 * @param {string[]} headers
 * @param {string[]} [semanticTypes] — index-aligned "parameter"|"raw_data"|"condition"
 * @returns {Array<{ column: string, columnIndex: number, conditions: string[] }>}
 */
export function detectConditionConflicts(cellTuples, headers, semanticTypes) {
  const conflicts = [];
  if (!Array.isArray(cellTuples) || cellTuples.length === 0 || !Array.isArray(headers)) {
    return conflicts;
  }
  const types = Array.isArray(semanticTypes) ? semanticTypes : [];

  for (let ci = 0; ci < headers.length; ci++) {
    const semanticType = types[ci];
    // Skip raw_data (varies per point by design) and condition columns (they are
    // the conditions). Unknown/undefined type is still checked (fail-soft).
    if (semanticType === "raw_data" || semanticType === "condition") continue;

    const seen = new Map(); // normalized key -> original display string
    for (let ri = 0; ri < cellTuples.length; ri++) {
      const tuple = cellTuples[ri]?.[ci];
      const condition = tuple && typeof tuple.condition === "string" ? tuple.condition.trim() : "";
      if (!condition) continue;
      const key = normalizeConditionKey(condition);
      if (key && !seen.has(key)) seen.set(key, condition);
    }

    if (seen.size >= 2) {
      conflicts.push({
        column: headers[ci],
        columnIndex: ci,
        conditions: [...seen.values()],
      });
    }
  }

  return conflicts;
}

/**
 * Phase 2.5 slice 09 (D-b): derive a "measurement condition" column from the per-cell
 * condition metadata for each column flagged as mixing conditions (tidy-data pivot).
 * The condition is already stored on cellTuples[r][c].condition; detectConditionConflicts
 * tells us *which* columns mix conditions. Rather than leaving that provenance buried in
 * a hover tooltip, we promote it to a first-class column so the mixed values become
 * disambiguated rows/cells the reader (and CSV export) can see.
 *
 * The insertion is atomic across every index-aligned structure: for each derived column
 * placed immediately AFTER its source column, we splice headers / rows / cellTuples /
 * columnSemanticTypes together and shift every later columnIndex (in conditionConflicts
 * and nullSummary.details) by +1. Conflicts are processed right-to-left so an earlier
 * insertion never invalidates a not-yet-processed index. The frontend renders the new
 * column automatically (headers.map + columnIndex-keyed conflict badge) — no UI change.
 *
 * Duplicate guard [assumption C]: skip a conflict whose derived header name already
 * exists in `headers` (e.g. a prior pivot or an orchestrator-provided column of the same
 * name) so the pivot never double-represents the same condition. We key on the derived
 * NAME, not the "condition" semantic type — identity columns (adsorbent/gas/model) are
 * also typed "condition", so a type-based guard would wrongly suppress every adsorption
 * pivot (defeating D-b, the very case this targets).
 *
 * Mutates the passed arrays in place and returns the (possibly new) columnSemanticTypes.
 *
 * @param {object} args
 * @param {string[]} args.headers
 * @param {string[][]} args.rows
 * @param {Array<Array<object|null>>} args.cellTuples
 * @param {Array<string|null>|null} args.columnSemanticTypes
 * @param {Array<{column: string, columnIndex: number, conditions: string[]}>} args.conditionConflicts
 * @param {Array<{columnIndex: number}>} args.nullDetails
 * @returns {Array<string|null>|null} columnSemanticTypes (unchanged reference when no pivot)
 */
export function deriveConditionColumns({ headers, rows, cellTuples, columnSemanticTypes, conditionConflicts, nullDetails }) {
  if (!Array.isArray(conditionConflicts) || conditionConflicts.length === 0) return columnSemanticTypes;

  // Work on a concrete semantic-types array so derived columns can be tagged "condition"
  // index-aligned with headers, even if the spec omitted the array entirely.
  let semanticTypes = Array.isArray(columnSemanticTypes)
    ? columnSemanticTypes.slice()
    : headers.map(() => null);
  let derivedAny = false;

  // Process conflicts high-index first so each splice leaves lower indices valid.
  const ordered = [...conditionConflicts].sort((a, b) => b.columnIndex - a.columnIndex);
  for (const conflict of ordered) {
    const srcIndex = conflict.columnIndex;
    if (typeof srcIndex !== "number" || srcIndex < 0 || srcIndex >= headers.length) continue;

    // Duplicate guard (assumption C): if a column with the derived name already exists,
    // skip — the condition is already represented (avoids double-representation).
    const derivedHeader = `측정 조건 (${headers[srcIndex]})`;
    if (headers.includes(derivedHeader)) continue;

    const insertAt = srcIndex + 1;

    // New header names the derived column after its source column.
    headers.splice(insertAt, 0, derivedHeader);
    semanticTypes.splice(insertAt, 0, "condition");
    derivedAny = true;

    // Each row gets the source cell's condition string (N/A when the cell had none).
    // The derived cell also carries a tuple so its condition is available on hover.
    for (let ri = 0; ri < rows.length; ri++) {
      const srcTuple = cellTuples[ri]?.[srcIndex];
      const condition = srcTuple && typeof srcTuple.condition === "string" && srcTuple.condition.trim()
        ? srcTuple.condition.trim()
        : "";
      rows[ri].splice(insertAt, 0, condition || CELL_NA);
      const derivedTuple = condition ? { condition } : null;
      if (Array.isArray(cellTuples[ri])) cellTuples[ri].splice(insertAt, 0, derivedTuple);
    }

    // Shift every later columnIndex so downstream (frontend badge, null details) stays aligned.
    conflict.derivedColumnIndex = insertAt;
    for (const c of conditionConflicts) {
      if (c !== conflict && typeof c.columnIndex === "number" && c.columnIndex >= insertAt) c.columnIndex += 1;
      if (c !== conflict && typeof c.derivedColumnIndex === "number" && c.derivedColumnIndex >= insertAt) c.derivedColumnIndex += 1;
    }
    if (Array.isArray(nullDetails)) {
      for (const d of nullDetails) {
        if (typeof d.columnIndex === "number" && d.columnIndex >= insertAt) d.columnIndex += 1;
      }
    }
  }

  // When nothing was derived, hand back the original reference untouched so callers see
  // no spurious change to columnSemanticTypes.
  return derivedAny ? semanticTypes : columnSemanticTypes;
}

export function mergeExtractionResults(extractionResults, tableSpec, paperMetadata, paperRefMap) {
  const headers = Array.isArray(tableSpec.column_definitions) ? tableSpec.column_definitions.slice() : [];
  const normalizedHeaders = headers.map((h) => normalizeColumnKey(h));
  // Phase 1: index-aligned column semantic types from the orchestrator spec (may be
  // absent on older specs / the fallback path). Trimmed to header length so a stray
  // extra/short array never misaligns downstream conflict detection.
  const columnSemanticTypes = Array.isArray(tableSpec.column_semantic_types)
    ? headers.map((_, ci) => tableSpec.column_semantic_types[ci] ?? null)
    : null;

  const rows = [];
  // Phase 1 (D1/D3): per-cell tuple metadata parallel to `rows`. cellTuples[r][c] is
  // { unit?, condition?, source_hint?, confidence? } or null. Placeholder rows push a
  // row of nulls to stay aligned with `rows`.
  const cellTuples = [];
  const nullDetails = [];
  const usedPaperIds = new Set();
  // Per-paper extraction notes, indexed by paperId, so we can surface "why a
  // paper produced no data" to the user (see docs/features/fix/19-...).
  const notesByPaperId = new Map();
  // Phase 2.5 slice 08 (D-a coverage): per-paper coverage observation. For each paper,
  // count the real (non-placeholder) rows it contributed and the number of DISTINCT
  // measurement conditions those rows carry (a proxy for how many parameter/condition
  // sets were captured). Recorded on reasons[] only — never changes rows/tableJson.
  const coverageByPaperId = new Map(); // paperId -> { rows, conditionKeys:Set }
  let totalNulls = 0;
  let totalCells = 0;
  let droppedRowCount = 0;

  for (const result of extractionResults) {
    const rawNote = typeof result.extraction?.notes === "string" ? result.extraction.notes.trim() : "";
    if (rawNote) notesByPaperId.set(result.paperId, rawNote);

    if (!result.success) continue;
    const dataRows = result.extraction?.data_rows ?? [];
    if (!Array.isArray(dataRows) || dataRows.length === 0) continue;

    const ref = paperRefMap.get(result.paperId);
    const refNo = ref?.refNo ?? null;
    const refTag = refNo ? ` [${refNo}]` : "";
    const safeDataRows = dataRows.slice(0, 50);

    for (const dataRow of safeDataRows) {
      const values = dataRow?.values || {};
      const normalizedValues = new Map();
      for (const [k, v] of Object.entries(values)) {
        normalizedValues.set(normalizeColumnKey(k), v);
      }
      // Phase 1: per-cell metadata (unit/condition/source_hint) keyed by normalized
      // column name. Optional and additive — absent on legacy extractions.
      const cellMeta = dataRow?.cell_meta && typeof dataRow.cell_meta === "object" ? dataRow.cell_meta : null;
      const normalizedMeta = new Map();
      if (cellMeta) {
        for (const [k, v] of Object.entries(cellMeta)) {
          // Slice 10-A: re-split a collapsed meta blob (several "key: value" pairs
          // stuffed into `unit`) back into unit/condition/source_hint so the condition
          // pivot (slice 09) and fidelity eval see the condition. No-op on well-shaped
          // meta.
          if (v && typeof v === "object") normalizedMeta.set(normalizeColumnKey(k), normalizeCellMeta(v));
        }
      }
      // Row-level source_hint applies to any cell lacking its own (D3 provenance).
      const rowSourceHint = typeof dataRow?.source_hint === "string" && dataRow.source_hint.trim()
        ? dataRow.source_hint.trim()
        : null;
      const rowConfidence = typeof dataRow?.confidence === "string" ? dataRow.confidence : null;

      const row = [];
      const rowTuples = [];
      const perRowNullColumns = [];
      for (let ci = 0; ci < headers.length; ci++) {
        const col = headers[ci];
        const nKey = normalizedHeaders[ci];
        const rawValue = normalizedValues.has(nKey) ? normalizedValues.get(nKey) : undefined;
        totalCells++;

        // D4: block leaked JSON fragments / control chars / over-length blobs before
        // they reach the cell. Rejected values collapse to the N/A sentinel (and stay
        // Stage 3d recovery targets).
        const validation = validateCellValue(rawValue);
        const raw = validation.ok ? rawValue : null;

        // D1/D3: collect the per-cell tuple regardless of null-ness (a condition on a
        // null cell is still meaningful for conflict detection / provenance).
        const meta = normalizedMeta.get(nKey);
        const tuple = {};
        if (meta && typeof meta.unit === "string" && meta.unit.trim()) tuple.unit = meta.unit.trim();
        if (meta && typeof meta.condition === "string" && meta.condition.trim()) tuple.condition = meta.condition.trim();
        const cellSourceHint = (meta && typeof meta.source_hint === "string" && meta.source_hint.trim())
          ? meta.source_hint.trim()
          : rowSourceHint;
        if (cellSourceHint) tuple.source_hint = cellSourceHint;
        if (rowConfidence) tuple.confidence = rowConfidence;
        rowTuples.push(Object.keys(tuple).length > 0 ? tuple : null);

        if (raw === null || raw === undefined || raw === "" || raw === CELL_NA) {
          row.push(CELL_NA);
          perRowNullColumns.push({ column: col, columnIndex: ci });
          totalNulls++;
        } else {
          const value = String(raw);
          const hasRefTag = /\[\d+\]/.test(value);
          row.push(hasRefTag || !refTag ? value : `${value}${refTag}`);
        }
      }

      const naCount = perRowNullColumns.length;
      if (headers.length > 0 && naCount / headers.length > 0.5) {
        droppedRowCount++;
        continue;
      }

      rows.push(row);
      cellTuples.push(rowTuples);
      usedPaperIds.add(result.paperId);

      // D-a coverage: tally this real row + its distinct conditions for the paper.
      let coverage = coverageByPaperId.get(result.paperId);
      if (!coverage) {
        coverage = { rows: 0, conditionKeys: new Set() };
        coverageByPaperId.set(result.paperId, coverage);
      }
      coverage.rows++;
      for (const tuple of rowTuples) {
        const cond = tuple && typeof tuple.condition === "string" ? tuple.condition.trim() : "";
        if (!cond) continue;
        const key = normalizeConditionKey(cond);
        if (key) coverage.conditionKeys.add(key);
      }

      const outRowIndex = rows.length - 1;
      for (const nullCol of perRowNullColumns) {
        nullDetails.push({
          paperId: result.paperId,
          paperTitle: result.paperTitle,
          column: nullCol.column,
          columnIndex: nullCol.columnIndex,
          rowIndex: outRowIndex,
        });
      }
    }
  }

  // Force a row for every scope paper that produced no data row above (empty
  // data_rows or success=false). Without this, a comparison request would render
  // "headers + references only" with an empty body. The placeholder row is all
  // N/A (the identity column included — we do not invent a fake material name;
  // the paper is identified via its [refNo] in the references + the reasons
  // section below). Placeholder rows bypass the >50% N/A drop rule because they
  // are intentionally empty. See docs/features/fix/19-table-empty-rows-and-reasons.md.
  const reasons = [];
  const failedByPaperId = new Map();
  for (const result of extractionResults) {
    if (!result.success) failedByPaperId.set(result.paperId, result.error || "");
  }
  for (const p of paperMetadata) {
    const ref = paperRefMap.get(p.paperId);
    const refNo = ref?.refNo ?? null;
    const hadRows = usedPaperIds.has(p.paperId);
    const failed = failedByPaperId.has(p.paperId);
    const note = notesByPaperId.get(p.paperId) || "";

    if (!hadRows) {
      // All-N/A placeholder row. Intentionally NOT recorded in nullSummary
      // (no totalCells/totalNulls/details entry) so that Stage 3d Agentic NULL
      // Recovery treats it as a deliberately empty row and does not re-search
      // a paper already judged to have no data, and so the NULL ratio gate for
      // real data rows is not skewed by placeholders.
      const row = headers.map(() => CELL_NA);
      rows.push(row);
      // Keep cellTuples aligned with rows: placeholder rows carry no tuple info.
      cellTuples.push(headers.map(() => null));
      usedPaperIds.add(p.paperId);
    }

    const coverage = coverageByPaperId.get(p.paperId);
    reasons.push({
      paperId: p.paperId,
      paperTitle: p.title,
      refNo: refNo ? String(refNo) : "",
      hadRows,
      failed,
      // D-a coverage counters (observation only — do not affect rows/tableJson).
      // extractedRowCount: real rows this paper contributed (placeholders excluded).
      // distinctConditionCount: distinct measurement conditions across those rows,
      // a proxy for how many condition/parameter sets were captured for the paper.
      extractedRowCount: coverage ? coverage.rows : 0,
      distinctConditionCount: coverage ? coverage.conditionKeys.size : 0,
      note: hadRows
        ? note
        : note || (failed ? `Extraction failed: ${failedByPaperId.get(p.paperId) || "unknown error"}` : "No matching data found in this paper"),
    });
  }

  const doiLookup = new Map(paperMetadata.map((p) => [p.paperId, p.doi]));
  const references = paperMetadata
    .filter((p) => usedPaperIds.has(p.paperId))
    .map((p) => {
      const ref = paperRefMap.get(p.paperId);
      return {
        refNo: String(ref?.refNo ?? ""),
        paperId: p.paperId,
        title: p.title,
        authors: p.authors,
        year: p.year,
        doi: doiLookup.get(p.paperId) || "",
      };
    })
    .sort((a, b) => (parseInt(a.refNo, 10) || 0) - (parseInt(b.refNo, 10) || 0));

  const missingCount = reasons.filter((r) => !r.hadRows).length;
  const notes = missingCount > 0
    ? `${missingCount} of ${reasons.length} paper(s) had no matching data; see the missing-data notes below.`
    : "";

  const tableJson = {
    title: tableSpec.title || "비교 테이블",
    headers,
    rows,
    references,
    notes,
  };

  const nullSummary = {
    totalNulls,
    totalCells,
    droppedRowCount,
    details: nullDetails,
  };

  // Phase 1 (D1): flag columns where differently-conditioned parameter sets were
  // merged without a distinguishing column. Reported (not auto-split) per assumption D.
  const conditionConflicts = detectConditionConflicts(cellTuples, headers, columnSemanticTypes);

  // Phase 2.5 slice 09 (D-b): pivot the buried per-cell condition into a first-class
  // "measurement condition" column for each flagged column. This is a末尾 post-processing
  // step: it runs after nullSummary/conditionConflicts are built and atomically shifts
  // every later columnIndex (conditionConflicts + nullDetails). tableJson.headers/rows
  // and nullSummary.details are the same array references, so the in-place splices flow
  // through. Only fires when a conflict exists and no explicit condition column is present.
  const finalSemanticTypes = deriveConditionColumns({
    headers,
    rows,
    cellTuples,
    columnSemanticTypes,
    conditionConflicts,
    nullDetails,
  });

  // D-a coverage observation: per-paper real rows + distinct conditions captured.
  const coverage = reasons
    .filter((r) => r.hadRows)
    .map((r) => ({ refNo: r.refNo || null, rows: r.extractedRowCount, conditions: r.distinctConditionCount }));

  const derivedConditionCols = conditionConflicts.filter((c) => typeof c.derivedColumnIndex === "number").length;
  console.log(
    `[Chat/Merge] rows=${rows.length}, cells=${totalCells}, nulls=${totalNulls}, droppedRows=${droppedRowCount}, missingPapers=${missingCount}, conditionConflicts=${conditionConflicts.length}, derivedConditionCols=${derivedConditionCols}, coverage=${JSON.stringify(coverage)}`,
  );

  return { tableJson, nullSummary, reasons, cellTuples, columnSemanticTypes: finalSemanticTypes, conditionConflicts };
}
