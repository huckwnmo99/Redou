import { describe, expect, it } from "vitest";

import { analyzeWorkspace } from "./analyzeWorkspace";
import type { AdvisorWorkspaceSnapshot } from "./types";

const now = "2026-06-01T00:00:00.000Z";

describe("analyzeWorkspace", () => {
  it("returns evidence-backed suggestions across the first MVP categories", () => {
    const snapshot: AdvisorWorkspaceSnapshot = {
      papers: [
        { id: "paper-1", title: "Secret Adsorption Paper", year: 2026, authorsCount: 2, folderId: null },
        { id: "paper-2", title: "Untitled paper", year: null, authorsCount: 0, folderId: null },
        { id: "paper-3", title: "Duplicate Study", year: 2024, authorsCount: 1, folderId: "folder-1" },
        { id: "paper-4", title: "Duplicate Study", year: 2024, authorsCount: 1, folderId: "folder-1" },
      ],
      primaryFiles: [
        { paperId: "paper-1", storedPath: "library/paper-1.pdf" },
      ],
      chunks: [
        { id: "chunk-1", paperId: "paper-1", hasEmbedding: false, page: null },
        { id: "chunk-2", paperId: "paper-3", hasEmbedding: true, page: 2 },
      ],
      sections: [
        { id: "section-1", paperId: "paper-1", pageStart: 1 },
      ],
      figures: [
        { id: "figure-1", paperId: "paper-1", caption: "", page: null },
      ],
      processingJobs: [
        {
          id: "job-1",
          paperId: "paper-1",
          jobType: "generate_embeddings",
          status: "running",
          createdAt: "2026-05-31T20:00:00.000Z",
        },
        {
          id: "job-2",
          paperId: "paper-2",
          jobType: "import_pdf",
          status: "failed",
          createdAt: "2026-05-31T19:00:00.000Z",
        },
        {
          id: "job-3",
          paperId: "paper-2",
          jobType: "import_pdf",
          status: "failed",
          createdAt: "2026-05-31T19:30:00.000Z",
        },
      ],
      generatedTables: [
        {
          id: "table-1",
          extractionMode: "single_call_fallback",
          rows: [
            ["Material", null],
            ["", "5.0"],
          ],
          sourceRefs: [],
          verification: [{ status: "unverified" }],
        },
      ],
      folders: [
        { id: "folder-1", paperCount: 2 },
        { id: "folder-empty", paperCount: 0 },
      ],
    };

    const suggestions = analyzeWorkspace(snapshot, { now });
    const categories = new Set(suggestions.map((suggestion) => suggestion.category));
    const suggestionText = JSON.stringify(suggestions);

    expect(categories).toEqual(new Set(["processing", "search", "extraction", "table", "library"]));
    expect(suggestions.map((suggestion) => suggestion.id)).toContain("processing-failed-jobs");
    expect(suggestions.map((suggestion) => suggestion.id)).toContain("search-chunks-without-embeddings");
    expect(suggestions.map((suggestion) => suggestion.id)).toContain("extraction-sparse-paper-structure");
    expect(suggestions.map((suggestion) => suggestion.id)).toContain("table-high-null-ratio");
    expect(suggestions.map((suggestion) => suggestion.id)).toContain("library-cleanup-metadata-and-folders");
    expect(suggestions.every((suggestion) => suggestion.createdAt === now)).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.evidence.length > 0)).toBe(true);
    expect(suggestionText).not.toContain("Secret Adsorption Paper");
  });

  it("returns no suggestions for a complete and healthy snapshot", () => {
    const suggestions = analyzeWorkspace({
      papers: [
        { id: "paper-1", title: "Complete Paper", year: 2026, authorsCount: 2, folderId: "folder-1" },
      ],
      primaryFiles: [
        { paperId: "paper-1", storedPath: "library/paper-1.pdf" },
      ],
      chunks: [
        { id: "chunk-1", paperId: "paper-1", hasEmbedding: true, page: 1 },
        { id: "chunk-2", paperId: "paper-1", hasEmbedding: true, page: 2 },
        { id: "chunk-3", paperId: "paper-1", hasEmbedding: true, page: 3 },
      ],
      sections: [
        { id: "section-1", paperId: "paper-1", pageStart: 1 },
      ],
      figures: [
        { id: "figure-1", paperId: "paper-1", caption: "A complete figure.", page: 1 },
      ],
      processingJobs: [
        {
          id: "job-1",
          paperId: "paper-1",
          jobType: "generate_embeddings",
          status: "succeeded",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      generatedTables: [
        {
          id: "table-1",
          extractionMode: "per_paper",
          rows: [["Material", "5.0"]],
          sourceRefs: [{ paperId: "paper-1" }],
          verification: [{ status: "verified" }],
        },
      ],
      folders: [
        { id: "folder-1", paperCount: 1 },
      ],
    }, { now });

    expect(suggestions).toEqual([]);
  });
});
