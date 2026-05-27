import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPaperSignals } from "./paperSignals";
import { supabase } from "../supabase";

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

function createSignalBuilder(result: unknown) {
  const promise = Promise.resolve(result);
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return builder;
}

describe("paper repository paper signals", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("aggregates note and figure counts by paper", async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(createSignalBuilder({
        data: [{ paper_id: "paper-1" }, { paper_id: "paper-1" }, { paper_id: "paper-2" }],
        error: null,
      }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: [{ paper_id: "paper-1" }, { paper_id: "paper-3" }],
        error: null,
      }) as never)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never);

    const signals = await fetchPaperSignals();

    expect(signals.noteMap).toEqual(new Map([
      ["paper-1", 2],
      ["paper-2", 1],
    ]));
    expect(signals.figureMap).toEqual(new Map([
      ["paper-1", 1],
      ["paper-3", 1],
    ]));
  });

  it("keeps the latest primary-source processing status and ignores supplementary jobs", async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: [{ id: "source-main", paper_id: "paper-1" }],
        error: null,
      }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: [
          {
            paper_id: "paper-1",
            source_file_id: "source-supp",
            job_type: "import_pdf",
            status: "failed",
            created_at: "2026-05-15T02:00:00.000Z",
          },
          {
            paper_id: "paper-1",
            source_file_id: "source-main",
            job_type: "import_pdf",
            status: "running",
            created_at: "2026-05-15T01:00:00.000Z",
          },
          {
            paper_id: "paper-1",
            source_file_id: "source-main",
            job_type: "import_pdf",
            status: "queued",
            created_at: "2026-05-15T00:30:00.000Z",
          },
        ],
        error: null,
      }) as never);

    const signals = await fetchPaperSignals();

    expect(signals.processingMap.get("paper-1")).toEqual({
      status: "running",
      updatedAt: "2026-05-15T01:00:00.000Z",
    });
  });

  it("falls back to unfiltered processing status when primary file lookup fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(supabase.from)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: null,
        error: { message: "paper_files unavailable" },
      }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: [
          {
            paper_id: "paper-1",
            source_file_id: "source-supp",
            job_type: "import_pdf",
            status: "queued",
            created_at: "2026-05-15T00:00:00.000Z",
          },
        ],
        error: null,
      }) as never);

    const signals = await fetchPaperSignals();

    expect(signals.processingMap.get("paper-1")).toEqual({
      status: "queued",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });
    expect(warnSpy).toHaveBeenCalledWith("[fetchPaperSignals] paper_files query failed:", "paper_files unavailable");
  });

  it("marks a paper Complete only when both import and embeddings succeed", async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: [
          { id: "src-1", paper_id: "paper-1" },
          { id: "src-2", paper_id: "paper-2" },
          { id: "src-3", paper_id: "paper-3" },
        ],
        error: null,
      }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: [
          // paper-1: import + embeddings both succeeded -> Complete
          {
            paper_id: "paper-1",
            source_file_id: "src-1",
            job_type: "generate_embeddings",
            status: "succeeded",
            created_at: "2026-05-15T02:00:00.000Z",
          },
          {
            paper_id: "paper-1",
            source_file_id: "src-1",
            job_type: "import_pdf",
            status: "succeeded",
            created_at: "2026-05-15T01:00:00.000Z",
          },
          // paper-2: import succeeded but embeddings still running -> running
          {
            paper_id: "paper-2",
            source_file_id: "src-2",
            job_type: "generate_embeddings",
            status: "running",
            created_at: "2026-05-15T03:00:00.000Z",
          },
          {
            paper_id: "paper-2",
            source_file_id: "src-2",
            job_type: "import_pdf",
            status: "succeeded",
            created_at: "2026-05-15T02:30:00.000Z",
          },
          // paper-3: import succeeded, no embeddings job yet -> still in progress
          {
            paper_id: "paper-3",
            source_file_id: "src-3",
            job_type: "import_pdf",
            status: "succeeded",
            created_at: "2026-05-15T04:00:00.000Z",
          },
        ],
        error: null,
      }) as never);

    const signals = await fetchPaperSignals();

    // Both core jobs succeeded -> Complete, timestamp = most recent core job.
    expect(signals.processingMap.get("paper-1")).toEqual({
      status: "succeeded",
      updatedAt: "2026-05-15T02:00:00.000Z",
    });
    // Embeddings running -> paper is in progress (regression: previously the
    // import-only check reported this as Complete).
    expect(signals.processingMap.get("paper-2")).toEqual({
      status: "running",
      updatedAt: "2026-05-15T03:00:00.000Z",
    });
    // Embeddings job not enqueued yet -> queued, never Complete on import alone.
    expect(signals.processingMap.get("paper-3")).toEqual({
      status: "queued",
      updatedAt: "2026-05-15T04:00:00.000Z",
    });
  });

  it("reports failed when a core job fails even if the other succeeded", async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({ data: [], error: null }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: [{ id: "src-1", paper_id: "paper-1" }],
        error: null,
      }) as never)
      .mockReturnValueOnce(createSignalBuilder({
        data: [
          {
            paper_id: "paper-1",
            source_file_id: "src-1",
            job_type: "generate_embeddings",
            status: "failed",
            created_at: "2026-05-15T02:00:00.000Z",
          },
          {
            paper_id: "paper-1",
            source_file_id: "src-1",
            job_type: "import_pdf",
            status: "succeeded",
            created_at: "2026-05-15T01:00:00.000Z",
          },
        ],
        error: null,
      }) as never);

    const signals = await fetchPaperSignals();

    expect(signals.processingMap.get("paper-1")).toEqual({
      status: "failed",
      updatedAt: "2026-05-15T02:00:00.000Z",
    });
  });
});
