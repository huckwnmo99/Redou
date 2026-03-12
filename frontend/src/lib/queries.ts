import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { importPdfToLibrary } from "./desktop";
import { supabasePaperRepository as paperRepository } from "./supabasePaperRepository";
import type {
  ImportedPaperDraft,
  ImportedPaperResult,
  PaperChunk,
  PaperFigure,
  PaperSection,
  PaperTextSelectionAnchor,
  ResearchNote,
} from "@/types/paper";

export const paperKeys = {
  all: ["papers"] as const,
  detail: (id: string) => ["papers", "detail", id] as const,
  byFolder: (id: string) => ["papers", "folder", id] as const,
  starred: ["papers", "starred"] as const,
  recent: ["papers", "recent"] as const,
  search: (q: string) => ["papers", "search", q] as const,
  folders: ["folders"] as const,
};

export const noteKeys = {
  all: ["notes"] as const,
  detail: (id: string) => ["notes", "detail", id] as const,
  byPaper: (paperId: string) => ["notes", "paper", paperId] as const,
};

export const highlightKeys = {
  byPaper: (paperId: string) => ["highlights", "paper", paperId] as const,
  presets: ["highlight-presets"] as const,
};

export const fileKeys = {
  primary: (paperId: string) => ["paper-files", "primary", paperId] as const,
};

export const chunkKeys = {
  all: ["paper-chunks"] as const,
};

export const sectionKeys = {
  byPaper: (paperId: string) => ["paper-sections", "paper", paperId] as const,
};

export const figureKeys = {
  all: ["paper-figures"] as const,
  byPaper: (paperId: string) => ["paper-figures", "paper", paperId] as const,
};

export const embeddingKeys = {
  search: (q: string, paperIds?: string[]) => ["embedding-search", q, paperIds ?? null] as const,
};

export function useAllPapers() {
  return useQuery({
    queryKey: paperKeys.all,
    queryFn: () => paperRepository.getAllPapers(),
  });
}

export function usePaperById(id: string | null) {
  return useQuery({
    queryKey: paperKeys.detail(id ?? "none"),
    queryFn: () => (id ? paperRepository.getPaperById(id) : Promise.resolve(undefined)),
    enabled: Boolean(id),
  });
}

export function usePapersByFolder(folderId: string | null) {
  return useQuery({
    queryKey: folderId ? paperKeys.byFolder(folderId) : paperKeys.all,
    queryFn: () => (folderId ? paperRepository.getPapersByFolder(folderId) : paperRepository.getAllPapers()),
  });
}

export function useStarredPapers() {
  return useQuery({
    queryKey: paperKeys.starred,
    queryFn: () => paperRepository.getStarredPapers(),
  });
}

export function useRecentPapers() {
  return useQuery({
    queryKey: paperKeys.recent,
    queryFn: () => paperRepository.getRecentPapers(),
  });
}

export function useSearchPapers(query: string) {
  return useQuery({
    queryKey: paperKeys.search(query),
    queryFn: () => paperRepository.searchPapers(query),
    enabled: query.trim().length > 0,
  });
}

export function useFolders() {
  return useQuery({
    queryKey: paperKeys.folders,
    queryFn: () => paperRepository.getAllFolders(),
  });
}

export function usePrimaryPaperFile(paperId: string | null) {
  return useQuery({
    queryKey: fileKeys.primary(paperId ?? "none"),
    queryFn: () => (paperId ? paperRepository.getPrimaryPaperFile(paperId) : Promise.resolve(undefined)),
    enabled: Boolean(paperId),
  });
}

export function useAllChunks() {
  return useQuery<PaperChunk[]>({
    queryKey: chunkKeys.all,
    queryFn: () => paperRepository.getAllChunks(),
  });
}

export function useSemanticChunkSearch(query: string, paperIds?: string[]) {
  return useQuery({
    queryKey: embeddingKeys.search(query, paperIds),
    queryFn: async () => {
      const api = window.redouDesktop;
      if (!api?.embedding?.generateQuery) return null;

      const result = await api.embedding.generateQuery({ text: query });
      if (!result.success || !result.data) return null;

      return paperRepository.semanticSearch(result.data, {
        threshold: 0.35,
        limit: 20,
        paperIds,
      });
    },
    enabled: query.trim().length > 2,
    staleTime: 30_000,
  });
}

