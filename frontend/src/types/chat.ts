// ============================================================
// Chat Feature Types
// ============================================================

export type ChatPhase = "clarifying" | "follow_up";
export type ConversationType = "table" | "qa";

export interface ChatConversation {
  id: string;
  owner_user_id: string;
  title: string;
  phase: ChatPhase;
  conversation_type: ConversationType;
  scope_folder_id: string | null;
  scope_all: boolean;
  created_at: string;
  updated_at: string;
}

export type ChatMessageRole = "user" | "assistant" | "system";
export type ChatMessageType = "text" | "table_report" | "verification" | "error";

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: ChatMessageRole;
  content: string;
  message_type: ChatMessageType;
  metadata: ChatMessageMetadata | null;
  created_at: string;
}

/**
 * Deterministic Q&A citation check (table-semantics-hardening slice 05). Recorded on
 * assistant messages, not enforced: `outOfRange` holds cited [N] with no matching
 * paper (range/existence failure); `ungroundedRefs` holds in-range citations whose
 * paper is absent from the RAG evidence set (weak paperId mismatch — NOT an LLM
 * claim-support verdict). Absent on messages produced before this slice.
 */
export interface QaCitationCheck {
  citationCount: number;
  outOfRange: number[];
  ungroundedRefs: number[];
}

export interface ChatMessageMetadata {
  source_chunk_ids?: string[];
  referenced_paper_ids?: string[];
  table_id?: string;
  citationCheck?: QaCitationCheck;
  [key: string]: unknown;
}

export interface TableReference {
  refNo: string;
  paperId?: string;
  title: string;
  authors?: string;
  year?: number;
  doi?: string;
  evidenceLocations?: string[];
  evidenceSummary?: string;
  hasSupplementaryEvidence?: boolean;
}

export interface CellVerification {
  row: number;
  col: number;
  status: "verified" | "unverified";
  sourceChunkId?: string;
  evidence?: string;
  /**
   * Which verifier decided this cell (Phase 2 slice 02). "code" = deterministically
   * back-matched against the parsed OCR matrix; "guardian" = LLM groundedness check.
   * Absent on tables verified before this slice.
   */
  method?: "code" | "guardian";
  /** Check kind: "backmatch" (code) or a MeasHalu type (unit/condition/value_fabrication). */
  checkType?: string;
  /** Back-match scope when method is "code": "source_hinted" | "any_matrix". */
  scope?: string;
}

/**
 * Per-paper missing-data reason, collected by the merge step and stored in
 * `chat_generated_tables.metadata.perPaperReasons` (see fix 19). Used to render
 * a "no data found" section explaining why a scope paper produced an empty row.
 */
export interface PerPaperReason {
  paperId: string;
  paperTitle: string;
  /** Reference number shown as "[refNo]" in the table/references. */
  refNo: string;
  /** True when the paper contributed at least one real data row (no reason needed). */
  hadRows: boolean;
  /** True when extraction failed (vs. simply finding no matching data). */
  failed: boolean;
  /** Human-readable reason (English LLM notes or a default). Empty for hadRows papers. */
  note: string;
}

export interface PartialExtractionFailure {
  paperId: string;
  paperTitle?: string;
  error?: string;
}

/**
 * Per-cell tuple metadata (Phase 1, table-semantics-hardening D1/D3), stored in
 * `chat_generated_tables.metadata.cellTuples[rowIndex][colIndex]`. Additive to the
 * scalar `rows`; a cell with no extra info is `null`. Absent entirely on the
 * single-call fallback path (no per-cell extraction).
 */
export interface CellTuple {
  /** Unit for the cell value when not already embedded in the value string. */
  unit?: string;
  /** Measurement condition the value was taken under (e.g. "at 293 K"). */
  condition?: string;
  /** Which table/figure/section the value came from (e.g. "Table 3"). */
  source_hint?: string;
  /** Extraction confidence ("high" | "medium" | "low"). */
  confidence?: string;
}

/**
 * A merged parameter column that carries cells measured under two or more different
 * conditions without a distinguishing column (D1). Reported, not auto-split.
 */
export interface ConditionConflict {
  column: string;
  columnIndex: number;
  conditions: string[];
  /**
   * Index of the "measurement condition" column derived from this column's per-cell
   * conditions (Phase 2.5 slice 09 D-b pivot). Present only when a derived column was
   * inserted; lets the renderer badge the derived column as auto-generated. Absent when
   * no pivot occurred (e.g. an explicit condition column already existed).
   */
  derivedColumnIndex?: number;
}

/** Column semantic type (Phase 1 D2). Index-aligned to the table headers. */
export type ColumnSemanticType = "parameter" | "raw_data" | "condition";

/**
 * Per-column grounding flag from snapColumnsToParsedHeaders (Phase 2.5 slice 11 branch
 * 2), stored in `chat_generated_tables.metadata.columnGrounding`. Deterministic snap of
 * spec column names to the source table's own header wording: `grounded` is whether the
 * name matched a parsed source header at all; `snappedFrom` holds the original spec
 * spelling when a strong single-match rewrote it to the source wording. Absent on tables
 * generated before this slice; empty array when there was no header vocabulary to snap
 * against or the spec had no columns.
 */
export interface ColumnGrounding {
  column: string;
  grounded: boolean;
  snappedFrom?: string;
}

/**
 * Contents of `chat_generated_tables.metadata` (JSONB). Only the fields consumed
 * by the renderer are typed here; the column may hold additional diagnostic keys.
 */
export interface ChatTableMetadata {
  extractionMode?: string;
  perPaperReasons?: PerPaperReason[];
  partialFailures?: PartialExtractionFailure[];
  /** Per-cell tuples parallel to `rows` (Phase 1 D1/D3). null cells / null on fallback. */
  cellTuples?: (CellTuple | null)[][] | null;
  /** Column semantic types index-aligned to `headers` (Phase 1 D2). */
  columnSemanticTypes?: (ColumnSemanticType | string | null)[] | null;
  /** Columns where differently-conditioned data was merged (Phase 1 D1). */
  conditionConflicts?: ConditionConflict[];
  /** Per-column grounding flags from the spec-name snap (Phase 2.5 slice 11 branch 2). */
  columnGrounding?: ColumnGrounding[];
  [key: string]: unknown;
}

export interface ChatGeneratedTable {
  id: string;
  message_id: string;
  conversation_id: string;
  table_title: string | null;
  headers: string[];
  rows: string[][];
  source_refs: TableReference[] | null;
  verification: CellVerification[] | null;
  metadata?: ChatTableMetadata | null;
  created_at: string;
}

// ============================================================
// IPC Event Payloads
// ============================================================

export interface ChatTokenEvent {
  conversationId: string;
  token: string;
}

export interface ChatCompleteEvent {
  conversationId: string;
  messageId: string;
  hasTable: boolean;
  tableId?: string;
}

export interface ChatVerificationDoneEvent {
  conversationId: string;
  tableId: string;
  verification: CellVerification[];
}

export interface ChatErrorEvent {
  conversationId: string;
  error: string;
}

// ============================================================
// IPC Request Params
// ============================================================

export interface ChatSendMessageParams {
  conversationId?: string;
  message: string;
  scopeFolderId?: string | null;
  scopeAll?: boolean;
  mode?: ConversationType;
}

export interface ChatAbortParams {
  conversationId: string;
}

export interface ChatExportCsvParams {
  tableId: string;
}
