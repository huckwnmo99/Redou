import { supabase } from "./supabase";
import type {
  Folder,
  ImportedPaperDraft,
  ImportedPaperResult,
  HighlightPreset,
  NoteKind,
  PaperChunk,
  PaperFigure,
  PaperSection,
  Paper,
  PaperPageAnchor,
  PaperPrimaryFile,
  PaperSelectionRect,
  PaperTextSelectionAnchor,
  ProcessingJobStatus,
  ResearchHighlight,
  ResearchNote,
} from "@/types/paper";
import type { FileImportResult } from "@/types/desktop";

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

const KIND_TO_DB: Record<NoteKind, string> = {
  summary: "summary_note",
  insight: "relevance_note",
  question: "question_note",
  quote: "figure_note",
  action: "followup_note",
  memo: "memo",
};

const noteSelect =
  "id, paper_id, title, note_text, note_type, created_at, updated_at, selected_text, is_pinned, page, highlight_id, highlight:highlights(id, page, selected_text, start_anchor)";

const highlightSelect =
  "id, paper_id, preset_id, page, selected_text, start_anchor, end_anchor, created_at, updated_at, preset:highlight_presets(name, color_hex)";

const presetSelect =
  "id, name, color_hex, description, sort_order, is_system_default, is_active";

interface PaperRow {
  id: string;
  title: string;
  publication_year: number | null;
  journal_name: string | null;
  abstract: string | null;
  reading_status: string;
  is_important: boolean;
  created_at: string;
  paper_tags?: { tags: { name: string } | null }[];
  paper_folders?: { folder_id: string }[];
}

interface StoredSelectionAnchor {
  paperId?: string;
  pageNumber?: number;
  pageLabel?: string;
  anchorId?: string;
  quote?: string;
  capturedAt?: string;
  rects?: PaperSelectionRect[];
}

interface HighlightPresetRow {
  name: string | null;
  color_hex: string | null;
}

interface HighlightPresetListRow {
  id: string;
  name: string;
  color_hex: string;
  description: string | null;
  sort_order: number;
  is_system_default: boolean;
  is_active: boolean;
}

