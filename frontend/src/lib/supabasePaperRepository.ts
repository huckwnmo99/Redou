import { supabase } from "./supabase";
import {
  createHighlightPresetRecord,
  createHighlightRecord,
  deleteHighlightPresetRecord,
  deleteHighlightRecord,
  fetchHighlightPresets,
  fetchHighlightsByPaper,
  updateHighlightPresetRecord,
} from "./paperRepository/highlights";
import {
  attachPaperToFolder,
  createFolderRecord,
  fetchFolders,
  fetchPaperIdsByFolder,
  movePaperToFolderAssignment,
} from "./paperRepository/folders";
import {
  createNoteRecord,
  fetchAllNotes,
  fetchNoteById,
  fetchNotesByPaper,
  updateNoteRecord,
} from "./paperRepository/notes";
import {
  fetchPaperSignals,
} from "./paperRepository/paperSignals";
import {
  createPaperRecord,
  fetchPaperRows,
  togglePaperStarRecord,
} from "./paperRepository/papers";
import {
  createImportJobRecord,
  createPaperFileRecord,
  deleteImportJobRecord,
  deletePaperFileRecord,
  fetchPrimaryPaperFile,
  fetchSupplementaryPaperFiles,
} from "./paperRepository/source-files";
import {
  rowToChunk,
  rowToFigure,
  rowToPaper,
  rowToSection,
} from "./paperRepository/mappers";
import type {
  ChunkRow,
  FigureRow,
  SectionRow,
} from "./paperRepository/mappers";
import type {
  Folder,
  ImportedPaperDraft,
  ImportedPaperResult,
  HighlightPreset,
  NoteKind,
  PaperChunk,
  PaperFigure,
  PaperReference,
  PaperSearchResult,
  FigureSearchResult,
  PaperSection,
  Paper,
  PaperPrimaryFile,
  PaperSupplementaryFile,
  PaperTextSelectionAnchor,
  ResearchHighlight,
  ResearchNote,
  SupplementaryPaperImportResult,
} from "@/types/paper";
import type { FileImportResult } from "@/types/desktop";

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

