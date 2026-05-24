import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGoldenPathServices,
  loadGoldenPathFixture,
} from "./integration/support/deterministic-services.mjs";

describe("golden-path deterministic service catalog", () => {
  it("catalogues happy-path, abort, and error fake scenarios", async () => {
    const fixture = await loadGoldenPathFixture();

    assert.deepEqual(Object.keys(fixture.serviceCatalog.scenarios).sort(), [
      "happyPath",
      "perPaperAbort",
      "perPaperError",
    ]);
  });

  it("can create a per-paper abort fake that aborts the parent signal", async () => {
    const fixture = await loadGoldenPathFixture();
    const abortController = new AbortController();
    const services = await createGoldenPathServices(fixture, {
      abortController,
      scenario: "perPaperAbort",
    });

    await assert.rejects(
      () => services.extractColumnsFromPaper({}, "", fixture.paper.title, new AbortController().signal),
      (err) => err?.name === "AbortError",
    );
    assert.equal(abortController.signal.aborted, true);
  });

  it("can create a per-paper error fake with a single-call fallback response", async () => {
    const fixture = await loadGoldenPathFixture();
    const services = await createGoldenPathServices(fixture, {
      scenario: "perPaperError",
    });

    await assert.rejects(
      () => services.extractColumnsFromPaper({}, "", fixture.paper.title, new AbortController().signal),
      /Fake per-paper extraction failed/,
    );

    const table = await services.generateTableFromSpec(
      fixture.llm.orchestratorPlan.table_spec,
      "",
      [],
      new AbortController().signal,
    );
    assert.equal(table.title, fixture.expected.tableTitle);
    assert.deepEqual(table.headers, fixture.expected.headers);
    assert.deepEqual(table.rows, fixture.expected.rows);
  });
});
