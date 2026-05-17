import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNoteRecord,
  fetchNotesByPaper,
  updateNoteRecord,
} from "./notes";
import {
  getOrCreateSelectionHighlight,
} from "./highlights";
import { supabase } from "../supabase";

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("./highlights", () => ({
  getHighlightById: vi.fn(),
  getOrCreateSelectionHighlight: vi.fn(),
}));

function createSelectBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function createInsertBuilder(result: unknown, insertedRows: unknown[]) {
  const builder = {
    insert: vi.fn((row: unknown) => {
      insertedRows.push(row);
      return builder;
    }),
    select: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function createUpdateBuilder(result: unknown, patches: unknown[]) {
  const builder = {
    update: vi.fn((patch: unknown) => {
      patches.push(patch);
      return builder;
    }),
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

describe("paper repository notes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches notes for a paper through the notes table facade", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createSelectBuilder({
        data: [
          {
            id: "note-1",
            paper_id: "paper-1",
            title: "Result",
            note_text: "Important result",
            note_type: "summary_note",
            created_at: "2026-05-14T00:00:00.000Z",
            updated_at: "2026-05-14T01:00:00.000Z",
            selected_text: null,
            is_pinned: false,
            page: null,
            highlight_id: null,
            highlight: null,
          },
        ],
        error: null,
      }) as never,
    );

    await expect(fetchNotesByPaper("paper-1")).resolves.toMatchObject([
      {
        id: "note-1",
        paperId: "paper-1",
        title: "Result",
        content: "Important result",
        kind: "summary",
      },
    ]);
    expect(supabase.from).toHaveBeenCalledWith("notes");
  });

  it("creates a note from a selection by delegating highlight creation", async () => {
    const insertedRows: unknown[] = [];
    vi.mocked(getOrCreateSelectionHighlight).mockResolvedValue({
      id: "highlight-1",
      paperId: "paper-1",
      presetId: "preset-1",
      pageNumber: 4,
      selectedText: "selected evidence",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    vi.mocked(supabase.from).mockReturnValue(
      createInsertBuilder(
        {
          data: {
            id: "note-1",
            paper_id: "paper-1",
            title: "Reader note - Page 4",
            note_text: "Selection: \"selected evidence\"\n\nWhy it matters:",
            note_type: "summary_note",
            created_at: "2026-05-14T00:00:00.000Z",
            updated_at: "2026-05-14T00:00:00.000Z",
            selected_text: "selected evidence",
            is_pinned: false,
            page: 4,
            highlight_id: "highlight-1",
            highlight: null,
          },
          error: null,
        },
        insertedRows,
      ) as never,
    );

    await createNoteRecord(
      {
        paperId: "paper-1",
        selectionAnchor: {
          paperId: "paper-1",
          pageNumber: 4,
          pageLabel: "4",
          anchorId: "paper:paper-1:page:4",
          quote: "selected evidence",
          capturedAt: "2026-05-14T00:00:00.000Z",
          rects: [],
        },
      },
      async () => "user-1",
    );

    expect(getOrCreateSelectionHighlight).toHaveBeenCalledWith(
      expect.objectContaining({
        paperId: "paper-1",
        userId: "user-1",
      }),
    );
    expect(insertedRows[0]).toMatchObject({
      paper_id: "paper-1",
      user_id: "user-1",
      note_scope: "highlight",
      highlight_id: "highlight-1",
      page: 4,
      selected_text: "selected evidence",
    });
  });

  it("updates note fields using database note types", async () => {
    const patches: unknown[] = [];
    vi.mocked(supabase.from).mockReturnValue(
      createUpdateBuilder(
        {
          data: {
            id: "note-1",
            paper_id: "paper-1",
            title: "Updated",
            note_text: "Next step",
            note_type: "followup_note",
            created_at: "2026-05-14T00:00:00.000Z",
            updated_at: "2026-05-14T01:00:00.000Z",
            selected_text: null,
            is_pinned: true,
            page: null,
            highlight_id: null,
            highlight: null,
          },
          error: null,
        },
        patches,
      ) as never,
    );

    await expect(
      updateNoteRecord("note-1", {
        title: " Updated ",
        content: " Next step ",
        kind: "action",
        pinned: true,
      }),
    ).resolves.toMatchObject({
      id: "note-1",
      title: "Updated",
      content: "Next step",
      kind: "action",
      pinned: true,
    });
    expect(patches[0]).toEqual({
      title: "Updated",
      note_text: "Next step",
      note_type: "followup_note",
      is_pinned: true,
    });
  });
});
