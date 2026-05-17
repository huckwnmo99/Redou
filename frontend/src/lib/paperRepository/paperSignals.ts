import { supabase } from "../supabase";
import type {
  ProcessingJobRow,
  ProcessingSignal,
} from "./mappers";

export interface PaperSignals {
  noteMap: Map<string, number>;
  figureMap: Map<string, number>;
  processingMap: Map<string, ProcessingSignal>;
}

export async function fetchPaperSignals(): Promise<PaperSignals> {
  const [noteRes, figureRes, primaryFileRes, jobRes] = await Promise.all([
    supabase.from("notes").select("paper_id"),
    supabase.from("figures").select("paper_id"),
    supabase.from("paper_files").select("id, paper_id").eq("is_primary", true),
    supabase
      .from("processing_jobs")
      .select("paper_id, source_file_id, job_type, status, created_at")
      .eq("job_type", "import_pdf")
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
  const processingMap = new Map<string, ProcessingSignal>();
  for (const row of (jobRes.data ?? []) as ProcessingJobRow[]) {
    if (!row.paper_id || processingMap.has(row.paper_id)) {
      continue;
    }

    if (canFilterByPrimarySource && row.source_file_id && !primaryFileIds.has(row.source_file_id)) {
      continue;
    }

    processingMap.set(row.paper_id, {
      status: row.status,
      updatedAt: row.created_at,
    });
  }

  return { noteMap, figureMap, processingMap };
}
