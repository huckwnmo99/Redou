// ============================================================
// Chat Feature Types
// ============================================================

export type ChatPhase = "clarifying" | "follow_up";

export interface ChatConversation {
  id: string;
  owner_user_id: string;
  title: string;
  phase: ChatPhase;
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
}

export interface CellVerification {
  row: number;
  col: number;
  status: "verified" | "unverified";
  sourceChunkId?: string;
  evidence?: string;
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
}

export interface ChatAbortParams {
  conversationId: string;
}

export interface ChatExportCsvParams {
  tableId: string;
}
