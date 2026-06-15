import { describe, expect, it } from "vitest";

import { analyzeWorkspace } from "./analyzeWorkspace";
import { buildAdvisorWorkspaceSnapshot } from "./buildWorkspaceSnapshot";
import type { ChatGeneratedTable } from "@/types/chat";
import type { Folder, Paper, PaperChunk, PaperFigure, PaperPrimaryFile, PaperSection } from "@/types/paper";

function paper(overrides: Partial<Paper>): Paper {
  return {
    id: "paper",
    title: "Untitled paper",
    authors: [],
    year: 2026,
    venue: "",
    abstract: "Do not leak this abstract",
    tags: [],
    status: "unread",
    starred: false,
    figureCount: 0,
    noteCount: 0,
    citationCount: 0,
    addedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildAdvisorWorkspaceSnapshot", () => {
  it("maps existing frontend domain data into an advisor snapshot", () => {
    const papers: Paper[] = [
      paper({
        id: "paper-1",
        title: "Mapped Paper",
        authors: [{ name: "Ada" }, { name: "Grace" }],
        folderId: "folder-1",
      }),
    ];
    const primaryFiles: PaperPrimaryFile[] = [
      {
        paperId: "paper-1",
        storedPath: "library/paper-1.pdf",
        storedFilename: "paper-1.pdf",
        originalFilename: "paper.pdf",
      },
    ];
    const chunks: PaperChunk[] = [
      {
        id: "chunk-1",
        paperId: "paper-1",
        order: 0,
        text: "Do not leak chunk text",
        page: 1,
      },
      {
        id: "chunk-2",
        paperId: "paper-1",
        order: 1,
        text: "Do not leak missing embedding text",
        page: undefined,
      },
    ];
    const sections: PaperSection[] = [
      {
        id: "section-1",
        paperId: "paper-1",
        name: "Intro",
        order: 0,
        rawText: "Do not leak section text",
        pageStart: 1,
      },
    ];
    const figures: PaperFigure[] = [
      {
        id: "figure-1",
        paperId: "paper-1",
        figureNo: "Figure 1",
        caption: "Useful caption",
        page: 2,
        isKeyFigure: false,
        isPresentationCandidate: false,
        itemType: "figure",
      },
    ];
    const generatedTables: ChatGeneratedTable[] = [
      {
        id: "table-1",
        message_id: "message-1",
        conversation_id: "conversation-1",
        table_title: "Table",
        headers: ["Material", "Value"],
        rows: [["Sample", ""]],
        source_refs: [{ refNo: "[1]", title: "Mapped Paper" }],
        verification: [{ row: 0, col: 1, status: "unverified" }],
        created_at: "2026-06-01T00:00:00.000Z",
      },
    ];
    const folders: Folder[] = [
      { id: "folder-1", name: "Folder", paperCount: 1 },
    ];

    const snapshot = buildAdvisorWorkspaceSnapshot({
      papers,
      primaryFiles,
      chunks,
      embeddedChunkIds: ["chunk-1"],
      sections,
      figures,
      processingJobs: [
        {
          id: "job-1",
          paper_id: "paper-1",
          job_type: "generate_embeddings",
          status: "running",
          created_at: "2026-05-31T20:00:00.000Z",
          started_at: "2026-05-31T20:10:00.000Z",
        },
      ],
      generatedTables,
      folders,
    });

    expect(snapshot.papers).toEqual([
      {
        id: "paper-1",
        title: "Mapped Paper",
        year: 2026,
        authorsCount: 2,
        folderId: "folder-1",
      },
    ]);
    expect(snapshot.chunks).toEqual([
      { id: "chunk-1", paperId: "paper-1", hasEmbedding: true, page: 1 },
      { id: "chunk-2", paperId: "paper-1", hasEmbedding: false, page: null },
    ]);
    expect(snapshot.processingJobs?.[0]).toMatchObject({
      id: "job-1",
      paperId: "paper-1",
      jobType: "generate_embeddings",
      status: "running",
      updatedAt: "2026-05-31T20:10:00.000Z",
    });
    expect(snapshot.generatedTables?.[0]).toEqual({
      id: "table-1",
      extractionMode: null,
      rows: [["Sample", ""]],
      sourceRefs: [{ refNo: "[1]", title: "Mapped Paper" }],
      verification: [{ status: "unverified" }],
    });

    const suggestions = analyzeWorkspace(snapshot, { now: "2026-06-01T00:00:00.000Z" });
    expect(suggestions.map((suggestion) => suggestion.id)).toEqual([
      "processing-stale-jobs",
      "search-chunks-without-embeddings",
      "table-high-null-ratio",
      "extraction-sparse-paper-structure",
      "table-weak-evidence-contract",
      "extraction-missing-evidence-hints",
    ]);
    expect(JSON.stringify(suggestions)).not.toContain("Do not leak");
  });

  it("accepts advisor-style table metadata for fallback diagnostics", () => {
    const snapshot = buildAdvisorWorkspaceSnapshot({
      generatedTables: [
        {
          id: "table-1",
          extraction_metadata: { extractionMode: "single_call_fallback" },
          rows: [["Material", "5.0"]],
          sourceRefs: [],
          verification: [],
        },
      ],
    });

    expect(snapshot.generatedTables?.[0]?.extractionMode).toBe("single_call_fallback");
    expect(analyzeWorkspace(snapshot).map((suggestion) => suggestion.id)).toEqual([
      "table-weak-evidence-contract",
    ]);
  });
});
