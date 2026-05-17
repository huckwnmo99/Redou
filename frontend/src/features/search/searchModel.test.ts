import { describe, expect, it } from "vitest";

import type { Folder, Paper } from "@/types/paper";
import { applySearchScope } from "./searchModel";

function paper(overrides: Partial<Paper>): Paper {
  return {
    id: "paper",
    title: "Untitled paper",
    authors: [],
    year: 2026,
    venue: "",
    abstract: "",
    tags: [],
    status: "unread",
    starred: false,
    figureCount: 0,
    noteCount: 0,
    citationCount: 0,
    addedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("applySearchScope", () => {
  it("keeps folder search scoped to direct paper membership", () => {
    const folders: Folder[] = [
      { id: "parent", name: "Parent", paperCount: 1 },
      { id: "child", name: "Child", parentId: "parent", paperCount: 1 },
    ];
    const papers = [
      paper({ id: "in-parent", folderId: "parent" }),
      paper({ id: "in-child", folderId: "child" }),
      paper({ id: "unfiled", folderId: undefined }),
    ];

    expect(applySearchScope(papers, folders, "parent").map((item) => item.id)).toEqual(["in-parent"]);
  });
});
