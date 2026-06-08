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

export interface ChatMessageMetadata {
  source_chunk_ids?: string[];
  referenced_paper_ids?: string[];
  table_id?: string;
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
 * Contents of `chat_generated_tables.metadata` (JSONB). Only the fields consumed
 * by the renderer are typed here; the column may hold additional diagnostic keys.
 */
export interface ChatTableMetadata {
  extractionMode?: string;
  perPaperReasons?: PerPaperReason[];
  partialFailures?: PartialExtractionFailure[];
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
