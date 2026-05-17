import { supabase } from "../supabase";
import {
  rowToSupplementaryFile,
} from "./mappers";
import type {
  PrimaryFileRow,
  ProcessingJobRow,
  ProcessingSignal,
  SupplementaryFileRow,
} from "./mappers";
import type { FileImportResult } from "@/types/desktop";
import type {
  PaperPrimaryFile,
  PaperSupplementaryFile,
} from "@/types/paper";

export async function createPaperFileRecord(
  paperId: string,
  storedFile: FileImportResult,
  options: { fileKind?: "main_pdf" | "supplementary_pdf"; isPrimary?: boolean } = {},
): Promise<string> {
  const { data, error } = await supabase
    .from("paper_files")
    .insert({
      paper_id: paperId,
      file_kind: options.fileKind ?? "main_pdf",
      original_filename: storedFile.originalFilename,
      stored_filename: storedFile.storedFilename,
      stored_path: storedFile.storedPath,
      checksum_sha256: storedFile.checksum,
      file_size_bytes: storedFile.fileSize,
      mime_type: "application/pdf",
      is_primary: options.isPrimary ?? true,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "Unable to create the paper file record.");
  }

  return data.id as string;
}

export async function createImportJobRecord(
  paperId: string,
  userId: string,
  storedPath: string,
  sourceFileId?: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("processing_jobs")
    .insert({
      paper_id: paperId,
      user_id: userId,
      job_type: "import_pdf",
      status: "queued",
      source_path: storedPath,
      source_file_id: sourceFileId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create the processing job.");
  }

  return data.id as string;
}

export async function fetchSupplementaryPaperFiles(paperId: string): Promise<PaperSupplementaryFile[]> {
  const { data, error } = await supabase
    .from("paper_files")
    .select("id, paper_id, stored_path, stored_filename, original_filename, file_size_bytes, is_primary, created_at")
    .eq("paper_id", paperId)
    .eq("file_kind", "supplementary_pdf")
    .eq("is_primary", false)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SupplementaryFileRow[];
  const fileIds = rows.map((row) => row.id);
  const processingMap = new Map<string, ProcessingSignal>();

  if (fileIds.length > 0) {
    const { data: jobs, error: jobError } = await supabase
      .from("processing_jobs")
      .select("source_file_id, status, created_at")
      .eq("paper_id", paperId)
      .eq("job_type", "import_pdf")
      .in("source_file_id", fileIds)
      .order("created_at", { ascending: false });

    if (jobError) {
      throw new Error(jobError.message);
    }

    for (const job of (jobs ?? []) as Pick<ProcessingJobRow, "source_file_id" | "status" | "created_at">[]) {
      if (!job.source_file_id || processingMap.has(job.source_file_id)) {
        continue;
      }

      processingMap.set(job.source_file_id, {
        status: job.status,
        updatedAt: job.created_at,
      });
    }
  }

  return rows.map((row) => rowToSupplementaryFile(row, processingMap.get(row.id)));
}

export async function fetchPrimaryPaperFile(paperId: string): Promise<PaperPrimaryFile | undefined> {
  const { data, error } = await supabase
    .from("paper_files")
    .select("paper_id, stored_path, stored_filename, original_filename, file_size_bytes")
    .eq("paper_id", paperId)
    .eq("is_primary", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return undefined;
  }

  const row = data as PrimaryFileRow;

  return {
    paperId: row.paper_id,
    storedPath: row.stored_path,
    storedFilename: row.stored_filename,
    originalFilename: row.original_filename,
    fileSize: row.file_size_bytes ?? undefined,
  };
}

export async function deleteImportJobRecord(id: string): Promise<void> {
  const { error } = await supabase.from("processing_jobs").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}

export async function deletePaperFileRecord(id: string): Promise<void> {
  const { error } = await supabase.from("paper_files").delete().eq("id", id);
  if (error) {
    throw new Error(error.message);
  }
}
