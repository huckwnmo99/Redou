import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { runTableConversationPipeline } from "../../../electron/chat/table-pipeline.mjs";
import { createMultiQueryRag } from "../../../electron/rag/multi-query-rag.mjs";
import { quietLogger } from "./deterministic-services.mjs";

const EVAL_FIXTURE_ROOT = new URL("../../fixtures/evals/", import.meta.url);

async function readJson(relativePath) {
  if (relativePath.includes("/") || relativePath.includes("\\")) {
    throw new Error(`Eval fixture name must be a file name: ${relativePath}`);
  }
  const raw = await readFile(new URL(relativePath, EVAL_FIXTURE_ROOT), "utf8");
  return JSON.parse(raw);
}

function recordMetric(metrics, name, observed, expected) {
  const metric = {
    name,
    passed: true,
    observed,
  };
  if (expected !== undefined) metric.expected = expected;
  metrics.push(metric);
}

function rankOf(items, key, id) {
  const index = items.findIndex((item) => item?.[key] === id);
  return index === -1 ? null : index + 1;
}

function countAtOrBefore(items, key, expectedItems, idKey, k) {
  return expectedItems.filter((expected) => {
    const rank = rankOf(items, key, expected[idKey]);
    return rank !== null && rank <= k;
  }).length;
}

function allRagItems(ragResults) {
  return [...(ragResults?.chunks ?? []), ...(ragResults?.figures ?? [])];
}

function assertSupportedCellGate(evalCase) {
  assert.equal(
    evalCase.metrics?.cellExactMatch,
    "all_asserted",
    `${evalCase.id}: v0 table evals require cellExactMatch="all_asserted"`,
  );
  assert.equal(
    Object.hasOwn(evalCase.metrics ?? {}, "cellExactMatchMin"),
    false,
    `${evalCase.id}: cellExactMatchMin is too weak for v0 table evals`,
  );
}

export async function loadEvalCaseSet(fileName) {
  const caseSet = await readJson(fileName);
  assertEvalCaseSetShape(caseSet);
  return caseSet;
}

export function assertEvalCaseSetShape(caseSet) {
  assert.equal(caseSet?.schemaVersion, "rag-table-eval-v0");
  assert.equal(caseSet?.fixture, "golden-path");
  assert.ok(Array.isArray(caseSet?.cases), "eval case set must include cases[]");

  for (const evalCase of caseSet.cases) {
    assert.equal(typeof evalCase.id, "string", "eval case id is required");
    assert.equal(evalCase.fixture, caseSet.fixture, `${evalCase.id}: fixture must match case set fixture`);
    assert.ok(["rag_retrieval", "table_generation"].includes(evalCase.mode), `${evalCase.id}: unsupported mode`);
    assert.equal(typeof evalCase.input, "object", `${evalCase.id}: input is required`);
    assert.equal(typeof evalCase.expected, "object", `${evalCase.id}: expected is required`);
    assert.equal(typeof evalCase.metrics, "object", `${evalCase.id}: metrics is required`);
    if (evalCase.mode === "table_generation") assertSupportedCellGate(evalCase);
  }
}

