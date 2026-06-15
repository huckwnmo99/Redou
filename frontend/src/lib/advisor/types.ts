export type AdvisorCategory = "processing" | "search" | "extraction" | "table" | "library" | "notes" | "ux";

export type AdvisorSeverity = "info" | "low" | "medium" | "high";

export type AdvisorConfidence = "low" | "medium" | "high";

export interface AdvisorEvidence {
  label: string;
  value: string | number;
  source: string;
}

export interface AdvisorSuggestion {
  id: string;
  category: AdvisorCategory;
  severity: AdvisorSeverity;
  confidence: AdvisorConfidence;
  title: string;
  evidence: AdvisorEvidence[];
  whyItMatters: string;
  recommendedAction: string;
  risk: string;
  createdAt: string;
}

export type AdvisorProcessingStatus = "queued" | "running" | "succeeded" | "failed";

export interface AdvisorPaper {
  id: string;
  title?: string | null;
  year?: number | null;
  authorsCount?: number | null;
  folderId?: string | null;
}

export interface AdvisorPrimaryFile {
  paperId: string;
  storedPath?: string | null;
}

export interface AdvisorChunk {
  id: string;
  paperId: string;
  hasEmbedding?: boolean | null;
  page?: number | null;
}

export interface AdvisorSection {
  id: string;
  paperId: string;
  pageStart?: number | null;
}

export interface AdvisorFigure {
  id: string;
  paperId: string;
  caption?: string | null;
  page?: number | null;
}

export interface AdvisorProcessingJob {
  id: string;
  paperId?: string | null;
  jobType: string;
  status: AdvisorProcessingStatus;
  createdAt?: string | null;
  updatedAt?: string | null;
  errorMessage?: string | null;
}

export type AdvisorTableCell = string | number | boolean | null | undefined;

export interface AdvisorCellVerification {
  status?: string | null;
}

export interface AdvisorGeneratedTable {
  id: string;
  extractionMode?: string | null;
  rows?: AdvisorTableCell[][] | null;
  sourceRefs?: unknown[] | null;
  verification?: AdvisorCellVerification[] | null;
}

export interface AdvisorFolder {
  id: string;
  paperCount?: number | null;
}

export interface AdvisorWorkspaceSnapshot {
  papers?: AdvisorPaper[];
  primaryFiles?: AdvisorPrimaryFile[];
  chunks?: AdvisorChunk[];
  sections?: AdvisorSection[];
  figures?: AdvisorFigure[];
  processingJobs?: AdvisorProcessingJob[];
  generatedTables?: AdvisorGeneratedTable[];
  folders?: AdvisorFolder[];
}

export interface AnalyzeWorkspaceOptions {
  now?: string;
  staleJobHours?: number;
  tableNullRatioThreshold?: number;
  repeatedFailureThreshold?: number;
}