export const supabasePaperRepository = {
  async getAllPapers(): Promise<Paper[]> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([fetchPaperRows(), fetchPaperSignals()]);
    return rows.map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async getPaperById(id: string): Promise<Paper | undefined> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([
      fetchPaperRows({ ids: [id] }),
      fetchPaperSignals(),
    ]);
    const row = rows[0];
    return row ? rowToPaper(row, noteMap, figureMap, processingMap) : undefined;
  },

  async getPapersByFolder(folderId: string): Promise<Paper[]> {
    const paperIds = await fetchPaperIdsByFolder(folderId);
    if (paperIds.length === 0) {
      return [];
    }

    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([
      fetchPaperRows({ ids: paperIds }),
      fetchPaperSignals(),
    ]);

    return rows.map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async getStarredPapers(): Promise<Paper[]> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([
      fetchPaperRows({ starred: true }),
      fetchPaperSignals(),
    ]);
    return rows.map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async getRecentPapers(limit = 8): Promise<Paper[]> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([fetchPaperRows(), fetchPaperSignals()]);
    return rows.slice(0, limit).map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async searchPapers(query: string): Promise<Paper[]> {
    const [rows, { noteMap, figureMap, processingMap }] = await Promise.all([
      fetchPaperRows({ search: query.trim() }),
      fetchPaperSignals(),
    ]);
    return rows.map((row) => rowToPaper(row, noteMap, figureMap, processingMap));
  },

  async togglePaperStar(id: string): Promise<Paper> {
    await togglePaperStarRecord(id);

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
      const createdPaperId = await createPaperRecord({
        userId,
        title,
        year: draft.year,
        venue: draft.venue,
      });
      paperId = createdPaperId;

      const sourceFileId = await createPaperFileRecord(createdPaperId, storedFile);

      if (draft.folderId) {
        await attachPaperToFolder(createdPaperId, draft.folderId, userId);
      }

      const processingJobId = await createImportJobRecord(createdPaperId, userId, storedFile.storedPath, sourceFileId);
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

  async getSupplementaryPaperFiles(paperId: string): Promise<PaperSupplementaryFile[]> {
    return fetchSupplementaryPaperFiles(paperId);
  },

  async attachSupplementaryPdfToPaper(
    paperId: string,
    storedFile: FileImportResult,
  ): Promise<SupplementaryPaperImportResult> {
    const userId = await currentUserId();
    let sourceFileId: string | null = null;
    let processingJobId: string | null = null;

    try {
      sourceFileId = await createPaperFileRecord(paperId, storedFile, {
        fileKind: "supplementary_pdf",
        isPrimary: false,
      });

      processingJobId = await createImportJobRecord(paperId, userId, storedFile.storedPath, sourceFileId);
      const file = (await fetchSupplementaryPaperFiles(paperId)).find((candidate) => candidate.id === sourceFileId);

      if (!file) {
        throw new Error("The supplementary PDF was attached but could not be loaded back into the workspace.");
      }

      return {
        file,
        processingJobId,
        storedPath: storedFile.storedPath,
        storedFilename: storedFile.storedFilename,
      };
    } catch (cause) {
      if (processingJobId) {
        try {
          await deleteImportJobRecord(processingJobId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[attachSupplementaryPdfToPaper] Failed to clean up supplementary processing job:", message);
        }
      }

      if (sourceFileId) {
        try {
          await deletePaperFileRecord(sourceFileId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[attachSupplementaryPdfToPaper] Failed to clean up supplementary file row:", message);
        }
      }

      if (cause instanceof Error) {
        throw cause;
      }

      throw new Error("Unable to attach the supplementary PDF.");
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
    return fetchPrimaryPaperFile(paperId);
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
    boostSectionNames?: string[];
    sectionBoost?: number;
  }): Promise<import("@/types/paper").SemanticSearchResult[]> {
    const { data, error } = await supabase.rpc("match_chunks", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: options?.threshold ?? 0.35,
      match_count: options?.limit ?? 20,
      filter_paper_ids: options?.paperIds ?? null,
      boost_section_names: options?.boostSectionNames ?? null,
      section_boost: options?.sectionBoost ?? 0.08,
    });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      chunkId: row.chunk_id as string,
      paperId: row.paper_id as string,
      sectionId: (row.section_id as string) ?? undefined,
      sectionName: (row.section_name as string) ?? undefined,
      chunkOrder: row.chunk_order as number,
      page: (row.page as number) ?? undefined,
      text: row.text as string,
      tokenCount: (row.token_count as number) ?? undefined,
      similarity: row.similarity as number,
    }));
  },

  async getHighlightPresets(): Promise<HighlightPreset[]> {
    return fetchHighlightPresets(currentUserId);
  },

  async createHighlightPreset(input: { name: string; colorHex: string; description?: string }): Promise<HighlightPreset> {
    return createHighlightPresetRecord(input, currentUserId);
  },

  async deleteHighlightPreset(id: string): Promise<string> {
    return deleteHighlightPresetRecord(id, currentUserId);
  },

  async getHighlightsByPaper(paperId: string): Promise<ResearchHighlight[]> {
    return fetchHighlightsByPaper(paperId);
  },

  async createHighlight(input: {
    paperId: string;
    selectionAnchor: PaperTextSelectionAnchor;
    presetId?: string;
  }): Promise<ResearchHighlight> {
    return createHighlightRecord(input, currentUserId);
  },

  async updateHighlightPreset(input: {
    id: string;
    paperId: string;
    presetId: string;
  }): Promise<ResearchHighlight> {
    return updateHighlightPresetRecord(input, currentUserId);
  },

  async deleteHighlight(input: {
    id: string;
    paperId: string;
  }): Promise<{ id: string; paperId: string }> {
    return deleteHighlightRecord(input, currentUserId);
  },

  async getAllFolders(): Promise<Folder[]> {
    return fetchFolders();
  },

  async createFolder(name: string, parentId: string | null): Promise<Folder> {
    return createFolderRecord(name, parentId, currentUserId);
  },

  async getAllNotes(): Promise<ResearchNote[]> {
    return fetchAllNotes();
  },

  async getNotesByPaper(paperId: string): Promise<ResearchNote[]> {
    return fetchNotesByPaper(paperId);
  },

  async getNoteById(id: string): Promise<ResearchNote | undefined> {
    return fetchNoteById(id);
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
    return createNoteRecord(input, currentUserId);
  },

  async updateNote(
    id: string,
    updates: Partial<Pick<ResearchNote, "title" | "content" | "kind" | "anchorLabel" | "pinned">>,
  ): Promise<ResearchNote> {
    return updateNoteRecord(id, updates);
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
          embedding_model: "nvidia/llama-nemotron-embed-vl-1b-v2",
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
    const { data: files, error: filesErr } = await supabase
      .from("paper_files")
      .select("stored_path")
      .eq("paper_id", paperId);

    if (filesErr) console.warn("[deletePaper] Failed to query paper_files:", filesErr.message);

    // Get figure image paths
    const { data: figures, error: figErr } = await supabase
      .from("figures")
      .select("image_path")
      .eq("paper_id", paperId)
      .not("image_path", "is", null);

    if (figErr) console.warn("[deletePaper] Failed to query figures:", figErr.message);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const deleteAuth =
      session?.user?.id && session.access_token
        ? { userId: session.user.id, accessToken: session.access_token }
        : {};

    // Clean up disk files via Electron IPC while DB ownership rows still exist.
    const api = (globalThis as any).window?.redouDesktop;
    const cleanupTasks: Promise<unknown>[] = [];
    if (api?.file?.delete) {
      for (const f of files ?? []) {
        if (f.stored_path) {
          cleanupTasks.push(api.file.delete({ storedPath: f.stored_path, ...deleteAuth }).catch(() => {}));
        }
      }
      for (const f of figures ?? []) {
        if (f.image_path) {
          cleanupTasks.push(api.file.delete({ storedPath: f.image_path, ...deleteAuth }).catch(() => {}));
        }
      }
    }
    await Promise.all(cleanupTasks);

    // Hard delete the paper (all related rows CASCADE)
    const { error } = await supabase
      .from("papers")
      .delete()
      .eq("id", paperId);

    if (error) {
      throw new Error(error.message);
    }

    return { id: paperId };
  },

  async getReferencesByPaper(paperId: string): Promise<PaperReference[]> {
    const { data, error } = await supabase
      .from("paper_references")
      .select("id, paper_id, ref_order, ref_title, ref_authors, ref_year, ref_journal, ref_doi, ref_volume, ref_pages, ref_raw_text, linked_paper_id")
      .eq("paper_id", paperId)
      .order("ref_order", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      paperId: row.paper_id as string,
      refOrder: row.ref_order as number,
      refTitle: (row.ref_title as string) ?? undefined,
      refAuthors: ((row.ref_authors as Array<{ name: string; affiliation?: string }>) ?? []).map((a) => ({
        name: a.name,
        affiliation: a.affiliation,
      })),
      refYear: (row.ref_year as number) ?? undefined,
      refJournal: (row.ref_journal as string) ?? undefined,
      refDoi: (row.ref_doi as string) ?? undefined,
      refVolume: (row.ref_volume as string) ?? undefined,
      refPages: (row.ref_pages as string) ?? undefined,
      refRawText: (row.ref_raw_text as string) ?? undefined,
      linkedPaperId: (row.linked_paper_id as string) ?? undefined,
    }));
  },

  async semanticPaperSearch(queryEmbedding: number[], options?: {
    threshold?: number;
    limit?: number;
    paperIds?: string[];
  }): Promise<PaperSearchResult[]> {
    const { data, error } = await supabase.rpc("match_papers", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: options?.threshold ?? 0.35,
      match_count: options?.limit ?? 20,
      filter_paper_ids: options?.paperIds ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      paperId: row.paper_id as string,
      title: row.title as string,
      authors: ((row.authors as Array<{ name: string; affiliation?: string }>) ?? []).map((a) => ({
        name: a.name,
        affiliation: a.affiliation,
      })),
      publicationYear: (row.publication_year as number) ?? undefined,
      abstract: (row.abstract as string) ?? undefined,
      journalName: (row.journal_name as string) ?? undefined,
      doi: (row.doi as string) ?? undefined,
      similarity: row.similarity as number,
    }));
  },

  async semanticFigureSearch(queryEmbedding: number[], options?: {
    threshold?: number;
    limit?: number;
    itemTypes?: string[];
    paperIds?: string[];
  }): Promise<FigureSearchResult[]> {
    const { data, error } = await supabase.rpc("match_figures", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: options?.threshold ?? 0.3,
      match_count: options?.limit ?? 20,
      filter_item_types: options?.itemTypes ?? ["table", "equation"],
      filter_paper_ids: options?.paperIds ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      figureId: row.figure_id as string,
      paperId: row.paper_id as string,
      figureNo: row.figure_no as string,
      caption: (row.caption as string) ?? undefined,
      itemType: row.item_type as "figure" | "table" | "equation",
      summaryText: (row.summary_text as string) ?? undefined,
      page: (row.page as number) ?? undefined,
      similarity: row.similarity as number,
    }));
  },
};