export function useSectionsByPaper(paperId: string | null) {
  return useQuery<PaperSection[]>({
    queryKey: sectionKeys.byPaper(paperId ?? "none"),
    queryFn: () => (paperId ? paperRepository.getSectionsByPaper(paperId) : Promise.resolve([])),
    enabled: Boolean(paperId),
  });
}

export function useAllFigures() {
  return useQuery<PaperFigure[]>({
    queryKey: figureKeys.all,
    queryFn: () => paperRepository.getAllFigures(),
  });
}

export function useFiguresByPaper(paperId: string | null) {
  return useQuery<PaperFigure[]>({
    queryKey: figureKeys.byPaper(paperId ?? "none"),
    queryFn: () => (paperId ? paperRepository.getFiguresByPaper(paperId) : Promise.resolve([])),
    enabled: Boolean(paperId),
  });
}

export function useHighlightPresets() {
  return useQuery({
    queryKey: highlightKeys.presets,
    queryFn: () => paperRepository.getHighlightPresets(),
  });
}

export function useCreateHighlightPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; colorHex: string; description?: string }) =>
      paperRepository.createHighlightPreset(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: highlightKeys.presets });
    },
  });
}

export function useDeleteHighlightPreset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => paperRepository.deleteHighlightPreset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: highlightKeys.presets });
    },
  });
}

export function useHighlightsByPaper(paperId: string | null) {
  return useQuery({
    queryKey: highlightKeys.byPaper(paperId ?? "none"),
    queryFn: () => (paperId ? paperRepository.getHighlightsByPaper(paperId) : Promise.resolve([])),
    enabled: Boolean(paperId),
  });
}

export function useAllNotes() {
  return useQuery({
    queryKey: noteKeys.all,
    queryFn: () => paperRepository.getAllNotes(),
  });
}

export function useNotesByPaper(paperId: string | null) {
  return useQuery({
    queryKey: noteKeys.byPaper(paperId ?? "none"),
    queryFn: () => (paperId ? paperRepository.getNotesByPaper(paperId) : Promise.resolve([])),
    enabled: Boolean(paperId),
  });
}

export function useNoteById(id: string | null) {
  return useQuery({
    queryKey: noteKeys.detail(id ?? "none"),
    queryFn: () => (id ? paperRepository.getNoteById(id) : Promise.resolve(undefined)),
    enabled: Boolean(id),
  });
}

export function useTogglePaperStar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paperId: string) => paperRepository.togglePaperStar(paperId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paperKeys.all });
      queryClient.invalidateQueries({ queryKey: paperKeys.folders });
    },
  });
}

export function useDeletePaper() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paperId: string) => paperRepository.deletePaper(paperId),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: paperKeys.all });
      queryClient.invalidateQueries({ queryKey: paperKeys.folders });
      queryClient.invalidateQueries({ queryKey: paperKeys.starred });
      queryClient.invalidateQueries({ queryKey: paperKeys.recent });
      queryClient.invalidateQueries({ queryKey: noteKeys.all });
      queryClient.invalidateQueries({ queryKey: chunkKeys.all });
      queryClient.invalidateQueries({ queryKey: figureKeys.all });
      queryClient.removeQueries({ queryKey: paperKeys.detail(id) });
    },
  });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: string | null }) => paperRepository.createFolder(name, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paperKeys.folders });
      queryClient.invalidateQueries({ queryKey: paperKeys.all });
    },
  });
}

export function useMovePaperToFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ paperId, folderId }: { paperId: string; folderId: string }) => paperRepository.movePaperToFolder(paperId, folderId),
    onSuccess: (paper) => {
      queryClient.invalidateQueries({ queryKey: paperKeys.all });
      queryClient.invalidateQueries({ queryKey: paperKeys.folders });
      queryClient.invalidateQueries({ queryKey: paperKeys.detail(paper.id) });
    },
  });
}

