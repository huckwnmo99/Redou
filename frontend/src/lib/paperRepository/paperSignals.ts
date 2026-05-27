import { supabase } from "../supabase";
import type { ProcessingJobStatus } from "@/types/paper";
import type {
  ProcessingJobRow,
  ProcessingSignal,
} from "./mappers";

export interface PaperSignals {
  noteMap: Map<string, number>;
  figureMap: Map<string, number>;
  processingMap: Map<string, ProcessingSignal>;
}

// Core pipeline jobs that determine the library "Complete" status.
// extract_entities is intentionally excluded: it is a graceful-degradation
// add-on and its failure must not flip a paper's core status away from
// "Complete" (the paper is still fully readable/searchable without entities).
const CORE_JOB_TYPES = ["import_pdf", "generate_embeddings"] as const;

// Lower number = higher precedence when synthesizing the combined status.
const STATUS_PRECEDENCE: Record<ProcessingJobStatus, number> = {
  failed: 0,
  running: 1,
  queued: 2,
  succeeded: 3,
};

export async function fetchPaperSignals(): Promise<PaperSignals> {
  const [noteRes, figureRes, primaryFileRes, jobRes] = await Promise.all([
    supabase.from("notes").select("paper_id"),
    supabase.from("figures").select("paper_id"),
    supabase.from("paper_files").select("id, paper_id").eq("is_primary", true),
    supabase
      .from("processing_jobs")
      .select("paper_id, source_file_id, job_type, status, created_at")
      .in("job_type", CORE_JOB_TYPES as unknown as string[])
      .order("created_at", { ascending: false }),
  ]);

  if (noteRes.error) console.warn("[fetchPaperSignals] notes query failed:", noteRes.error.message);
  if (figureRes.error) console.warn("[fetchPaperSignals] figures query failed:", figureRes.error.message);
  if (primaryFileRes.error) console.warn("[fetchPaperSignals] paper_files query failed:", primaryFileRes.error.message);
  if (jobRes.error) console.warn("[fetchPaperSignals] processing_jobs query failed:", jobRes.error.message);

  const noteMap = new Map<string, number>();
  for (const row of noteRes.data ?? []) {
    noteMap.set(row.paper_id, (noteMap.get(row.paper_id) ?? 0) + 1);
  }

  const figureMap = new Map<string, number>();
  for (const row of figureRes.data ?? []) {
    figureMap.set(row.paper_id, (figureMap.get(row.paper_id) ?? 0) + 1);
  }

  const primaryFileIds = new Set((primaryFileRes.data ?? []).map((row) => row.id).filter(Boolean));
  const canFilterByPrimarySource = !primaryFileRes.error;

  // Collect the latest signal per (paper, core job_type). jobRes is ordered by
  // created_at desc, so the first row we see for a (paper, type) pair is newest.
  const latestByType = new Map<string, Map<string, ProcessingSignal>>();
  for (const row of (jobRes.data ?? []) as ProcessingJobRow[]) {
    if (!row.paper_id) {
      continue;
    }

    if (canFilterByPrimarySource && row.source_file_id && !primaryFileIds.has(row.source_file_id)) {
      continue;
    }

    let perType = latestByType.get(row.paper_id);
    if (!perType) {
      perType = new Map<string, ProcessingSignal>();
      latestByType.set(row.paper_id, perType);
    }
    if (perType.has(row.job_type)) {
      continue;
    }
    perType.set(row.job_type, { status: row.status, updatedAt: row.created_at });
  }

  // Synthesize the core "Complete" status from import_pdf + generate_embeddings.
  // - "succeeded" only when BOTH core jobs are present and succeeded.
  // - any failed -> failed, any running -> running, otherwise queued.
  //   (A missing generate_embeddings job means embeddings have not finished yet,
  //   so the paper is still in progress rather than complete.)
  const processingMap = new Map<string, ProcessingSignal>();
  for (const [paperId, perType] of latestByType) {
    let combinedStatus: ProcessingJobStatus | null = null;
    let combinedUpdatedAt: string | undefined;

    for (const jobType of CORE_JOB_TYPES) {
      const signal = perType.get(jobType);
      // A missing core job (e.g. embeddings not enqueued yet) counts as still
      // in progress ("queued") so an import-only paper never shows "Complete".
      const candidateStatus: ProcessingJobStatus = signal ? signal.status : "queued";

      if (combinedStatus === null || STATUS_PRECEDENCE[candidateStatus] < STATUS_PRECEDENCE[combinedStatus]) {
        combinedStatus = candidateStatus;
      }
      if (signal && (!combinedUpdatedAt || signal.updatedAt > combinedUpdatedAt)) {
        combinedUpdatedAt = signal.updatedAt;
      }
    }

    if (combinedStatus === null) {
      continue;
    }

    // Because a missing core job contributes "queued" (precedence above
    // "succeeded"), combinedStatus can only be "succeeded" when BOTH core jobs
    // are present and succeeded.
    processingMap.set(paperId, {
      status: combinedStatus,
      updatedAt: combinedUpdatedAt ?? new Date(0).toISOString(),
    });
  }

  return { noteMap, figureMap, processingMap };
}
