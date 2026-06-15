import type { CellVerification, ChatGeneratedTable } from "@/types/chat";
import type {
  Folder,
  Paper,
  PaperChunk,
  PaperFigure,
  PaperPrimaryFile,
  PaperSection,
  ProcessingJobStatus,
} from "@/types/paper";

import type {
  AdvisorCellVerification,
  AdvisorGeneratedTable,
  AdvisorProcessingJob,
  AdvisorTableCell,
  AdvisorWorkspaceSnapshot,
} from "./types";

export interface AdvisorProcessingJobSource {
  id: string;
  paper_id?: string | null;
  paperId?: string | null;
  job_type?: string | null;
  jobType?: string | null;
  status: ProcessingJobStatus;
  created_at?: string | null;
  createdAt?: string | null;
  started_at?: string | null;
  startedAt?: string | null;
  finished_at?: string | null;
  finishedAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  error_message?: string | null;
  errorMessage?: string | null;
}

export interface AdvisorGeneratedTableSource {
  id: string;
  rows?: AdvisorTableCell[][] | null;
  source_refs?: unknown[] | null;
  sourceRefs?: unknown[] | null;
  verification?: Array<CellVerification | AdvisorCellVerification> | null;
  extractionMode?: string | null;
  extraction_mode?: string | null;
  extraction_metadata?: {
    extractionMode?: string | null;
    extraction_mode?: string | null;
    mode?: string | null;
  } | null;
}

export interface BuildAdvisorWorkspaceSnapshotInput {
  papers?: Paper[];
  primaryFiles?: PaperPrimaryFile[];
  chunks?: PaperChunk[];
  embeddedChunkIds?: readonly string[];
  sections?: PaperSection[];
  figures?: PaperFigure[];
  processingJobs?: AdvisorProcessingJobSource[];
  generatedTables?: Array<ChatGeneratedTable | AdvisorGeneratedTableSource>;
  folders?: Folder[];
}

export function buildAdvisorWorkspaceSnapshot(input: BuildAdvisorWorkspaceSnapshotInput): AdvisorWorkspaceSnapshot {
  const embeddedChunkIds = input.embeddedChunkIds ? new Set(input.embeddedChunkIds) : null;

  return {
    papers: input.papers?.map((paper) => ({
      id: paper.id,
      title: paper.title,
      year: paper.year,
      authorsCount: paper.authors.length,
      folderId: paper.folderId ?? null,
    })),
    primaryFiles: input.primaryFiles?.map((file) => ({
      paperId: file.paperId,
      storedPath: file.storedPath,
    })),
    chunks: input.chunks?.map((chunk) => ({
      id: chunk.id,
      paperId: chunk.paperId,
      hasEmbedding: embeddedChunkIds ? embeddedChunkIds.has(chunk.id) : undefined,
      page: chunk.page ?? null,
    })),
    sections: input.sections?.map((section) => ({
      id: section.id,
      paperId: section.paperId,
      pageStart: section.pageStart ?? null,
    })),
    figures: input.figures?.map((figure) => ({
      id: figure.id,
      paperId: figure.paperId,
      caption: figure.caption ?? null,
      page: figure.page ?? null,
    })),
    processingJobs: input.processingJobs?.map(mapProcessingJob),
    generatedTables: input.generatedTables?.map(mapGeneratedTable),
    folders: input.folders?.map((folder) => ({
      id: folder.id,
      paperCount: folder.paperCount,
    })),
  };
}

function mapProcessingJob(job: AdvisorProcessingJobSource): AdvisorProcessingJob {
  const createdAt = job.createdAt ?? job.created_at ?? null;
  const startedAt = job.startedAt ?? job.started_at ?? null;
  const finishedAt = job.finishedAt ?? job.finished_at ?? null;
  const updatedAt = job.updatedAt ?? job.updated_at ?? finishedAt ?? startedAt ?? createdAt;

  return {
    id: job.id,
    paperId: job.paperId ?? job.paper_id ?? null,
    jobType: job.jobType ?? job.job_type ?? "unknown",
    status: job.status,
    createdAt,
    updatedAt,
    errorMessage: job.errorMessage ?? job.error_message ?? null,
  };
}

function mapGeneratedTable(table: ChatGeneratedTable | AdvisorGeneratedTableSource): AdvisorGeneratedTable {
  return {
    id: table.id,
    extractionMode: readExtractionMode(table),
    rows: table.rows ?? null,
    sourceRefs: "sourceRefs" in table ? table.sourceRefs ?? null : table.source_refs ?? null,
    verification: table.verification?.map((cell) => ({ status: cell.status })) ?? null,
  };
}

function readExtractionMode(table: ChatGeneratedTable | AdvisorGeneratedTableSource): string | null {
  if ("extractionMode" in table && table.extractionMode) return table.extractionMode;
  if ("extraction_mode" in table && table.extraction_mode) return table.extraction_mode;
  if ("extraction_metadata" in table) {
    return table.extraction_metadata?.extractionMode
      ?? table.extraction_metadata?.extraction_mode
      ?? table.extraction_metadata?.mode
      ?? null;
  }
  return null;
}
