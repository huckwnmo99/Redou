import type {
  HighlightPreset,
  NoteKind,
  Paper,
  PaperChunk,
  PaperFigure,
  PaperPageAnchor,
  PaperSection,
  PaperSelectionRect,
  PaperSupplementaryFile,
  PaperTextSelectionAnchor,
  ProcessingJobStatus,
  ResearchHighlight,
  ResearchNote,
} from "@/types/paper";

const DB_TO_KIND: Record<string, NoteKind> = {
  summary_note: "summary",
  relevance_note: "insight",
  presentation_note: "insight",
  result_note: "summary",
  followup_note: "action",
  figure_note: "quote",
  question_note: "question",
  custom: "summary",
  memo: "memo",
};

export const KIND_TO_DB: Record<NoteKind, string> = {
  summary: "summary_note",
  insight: "relevance_note",
  question: "question_note",
  quote: "figure_note",
  action: "followup_note",
  memo: "memo",
};

export interface PaperRow {
  id: string;
  title: string;
  publication_year: number | null;
  journal_name: string | null;
  doi: string | null;
  authors: { name: string; affiliation?: string }[] | null;
  abstract: string | null;
  reading_status: string;
  is_important: boolean;
  created_at: string;
  paper_tags?: { tags: { name: string } | null }[];
  paper_folders?: { folder_id: string }[];
}

export interface StoredSelectionAnchor {
  paperId?: string;
  pageNumber?: number;
  pageLabel?: string;
  anchorId?: string;
  quote?: string;
  capturedAt?: string;
  rects?: PaperSelectionRect[];
}

export interface HighlightPresetRow {
  name: string | null;
  color_hex: string | null;
}

export interface HighlightPresetListRow {
  id: string;
  name: string;
  color_hex: string;
  description: string | null;
  sort_order: number;
  is_system_default: boolean;
  is_active: boolean;
}

export interface HighlightRow {
  id: string;
  paper_id: string;
  preset_id: string;
  page: number | null;
  selected_text: string;
  start_anchor: StoredSelectionAnchor | null;
  end_anchor: StoredSelectionAnchor | null;
  created_at: string;
  updated_at: string;
  preset?: HighlightPresetRow | HighlightPresetRow[] | null;
}

export interface NoteHighlightRow {
  id: string;
  page: number | null;
  selected_text: string | null;
  start_anchor: StoredSelectionAnchor | null;
}

export interface NoteRow {
  id: string;
  paper_id: string;
  title: string | null;
  note_text: string;
  note_type: string;
  created_at: string;
  updated_at: string;
  selected_text: string | null;
  is_pinned: boolean;
  page: number | null;
  highlight_id: string | null;
  highlight?: NoteHighlightRow | NoteHighlightRow[] | null;
}

export interface PrimaryFileRow {
  paper_id: string;
  stored_path: string;
  stored_filename: string;
  original_filename: string;
  file_size_bytes: number | null;
}

export interface SupplementaryFileRow {
  id: string;
  paper_id: string;
  stored_path: string;
  stored_filename: string;
  original_filename: string;
  file_size_bytes: number | null;
  is_primary: boolean;
  created_at: string;
}

export interface SectionRow {
  id: string;
  paper_id: string;
  section_name: string;
  section_order: number;
  page_start: number | null;
  page_end: number | null;
  raw_text: string;
  parser_confidence: number | null;
}

export interface ChunkRow {
  id: string;
  paper_id: string;
  section_id: string | null;
  chunk_order: number;
  page: number | null;
  text: string;
  token_count: number | null;
  start_char_offset: number | null;
  end_char_offset: number | null;
  parser_confidence: number | null;
}

export interface FigureRow {
  id: string;
  paper_id: string;
  figure_no: string;
  caption: string | null;
  page: number | null;
  image_path: string | null;
  summary_text: string | null;
  is_key_figure: boolean;
  is_presentation_candidate: boolean;
  item_type: string;
}

export interface ProcessingJobRow {
  paper_id: string | null;
  source_file_id: string | null;
  job_type: string;
  status: ProcessingJobStatus;
  created_at: string;
}