export function useImportDesktopPapers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (drafts: ImportedPaperDraft[]): Promise<ImportedPaperResult[]> => {
      const results: ImportedPaperResult[] = [];

      for (const draft of drafts) {
        const storedFile = await importPdfToLibrary({
          sourcePath: draft.sourcePath,
          year: draft.year,
          firstAuthor: draft.firstAuthor,
          shortTitle: draft.title,
        });

        const result = await paperRepository.createImportedPaper(draft, storedFile);
        results.push(result);
      }

      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: paperKeys.all });
      queryClient.invalidateQueries({ queryKey: paperKeys.folders });
      queryClient.invalidateQueries({ queryKey: paperKeys.recent });
      queryClient.invalidateQueries({ queryKey: chunkKeys.all });
      queryClient.invalidateQueries({ queryKey: figureKeys.all });

      for (const result of results) {
        queryClient.invalidateQueries({ queryKey: paperKeys.detail(result.paper.id) });
        queryClient.invalidateQueries({ queryKey: fileKeys.primary(result.paper.id) });
        queryClient.invalidateQueries({ queryKey: sectionKeys.byPaper(result.paper.id) });
        queryClient.invalidateQueries({ queryKey: figureKeys.byPaper(result.paper.id) });
      }
    },
  });
}

export function useCreateHighlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      paperId: string;
      selectionAnchor: PaperTextSelectionAnchor;
      presetId?: string;
    }) => paperRepository.createHighlight(input),
    onSuccess: (highlight) => {
      queryClient.invalidateQueries({ queryKey: highlightKeys.byPaper(highlight.paperId) });
      queryClient.invalidateQueries({ queryKey: paperKeys.detail(highlight.paperId) });
    },
  });
}

export function useUpdateHighlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; paperId: string; presetId: string }) => paperRepository.updateHighlightPreset(input),
    onSuccess: (highlight) => {
      queryClient.invalidateQueries({ queryKey: highlightKeys.byPaper(highlight.paperId) });
      queryClient.invalidateQueries({ queryKey: paperKeys.detail(highlight.paperId) });
    },
  });
}

export function useDeleteHighlight() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; paperId: string }) => paperRepository.deleteHighlight(input),
    onSuccess: ({ paperId }) => {
      queryClient.invalidateQueries({ queryKey: highlightKeys.byPaper(paperId) });
      queryClient.invalidateQueries({ queryKey: paperKeys.detail(paperId) });
      queryClient.invalidateQueries({ queryKey: noteKeys.all });
      queryClient.invalidateQueries({ queryKey: noteKeys.byPaper(paperId) });
    },
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      paperId: string;
      title?: string;
      content?: string;
      kind?: ResearchNote["kind"];
      anchorLabel?: string;
      selectionAnchor?: PaperTextSelectionAnchor;
      highlightId?: string;
      presetId?: string;
    }) => paperRepository.createNote(input),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.all });
      queryClient.invalidateQueries({ queryKey: noteKeys.byPaper(note.paperId) });
      queryClient.invalidateQueries({ queryKey: paperKeys.all });
      queryClient.invalidateQueries({ queryKey: paperKeys.detail(note.paperId) });
      queryClient.invalidateQueries({ queryKey: highlightKeys.byPaper(note.paperId) });
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      id: string;
      title: string;
      content: string;
      kind: ResearchNote["kind"];
      anchorLabel?: string;
      pinned?: boolean;
    }) => paperRepository.updateNote(input.id, input),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.all });
      queryClient.invalidateQueries({ queryKey: noteKeys.byPaper(note.paperId) });
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(note.id) });
      queryClient.invalidateQueries({ queryKey: paperKeys.all });
      queryClient.invalidateQueries({ queryKey: paperKeys.detail(note.paperId) });
    },
  });
}

export function useUpsertHighlightEmbedding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      highlightId: string;
      presetId: string;
      paperId: string;
      textContent: string;
      noteText?: string;
      embedding: number[];
    }) => paperRepository.upsertHighlightEmbedding(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["highlight-embedding-search"] });
    },
  });
}

export function useSearchHighlightEmbeddings(
  query: string,
  presetIds?: string[],
  paperIds?: string[],
) {
  return useQuery({
    queryKey: ["highlight-embedding-search", query, presetIds ?? null, paperIds ?? null] as const,
    queryFn: async () => {
      const api = window.redouDesktop;
      if (!api?.embedding?.generateQuery) return null;

      const result = await api.embedding.generateQuery({ text: query });
      if (!result.success || !result.data) return null;

      return paperRepository.searchHighlightEmbeddings(result.data, {
        presetIds,
        paperIds,
        threshold: 0.35,
        limit: 20,
      });
    },
    enabled: query.trim().length > 2,
    staleTime: 30_000,
  });
}
