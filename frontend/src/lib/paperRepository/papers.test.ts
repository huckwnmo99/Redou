import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPaperRecord, fetchPaperRows, togglePaperStarRecord } from "./papers";
import { supabase } from "../supabase";

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

function createPaperSelectBuilder(result: unknown, calls: unknown[]) {
  const promise = Promise.resolve(result);
  const builder = {
    select: vi.fn(() => builder),
    is: vi.fn((column: string, value: unknown) => {
      calls.push({ method: "is", column, value });
      return builder;
    }),
    order: vi.fn((column: string, options: unknown) => {
      calls.push({ method: "order", column, options });
      return builder;
    }),
    in: vi.fn((column: string, value: unknown) => {
      calls.push({ method: "in", column, value });
      return builder;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      calls.push({ method: "eq", column, value });
      return builder;
    }),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
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

describe("paper repository papers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches paper rows with database filters before applying client search", async () => {
    const calls: unknown[] = [];
    vi.mocked(supabase.from).mockReturnValue(
      createPaperSelectBuilder(
        {
          data: [
            {
              id: "paper-1",
              title: "Redou Architecture",
              publication_year: 2026,
              journal_name: "Systems",
              doi: null,
              authors: [],
              abstract: "debuggable architecture",
              reading_status: "unread",
              is_important: true,
              created_at: "2026-05-15T00:00:00.000Z",
              paper_tags: [],
              paper_folders: [],
            },
            {
              id: "paper-2",
              title: "Other Work",
              publication_year: 2024,
              journal_name: "Biology",
              doi: null,
              authors: [],
              abstract: "unrelated",
              reading_status: "unread",
              is_important: true,
              created_at: "2026-05-14T00:00:00.000Z",
              paper_tags: [],
              paper_folders: [],
            },
          ],
          error: null,
        },
        calls,
      ) as never,
    );

    const rows = await fetchPaperRows({
      ids: ["paper-1", "paper-2"],
      starred: true,
      search: "architecture",
    });

    expect(rows.map((row) => row.id)).toEqual(["paper-1"]);
    expect(calls).toEqual([
      { method: "is", column: "trashed_at", value: null },
      { method: "order", column: "created_at", options: { ascending: false } },
      { method: "in", column: "id", value: ["paper-1", "paper-2"] },
      { method: "eq", column: "is_important", value: true },
    ]);
  });

  it("creates imported paper records with normalized metadata", async () => {
    const insertedRows: unknown[] = [];
    vi.mocked(supabase.from).mockReturnValue(
      createInsertBuilder(
        {
          data: { id: "paper-1" },
          error: null,
        },
        insertedRows,
      ) as never,
    );

    await expect(
      createPaperRecord({
        userId: "user-1",
        title: "  Redou Architecture  ",
        year: 2026,
        venue: "  Systems  ",
      }),
    ).resolves.toBe("paper-1");

    expect(insertedRows[0]).toEqual({
      owner_user_id: "user-1",
      title: "  Redou Architecture  ",
      normalized_title: "redou architecture",
      publication_year: 2026,
      journal_name: "Systems",
      abstract: "",
      language: "en",
      reading_status: "unread",
      metadata_confidence: 0.1,
    });
  });

  it("throws when paper creation does not return an id", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createInsertBuilder(
        {
          data: { id: "" },
          error: null,
        },
        [],
      ) as never,
    );

    await expect(
      createPaperRecord({
        userId: "user-1",
        title: "Missing Id",
      }),
    ).rejects.toThrow("Unable to resolve the created paper id.");
  });

  it("toggles paper star state through the existing rpc", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);

    await expect(togglePaperStarRecord("paper-1")).resolves.toBeUndefined();

    expect(supabase.rpc).toHaveBeenCalledWith("toggle_paper_star", {
      paper_id: "paper-1",
    });
  });
});
