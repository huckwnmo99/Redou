import { readFile } from "node:fs/promises";

const FIXTURE_ROOT = new URL("../../fixtures/golden-path/", import.meta.url);

async function readJson(relativePath) {
  const raw = await readFile(new URL(relativePath, FIXTURE_ROOT), "utf8");
  return JSON.parse(raw);
}

function createDeterministicVector(dimensions, seed) {
  const vector = Array(dimensions).fill(0);
  vector[0] = 1;
  const offset = Math.max(1, seed.length % dimensions);
  vector[offset] = 0.0001;
  return vector;
}

function createAbortError(message = "Fake service aborted") {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

export function quietLogger() {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  };
}

export async function loadGoldenPathFixture() {
  const [metadata, extraction, table, embedding, llm, serviceCatalog] = await Promise.all([
    readJson("source/paper.metadata.json"),
    readJson("expected/extraction.json"),
    readJson("expected/table.json"),
    readJson("fakes/embedding-service.json"),
    readJson("fakes/llm-service.json"),
    readJson("fakes/service-catalog.json"),
  ]);

  return {
    ids: metadata.ids,
    paper: metadata.paper,
    source: metadata.source,
    extraction,
    embedding,
    expected: table,
    keywordHints: llm.orchestratorPlan.keyword_hints,
    searchQueries: llm.orchestratorPlan.search_queries,
    history: llm.history,
    llm,
    serviceCatalog,
  };
}

export async function createGoldenPathServices(fixture, options = {}) {
  const scenario = options.scenario ?? "happyPath";
  if (!fixture.serviceCatalog?.scenarios?.[scenario]) {
    throw new Error(`Unknown golden-path fake service scenario: ${scenario}`);
  }

  const embedding = createDeterministicVector(fixture.embedding.dimensions, fixture.embedding.seed);
  const extractColumnsFromPaper = async () => {
    if (scenario === "perPaperAbort") {
      options.abortController?.abort();
      throw createAbortError("Fake per-paper extraction aborted");
    }
    if (scenario === "perPaperError") {
      throw new Error("Fake per-paper extraction failed");
    }
    return fixture.llm.perPaperExtraction;
  };
  const generateTableFromSpec = async (_tableSpec, _ragContext, _paperMetadata, abortSignal) => {
    if (abortSignal?.aborted) {
      throw createAbortError("Fake single-call table generation aborted");
    }
    return {
      title: fixture.expected.tableTitle,
      headers: [...fixture.expected.headers],
      rows: fixture.expected.rows.map((row) => [...row]),
      references: [],
    };
  };

  return {
    embedding,
    generateEmbedding: async () => [...embedding],
    orchestratorPlan: fixture.llm.orchestratorPlan,
    extractColumnsFromPaper,
    generateTableFromSpec,
    parseAllHtmlTables: () => [],
    extractMatrixFromHtml: async () => ({ headers: [], rows: [] }),
  };
}
