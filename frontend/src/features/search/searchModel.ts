import type {
  Folder,
  HighlightSearchResult,
  Paper,
  PaperChunk,
  PaperFigure,
  ResearchNote,
  SearchResultKind,
  SemanticSearchResult,
} from "@/types/paper";

export interface SearchChunkResult {
  id: string;
  paperId: string;
  title: string;
  label: string;
  snippet: string;
  page?: number;
  similarity?: number;
}

export interface SearchNoteResult {
  id: string;
  noteId: string;
  paperId: string;
  title: string;
  body: string;
  countLabel: string;
}

export interface SearchFigureResult {
  id: string;
  paperId: string;
  figureNo: string;
  title: string;
  body: string;
  countLabel: string;
  page?: number;
}

export type VisibleSearchKind = Exclude<SearchResultKind, "all">;

export interface SearchGroups {
  papers: Paper[];
  chunks: SearchChunkResult[];
  notes: SearchNoteResult[];
  figures: SearchFigureResult[];
  highlights: HighlightSearchResult[];
}

function includesNormalized(value: string | undefined, query: string) {
  return (value ?? "").toLowerCase().includes(query);
}

function buildSnippet(text: string, query: string, maxLength = 180) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return "No extracted text yet.";
  }

  if (!query) {
    return normalizedText.length > maxLength ? `${normalizedText.slice(0, maxLength).trimEnd()}...` : normalizedText;
  }

  const matchIndex = normalizedText.toLowerCase().indexOf(query);
  if (matchIndex === -1) {
    return normalizedText.length > maxLength ? `${normalizedText.slice(0, maxLength).trimEnd()}...` : normalizedText;
  }

  const start = Math.max(0, matchIndex - 48);
  const end = Math.min(normalizedText.length, matchIndex + query.length + 96);
  const snippet = normalizedText.slice(start, end).trim();
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalizedText.length ? "..." : "";
  return `${prefix}${snippet}${suffix}`;
}

function sortPapersNewestFirst(papers: Paper[]) {
  return [...papers].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function applySearchScope(papers: Paper[], _folders: Folder[], scopeId: string | null) {
  if (!scopeId) {
    return papers;
  }

  if (scopeId === "starred") {
    return papers.filter((paper) => paper.starred);
  }

  if (scopeId === "recent") {
    return sortPapersNewestFirst(papers).slice(0, 8);
  }

  return papers.filter((paper) => paper.folderId === scopeId);
}

export function buildSearchGroups(input: {
  papers: Paper[];
  chunks: PaperChunk[];
  notes: ResearchNote[];
  figures: PaperFigure[];
  query: string;
}): SearchGroups {
  const normalized = input.query.trim().toLowerCase();
  const paperById = new Map(input.papers.map((paper) => [paper.id, paper]));
  const scopedPaperIds = new Set(input.papers.map((paper) => paper.id));

  const papers = (normalized
    ? input.papers.filter(
        (paper) =>
          includesNormalized(paper.title, normalized) ||
          includesNormalized(paper.venue, normalized) ||
          includesNormalized(paper.abstract, normalized) ||
          paper.authors.some((author) => includesNormalized(author.name, normalized)) ||
          paper.tags.some((tag) => includesNormalized(tag, normalized)),
      )
    : sortPapersNewestFirst(input.papers).slice(0, 8));

  const chunks = input.chunks
    .filter((chunk) => scopedPaperIds.has(chunk.paperId))
    .filter((chunk) => (normalized ? includesNormalized(chunk.text, normalized) : true))
    .slice(0, 12)
    .map((chunk) => {
      const paper = paperById.get(chunk.paperId);
      return {
        id: chunk.id,
        paperId: chunk.paperId,
        title: paper?.title ?? "Untitled paper",
        label: chunk.page ? `Page ${chunk.page}` : "Extracted chunk",
        snippet: buildSnippet(chunk.text, normalized),
        page: chunk.page,
      };
    });

  const notes = input.notes
    .filter((note) => scopedPaperIds.has(note.paperId))
    .filter((note) => {
      if (!normalized) {
        return true;
      }

      return (
        includesNormalized(note.title, normalized) ||
        includesNormalized(note.content, normalized) ||
        includesNormalized(note.anchorLabel, normalized) ||
        includesNormalized(note.anchorQuote, normalized)
      );
    })
    .slice(0, 12)
    .map((note) => ({
      id: note.id,
      noteId: note.id,
      paperId: note.paperId,
      title: note.title || paperById.get(note.paperId)?.title || "Untitled note",
      body: buildSnippet(note.content || note.anchorQuote || "", normalized, 160),
      countLabel: note.anchorLabel ?? `${note.kind} note`,
    }));

  const figures = input.figures
    .filter((figure) => scopedPaperIds.has(figure.paperId))
    .filter((figure) => {
      if (!normalized) {
        return true;
      }

      return (
        includesNormalized(figure.figureNo, normalized) ||
        includesNormalized(figure.caption, normalized) ||
        includesNormalized(figure.summaryText, normalized)
      );
    })
    .slice(0, 12)
    .map((figure) => {
      const paper = paperById.get(figure.paperId);
      return {
        id: figure.id,
        paperId: figure.paperId,
        figureNo: figure.figureNo,
        title: paper?.title ?? "Untitled paper",
        body: buildSnippet(figure.caption ?? figure.summaryText ?? "Figure caption not extracted yet.", normalized, 150),
        countLabel: figure.isPresentationCandidate ? `${figure.figureNo} - deck candidate` : figure.figureNo,
        page: figure.page,
      };
    });

  return {
    papers,
    chunks,
    notes,
    figures,
    highlights: [],
  };
}

export function getVisibleSearchKinds(kind: SearchResultKind): VisibleSearchKind[] {
  return kind === "all" ? ["papers", "chunks", "highlights", "notes", "figures"] : [kind as VisibleSearchKind];
}

export function semanticResultsToChunks(
  results: SemanticSearchResult[],
  papers: Paper[],
): SearchChunkResult[] {
  const paperById = new Map(papers.map((p) => [p.id, p]));

  return results.map((r) => {
    const paper = paperById.get(r.paperId);
    return {
      id: r.chunkId,
      paperId: r.paperId,
      title: paper?.title ?? "Untitled paper",
      label: r.page ? `Page ${r.page} · ${Math.round(r.similarity * 100)}% match` : `${Math.round(r.similarity * 100)}% match`,
      snippet: buildSnippet(r.text, "", 200),
      page: r.page,
      similarity: r.similarity,
    };
  });
}



