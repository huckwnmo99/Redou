import type {
  FigureSearchResult,
  Folder,
  HighlightSearchResult,
  Paper,
  PaperChunk,
  PaperFigure,
  PaperSearchResult,
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
  sectionName?: string;
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
  itemType: PaperFigure["itemType"];
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
        itemType: figure.itemType,
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
  return kind === "all" ? (["papers", "chunks", "highlights", "notes", "figures"] as VisibleSearchKind[]) : [kind as VisibleSearchKind];
}

export function semanticResultsToChunks(
  results: SemanticSearchResult[],
  papers: Paper[],
): SearchChunkResult[] {
  const paperById = new Map(papers.map((p) => [p.id, p]));

  return results.map((r) => {
    const paper = paperById.get(r.paperId);
    const parts: string[] = [];
    if (r.sectionName) parts.push(r.sectionName);
    if (r.page) parts.push(`p.${r.page}`);
    parts.push(`${Math.round(r.similarity * 100)}%`);
    return {
      id: r.chunkId,
      paperId: r.paperId,
      title: paper?.title ?? "Untitled paper",
      label: parts.join(" · "),
      snippet: buildSnippet(r.text, "", 200),
      page: r.page,
      similarity: r.similarity,
      sectionName: r.sectionName,
    };
  });
}

/* ── Unified paper-centric results ── */

export interface MatchEvidence {
  source: "title" | "content" | "highlight" | "note" | "figure";
  snippet?: string;
  page?: number;
  similarity?: number;
  label?: string;
  color?: string;
}

export interface UnifiedPaperResult {
  paperId: string;
  paper: Paper;
  score: number;
  evidence: MatchEvidence[];
}

export function buildUnifiedResults(input: {
  paperMap: Map<string, Paper>;
  textMatchPaperIds: Set<string>;
  semanticPapers: PaperSearchResult[];
  textChunks: SearchChunkResult[];
  semanticChunks: SearchChunkResult[];
  highlights: HighlightSearchResult[];
  notes: SearchNoteResult[];
  textFigures: SearchFigureResult[];
  semanticFigures: FigureSearchResult[];
  presetMap: Map<string, { name: string; colorHex: string }>;
  scope?: SearchResultKind;
}): UnifiedPaperResult[] {
  const scope = input.scope ?? "all";
  const agg = new Map<string, { score: number; evidence: MatchEvidence[] }>();

  function entry(paperId: string) {
    if (!agg.has(paperId)) agg.set(paperId, { score: 0, evidence: [] });
    return agg.get(paperId)!;
  }

  function countSource(ev: MatchEvidence[], src: MatchEvidence["source"]) {
    return ev.filter((e) => e.source === src).length;
  }

  const includeTitle = scope === "all" || scope === "title";
  const includeContent = scope === "all" || scope === "content";
  const includeHighlights = scope === "all" || scope === "highlights";
  const includeNotes = scope === "all" || scope === "notes";
  const includeFigures = scope === "all" || scope === "figures";
  const includeEquations = scope === "all" || scope === "equations";

  // Title / abstract text matches
  if (includeTitle) {
    for (const pid of input.textMatchPaperIds) {
      const e = entry(pid);
      e.score = Math.max(e.score, 0.5);
      e.evidence.push({ source: "title" });
    }
    for (const sp of input.semanticPapers) {
      const e = entry(sp.paperId);
      e.score = Math.max(e.score, sp.similarity);
      if (countSource(e.evidence, "title") === 0) {
        e.evidence.push({ source: "title", similarity: sp.similarity });
      }
    }
  }

  // Text chunks + semantic chunks
  if (includeContent) {
    for (const c of input.textChunks) {
      const e = entry(c.paperId);
      e.score = Math.max(e.score, 0.4);
      if (countSource(e.evidence, "content") < 1) {
        e.evidence.push({ source: "content", snippet: c.snippet, page: c.page });
      }
    }
    for (const c of input.semanticChunks) {
      const e = entry(c.paperId);
      e.score = Math.max(e.score, c.similarity ?? 0.3);
      if (countSource(e.evidence, "content") < 1) {
        e.evidence.push({ source: "content", snippet: c.snippet, page: c.page, similarity: c.similarity });
      }
    }
  }

  // Highlights
  if (includeHighlights) {
    for (const hl of input.highlights) {
      const e = entry(hl.paperId);
      e.score = Math.max(e.score, hl.similarity);
      const preset = input.presetMap.get(hl.presetId);
      if (countSource(e.evidence, "highlight") < 2) {
        e.evidence.push({
          source: "highlight",
          snippet: hl.textContent,
          similarity: hl.similarity,
          label: preset?.name,
          color: preset?.colorHex,
        });
      }
    }
  }

  // Notes
  if (includeNotes) {
    for (const n of input.notes) {
      const e = entry(n.paperId);
      e.score = Math.max(e.score, 0.45);
      if (countSource(e.evidence, "note") < 1) {
        e.evidence.push({ source: "note", snippet: n.body, label: n.title });
      }
    }
  }

  // Text figures, tables, and equations (caption fallback when embeddings are unavailable)
  if (includeFigures || includeEquations) {
    for (const f of input.textFigures) {
      const isFigType = f.itemType === "figure";
      const isTableOrEq = f.itemType === "table" || f.itemType === "equation";
      if ((isFigType && !includeFigures) || (isTableOrEq && !includeEquations)) continue;
      const e = entry(f.paperId);
      e.score = Math.max(e.score, 0.35);
      if (countSource(e.evidence, "figure") < 1) {
        const typeLabel = f.itemType === "table" ? "Table" : f.itemType === "equation" ? "Equation" : "Figure";
        e.evidence.push({ source: "figure", snippet: f.body, page: f.page, label: `${typeLabel} ${f.figureNo}` });
      }
    }
  }

  // Semantic figures — tables & equations
  if (includeEquations || includeFigures) {
    for (const f of input.semanticFigures) {
      const isFigType = f.itemType === "figure";
      const isTableOrEq = f.itemType === "table" || f.itemType === "equation";
      if ((isFigType && !includeFigures) || (isTableOrEq && !includeEquations)) continue;
      const e = entry(f.paperId);
      e.score = Math.max(e.score, f.similarity);
      if (countSource(e.evidence, "figure") < 1) {
        const typeLabel = f.itemType === "table" ? "Table" : f.itemType === "equation" ? "Equation" : "Figure";
        e.evidence.push({
          source: "figure",
          snippet: f.caption ?? f.summaryText,
          page: f.page,
          similarity: f.similarity,
          label: `${typeLabel} ${f.figureNo}`,
        });
      }
    }
  }

  // Build and sort
  const results: UnifiedPaperResult[] = [];
  for (const [paperId, data] of agg) {
    const paper = input.paperMap.get(paperId);
    if (!paper) continue;
    results.push({ paperId, paper, score: data.score, evidence: data.evidence });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}