export function normalizeEvalString(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// table_fidelity mode
//
// Compares a persisted generated table against hand-verified ground-truth cells
// (extracted directly from the source PDF tables). Unlike table_generation this
// mode reports scores (not pass/fail) so it can grade extraction/A-B changes.
// Ground-truth fixture schema: table-fidelity-v0
// (apps/desktop/tests/fixtures/evals/adsorption-groundtruth-v0.json).
// ---------------------------------------------------------------------------

// Ground-truth values are labels/numbers; identities are matched as
// case-insensitive substrings against the whole row so column splitting in the
// generated table (e.g. a separate "Model" column) does not break matching.
export function normalizeFidelityToken(value) {
  return normalizeEvalString(value).toLowerCase();
}

// Strip inline citation tags ("[1]", "[2, 3]") the pipeline appends to cells so
// a numeric comparison sees only the value. Value comparison stays exact.
export function stripCitationTags(value) {
  return normalizeEvalString(value).replace(/\[[\d\s,]+\]/g, "").trim();
}

export function isNumericCellValue(value) {
  const cleaned = stripCitationTags(value);
  if (cleaned === "" || cleaned.toUpperCase() === "N/A") return false;
  return /^[+-]?\d[\d.,eE+-]*$/.test(cleaned);
}

function rowIdentityText(row) {
  const cells = Array.isArray(row) ? row : Object.values(row ?? {});
  return normalizeFidelityToken(cells.map((cell) => String(cell ?? "")).join("  "));
}

function rowMatchesIdentity(row, identityTokens) {
  const text = rowIdentityText(row);
  return (identityTokens ?? []).every((token) => text.includes(normalizeFidelityToken(token)));
}

// A generated table may name the q_m column many ways ("q_m", "qm", "q max",
// "saturation capacity"). Ground-truth column ids stay canonical; matching is
// tolerant on separators/case so header wording drift does not sink fidelity.
function columnAliasKey(header) {
  return normalizeFidelityToken(header).replace(/[_\-\s]/g, "");
}

function findColumnIndex(headers, columnName) {
  const target = columnAliasKey(columnName);
  const list = headers ?? [];
  const exact = list.findIndex((header) => columnAliasKey(header) === target);
  if (exact !== -1) return exact;
  // fall back to substring so "q_m (mol/kg)" still binds to ground-truth "q_m"
  return list.findIndex((header) => {
    const key = columnAliasKey(header);
    return key.includes(target) || target.includes(key);
  });
}

function cellValueAt(row, columnIndex) {
  if (columnIndex < 0) return undefined;
  const cells = Array.isArray(row) ? row : Object.values(row ?? {});
  return cells[columnIndex];
}

function conditionTokenPresent(text, condition) {
  const normalized = normalizeFidelityToken(condition);
  if (!normalized) return true;
  // Compare on the discriminating digits/tilde so "<=1000 kPa" still matches a
  // row that renders "DSL(≤1000 kPa)" or a cell tuple condition of "1000 kPa".
  const digits = normalized.replace(/[^\d~]/g, "");
  if (digits && text.replace(/[^\d~]/g, "").includes(digits)) return true;
  return text.includes(normalized);
}

// Does any part of the matched row (identity cells or its cellTuples entry)
// carry the ground-truth condition? Used to split "value right + condition kept"
// (matched) from "value right + condition lost/wrong" (misattributed, D1).
function rowCarriesCondition(row, rowIndex, condition, cellTuples) {
  if (conditionTokenPresent(rowIdentityText(row), condition)) return true;
  const tupleRow = Array.isArray(cellTuples) ? cellTuples[rowIndex] : null;
  if (Array.isArray(tupleRow)) {
    for (const tuple of tupleRow) {
      if (tuple && conditionTokenPresent(normalizeFidelityToken(tuple.condition ?? ""), condition)) {
        return true;
      }
    }
  }
  return false;
}

export function evaluateTableFidelityCase(groundTruth, tableRow) {
  const paperId = groundTruth?.paperId ?? null;
  const headers = tableRow?.headers ?? [];
  const rows = tableRow?.rows ?? [];
  const cellTuples = tableRow?.metadata?.cellTuples ?? null;
  const groundTruthCells = groundTruth?.groundTruthCells ?? [];

  const groundTruthValues = new Set(
    groundTruthCells.map((cell) => normalizeEvalString(cell.value)),
  );
  const groundTruthColumns = new Set(
    groundTruthCells.map((cell) => columnAliasKey(cell.column)),
  );

  const matchedCells = [];
  const misattributedCells = [];
  const missingCells = [];

  for (const cell of groundTruthCells) {
    const columnIndex = findColumnIndex(headers, cell.column);
    const expectedValue = normalizeEvalString(cell.value);
    let matched = false;
    let valuePresentWrongCondition = false;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!rowMatchesIdentity(row, cell.identity)) continue;
      const actual = normalizeEvalString(stripCitationTags(cellValueAt(row, columnIndex)));
      if (actual !== expectedValue) continue;
      if (rowCarriesCondition(row, rowIndex, cell.condition, cellTuples)) {
        matched = true;
        break;
      }
      valuePresentWrongCondition = true;
    }

    if (matched) {
      matchedCells.push(cell);
    } else if (valuePresentWrongCondition) {
      misattributedCells.push(cell);
    } else {
      missingCells.push(cell);
    }
  }

  // Fabrication: numeric cells in ground-truth columns, inside rows that match a
  // known identity, whose value appears in no ground-truth cell for this paper.
  // Restricting to identity-matched rows + ground-truth columns keeps this a
  // conservative signal (the fixture is a curated subset, not the full table).
  const fabricatedCells = [];
  const knownIdentityRows = rows.filter((row) =>
    groundTruthCells.some((cell) => rowMatchesIdentity(row, cell.identity)),
  );
  for (const row of knownIdentityRows) {
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      if (!groundTruthColumns.has(columnAliasKey(headers[columnIndex]))) continue;
      const rawValue = cellValueAt(row, columnIndex);
      if (!isNumericCellValue(rawValue)) continue;
      const value = normalizeEvalString(stripCitationTags(rawValue));
      if (!groundTruthValues.has(value)) {
        fabricatedCells.push({ column: headers[columnIndex], value });
      }
    }
  }

  // Conflict handling: did metadata.conditionConflicts flag the columns the
  // fixture marks as inherently condition-mixed (same parameter, two conditions)?
  const expectedConflictColumns = (groundTruth?.conditionMixedColumns ?? []).map((entry) =>
    columnAliasKey(entry.column),
  );
  const reportedConflicts = tableRow?.metadata?.conditionConflicts ?? [];
  const reportedConflictColumns = new Set(
    reportedConflicts.map((conflict) => columnAliasKey(conflict.column)),
  );
  const detectedConflictColumns = expectedConflictColumns.filter((column) =>
    reportedConflictColumns.has(column),
  );

  const fidelityTotal = groundTruthCells.length;
  const fidelityScore = fidelityTotal === 0 ? 1 : matchedCells.length / fidelityTotal;
  const conflictExpected = expectedConflictColumns.length;
  const conflictScore = conflictExpected === 0 ? 1 : detectedConflictColumns.length / conflictExpected;

  return {
    mode: "table_fidelity",
    paperId,
    fidelity: {
      matched: matchedCells.length,
      total: fidelityTotal,
      score: fidelityScore,
    },
    misattribution: {
      count: misattributedCells.length,
      cells: misattributedCells,
    },
    fabrication: {
      count: fabricatedCells.length,
      cells: fabricatedCells,
    },
    conflictHandling: {
      expected: conflictExpected,
      detected: detectedConflictColumns.length,
      score: conflictScore,
    },
    missing: {
      count: missingCells.length,
      cells: missingCells,
    },
  };
}