interface HighlightRow {
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

interface NoteHighlightRow {
  id: string;
  page: number | null;
  selected_text: string | null;
  start_anchor: StoredSelectionAnchor | null;
}

interface NoteRow {
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

interface PrimaryFileRow {
  paper_id: string;
  stored_path: string;
  stored_filename: string;
  original_filename: string;
  file_size_bytes: number | null;
}

interface SectionRow {
  id: string;
  paper_id: string;
  section_name: string;
  section_order: number;
  page_start: number | null;
  page_end: number | null;
  raw_text: string;
  parser_confidence: number | null;
}

interface ChunkRow {
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

interface FigureRow {
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

interface ProcessingJobRow {
  paper_id: string | null;
  status: ProcessingJobStatus;
  created_at: string;
}

interface ProcessingSignal {
  status: ProcessingJobStatus;
  updatedAt: string;
}

function toNoteKind(dbType: string): NoteKind {
  return DB_TO_KIND[dbType] ?? "summary";
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function toSlug(value: string): string {
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

function normalizeSelectionAnchor(selection: PaperTextSelectionAnchor): PaperTextSelectionAnchor {
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

function rowToPaper(
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
    authors: [],
    year: row.publication_year ?? 0,
    venue: row.journal_name ?? "",
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

function rowToHighlight(row: HighlightRow): ResearchHighlight {
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

function rowToHighlightPreset(row: HighlightPresetListRow): HighlightPreset {
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

function rowToSection(row: SectionRow): PaperSection {
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

function rowToChunk(row: ChunkRow): PaperChunk {
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

function rowToFigure(row: FigureRow): PaperFigure {
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

function rowToNote(row: NoteRow): ResearchNote {
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

async function fetchPaperSignals() {
  const [noteRes, figureRes, jobRes] = await Promise.all([
    supabase.from("notes").select("paper_id"),
    supabase.from("figures").select("paper_id"),
    supabase.from("processing_jobs").select("paper_id, status, created_at").order("created_at", { ascending: false }),
  ]);

  const noteMap = new Map<string, number>();
  for (const row of noteRes.data ?? []) {
    noteMap.set(row.paper_id, (noteMap.get(row.paper_id) ?? 0) + 1);
  }

  const figureMap = new Map<string, number>();
  for (const row of figureRes.data ?? []) {
    figureMap.set(row.paper_id, (figureMap.get(row.paper_id) ?? 0) + 1);
  }

  const processingMap = new Map<string, ProcessingSignal>();
  for (const row of (jobRes.data ?? []) as ProcessingJobRow[]) {
    if (!row.paper_id || processingMap.has(row.paper_id)) {
      continue;
    }

    processingMap.set(row.paper_id, {
      status: row.status,
      updatedAt: row.created_at,
    });
  }

  return { noteMap, figureMap, processingMap };
}

async function fetchPapersRaw(filter?: {
  ids?: string[];
  starred?: boolean;
  search?: string;
}) {
  let query = supabase
    .from("papers")
    .select(
      "id, title, publication_year, journal_name, abstract, reading_status, is_important, created_at, paper_tags(tags(name)), paper_folders(folder_id)",
    )
    .is("trashed_at", null)
    .order("created_at", { ascending: false });

  if (filter?.ids) {
    query = query.in("id", filter.ids);
  }

  if (filter?.starred) {
    query = query.eq("is_important", true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  let papers = (data ?? []) as unknown as PaperRow[];

  if (filter?.search) {
    const normalized = filter.search.toLowerCase();
    papers = papers.filter(
      (paper) =>
        paper.title.toLowerCase().includes(normalized) ||
        (paper.journal_name ?? "").toLowerCase().includes(normalized) ||
        (paper.abstract ?? "").toLowerCase().includes(normalized),
    );
  }

  return papers;
}

async function currentUserId(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw new Error(`Unable to read the current auth session: ${error.message}`);
  }

  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("Your session is no longer available. Sign in again before changing papers, notes, folders, or highlights.");
  }

  return userId;
}

async function attachPaperToFolder(paperId: string, folderId: string, userId: string) {
  const { error } = await supabase.from("paper_folders").insert({
    paper_id: paperId,
    folder_id: folderId,
    assigned_by_user_id: userId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function movePaperToFolderAssignment(paperId: string, folderId: string, userId: string) {
  const { data: existingLinks, error: existingError } = await supabase
    .from("paper_folders")
    .select("folder_id")
    .eq("paper_id", paperId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const assignedFolderIds = new Set((existingLinks ?? []).map((link) => link.folder_id).filter(Boolean));

  if (!assignedFolderIds.has(folderId)) {
    await attachPaperToFolder(paperId, folderId, userId);
  }

  const { error: cleanupError } = await supabase
    .from("paper_folders")
    .delete()
    .eq("paper_id", paperId)
    .neq("folder_id", folderId);

  if (cleanupError) {
    throw new Error(cleanupError.message);
  }
}

async function insertPaperFile(paperId: string, storedFile: FileImportResult) {
  const { error } = await supabase.from("paper_files").insert({
    paper_id: paperId,
    file_kind: "main_pdf",
    original_filename: storedFile.originalFilename,
    stored_filename: storedFile.storedFilename,
    stored_path: storedFile.storedPath,
    checksum_sha256: storedFile.checksum,
    file_size_bytes: storedFile.fileSize,
    mime_type: "application/pdf",
    is_primary: true,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function createImportJob(paperId: string, userId: string, storedPath: string) {
  const { data, error } = await supabase
    .from("processing_jobs")
    .insert({
      paper_id: paperId,
      user_id: userId,
      job_type: "import_pdf",
      status: "queued",
      source_path: storedPath,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create the processing job.");
  }

  return data.id as string;
}

async function getDefaultHighlightPresetId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("highlight_presets")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "No active highlight preset is available for this workspace.");
  }

  return data.id as string;
}

async function getHighlightById(highlightId: string, userId?: string): Promise<ResearchHighlight | undefined> {
  let query = supabase
    .from("highlights")
    .select(highlightSelect)
    .eq("id", highlightId)
    .limit(1);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return undefined;
  }

  return rowToHighlight(data as HighlightRow);
}

async function findExistingHighlight(
  paperId: string,
  userId: string,
  selection: PaperTextSelectionAnchor,
): Promise<HighlightRow | undefined> {
  const { data, error } = await supabase
    .from("highlights")
    .select(highlightSelect)
    .eq("paper_id", paperId)
    .eq("user_id", userId)
    .eq("page", selection.pageNumber)
    .eq("selected_text", selection.quote)
    .contains("start_anchor", { anchorId: selection.anchorId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? undefined) as HighlightRow | undefined;
}

async function getOrCreateSelectionHighlight(input: {
  paperId: string;
  userId: string;
  selectionAnchor: PaperTextSelectionAnchor;
  presetId?: string;
}): Promise<ResearchHighlight> {
  const normalizedSelection = normalizeSelectionAnchor(input.selectionAnchor);
  const existing = await findExistingHighlight(input.paperId, input.userId, normalizedSelection);
  if (existing) {
    return rowToHighlight(existing);
  }

  const presetId = input.presetId ?? (await getDefaultHighlightPresetId(input.userId));

  const { data, error } = await supabase
    .from("highlights")
    .insert({
      paper_id: input.paperId,
      user_id: input.userId,
      preset_id: presetId,
      page: normalizedSelection.pageNumber,
      selected_text: normalizedSelection.quote,
      start_anchor: normalizedSelection,
      end_anchor: normalizedSelection,
    })
    .select(highlightSelect)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to save the highlight selection.");
  }

  return rowToHighlight(data as HighlightRow);
}

export const supabasePaperRepository = {
  async getAllPapers(): Promise<Paper[]> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([fetchPapersRaw(), fetchPaperSignals()]);
    return rows.map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async getPaperById(id: string): Promise<Paper | undefined> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([
      fetchPapersRaw({ ids: [id] }),
      fetchPaperSignals(),
    ]);
    const row = rows[0];
    return row ? rowToPaper(row, noteMap, figureMap, processingMap) : undefined;
  },

  async getPapersByFolder(folderId: string): Promise<Paper[]> {
    const { data: links } = await supabase.from("paper_folders").select("paper_id").eq("folder_id", folderId);
    const paperIds = [...new Set((links ?? []).map((link) => link.paper_id))];
    if (paperIds.length === 0) {
      return [];
    }

    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([
      fetchPapersRaw({ ids: paperIds }),
      fetchPaperSignals(),
    ]);

    return rows.map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async getStarredPapers(): Promise<Paper[]> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([
      fetchPapersRaw({ starred: true }),
      fetchPaperSignals(),
    ]);
    return rows.map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async getRecentPapers(limit = 8): Promise<Paper[]> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([fetchPapersRaw(), fetchPaperSignals()]);
    return rows.slice(0, limit).map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async searchPapers(query: string): Promise<Paper[]> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([
      fetchPapersRaw({ search: query.trim() }),
      fetchPaperSignals(),
    ]);
    return rows.map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async togglePaperStar(id: string): Promise<Paper> {
    const { data: current, error: readError } = await supabase
      .from("papers")
      .select("is_important")
      .eq("id", id)
      .single();

    if (readError || !current) {
      throw new Error("Paper not found");
    }

    const { error: updateError } = await supabase
      .from("papers")
      .update({ is_important: !current.is_important })
      .eq("id", id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    const paper = await this.getPaperById(id);
    if (!paper) {
      throw new Error("Paper not found after update");
    }

    return paper;
  },

  async createImportedPaper(
    draft: ImportedPaperDraft,
    storedFile: FileImportResult,
  ): Promise<ImportedPaperResult> {
    const userId = await currentUserId();
    const title = draft.title.trim();
    if (!title) {
      throw new Error("A paper title is required before import.");
    }

    let paperId: string | null = null;

    try {
      const { data: paperRow, error: paperError } = await supabase
        .from("papers")
        .insert({
          owner_user_id: userId,
          title,
          normalized_title: normalizeTitle(title),
          publication_year: draft.year ?? null,
          journal_name: draft.venue?.trim() || null,
          abstract: "",
          language: "en",
          reading_status: "unread",
          metadata_confidence: 0.1,
        })
        .select("id")
        .single();

      if (paperError || !paperRow) {
        throw new Error(paperError?.message ?? "Unable to create the paper record.");
      }

      if (!paperRow.id) {
        throw new Error("Unable to resolve the created paper id.");
      }

      const createdPaperId = paperRow.id;
      paperId = createdPaperId;

      await insertPaperFile(createdPaperId, storedFile);

      if (draft.folderId) {
        await attachPaperToFolder(createdPaperId, draft.folderId, userId);
      }

      const processingJobId = await createImportJob(createdPaperId, userId, storedFile.storedPath);
      const paper = await this.getPaperById(createdPaperId);

      if (!paper) {
        throw new Error("The paper was created but could not be loaded back into the workspace.");
      }

      return {
        paper,
        processingJobId,
        storedPath: storedFile.storedPath,
        storedFilename: storedFile.storedFilename,
      };
    } catch (cause) {
      if (paperId) {
        const { error: cleanupError } = await supabase.from("papers").delete().eq("id", paperId);
        if (cleanupError) {
          const baseMessage = cause instanceof Error ? cause.message : "Unable to finish importing the paper.";
          throw new Error(`${baseMessage} Cleanup also failed, so an incomplete paper record may still exist: ${cleanupError.message}`);
        }
      }

      if (cause instanceof Error) {
        throw cause;
      }

      throw new Error("Unable to finish importing the paper.");
    }
  },

  async movePaperToFolder(paperId: string, folderId: string): Promise<Paper> {
    const userId = await currentUserId();
    await movePaperToFolderAssignment(paperId, folderId, userId);

    const paper = await this.getPaperById(paperId);
    if (!paper) {
      throw new Error("Paper not found after moving folders.");
    }

    return paper;
  },

  async getAllChunks(): Promise<PaperChunk[]> {
    const { data, error } = await supabase
      .from("paper_chunks")
      .select("id, paper_id, section_id, chunk_order, page, text, token_count, start_char_offset, end_char_offset, parser_confidence")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => rowToChunk(row as ChunkRow));
  },

  async getAllFigures(): Promise<PaperFigure[]> {
    const { data, error } = await supabase
      .from("figures")
      .select("id, paper_id, figure_no, caption, page, image_path, summary_text, is_key_figure, is_presentation_candidate, item_type")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => rowToFigure(row as FigureRow));
  },

  async getPrimaryPaperFile(paperId: string): Promise<PaperPrimaryFile | undefined> {
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
  },

  async getSectionsByPaper(paperId: string): Promise<PaperSection[]> {
    const { data, error } = await supabase
      .from("paper_sections")
      .select("id, paper_id, section_name, section_order, page_start, page_end, raw_text, parser_confidence")
      .eq("paper_id", paperId)
      .order("section_order", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => rowToSection(row as SectionRow));
  },

  async getFiguresByPaper(paperId: string): Promise<PaperFigure[]> {
    const { data, error } = await supabase
      .from("figures")
      .select("id, paper_id, figure_no, caption, page, image_path, summary_text, is_key_figure, is_presentation_candidate, item_type")
      .eq("paper_id", paperId)
      .order("figure_no", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => rowToFigure(row as FigureRow));
  },

  async semanticSearch(queryEmbedding: number[], options?: {
    threshold?: number;
    limit?: number;
    paperIds?: string[];
  }): Promise<import("@/types/paper").SemanticSearchResult[]> {
    const { data, error } = await supabase.rpc("match_chunks", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: options?.threshold ?? 0.35,
      match_count: options?.limit ?? 20,
      filter_paper_ids: options?.paperIds ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      chunkId: row.chunk_id as string,
      paperId: row.paper_id as string,
      sectionId: (row.section_id as string) ?? undefined,
      chunkOrder: row.chunk_order as number,
      page: (row.page as number) ?? undefined,
      text: row.text as string,
      tokenCount: (row.token_count as number) ?? undefined,
      similarity: row.similarity as number,
    }));
  },

  async getHighlightPresets(): Promise<HighlightPreset[]> {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("highlight_presets")
      .select(presetSelect)
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => rowToHighlightPreset(row as HighlightPresetListRow));
  },

  async createHighlightPreset(input: { name: string; colorHex: string; description?: string }): Promise<HighlightPreset> {
    const userId = await currentUserId();
    const { count } = await supabase
      .from("highlight_presets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const { data, error } = await supabase
      .from("highlight_presets")
      .insert({
        user_id: userId,
        name: input.name.trim(),
        color_hex: input.colorHex,
        description: input.description?.trim() || null,
        sort_order: (count ?? 0) + 1,
        is_system_default: false,
        is_active: true,
      })
      .select(presetSelect)
      .single();

    if (error || !data) throw new Error(error?.message ?? "Unable to create highlight preset.");
    return rowToHighlightPreset(data as HighlightPresetListRow);
  },

  async deleteHighlightPreset(id: string): Promise<string> {
    const userId = await currentUserId();
    const { error } = await supabase
      .from("highlight_presets")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return id;
  },

  async getHighlightsByPaper(paperId: string): Promise<ResearchHighlight[]> {
    const { data, error } = await supabase
      .from("highlights")
      .select(highlightSelect)
      .eq("paper_id", paperId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => rowToHighlight(row as HighlightRow));
  },

  async createHighlight(input: {
    paperId: string;
    selectionAnchor: PaperTextSelectionAnchor;
    presetId?: string;
  }): Promise<ResearchHighlight> {
    const userId = await currentUserId();
    return getOrCreateSelectionHighlight({
      paperId: input.paperId,
      userId,
      selectionAnchor: input.selectionAnchor,
      presetId: input.presetId,
    });
  },

  async updateHighlightPreset(input: {
    id: string;
    paperId: string;
    presetId: string;
  }): Promise<ResearchHighlight> {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from("highlights")
      .update({
        preset_id: input.presetId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("user_id", userId)
      .select(highlightSelect)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Unable to update the highlight preset.");
    }

    return rowToHighlight(data as HighlightRow);
  },

  async deleteHighlight(input: {
    id: string;
    paperId: string;
  }): Promise<{ id: string; paperId: string }> {
    const userId = await currentUserId();
    const { error } = await supabase
      .from("highlights")
      .delete()
      .eq("id", input.id)
      .eq("user_id", userId);

    if (error) {
      throw new Error(error.message);
    }

    return { id: input.id, paperId: input.paperId };
  },

  async getAllFolders(): Promise<Folder[]> {
    const [folderRes, linkRes] = await Promise.all([
      supabase.from("folders").select("id, name, parent_folder_id, sort_order").order("sort_order"),
      supabase.from("paper_folders").select("paper_id, folder_id"),
    ]);

    const folders = folderRes.data ?? [];
    const links = linkRes.data ?? [];

    return folders.map((folder) => {
      const paperCount = new Set(links.filter((link) => link.folder_id === folder.id).map((link) => link.paper_id)).size;

      return {
        id: folder.id,
        name: folder.name,
        parentId: folder.parent_folder_id ?? undefined,
        paperCount,
      };
    });
  },

  async createFolder(name: string, parentId: string | null): Promise<Folder> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Folder name is required.");
    }

    const userId = await currentUserId();
    const slug = toSlug(trimmed);

    const { data, error } = await supabase
      .from("folders")
      .insert({
        owner_user_id: userId,
        name: trimmed,
        slug,
        parent_folder_id: parentId,
      })
      .select("id, name, parent_folder_id")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Unable to create the folder.");
    }

    return {
      id: data.id,
      name: data.name,
      parentId: data.parent_folder_id ?? undefined,
      paperCount: 0,
    };
  },

  async getAllNotes(): Promise<ResearchNote[]> {
    const { data, error } = await supabase.from("notes").select(noteSelect).order("updated_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => rowToNote(row as NoteRow));
  },

  async getNotesByPaper(paperId: string): Promise<ResearchNote[]> {
    const { data, error } = await supabase
      .from("notes")
      .select(noteSelect)
      .eq("paper_id", paperId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => rowToNote(row as NoteRow));
  },

  async getNoteById(id: string): Promise<ResearchNote | undefined> {
    const { data, error } = await supabase.from("notes").select(noteSelect).eq("id", id).single();

    if (error || !data) {
      return undefined;
    }

    return rowToNote(data as NoteRow);
  },

  async createNote(input: {
    paperId: string;
    title?: string;
    content?: string;
    kind?: NoteKind;
    anchorLabel?: string;
    selectionAnchor?: PaperTextSelectionAnchor;
    highlightId?: string;
    presetId?: string;
  }): Promise<ResearchNote> {
    const userId = await currentUserId();
    const noteType = KIND_TO_DB[input.kind ?? "summary"];

    let noteScope: "paper" | "highlight" = "paper";
    let highlightId: string | null = null;
    let page: number | null = null;
    let selectedText = input.anchorLabel?.trim() || null;
    let notePageLabel: string | undefined;

    if (input.selectionAnchor) {
      const highlight = await getOrCreateSelectionHighlight({
        paperId: input.paperId,
        userId,
        selectionAnchor: input.selectionAnchor,
        presetId: input.presetId,
      });
      noteScope = "highlight";
      highlightId = highlight.id;
      page = input.selectionAnchor.pageNumber;
      selectedText = input.selectionAnchor.quote;
      notePageLabel = input.selectionAnchor.pageLabel;
    } else if (input.highlightId) {
      const highlight = await getHighlightById(input.highlightId, userId);
      if (!highlight) {
        throw new Error("The selected highlight could not be found.");
      }

      noteScope = "highlight";
      highlightId = highlight.id;
      page = highlight.startAnchor?.pageNumber ?? highlight.pageNumber ?? null;
      selectedText = highlight.selectedText;
      notePageLabel = highlight.startAnchor?.pageLabel ?? (highlight.pageNumber ? String(highlight.pageNumber) : undefined);
    }

    const { data, error } = await supabase
      .from("notes")
      .insert({
        paper_id: input.paperId,
        user_id: userId,
        note_scope: noteScope,
        highlight_id: highlightId,
        page,
        note_type: noteType,
        title: input.title?.trim() || (notePageLabel ? `Reader note - Page ${notePageLabel}` : "New note"),
        note_text:
          input.content?.trim() ||
          (selectedText
            ? `Selection: "${selectedText}"\n\nWhy it matters:`
            : "Capture the key takeaway, open question, or next action from this paper."),
        selected_text: selectedText,
        is_pinned: false,
      })
      .select(noteSelect)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Unable to create the note.");
    }

    return rowToNote(data as NoteRow);
  },

  async updateNote(
    id: string,
    updates: Partial<Pick<ResearchNote, "title" | "content" | "kind" | "anchorLabel" | "pinned">>,
  ): Promise<ResearchNote> {
    const patch: Record<string, unknown> = {};
    if (updates.title !== undefined) patch.title = updates.title.trim();
    if (updates.content !== undefined) patch.note_text = updates.content.trim();
    if (updates.kind !== undefined) patch.note_type = KIND_TO_DB[updates.kind];
    if (updates.anchorLabel !== undefined) patch.selected_text = updates.anchorLabel.trim() || null;
    if (updates.pinned !== undefined) patch.is_pinned = updates.pinned;

    const { data, error } = await supabase
      .from("notes")
      .update(patch)
      .eq("id", id)
      .select(noteSelect)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Unable to update the note.");
    }

    return rowToNote(data as NoteRow);
  },

  async upsertHighlightEmbedding(input: {
    highlightId: string;
    presetId: string;
    paperId: string;
    textContent: string;
    noteText?: string;
    embedding: number[];
  }): Promise<void> {
    const userId = await currentUserId();
    const { error } = await supabase
      .from("highlight_embeddings")
      .upsert(
        {
          highlight_id: input.highlightId,
          preset_id: input.presetId,
          paper_id: input.paperId,
          user_id: userId,
          text_content: input.textContent,
          note_text: input.noteText || null,
          embedding: JSON.stringify(input.embedding),
          embedding_model: "all-MiniLM-L6-v2",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "highlight_id" },
      );
    if (error) throw new Error(error.message);
  },

  async searchHighlightEmbeddings(
    queryEmbedding: number[],
    options?: {
      presetIds?: string[];
      paperIds?: string[];
      threshold?: number;
      limit?: number;
    },
  ): Promise<{
    id: string;
    highlightId: string;
    presetId: string;
    paperId: string;
    textContent: string;
    noteText: string | null;
    similarity: number;
  }[]> {
    const { data, error } = await supabase.rpc("match_highlight_embeddings", {
      query_embedding: JSON.stringify(queryEmbedding),
      filter_preset_ids: options?.presetIds ?? null,
      filter_paper_ids: options?.paperIds ?? null,
      match_threshold: options?.threshold ?? 0.35,
      match_count: options?.limit ?? 20,
    });

    if (error) throw new Error(error.message);

    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      highlightId: row.highlight_id as string,
      presetId: row.preset_id as string,
      paperId: row.paper_id as string,
      textContent: row.text_content as string,
      noteText: (row.note_text as string) ?? null,
      similarity: row.similarity as number,
    }));
  },

  async deletePaper(paperId: string): Promise<{ id: string }> {
    // Get stored file paths before deleting so we can clean up disk files
    const { data: files } = await supabase
      .from("paper_files")
      .select("stored_path")
      .eq("paper_id", paperId);

    // Get figure image paths
    const { data: figures } = await supabase
      .from("figures")
      .select("image_path")
      .eq("paper_id", paperId)
      .not("image_path", "is", null);

    // Hard delete the paper (all related rows CASCADE)
    const { error } = await supabase
      .from("papers")
      .delete()
      .eq("id", paperId);

    if (error) {
      throw new Error(error.message);
    }

    // Clean up disk files via Electron IPC (best-effort)
    const api = (globalThis as any).window?.redouDesktop;
    if (api?.file?.delete) {
      for (const f of files ?? []) {
        if (f.stored_path) {
          api.file.delete({ storedPath: f.stored_path }).catch(() => {});
        }
      }
      for (const f of figures ?? []) {
        if (f.image_path) {
          api.file.delete({ storedPath: f.image_path }).catch(() => {});
        }
      }
    }

    return { id: paperId };
  },
};











