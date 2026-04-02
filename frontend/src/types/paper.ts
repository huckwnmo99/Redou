export type ReadStatus = "unread" | "reading" | "read";
export type ProcessingJobStatus = "queued" | "running" | "succeeded" | "failed";
export type SortKey = "addedAt" | "year" | "title" | "citations";
export type ViewMode = "grid" | "list";
export type NavItem = "library" | "search" | "figures" | "tables" | "equations" | "notes" | "processing" | "settings" | "chat";
export type PaperDetailTab = "overview" | "pdf" | "notes" | "figures" | "tables" | "equations" | "metadata" | "references";
export type SearchResultKind = "all" | "title" | "content" | "notes" | "highlights" | "figures" | "equations";

export interface HighlightSearchResult {
  id: string;
  highlightId: string;
  presetId: string;
  paperId: string;
  textContent: string;
  noteText: string | null;
  similarity: number;
}
export type NoteKind = "summary" | "insight" | "question" | "quote" | "action" | "memo";

export interface Author {
  name: string;
  affiliation?: string;
}

export interface Paper {
  id: string;
  title: string;
  authors: Author[];
  year: number;
  venue: string;
  abstract: string;
  tags: string[];
  status: ReadStatus;
  starred: boolean;
  figureCount: number;
  noteCount: number;
  citationCount: number;
  folderId?: string;
  addedAt: string;
  thumbnailUrl?: string;
  doi?: string;
  processingStatus?: ProcessingJobStatus;
  processingUpdatedAt?: string;
}

export interface PaperPrimaryFile {
  paperId: string;
  storedPath: string;
  storedFilename: string;
  originalFilename: string;
  fileSize?: number;
}

export interface PaperSection {
  id: string;
  paperId: string;
  name: string;
  order: number;
  pageStart?: number;
  pageEnd?: number;
  rawText: string;
  parserConfidence?: number;
}

export interface PaperChunk {
  id: string;
  paperId: string;
  sectionId?: string;
  order: number;
  page?: number;
  text: string;
  tokenCount?: number;
  startCharOffset?: number;
  endCharOffset?: number;
  parserConfidence?: number;
}

export interface SemanticSearchResult {
  chunkId: string;
  paperId: string;
  sectionId?: string;
  sectionName?: string;
  chunkOrder: number;
  page?: number;
  text: string;
  tokenCount?: number;
  similarity: number;
}

export type FigureItemType = "figure" | "table" | "equation";

export interface PaperReference {
  id: string;
  paperId: string;
  refOrder: number;
  refTitle?: string;
  refAuthors: Author[];
  refYear?: number;
  refJournal?: string;
  refDoi?: string;
  refVolume?: string;
  refPages?: string;
  refRawText?: string;
  linkedPaperId?: string;
}

export interface PaperSearchResult {
  paperId: string;
  title: string;
  authors: Author[];
  publicationYear?: number;
  abstract?: string;
  journalName?: string;
  doi?: string;
  similarity: number;
}

export interface FigureSearchResult {
  figureId: string;
  paperId: string;
  figureNo: string;
  caption?: string;
  itemType: FigureItemType;
  summaryText?: string;
  page?: number;
  similarity: number;
}

export interface PaperFigure {
  id: string;
  paperId: string;
  figureNo: string;
  caption?: string;
  page?: number;
  imagePath?: string;
  summaryText?: string;
  isKeyFigure: boolean;
  isPresentationCandidate: boolean;
  itemType: FigureItemType;
}

export interface PaperSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaperPageAnchor {
  paperId: string;
  pageNumber: number;
  pageLabel: string;
  anchorId: string;
}

export interface PaperTextSelectionAnchor extends PaperPageAnchor {
  quote: string;
  capturedAt: string;
  rects: PaperSelectionRect[];
}

export interface HighlightPreset {
  id: string;
  name: string;
  colorHex: string;
  description?: string;
  sortOrder: number;
  isSystemDefault?: boolean;
  isActive?: boolean;
}

export interface ResearchHighlight {
  id: string;
  paperId: string;
  presetId: string;
  presetName?: string;
  colorHex?: string;
  pageNumber?: number;
  selectedText: string;
  startAnchor?: PaperTextSelectionAnchor;
  endAnchor?: PaperTextSelectionAnchor;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  paperCount: number;
  children?: Folder[];
}

export interface ResearchNote {
  id: string;
  paperId: string;
  title: string;
  content: string;
  kind: NoteKind;
  createdAt: string;
  updatedAt: string;
  anchorLabel?: string;
  pinned?: boolean;
  pageNumber?: number;
  highlightId?: string;
  linkedAnchor?: PaperPageAnchor;
  anchorQuote?: string;
}

export interface ImportedPaperDraft {
  sourcePath: string;
  title: string;
  year?: number;
  firstAuthor?: string;
  venue?: string;
  folderId?: string | null;
}

export interface ImportedPaperResult {
  paper: Paper;
  processingJobId: string;
  storedPath: string;
  storedFilename: string;
}