// Load a table-fidelity-v0 ground-truth fixture and validate its shape.
export async function loadFidelityGroundTruth(fileName) {
  const groundTruth = await readJson(fileName);
  assertFidelityGroundTruthShape(groundTruth);
  return groundTruth;
}

export function assertFidelityGroundTruthShape(groundTruth) {
  assert.equal(groundTruth?.schemaVersion, "table-fidelity-v0", "fidelity fixture must be table-fidelity-v0");
  assert.ok(Array.isArray(groundTruth?.papers), "fidelity fixture must include papers[]");
  for (const paper of groundTruth.papers) {
    assert.equal(typeof paper.paperId, "string", "paper.paperId is required");
    assert.ok(Array.isArray(paper.groundTruthCells), `${paper.paperId}: groundTruthCells[] is required`);
    for (const cell of paper.groundTruthCells) {
      assert.ok(Array.isArray(cell.identity) && cell.identity.length > 0, `${paper.paperId}: cell.identity[] is required`);
      assert.equal(typeof cell.column, "string", `${paper.paperId}: cell.column is required`);
      assert.ok(cell.value !== undefined && cell.value !== null, `${paper.paperId}: cell.value is required`);
    }
  }
}

// Score a whole fidelity fixture against a map of persisted tables keyed by
// paperId (typically one merged multi-paper table applied to each paper block).
export function evaluateTableFidelityFixture(groundTruth, tableByPaperId) {
  assertFidelityGroundTruthShape(groundTruth);
  const reports = (groundTruth.papers ?? []).map((paper) => {
    const tableRow =
      typeof tableByPaperId === "function"
        ? tableByPaperId(paper.paperId)
        : tableByPaperId?.[paper.paperId];
    return evaluateTableFidelityCase(paper, tableRow ?? {});
  });
  const matched = reports.reduce((sum, report) => sum + report.fidelity.matched, 0);
  const total = reports.reduce((sum, report) => sum + report.fidelity.total, 0);
  return {
    schemaVersion: groundTruth.schemaVersion,
    fixture: groundTruth.fixture ?? null,
    overall: {
      fidelity: total === 0 ? 1 : matched / total,
      matched,
      total,
      misattribution: reports.reduce((sum, report) => sum + report.misattribution.count, 0),
      fabrication: reports.reduce((sum, report) => sum + report.fabrication.count, 0),
    },
    reports,
  };
}

