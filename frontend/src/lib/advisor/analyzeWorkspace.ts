import type {
  AdvisorCategory,
  AdvisorConfidence,
  AdvisorEvidence,
  AdvisorGeneratedTable,
  AdvisorPaper,
  AdvisorProcessingJob,
  AdvisorSeverity,
  AdvisorSuggestion,
  AdvisorTableCell,
  AdvisorWorkspaceSnapshot,
  AnalyzeWorkspaceOptions,
} from "./types";

const DEFAULT_NOW = "2026-06-01T00:00:00.000Z";
const DEFAULT_STALE_JOB_HOURS = 2;
const DEFAULT_TABLE_NULL_RATIO_THRESHOLD = 0.25;
const DEFAULT_REPEATED_FAILURE_THRESHOLD = 2;

const severityRank: Record<AdvisorSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
};

interface AnalyzerContext {
  now: string;
  staleJobHours: number;
  tableNullRatioThreshold: number;
  repeatedFailureThreshold: number;
}

interface PushSuggestionInput {
  id: string;
  category: AdvisorCategory;
  severity: AdvisorSeverity;
  confidence?: AdvisorConfidence;
  title: string;
  evidence: AdvisorEvidence[];
  whyItMatters: string;
  recommendedAction: string;
  risk: string;
}

export function analyzeWorkspace(
  snapshot: AdvisorWorkspaceSnapshot,
  options: AnalyzeWorkspaceOptions = {},
): AdvisorSuggestion[] {
  const context: AnalyzerContext = {
    now: options.now ?? DEFAULT_NOW,
    staleJobHours: options.staleJobHours ?? DEFAULT_STALE_JOB_HOURS,
    tableNullRatioThreshold: options.tableNullRatioThreshold ?? DEFAULT_TABLE_NULL_RATIO_THRESHOLD,
    repeatedFailureThreshold: options.repeatedFailureThreshold ?? DEFAULT_REPEATED_FAILURE_THRESHOLD,
  };
  const suggestions: AdvisorSuggestion[] = [];

  analyzeProcessingHealth(snapshot, context, suggestions);
  analyzeSearchableDataHealth(snapshot, context, suggestions);
  analyzeExtractionCompleteness(snapshot, context, suggestions);
  analyzeTableQuality(snapshot, context, suggestions);
  analyzeLibraryCleanup(snapshot, context, suggestions);

  return suggestions.sort((left, right) => {
    const severityDelta = severityRank[left.severity] - severityRank[right.severity];
    return severityDelta === 0 ? left.id.localeCompare(right.id) : severityDelta;
  });
}

function analyzeProcessingHealth(
  snapshot: AdvisorWorkspaceSnapshot,
  context: AnalyzerContext,
  suggestions: AdvisorSuggestion[],
) {
  const papers = snapshot.papers ?? [];
  const jobs = snapshot.processingJobs ?? [];
  const primaryFilePaperIds = new Set(
    (snapshot.primaryFiles ?? [])
      .filter((file) => Boolean(file.storedPath?.trim()))
      .map((file) => file.paperId),
  );
  const staleJobs = jobs.filter((job) => {
    if (job.status !== "queued" && job.status !== "running") return false;
    const ageHours = getAgeHours(job.updatedAt ?? job.createdAt, context.now);
    return ageHours !== null && ageHours >= context.staleJobHours;
  });
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const repeatedFailures = countRepeatedFailures(failedJobs, context.repeatedFailureThreshold);
  const papersMissingPrimaryFiles = papers.filter((paper) => !primaryFilePaperIds.has(paper.id));

  if (staleJobs.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "processing-stale-jobs",
      category: "processing",
      severity: staleJobs.some((job) => job.status === "running") ? "high" : "medium",
      title: "Processing jobs may be stuck",
      evidence: [
        { label: "Stale queued or running jobs", value: staleJobs.length, source: "processing_jobs" },
        { label: "Stale threshold hours", value: context.staleJobHours, source: "advisor_options" },
      ],
      whyItMatters: "Stuck processing leaves papers partially imported, unsearchable, or hard to trust.",
      recommendedAction: "Show a reprocess or retry path for stale jobs before adding broader automation.",
      risk: "Low. This suggestion is based only on job status and timestamps.",
    });
  }

  if (failedJobs.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "processing-failed-jobs",
      category: "processing",
      severity: repeatedFailures > 0 ? "high" : "medium",
      title: "Processing failures need attention",
      evidence: [
        { label: "Failed jobs", value: failedJobs.length, source: "processing_jobs" },
        { label: "Repeated failure groups", value: repeatedFailures, source: "processing_jobs" },
      ],
      whyItMatters: "Repeated failures usually explain missing chunks, embeddings, figures, or entity graph data.",
      recommendedAction: "Prioritize a retry or diagnostic surface grouped by paper and job type.",
      risk: "Low. The advisor does not inspect PDF contents or retry jobs automatically.",
    });
  }

  if (papers.length > 0 && papersMissingPrimaryFiles.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "processing-missing-primary-files",
      category: "processing",
      severity: "medium",
      confidence: "medium",
      title: "Some papers are missing primary PDF file records",
      evidence: [
        { label: "Papers missing primary files", value: papersMissingPrimaryFiles.length, source: "papers + paper_files" },
      ],
      whyItMatters: "Reader actions, reprocessing, and source-backed answers depend on a primary file record.",
      recommendedAction: "Add a repair flow that identifies papers without primary file metadata.",
      risk: "Medium. File availability checks can have false positives if the snapshot is incomplete.",
    });
  }
}

