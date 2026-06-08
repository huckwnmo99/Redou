import { normalizeColumnKey } from "./extraction-utils.mjs";
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

export function mergeExtractionResults(extractionResults, tableSpec, paperMetadata, paperRefMap) {
  const headers = Array.isArray(tableSpec.column_definitions) ? tableSpec.column_definitions.slice() : [];
  const normalizedHeaders = headers.map((h) => normalizeColumnKey(h));

  const rows = [];
  const nullDetails = [];
  const usedPaperIds = new Set();
  let totalNulls = 0;
  let totalCells = 0;
  let droppedRowCount = 0;

  for (const result of extractionResults) {
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

      const row = [];
      const perRowNullColumns = [];
      for (let ci = 0; ci < headers.length; ci++) {
        const col = headers[ci];
        const nKey = normalizedHeaders[ci];
        const raw = normalizedValues.has(nKey) ? normalizedValues.get(nKey) : undefined;
        totalCells++;

        if (raw === null || raw === undefined || raw === "" || raw === "N/A") {
          row.push("N/A");
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
      usedPaperIds.add(result.paperId);

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

  const tableJson = {
    title: tableSpec.title || "비교 테이블",
    headers,
    rows,
    references,
    notes: "",
  };

  const nullSummary = {
    totalNulls,
    totalCells,
    droppedRowCount,
    details: nullDetails,
  };

  console.log(
    `[Chat/Merge] rows=${rows.length}, cells=${totalCells}, nulls=${totalNulls}, droppedRows=${droppedRowCount}`,
  );

  return { tableJson, nullSummary };
}