export interface ProcessingSignal {
  status: ProcessingJobStatus;
  updatedAt: string;
}

function toNoteKind(dbType: string): NoteKind {
  return DB_TO_KIND[dbType] ?? "summary";
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function roundRectValue(value: number) {
  return Number(value.toFixed(4));
}

function normalizeSelectionRect(rect: PaperSelectionRect): PaperSelectionRect {
  return {
    x: roundRectValue(rect.x),
    y: roundRectValue(rect.y),
    width: roundRectValue(rect.width),
    height: roundRectValue(rect.height),
  };
}

export function normalizeSelectionAnchor(selection: PaperTextSelectionAnchor): PaperTextSelectionAnchor {
  return {
    ...selection,
    pageLabel: selection.pageLabel.trim() || String(selection.pageNumber),
    anchorId: selection.anchorId.trim() || `paper:${selection.paperId}:page:${selection.pageNumber}`,
    quote: selection.quote.trim(),
    capturedAt: selection.capturedAt,
    rects: selection.rects.map(normalizeSelectionRect),
  };
}

function buildPageAnchor(paperId: string, pageNumber: number, pageLabel?: string, anchorId?: string): PaperPageAnchor {
  const resolvedLabel = pageLabel?.trim() || String(pageNumber);
  return {
    paperId,
    pageNumber,
    pageLabel: resolvedLabel,
    anchorId: anchorId?.trim() || `paper:${paperId}:page:${pageNumber}`,
  };
}

function firstRelationRow<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? undefined;
}

function selectionFromStored(
  paperId: string,
  stored: StoredSelectionAnchor | null,
  fallbackPage: number | null,
  fallbackQuote: string | null,
  fallbackTimestamp: string,
): PaperTextSelectionAnchor | undefined {
  const pageNumber =
    typeof stored?.pageNumber === "number" && Number.isFinite(stored.pageNumber)
      ? stored.pageNumber
      : fallbackPage ?? undefined;

  if (!pageNumber) {
    return undefined;
  }

  const quote = stored?.quote?.trim() || fallbackQuote?.trim();
  if (!quote) {
    return undefined;
  }

  const rects = Array.isArray(stored?.rects)
    ? stored.rects
        .filter(
          (rect) =>
            Number.isFinite(rect?.x) &&
            Number.isFinite(rect?.y) &&
            Number.isFinite(rect?.width) &&
            Number.isFinite(rect?.height),
        )
        .map(normalizeSelectionRect)
    : [];

  return {
    ...buildPageAnchor(paperId, pageNumber, stored?.pageLabel, stored?.anchorId),
    quote,
    capturedAt: stored?.capturedAt?.trim() || fallbackTimestamp,
    rects,
  };
}

export function rowToPaper(
  row: PaperRow,
  noteCountMap: Map<string, number>,
  figureCountMap: Map<string, number>,
  processingMap: Map<string, ProcessingSignal>,
): Paper {
  const tags: string[] = [];
  if (row.paper_tags) {
    for (const paperTag of row.paper_tags) {
      if (paperTag.tags?.name) {
        tags.push(paperTag.tags.name);
      }
    }
  }

  const processing = processingMap.get(row.id);

  return {
    id: row.id,
    title: row.title,
    authors: (row.authors ?? []).map((a) => ({ name: a.name, affiliation: a.affiliation })),
    year: row.publication_year ?? 0,
    venue: row.journal_name ?? "",
    doi: row.doi ?? undefined,
    abstract: row.abstract ?? "",
    tags,
    status: row.reading_status as Paper["status"],
    starred: row.is_important,
    figureCount: figureCountMap.get(row.id) ?? 0,
    noteCount: noteCountMap.get(row.id) ?? 0,
    citationCount: 0,
    folderId: row.paper_folders?.[0]?.folder_id,
    addedAt: row.created_at,
    processingStatus: processing?.status,
    processingUpdatedAt: processing?.updatedAt,
  };
}