function analyzeSearchableDataHealth(
  snapshot: AdvisorWorkspaceSnapshot,
  context: AnalyzerContext,
  suggestions: AdvisorSuggestion[],
) {
  const papers = snapshot.papers ?? [];
  const chunks = snapshot.chunks ?? [];
  const chunkCountsByPaper = countBy(chunks, (chunk) => chunk.paperId);
  const papersWithoutChunks = papers.filter((paper) => (chunkCountsByPaper.get(paper.id) ?? 0) === 0);
  const chunksWithoutEmbeddings = chunks.filter((chunk) => chunk.hasEmbedding === false);
  const papersWithMissingEmbeddings = new Set(chunksWithoutEmbeddings.map((chunk) => chunk.paperId));

  if (papersWithoutChunks.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "search-papers-without-chunks",
      category: "search",
      severity: papersWithoutChunks.length > 3 ? "high" : "medium",
      title: "Some papers are not searchable yet",
      evidence: [
        { label: "Papers without chunks", value: papersWithoutChunks.length, source: "papers + paper_chunks" },
      ],
      whyItMatters: "Chunkless papers cannot participate in semantic search, RAG, or table generation.",
      recommendedAction: "Check import and extraction jobs before tuning retrieval logic.",
      risk: "Low. The count is derived from paper and chunk rows only.",
    });
  }

  if (chunksWithoutEmbeddings.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "search-chunks-without-embeddings",
      category: "search",
      severity: "high",
      title: "Searchable chunks are missing embeddings",
      evidence: [
        { label: "Chunks without embeddings", value: chunksWithoutEmbeddings.length, source: "paper_chunks + chunk_embeddings" },
        { label: "Affected papers", value: papersWithMissingEmbeddings.size, source: "paper_chunks" },
      ],
      whyItMatters: "Semantic search and RAG quality drop sharply when chunks exist but embeddings are missing.",
      recommendedAction: "Add an embedding-health check or expose a retry action for affected papers.",
      risk: "Low. The advisor only reports the missing embedding signal.",
    });
  }
}