export function evaluateRagRetrievalCase(evalCase, ragResults) {
  assert.equal(evalCase.mode, "rag_retrieval");
  const chunks = ragResults?.chunks ?? [];
  const figures = ragResults?.figures ?? [];
  const expected = evalCase.expected ?? {};
  const metrics = [];

  for (const expectedChunk of expected.mustIncludeChunks ?? []) {
    const rank = rankOf(chunks, "chunk_id", expectedChunk.chunkId);
    assert.ok(
      rank !== null && rank <= expectedChunk.rankAtOrBefore,
      `${evalCase.id}: expected chunk ${expectedChunk.chunkId} by rank ${expectedChunk.rankAtOrBefore}, got ${rank}`,
    );
  }
  recordMetric(metrics, "mustIncludeChunks", expected.mustIncludeChunks?.length ?? 0);

  for (const expectedFigure of expected.mustIncludeFigures ?? []) {
    const rank = rankOf(figures, "figure_id", expectedFigure.figureId);
    assert.ok(
      rank !== null && rank <= expectedFigure.rankAtOrBefore,
      `${evalCase.id}: expected figure ${expectedFigure.figureId} by rank ${expectedFigure.rankAtOrBefore}, got ${rank}`,
    );
  }
  recordMetric(metrics, "mustIncludeFigures", expected.mustIncludeFigures?.length ?? 0);

  const chunkRecall = evalCase.metrics?.chunkRecallAtK;
  if (chunkRecall) {
    const observed = countAtOrBefore(
      chunks,
      "chunk_id",
      expected.mustIncludeChunks ?? [],
      "chunkId",
      chunkRecall.k,
    );
    assert.ok(observed >= chunkRecall.min, `${evalCase.id}: chunk recall@${chunkRecall.k} ${observed} < ${chunkRecall.min}`);
    recordMetric(metrics, "chunkRecallAtK", observed, chunkRecall);
  }

  const figureRecall = evalCase.metrics?.figureRecallAtK;
  if (figureRecall) {
    const observed = countAtOrBefore(
      figures,
      "figure_id",
      expected.mustIncludeFigures ?? [],
      "figureId",
      figureRecall.k,
    );
    assert.ok(observed >= figureRecall.min, `${evalCase.id}: figure recall@${figureRecall.k} ${observed} < ${figureRecall.min}`);
    recordMetric(metrics, "figureRecallAtK", observed, figureRecall);
  }

  const forbiddenPaperIds = new Set(expected.forbiddenPaperIds ?? []);
  const forbiddenCount = allRagItems(ragResults).filter((item) => forbiddenPaperIds.has(item.paper_id)).length;
  const maxForbidden = evalCase.metrics?.forbiddenPaperCount?.max ?? 0;
  assert.ok(forbiddenCount <= maxForbidden, `${evalCase.id}: forbidden paper result count ${forbiddenCount} > ${maxForbidden}`);
  recordMetric(metrics, "forbiddenPaperCount", forbiddenCount, { max: maxForbidden });

  for (const coverage of expected.sourceCoverage ?? []) {
    const matched = allRagItems(ragResults).some(
      (item) => item.paper_id === coverage.paperId && item.source_file_id === coverage.sourceFileId,
    );
    assert.equal(matched, true, `${evalCase.id}: missing source coverage ${coverage.paperId}/${coverage.sourceFileId}`);
  }
  recordMetric(metrics, "sourceCoverage", expected.sourceCoverage?.length ?? 0);

  return {
    id: evalCase.id,
    mode: evalCase.mode,
    passed: true,
    metrics,
  };
}

