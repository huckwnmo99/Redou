import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createImportJobRecord,
  createPaperFileRecord,
  fetchPrimaryPaperFile,
  fetchSupplementaryPaperFiles,
} from "./source-files";
import { supabase } from "../supabase";

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

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

function createPrimaryFileBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function createSupplementaryFilesBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

function createProcessingJobsBuilder(result: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => Promise.resolve(result)),
  };
  return builder;
}

describe("paper repository source files", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates a primary paper file record from an imported desktop file", async () => {
    const insertedRows: unknown[] = [];
    vi.mocked(supabase.from).mockReturnValue(
      createInsertBuilder({ data: { id: "source-1" }, error: null }, insertedRows) as never,
    );

    await expect(
      createPaperFileRecord("paper-1", {
        originalFilename: "paper.pdf",
        storedFilename: "paper-1.pdf",
        storedPath: "C:/Redou/paper-1.pdf",
        checksum: "sha",
        fileSize: 1234,
      }),
    ).resolves.toBe("source-1");

    expect(supabase.from).toHaveBeenCalledWith("paper_files");
    expect(insertedRows[0]).toMatchObject({
      paper_id: "paper-1",
      file_kind: "main_pdf",
      original_filename: "paper.pdf",
      stored_filename: "paper-1.pdf",
      stored_path: "C:/Redou/paper-1.pdf",
      checksum_sha256: "sha",
      file_size_bytes: 1234,
      mime_type: "application/pdf",
      is_primary: true,
    });
  });

  it("creates queued import jobs scoped to a source file", async () => {
    const insertedRows: unknown[] = [];
    vi.mocked(supabase.from).mockReturnValue(
      createInsertBuilder({ data: { id: "job-1" }, error: null }, insertedRows) as never,
    );

    await expect(createImportJobRecord("paper-1", "user-1", "C:/Redou/supp.pdf", "source-1")).resolves.toBe("job-1");
    expect(supabase.from).toHaveBeenCalledWith("processing_jobs");
    expect(insertedRows[0]).toEqual({
      paper_id: "paper-1",
      user_id: "user-1",
      job_type: "import_pdf",
      status: "queued",
      source_path: "C:/Redou/supp.pdf",
      source_file_id: "source-1",
    });
  });

  it("maps the primary paper file facade shape", async () => {
    vi.mocked(supabase.from).mockReturnValue(
      createPrimaryFileBuilder({
        data: {
          paper_id: "paper-1",
          stored_path: "C:/Redou/paper.pdf",
          stored_filename: "paper.pdf",
          original_filename: "Original.pdf",
          file_size_bytes: 1024,
        },
        error: null,
      }) as never,
    );

    await expect(fetchPrimaryPaperFile("paper-1")).resolves.toEqual({
      paperId: "paper-1",
      storedPath: "C:/Redou/paper.pdf",
      storedFilename: "paper.pdf",
      originalFilename: "Original.pdf",
      fileSize: 1024,
    });
  });

  it("maps supplementary files with latest source-scoped processing status", async () => {
    const filesBuilder = createSupplementaryFilesBuilder({
      data: [
        {
          id: "source-1",
          paper_id: "paper-1",
          stored_path: "C:/Redou/supp.pdf",
          stored_filename: "supp.pdf",
          original_filename: "Supplement.pdf",
          file_size_bytes: 2048,
          is_primary: false,
          created_at: "2026-05-15T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const jobsBuilder = createProcessingJobsBuilder({
      data: [
        {
          source_file_id: "source-1",
          status: "running",
          created_at: "2026-05-15T01:00:00.000Z",
        },
        {
          source_file_id: "source-1",
          status: "queued",
          created_at: "2026-05-15T00:30:00.000Z",
        },
      ],
      error: null,
    });
    vi.mocked(supabase.from)
      .mockReturnValueOnce(filesBuilder as never)
      .mockReturnValueOnce(jobsBuilder as never);

    await expect(fetchSupplementaryPaperFiles("paper-1")).resolves.toMatchObject([
      {
        id: "source-1",
        paperId: "paper-1",
        originalFilename: "Supplement.pdf",
        processingStatus: "running",
        processingUpdatedAt: "2026-05-15T01:00:00.000Z",
      },
    ]);
    expect(jobsBuilder.in).toHaveBeenCalledWith("source_file_id", ["source-1"]);
  });
});