function analyzeExtractionCompleteness(
  snapshot: AdvisorWorkspaceSnapshot,
  context: AnalyzerContext,
  suggestions: AdvisorSuggestion[],
) {
  const papers = snapshot.papers ?? [];
  const sections = snapshot.sections ?? [];
  const chunks = snapshot.chunks ?? [];
  const figures = snapshot.figures ?? [];
  const sectionCountsByPaper = countBy(sections, (section) => section.paperId);
  const chunkCountsByPaper = countBy(chunks, (chunk) => chunk.paperId);
  const papersWithoutSections = papers.filter((paper) => (sectionCountsByPaper.get(paper.id) ?? 0) === 0);
  const sparsePapers = papers.filter((paper) => (chunkCountsByPaper.get(paper.id) ?? 0) > 0 && (chunkCountsByPaper.get(paper.id) ?? 0) < 3);
  const figuresMissingCaptions = figures.filter((figure) => !figure.caption?.trim());
  const chunksWithoutPageHints = chunks.filter((chunk) => chunk.page === null || chunk.page === undefined);

  if (papersWithoutSections.length > 0 || sparsePapers.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "extraction-sparse-paper-structure",
      category: "extraction",
      severity: papersWithoutSections.length > 3 ? "high" : "medium",
      title: "Extraction output looks sparse",
      evidence: [
        { label: "Papers without sections", value: papersWithoutSections.length, source: "papers + paper_sections" },
        { label: "Papers with fewer than 3 chunks", value: sparsePapers.length, source: "paper_chunks" },
      ],
      whyItMatters: "Sparse extraction weakens paper detail views, search snippets, figures, and downstream RAG.",
      recommendedAction: "Prioritize extraction completeness diagnostics before adding more retrieval features.",
      risk: "Medium. Some very short PDFs may be valid sparse papers.",
    });
  }

  if (figuresMissingCaptions.length > 0 || chunksWithoutPageHints.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "extraction-missing-evidence-hints",
      category: "extraction",
      severity: "low",
      confidence: "medium",
      title: "Extraction evidence hints are incomplete",
      evidence: [
        { label: "Figures missing captions", value: figuresMissingCaptions.length, source: "figures" },
        { label: "Chunks missing page hints", value: chunksWithoutPageHints.length, source: "paper_chunks" },
      ],
      whyItMatters: "Missing captions or page hints make source inspection and reader navigation harder.",
      recommendedAction: "Track page and caption coverage before investing in richer figure or citation UI.",
      risk: "Low. The suggestion is about metadata completeness, not content quality.",
    });
  }
}

function analyzeTableQuality(
  snapshot: AdvisorWorkspaceSnapshot,
  context: AnalyzerContext,
  suggestions: AdvisorSuggestion[],
) {
  const tables = snapshot.generatedTables ?? [];
  if (tables.length === 0) return;

  const tableStats = tables.map(calculateTableStats);
  const totalCells = sum(tableStats.map((stats) => stats.totalCells));
  const nullCells = sum(tableStats.map((stats) => stats.nullCells));
  const nullRatio = totalCells === 0 ? 0 : nullCells / totalCells;
  const tablesMissingSourceRefs = tables.filter((table) => (table.sourceRefs?.length ?? 0) === 0);
  const fallbackTables = tables.filter((table) => table.extractionMode === "single_call_fallback");
  const unverifiedCells = sum(tables.map((table) => countUnverifiedCells(table)));

  if (totalCells > 0 && nullRatio >= context.tableNullRatioThreshold) {
    pushSuggestion(suggestions, context, {
      id: "table-high-null-ratio",
      category: "table",
      severity: nullRatio >= 0.5 ? "high" : "medium",
      title: "Generated tables have many empty cells",
      evidence: [
        { label: "Empty cell ratio", value: formatPercent(nullRatio), source: "chat_generated_tables.rows" },
        { label: "Empty cells", value: nullCells, source: "chat_generated_tables.rows" },
      ],
      whyItMatters: "High NULL rates often mean retrieval missed evidence or the extraction prompt needs tighter recovery.",
      recommendedAction: "Inspect recurring missing columns before expanding table automation.",
      risk: "Medium. Some requested columns may legitimately be absent from the papers.",
    });
  }

  if (tablesMissingSourceRefs.length > 0 || fallbackTables.length > 0 || unverifiedCells > 0) {
    pushSuggestion(suggestions, context, {
      id: "table-weak-evidence-contract",
      category: "table",
      severity: unverifiedCells > 0 ? "medium" : "low",
      confidence: "medium",
      title: "Some table outputs have weak evidence signals",
      evidence: [
        { label: "Tables without source refs", value: tablesMissingSourceRefs.length, source: "chat_generated_tables.source_refs" },
        { label: "Single-call fallback tables", value: fallbackTables.length, source: "chat_generated_tables.extraction_metadata" },
        { label: "Unverified cells", value: unverifiedCells, source: "chat_generated_tables.verification" },
      ],
      whyItMatters: "Weak evidence signals make generated tables harder to trust or audit.",
      recommendedAction: "Improve table evidence diagnostics before adding new table-generation capabilities.",
      risk: "Low. This only checks stored metadata and verification status.",
    });
  }
}

