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
