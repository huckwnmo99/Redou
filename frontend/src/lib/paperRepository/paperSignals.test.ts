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
});
