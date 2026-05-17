import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createFolderRecord,
  fetchPaperIdsByFolder,
  fetchFolders,
  movePaperToFolderAssignment,
} from "./folders";
import { supabase } from "../supabase";

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

function createFetchBuilder(result: unknown) {
  const promise = Promise.resolve(result);
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
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

function createExistingLinksBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function createFolderPaperIdsBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function createDeleteBuilder(result: unknown, deletedFilters: unknown[]) {
  const builder = {
    delete: vi.fn(() => builder),
    eq: vi.fn((column: string, value: string) => {
      deletedFilters.push({ column, value });
      return builder;
    }),
    neq: vi.fn((column: string, value: string) => {
      deletedFilters.push({ column, value });
      return Promise.resolve(result);
    }),
  };
  return builder;
}

describe("paper repository folders", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches folders with direct paper membership counts", async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(createFetchBuilder({
        data: [
          { id: "folder-1", name: "Inbox", parent_folder_id: null, sort_order: 1 },
          { id: "folder-2", name: "Methods", parent_folder_id: "folder-1", sort_order: 2 },
        ],
        error: null,
      }) as never)
      .mockReturnValueOnce(createFetchBuilder({
        data: [
          { paper_id: "paper-1", folder_id: "folder-1" },
          { paper_id: "paper-1", folder_id: "folder-1" },
          { paper_id: "paper-2", folder_id: "folder-2" },
        ],
        error: null,
      }) as never);

    await expect(fetchFolders()).resolves.toEqual([
      {
        id: "folder-1",
        name: "Inbox",
        parentId: undefined,
        paperCount: 1,
      },
      {
        id: "folder-2",
        name: "Methods",
        parentId: "folder-1",
        paperCount: 1,
      },
    ]);
  });

  it("creates folders with the current user id and normalized slug", async () => {
    const insertedRows: unknown[] = [];
    vi.mocked(supabase.from).mockReturnValue(
      createInsertBuilder(
        {
          data: {
            id: "folder-1",
            name: "Redou Methods",
            parent_folder_id: "parent-1",
          },
          error: null,
        },
        insertedRows,
      ) as never,
    );

    await expect(createFolderRecord("  Redou: Methods!  ", "parent-1", async () => "user-1")).resolves.toEqual({
      id: "folder-1",
      name: "Redou Methods",
      parentId: "parent-1",
      paperCount: 0,
    });

    expect(insertedRows[0]).toEqual({
      owner_user_id: "user-1",
      name: "Redou: Methods!",
      slug: "redou-methods",
      parent_folder_id: "parent-1",
    });
  });

  it("fetches unique paper ids for a direct folder scope", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createFolderPaperIdsBuilder({
        data: [
          { paper_id: "paper-1" },
          { paper_id: "paper-1" },
          { paper_id: "paper-2" },
        ],
        error: null,
      }) as never,
    );

    await expect(fetchPaperIdsByFolder("folder-1")).resolves.toEqual(["paper-1", "paper-2"]);
  });

  it("adds missing target folder assignment before cleaning up old folder links", async () => {
    const insertedRows: unknown[] = [];
    const deletedFilters: unknown[] = [];
    vi.mocked(supabase.from)
      .mockReturnValueOnce(createExistingLinksBuilder({
        data: [{ folder_id: "old-folder" }],
        error: null,
      }) as never)
      .mockReturnValueOnce(createInsertBuilder({ data: null, error: null }, insertedRows) as never)
      .mockReturnValueOnce(createDeleteBuilder({ data: null, error: null }, deletedFilters) as never);

    await movePaperToFolderAssignment("paper-1", "target-folder", "user-1");

    expect(insertedRows[0]).toEqual({
      paper_id: "paper-1",
      folder_id: "target-folder",
      assigned_by_user_id: "user-1",
    });
    expect(deletedFilters).toEqual([
      { column: "paper_id", value: "paper-1" },
      { column: "folder_id", value: "target-folder" },
    ]);
  });
});
