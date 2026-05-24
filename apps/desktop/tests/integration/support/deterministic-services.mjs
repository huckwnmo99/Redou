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

export function quietLogger() {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  };
}

export async function loadGoldenPathFixture() {
  const [metadata, extraction, table, embedding, llm] = await Promise.all([
    readJson("source/paper.metadata.json"),
    readJson("expected/extraction.json"),
    readJson("expected/table.json"),
    readJson("fakes/embedding-service.json"),
    readJson("fakes/llm-service.json"),
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
  };
}

export async function createGoldenPathServices(fixture) {
  const embedding = createDeterministicVector(fixture.embedding.dimensions, fixture.embedding.seed);

  return {
    embedding,
    generateEmbedding: async () => [...embedding],
    orchestratorPlan: fixture.llm.orchestratorPlan,
    extractColumnsFromPaper: async () => fixture.llm.perPaperExtraction,
    parseAllHtmlTables: () => [],
    extractMatrixFromHtml: async () => ({ headers: [], rows: [] }),
  };
}
