import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildEvidenceLocationsByPaper,
  enrichSourceRefsWithEvidence,
  serializeEvidenceLocations,
} from "../electron/chat/source-evidence.mjs";

describe("source evidence helpers", () => {
  it("labels main PDF evidence with page hints", () => {
    const locationsByPaper = buildEvidenceLocationsByPaper([
      { paper_id: "paper-1", page: 4, source_file_id: "main-file", source_file_kind: "main_pdf" },
    ], []);

    assert.deepEqual(serializeEvidenceLocations(locationsByPaper), {
      "paper-1": ["Main PDF p.4"],
    });
  });

  it("labels supplementary PDF evidence with filename and page hints", () => {
    const locationsByPaper = buildEvidenceLocationsByPaper([], [
      {
        paper_id: "paper-1",
        page: 7,
        source_file_id: "supp-file",
        source_file_kind: "supplementary_pdf",
        source_filename: "supplementary-table.pdf",
      },
    ]);
    const sourceRefs = enrichSourceRefsWithEvidence(
      [{ paperId: "paper-1", refNo: 1, title: "Paper One" }],
      locationsByPaper,
      new Map([["paper-1", { refNo: 1, title: "Paper One" }]]),
    );

    assert.deepEqual(serializeEvidenceLocations(locationsByPaper), {
      "paper-1": ["Supplementary: supplementary-table.pdf, p.7"],
    });
    assert.equal(sourceRefs[0].evidenceSummary, "Supplementary: supplementary-table.pdf, p.7");
    assert.equal(sourceRefs[0].hasSupplementaryEvidence, true);
  });

  it("falls back to main PDF labels when source metadata is missing", () => {
    const locationsByPaper = buildEvidenceLocationsByPaper([
      { paper_id: "paper-1", page: 2, source_file_id: null },
      { paper_id: "paper-1", page: 2, source_file_id: null },
    ], []);

    assert.deepEqual(serializeEvidenceLocations(locationsByPaper), {
      "paper-1": ["Main PDF p.2"],
    });
  });
});
