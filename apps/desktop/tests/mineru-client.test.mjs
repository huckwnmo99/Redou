import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseMineruResult } from "../electron/mineru-client.mjs";

// Faithful (abbreviated) MinerU 3.4.2 content_list captured from a real paper.
// Covers every element type 3.4 emits, incl. the 6 new ones (chart, list,
// header, footer, page_number, page_footnote). See fixture _note.
const fixturePath = fileURLToPath(new URL("./fixtures/mineru-34-content-list.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function run() {
  return parseMineruResult({ contentList: fixture.contentList, mdContent: "", images: {} });
}

// Type census of the fixture input, so counts below are self-checking.
const inputCounts = fixture.contentList.reduce((acc, el) => {
  acc[el.type] = (acc[el.type] || 0) + 1;
  return acc;
}, {});

describe("parseMineruResult — MinerU 3.4 schema drift", () => {
  it("fixture actually exercises the 3.4-new element types", () => {
    // Guards the test itself: if the fixture regresses these, the assertions below are meaningless.
    for (const t of ["chart", "list", "header", "footer", "page_number", "page_footnote"]) {
      assert.ok(inputCounts[t] > 0, `fixture must contain a "${t}" element`);
    }
    assert.ok(inputCounts.list >= 2, "fixture needs both a ref_text and a non-ref list");
  });

  it("still parses unchanged types (table/equation) despite new fields", () => {
    const r = run();
    // equation now carries text_format=latex, image carries image_footnote — the
    // parser reads el.text / el.image_caption, which are unchanged, so counts hold.
    assert.equal(r.tables.length, inputCounts.table, "all tables parsed");
    assert.equal(r.equations.length, inputCounts.equation, "all equations parsed");
    assert.ok(r.tables[0].html.includes("<table"), "table_body HTML preserved");
    assert.ok(r.equations[0].latex.length > 0, "equation LaTeX extracted from el.text");
  });

  it("captures 3.4 `chart` elements as figures (image path)", () => {
    const r = run();
    // figures = image + chart (charts are figure-like, carry img_path).
    assert.equal(
      r.figures.length,
      (inputCounts.image || 0) + (inputCounts.chart || 0),
      "figures = images + charts",
    );
    // A chart with a caption keeps it; captionless chart with structured content
    // uses content as the searchable caption fallback.
    const capturedCaptions = r.figures.map((f) => f.caption);
    assert.ok(
      capturedCaptions.some((c) => c.includes("CO2 isotherms")),
      "chart_caption surfaced onto the figure",
    );
    assert.ok(
      capturedCaptions.some((c) => c.includes("KOH-AC")),
      "captionless chart falls back to its content text",
    );
  });

  it("accepts a non-ref `list` as body text (list_items joined)", () => {
    const r = run();
    const bodyBlob = r.sections.map((s) => s.rawText).join("\n");
    assert.ok(bodyBlob.includes("activate the carbon precursor with KOH"), "list item 1 in body");
    assert.ok(bodyBlob.includes("wash the sample until the filtrate"), "list item 2 in body");
    // rawText mirror path also carries it.
    assert.ok(r.rawText.includes("dry under vacuum"), "list body also in rawText");
  });

  it("EXCLUDES a `ref_text` list from body (references owned by GROBID)", () => {
    const r = run();
    const bodyBlob = r.sections.map((s) => s.rawText).join("\n") + "\n" + r.rawText;
    // Bibliography entries must NOT leak into body chunks/embeddings.
    assert.ok(!bodyBlob.includes("U. Eberle"), "ref_text bibliography not in body");
    assert.ok(!bodyBlob.includes("The future of hydrogen"), "ref_text bibliography not in body");
  });

  it("explicitly ignores page boilerplate (header/footer/page_number/page_footnote)", () => {
    const r = run();
    const bodyBlob = r.sections.map((s) => s.rawText).join("\n") + "\n" + r.rawText;
    assert.ok(!bodyBlob.includes("Chemical Engineering Journal 431"), "journal running head ignored");
    assert.ok(!bodyBlob.includes("Corresponding authors"), "page_footnote ignored");
    assert.ok(!bodyBlob.includes("doi.org/10.1016"), "footer copyright/DOI ignored");
    // Boilerplate is not a section either.
    assert.ok(
      r.sections.every((s) => !s.rawText.includes("133396")),
      "no boilerplate text captured into any section",
    );
  });

  it("produces sections + chunks from the real headings", () => {
    const r = run();
    assert.ok(r.sections.length >= 3, "multiple sections from headings");
    const names = r.sections.map((s) => s.sectionName);
    assert.ok(names.some((n) => /Introduction/i.test(n)), "Introduction section present");
    assert.ok(r.chunks.length > 0, "chunks built from section text");
  });
});