export function rowToHighlight(row: HighlightRow): ResearchHighlight {
  const preset = firstRelationRow(row.preset);

  return {
    id: row.id,
    paperId: row.paper_id,
    presetId: row.preset_id,
    presetName: preset?.name ?? undefined,
    colorHex: preset?.color_hex ?? undefined,
    pageNumber: row.page ?? undefined,
    selectedText: row.selected_text,
    startAnchor: selectionFromStored(row.paper_id, row.start_anchor, row.page, row.selected_text, row.created_at),
    endAnchor: selectionFromStored(row.paper_id, row.end_anchor, row.page, row.selected_text, row.updated_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToHighlightPreset(row: HighlightPresetListRow): HighlightPreset {
  return {
    id: row.id,
    name: row.name,
    colorHex: row.color_hex,
    description: row.description ?? undefined,
    sortOrder: row.sort_order,
    isSystemDefault: row.is_system_default,
    isActive: row.is_active,
  };
}

export function rowToSection(row: SectionRow): PaperSection {
  return {
    id: row.id,
    paperId: row.paper_id,
    name: row.section_name,
    order: row.section_order,
    pageStart: row.page_start ?? undefined,
    pageEnd: row.page_end ?? undefined,
    rawText: row.raw_text,
    parserConfidence: row.parser_confidence ?? undefined,
  };
}

export function rowToChunk(row: ChunkRow): PaperChunk {
  return {
    id: row.id,
    paperId: row.paper_id,
    sectionId: row.section_id ?? undefined,
    order: row.chunk_order,
    page: row.page ?? undefined,
    text: row.text,
    tokenCount: row.token_count ?? undefined,
    startCharOffset: row.start_char_offset ?? undefined,
    endCharOffset: row.end_char_offset ?? undefined,
    parserConfidence: row.parser_confidence ?? undefined,
  };
}

export function rowToFigure(row: FigureRow): PaperFigure {
  return {
    id: row.id,
    paperId: row.paper_id,
    figureNo: row.figure_no,
    caption: row.caption ?? undefined,
    page: row.page ?? undefined,
    imagePath: row.image_path ?? undefined,
    summaryText: row.summary_text ?? undefined,
    isKeyFigure: row.is_key_figure,
    isPresentationCandidate: row.is_presentation_candidate,
    itemType: (row.item_type === "table" ? "table" : row.item_type === "equation" ? "equation" : "figure") as PaperFigure["itemType"],
  };
}

export function rowToSupplementaryFile(row: SupplementaryFileRow, processing?: ProcessingSignal): PaperSupplementaryFile {
  return {
    id: row.id,
    paperId: row.paper_id,
    storedPath: row.stored_path,
    storedFilename: row.stored_filename,
    originalFilename: row.original_filename,
    fileSize: row.file_size_bytes ?? undefined,
    isPrimary: false,
    createdAt: row.created_at,
    processingStatus: processing?.status,
    processingUpdatedAt: processing?.updatedAt,
  };
}

export function rowToNote(row: NoteRow): ResearchNote {
  const linkedHighlight = firstRelationRow(row.highlight);
  const linkedSelection = selectionFromStored(
    row.paper_id,
    linkedHighlight?.start_anchor ?? null,
    linkedHighlight?.page ?? row.page,
    linkedHighlight?.selected_text ?? row.selected_text,
    row.updated_at,
  );
  const linkedAnchor = linkedSelection
    ? buildPageAnchor(row.paper_id, linkedSelection.pageNumber, linkedSelection.pageLabel, linkedSelection.anchorId)
    : row.page
      ? buildPageAnchor(row.paper_id, row.page)
      : undefined;

  return {
    id: row.id,
    paperId: row.paper_id,
    title: row.title ?? "",
    content: row.note_text,
    kind: toNoteKind(row.note_type),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    anchorLabel: linkedAnchor ? `Page ${linkedAnchor.pageLabel}` : row.selected_text ?? undefined,
    pinned: row.is_pinned,
    pageNumber: linkedAnchor?.pageNumber,
    highlightId: row.highlight_id ?? linkedHighlight?.id ?? undefined,
    linkedAnchor,
    anchorQuote: linkedHighlight?.selected_text ?? row.selected_text ?? undefined,
  };
}
