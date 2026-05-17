import { extractKeyTerms, normalizeColumnKey, sanitizeColumnNames } from "./extraction-utils.mjs";
import { assemblePerPaperContext } from "./table-extraction.mjs";

export function shouldTriggerAgenticRecovery(nullSummary, tableJson, abortSignal) {
  if (abortSignal?.aborted) return false;
  const totalNulls = Number(nullSummary?.totalNulls ?? 0);
  const totalCells = Number(nullSummary?.totalCells ?? 0);
  const nullDetails = Array.isArray(nullSummary?.details) ? nullSummary.details : [];
  const rowCount = Array.isArray(tableJson?.rows) ? tableJson.rows.length : 0;
  if (totalNulls <= 0 || totalCells <= 0 || nullDetails.length === 0 || rowCount === 0) return false;
  const recoverablePaperIds = new Set(nullDetails.map((detail) => detail.paperId).filter(Boolean));
  if (recoverablePaperIds.size === 0) return false;
  return totalNulls / totalCells >= 0.05;
}

export function buildSkippedAgenticRecovery(nullSummary, skippedReason) {
  const nullsBeforeRecovery = Number(nullSummary?.totalNulls ?? 0);
  return {
    attempted: false,
    ms: 0,
    nullsBeforeRecovery,
    nullsAfterRecovery: nullsBeforeRecovery,
    recoveredCellCount: 0,
    perPaper: [],
    skippedReason,
  };
}

export function groupNullsByPaper(nullSummary) {
  const grouped = new Map();
  for (const detail of nullSummary?.details ?? []) {
    if (!detail?.paperId) continue;
    if (!grouped.has(detail.paperId)) {
      grouped.set(detail.paperId, {
        paperTitle: detail.paperTitle || "",
        nullCells: [],
      });
    }
    grouped.get(detail.paperId).nullCells.push({
      column: detail.column,
      columnIndex: detail.columnIndex,
      rowIndex: detail.rowIndex,
    });
  }
  return grouped;
}

export function uniqueStrings(values) {
  return [...new Set((values ?? []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function compactRecoveryQuery(parts) {
  return uniqueStrings(parts)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function buildRecoveryQueries(paperTitle, columns, keywordHints) {
  const safeColumns = uniqueStrings(sanitizeColumnNames(columns ?? []));
  const safeHints = uniqueStrings(keywordHints ?? []);
  const columnText = safeColumns.join(" ");
  const units = uniqueStrings(
    safeColumns.flatMap((column) => [...String(column).matchAll(/\(([^)]+)\)|\[([^\]]+)\]/g)].map((match) => match[1] || match[2])),
  );
  const titleTerms = String(paperTitle || "").split(/\s+/).filter(Boolean).slice(0, 10).join(" ");
  const inferredTerms = extractKeyTerms(`${paperTitle || ""} ${columnText}`).slice(0, 8);

  const candidates = [
    compactRecoveryQuery([columnText, units.join(" "), safeHints.join(" "), inferredTerms.join(" ")]),
    compactRecoveryQuery([titleTerms, safeColumns[0] || columnText, units.join(" ")]),
    compactRecoveryQuery(["methods experimental conditions", columnText, safeHints.slice(0, 4).join(" ")]),
  ].filter(Boolean);

  return uniqueStrings(candidates).slice(0, 3).map((query) => ({ query, intent: "recovery" }));
}

export function getChunkId(chunk) {
  return chunk?.chunk_id ?? chunk?.id ?? null;
}

export function getFigureId(figure) {
  return figure?.figure_id ?? figure?.id ?? null;
}

export function appendUniqueById(target, items, idFn) {
  const existingIds = new Set((target ?? []).map(idFn).filter(Boolean));
  for (const item of items ?? []) {
    const id = idFn(item);
    if (!id || existingIds.has(id)) continue;
    target.push(item);
    existingIds.add(id);
  }
}

export function isNullTableCell(value) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === "" || text.toLowerCase() === "n/a" || text.toLowerCase() === "null";
}

export function cloneTableForRecovery(tableJson) {
  return {
    ...(tableJson ?? {}),
    headers: Array.isArray(tableJson?.headers) ? tableJson.headers.slice() : [],
    rows: Array.isArray(tableJson?.rows) ? tableJson.rows.map((row) => (Array.isArray(row) ? row.slice() : [])) : [],
    references: Array.isArray(tableJson?.references) ? tableJson.references.map((ref) => ({ ...ref })) : [],
  };
}

export function cloneNullSummaryForRecovery(nullSummary) {
  return {
    ...(nullSummary ?? {}),
    totalNulls: Number(nullSummary?.totalNulls ?? 0),
    totalCells: Number(nullSummary?.totalCells ?? 0),
    droppedRowCount: Number(nullSummary?.droppedRowCount ?? 0),
    details: Array.isArray(nullSummary?.details) ? nullSummary.details.map((detail) => ({ ...detail })) : [],
  };
}

export function assembleRecoveryContext({
  newChunks,
  newFigures,
  missingColumns,
  paperTitle,
}) {
  const focusedContext = assemblePerPaperContext({
    chunks: newChunks ?? [],
    figures: newFigures ?? [],
    parsedTables: [],
    paperTitle,
  });
  const header = `=== Recovery target columns ===\n${(missingColumns ?? []).join(", ")}\n\n=== Recovery rule ===\nOnly recover values that are directly present in the new context below.`;
  return `${header}\n\n${focusedContext || ""}`.trim();
}

export function applyRecoveredValues(tableJson, paperRefMap, paperId, recoveredRows, nullSummary) {
  const headers = Array.isArray(tableJson?.headers) ? tableJson.headers : [];
  const headerLookup = new Map(headers.map((header, index) => [normalizeColumnKey(header), { header, index }]));
  const details = Array.isArray(nullSummary?.details) ? nullSummary.details : [];
  const refNo = paperRefMap?.get(paperId)?.refNo ?? null;
  const refTag = refNo ? ` [${refNo}]` : "";
  let appliedCount = 0;

  for (const recoveredRow of recoveredRows ?? []) {
    if (recoveredRow?.confidence !== "high") continue;
    const values = recoveredRow?.values;
    if (!values || typeof values !== "object") continue;

    for (const [columnName, rawValue] of Object.entries(values)) {
      if (isNullTableCell(rawValue)) continue;
      const headerMatch = headerLookup.get(normalizeColumnKey(columnName));
      if (!headerMatch) continue;

      const detailIndex = details.findIndex((detail) => {
        if (detail.paperId !== paperId || detail.columnIndex !== headerMatch.index) return false;
        return isNullTableCell(tableJson.rows?.[detail.rowIndex]?.[headerMatch.index]);
      });
      if (detailIndex < 0) continue;

      const detail = details[detailIndex];
      const value = String(rawValue).trim();
      if (!value) continue;
      const valueWithRef = /\[\d+\]/.test(value) || !refTag ? value : `${value}${refTag}`;
      tableJson.rows[detail.rowIndex][headerMatch.index] = valueWithRef;
      details.splice(detailIndex, 1);
      appliedCount++;
    }
  }

  nullSummary.details = details;
  nullSummary.totalNulls = details.length;
  return appliedCount;
}