function analyzeLibraryCleanup(
  snapshot: AdvisorWorkspaceSnapshot,
  context: AnalyzerContext,
  suggestions: AdvisorSuggestion[],
) {
  const papers = snapshot.papers ?? [];
  const folders = snapshot.folders ?? [];
  const papersWithoutFolders = papers.filter((paper) => !paper.folderId);
  const papersMissingMetadata = papers.filter(hasMissingMetadata);
  const duplicateGroups = countDuplicateTitleYearGroups(papers);
  const emptyFolders = folders.filter((folder) => (folder.paperCount ?? 0) === 0);

  if (papersWithoutFolders.length > 0 || papersMissingMetadata.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "library-cleanup-metadata-and-folders",
      category: "library",
      severity: papersWithoutFolders.length > 5 || papersMissingMetadata.length > 5 ? "medium" : "low",
      title: "Library organization has cleanup candidates",
      evidence: [
        { label: "Papers without folders", value: papersWithoutFolders.length, source: "papers.folder_id" },
        { label: "Papers missing metadata", value: papersMissingMetadata.length, source: "papers" },
      ],
      whyItMatters: "Missing folders and metadata make browsing, filtering, and later automation less reliable.",
      recommendedAction: "Consider metadata repair and folder suggestion workflows after core analysis is stable.",
      risk: "Low. This suggestion uses only metadata counts.",
    });
  }

  if (duplicateGroups > 0 || emptyFolders.length > 0) {
    pushSuggestion(suggestions, context, {
      id: "library-cleanup-duplicates-and-empty-folders",
      category: "library",
      severity: "info",
      confidence: "medium",
      title: "Library structure may need light maintenance",
      evidence: [
        { label: "Duplicate title/year groups", value: duplicateGroups, source: "papers.title + papers.year" },
        { label: "Empty folders", value: emptyFolders.length, source: "folders" },
      ],
      whyItMatters: "Small cleanup issues can compound as the library grows.",
      recommendedAction: "Add a review-only cleanup checklist before automatic organization.",
      risk: "Medium. Duplicate detection by title/year is only a heuristic.",
    });
  }
}

function pushSuggestion(
  suggestions: AdvisorSuggestion[],
  context: AnalyzerContext,
  input: PushSuggestionInput,
) {
  suggestions.push({
    confidence: "high",
    createdAt: context.now,
    ...input,
  });
}

function countRepeatedFailures(jobs: AdvisorProcessingJob[], threshold: number): number {
  const counts = countBy(jobs, (job) => `${job.paperId ?? "workspace"}:${job.jobType}`);
  return Array.from(counts.values()).filter((count) => count >= threshold).length;
}

function calculateTableStats(table: AdvisorGeneratedTable): { totalCells: number; nullCells: number } {
  const rows = table.rows ?? [];
  const cells = rows.flat();
  return {
    totalCells: cells.length,
    nullCells: cells.filter(isEmptyCell).length,
  };
}

function countUnverifiedCells(table: AdvisorGeneratedTable): number {
  return (table.verification ?? []).filter((cell) => {
    const status = cell.status?.toLowerCase();
    return status === "unverified" || status === "failed" || status === "mismatch";
  }).length;
}

function isEmptyCell(cell: AdvisorTableCell): boolean {
  if (cell === null || cell === undefined) return true;
  return typeof cell === "string" && (cell.trim() === "" || cell.trim().toLowerCase() === "null");
}

function hasMissingMetadata(paper: AdvisorPaper): boolean {
  const title = paper.title?.trim().toLowerCase() ?? "";
  return title === "" || title === "untitled paper" || !paper.year || (paper.authorsCount ?? 0) === 0;
}

function countDuplicateTitleYearGroups(papers: AdvisorPaper[]): number {
  const counts = countBy(
    papers.filter((paper) => Boolean(paper.title?.trim()) && Boolean(paper.year)),
    (paper) => `${paper.title?.trim().toLowerCase()}::${paper.year}`,
  );
  return Array.from(counts.values()).filter((count) => count > 1).length;
}

function getAgeHours(value: string | null | undefined, now: string): number | null {
  if (!value) return null;
  const startedAt = Date.parse(value);
  const nowAt = Date.parse(now);
  if (!Number.isFinite(startedAt) || !Number.isFinite(nowAt)) return null;
  return Math.max(0, (nowAt - startedAt) / (1000 * 60 * 60));
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