export function evaluateTableGenerationCase(evalCase, tableRow) {
  assert.equal(evalCase.mode, "table_generation");
  assertSupportedCellGate(evalCase);

  const expected = evalCase.expected ?? {};
  const metrics = [];

  assert.equal(normalizeEvalString(tableRow?.table_title), normalizeEvalString(expected.tableTitle), `${evalCase.id}: table title mismatch`);
  recordMetric(metrics, "tableTitle", tableRow?.table_title, expected.tableTitle);

  if (evalCase.metrics?.headerExactMatch) {
    const actualHeaders = (tableRow?.headers ?? []).map(normalizeEvalString);
    const expectedHeaders = (expected.headers ?? []).map(normalizeEvalString);
    assert.deepEqual(actualHeaders, expectedHeaders, `${evalCase.id}: headers mismatch`);
    recordMetric(metrics, "headerExactMatch", actualHeaders.length, expectedHeaders.length);
  }

  let matchedCells = 0;
  for (const cell of expected.cells ?? []) {
    const columnIndex = (tableRow?.headers ?? []).findIndex((header) => normalizeEvalString(header) === normalizeEvalString(cell.column));
    assert.notEqual(columnIndex, -1, `${evalCase.id}: missing expected column ${cell.column}`);
    const actual = tableRow?.rows?.[cell.row]?.[columnIndex];
    assert.equal(
      normalizeEvalString(actual),
      normalizeEvalString(cell.equalsNormalized),
      `${evalCase.id}: cell ${cell.row}/${cell.column} mismatch`,
    );
    matchedCells++;
  }
  recordMetric(metrics, "cellExactMatch", matchedCells, expected.cells?.length ?? 0);

  for (const expectedRef of expected.references ?? []) {
    const matched = (tableRow?.source_refs ?? []).some(
      (sourceRef) => sourceRef.paperId === expectedRef.paperId && String(sourceRef.refNo) === String(expectedRef.refNo),
    );
    assert.equal(matched, true, `${evalCase.id}: missing source ref ${expectedRef.paperId} [${expectedRef.refNo}]`);
  }
  recordMetric(metrics, "references", expected.references?.length ?? 0);

  if (evalCase.metrics?.requiredMetadataKeysPresent) {
    for (const key of expected.metadata?.requiredKeys ?? []) {
      assert.equal(Object.hasOwn(tableRow?.metadata ?? {}, key), true, `${evalCase.id}: missing metadata.${key}`);
    }
    recordMetric(metrics, "requiredMetadataKeysPresent", expected.metadata?.requiredKeys?.length ?? 0);
  }

  if (expected.metadata?.extractionMode) {
    assert.equal(tableRow?.metadata?.extractionMode, expected.metadata.extractionMode, `${evalCase.id}: extractionMode mismatch`);
    recordMetric(metrics, "extractionMode", tableRow?.metadata?.extractionMode, expected.metadata.extractionMode);
  }

  return {
    id: evalCase.id,
    mode: evalCase.mode,
    passed: true,
    metrics,
  };
}

export async function runEvalCase({ evalCase, supabase, fixture, services }) {
  const { runMultiQueryRag } = createMultiQueryRag({
    supabase,
    generateEmbedding: services.generateEmbedding,
    isRerankerAvailable: async () => false,
    logger: quietLogger(),
  });

  if (evalCase.mode === "rag_retrieval") {
    const ragResults = await runMultiQueryRag(
      evalCase.input.queries,
      evalCase.input.keywordHints,
      evalCase.input.filterPaperIds,
      evalCase.input.ragMode,
      { abortSignal: new AbortController().signal },
    );
    return evaluateRagRetrievalCase(evalCase, ragResults);
  }

  if (evalCase.mode === "table_generation") {
    assert.equal(evalCase.input.fakeServiceScenario ?? "happyPath", "happyPath");
    const result = await runTableConversationPipeline({
      supabase,
      conversationId: evalCase.input.conversationId,
      ownerId: evalCase.input.ownerId,
      ownerPaperIds: evalCase.input.ownerPaperIds,
      scopeAll: evalCase.input.scopeAll ?? true,
      history: fixture.history,
      message: evalCase.input.message,
      abortSignal: new AbortController().signal,
      emitStatus: () => {},
      emitComplete: () => {},
      generateOrchestratorPlanFn: async () => services.orchestratorPlan,
      runMultiQueryRagFn: runMultiQueryRag,
      extractColumnsFromPaperFn: services.extractColumnsFromPaper,
      parseAllHtmlTablesFn: services.parseAllHtmlTables,
      extractMatrixFromHtmlFn: services.extractMatrixFromHtml,
      runPaperScopedRecoverySearchFn: async () => ({ chunks: [], figures: [] }),
      extractNullCellsFromPaperFn: async () => ({ data_rows: [] }),
      scheduleImmediateFn: () => {},
    });

    assert.equal(result.hasTable, true, `${evalCase.id}: table pipeline did not produce a table`);
    assert.ok(result.tableId, `${evalCase.id}: table id is required`);

    const { data, error } = await supabase
      .from("chat_generated_tables")
      .select("table_title, headers, rows, source_refs, metadata")
      .eq("id", result.tableId)
      .limit(1);
    assert.equal(error, null, `${evalCase.id}: failed to load generated table`);

    return evaluateTableGenerationCase(evalCase, data?.[0]);
  }

  throw new Error(`Unsupported eval mode: ${evalCase.mode}`);
}

export async function runEvalCaseSet({ caseSet, supabase, fixture, services }) {
  assertEvalCaseSetShape(caseSet);
  const cases = [];
  for (const evalCase of caseSet.cases) {
    cases.push(await runEvalCase({ evalCase, supabase, fixture, services }));
  }
  return {
    schemaVersion: caseSet.schemaVersion,
    fixture: caseSet.fixture,
    passed: cases.every((evalCase) => evalCase.passed),
    cases,
  };
}
