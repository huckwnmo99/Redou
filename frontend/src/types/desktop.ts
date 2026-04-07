export interface DbQueryParams {
  table: string;
  method: "select";
  params?: {
    columns?: string;
    filters?: [string, string, unknown][];
    order?: { column: string; ascending?: boolean };
    limit?: number;
  };
}

export interface DbMutateParams {
  table: string;
  method: "insert" | "update" | "upsert" | "delete";
  params: {
    data?: Record<string, unknown> | Record<string, unknown>[];
    match?: Record<string, unknown>;
  };
}

export interface DbResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface FileImportParams {
  sourcePath: string;
  year?: number;
  firstAuthor?: string;
  shortTitle?: string;
}

export interface FileImportResult {
  storedPath: string;
  storedFilename: string;
  originalFilename: string;
  checksum: string;
  fileSize: number;
}

export interface PdfInspectionResult {
  title?: string;
  year?: number;
  firstAuthor?: string;
  venue?: string;
  abstractPreview?: string;
}

export interface DetachPanelParams {
  panelId: string;
  url?: string;
}

export interface BackupRestoreParams {
  backupPath: string;
}

export interface BackupCreateResult {
  backupPath: string;
  fileSize: number;
}

export interface DesktopJobProgressEvent {
  jobId: string;
  paperId?: string | null;
  status: string;
  progress: number;
  message?: string;
}

export interface DesktopJobCompletedEvent {
  jobId: string;
  paperId?: string | null;
  result: unknown;
}

export interface DesktopJobFailedEvent {
  jobId: string;
  paperId?: string | null;
  error: string;
}

export interface ChatSendMessageParams {
  conversationId?: string;
  message: string;
  scopeFolderId?: string | null;
  scopeAll?: boolean;
  mode?: "table" | "qa";
}

export interface ChatAbortParams {
  conversationId: string;
}

export interface ChatExportCsvParams {
  tableId: string;
}

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
  verification: unknown[];
}

export interface ChatErrorEvent {
  conversationId: string;
  error: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  details?: Record<string, unknown> | null;
}

export interface LlmModelInfo {
  model: string;
  source: "user" | "env" | "default";
}

export type ChatPipelineStage = "orchestrating" | "searching" | "parsing" | "assembling" | "verifying" | "answering";

export interface ChatStatusEvent {
  conversationId: string;
  stage: ChatPipelineStage;
  message: string;
  detail?: string;
}

export interface RedouDesktopApi {
  platform: string;
  db: {
    query: <T = unknown>(args: DbQueryParams) => Promise<DbResult<T[]>>;
    mutate: <T = unknown>(args: DbMutateParams) => Promise<DbResult<T>>;
  };
  file: {
    importPdf: (args: FileImportParams) => Promise<DbResult<FileImportResult>>;
    inspectPdf: (args: { sourcePath: string }) => Promise<DbResult<PdfInspectionResult>>;
    getPath: (args: { storedPath: string }) => Promise<DbResult<string>>;
    openPath: (args: { filePath: string }) => Promise<DbResult>;
    delete: (args: { storedPath: string }) => Promise<DbResult>;
    openInExplorer: (args: { filePath: string }) => Promise<DbResult>;
    selectDialog: () => Promise<DbResult<string[]>>;
  };
  app: {
    getPlatform: () => Promise<string>;
    getVersion: () => Promise<string>;
    getLibraryPath: () => Promise<string>;
  };
  window: {
    detachPanel: (args: DetachPanelParams) => Promise<DbResult<{ windowId: string }>>;
    reattachPanel: (args: { panelId: string }) => Promise<DbResult>;
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
  };
  backup: {
    create: () => Promise<DbResult<BackupCreateResult>>;
    restore: (args: BackupRestoreParams) => Promise<DbResult>;
    list: () => Promise<DbResult<unknown[]>>;
  };
  embedding: {
    generateQuery: (args: { text: string }) => Promise<DbResult<number[]>>;
  };
  auth: {
    googleSignIn: () => Promise<DbResult<{ accessToken: string; refreshToken: string }>>;
  };
  pipeline: {
    requeueAll: () => Promise<DbResult<{ queued: number }>>;
  };
  chat: {
    sendMessage: (args: ChatSendMessageParams) => Promise<DbResult<{ conversationId: string }>>;
    abort: (args: ChatAbortParams) => Promise<DbResult>;
    exportCsv: (args: ChatExportCsvParams) => Promise<DbResult<{ filePath: string }>>;
  };
  llm: {
    listModels: () => Promise<DbResult<OllamaModel[]>>;
    getModel: () => Promise<DbResult<LlmModelInfo>>;
    setModel: (args: { model: string }) => Promise<DbResult<{ model: string }>>;
  };
  openExternal: (url: string) => Promise<void>;
  getFilePathForDrop: (file: File) => string;
  onJobProgress: (callback: (data: DesktopJobProgressEvent) => void) => () => void;
  onJobCompleted: (callback: (data: DesktopJobCompletedEvent) => void) => () => void;
  onJobFailed: (callback: (data: DesktopJobFailedEvent) => void) => () => void;
  onBackupAutoCompleted: (callback: (data: { backupPath: string }) => void) => () => void;
  onChatToken: (callback: (data: ChatTokenEvent) => void) => () => void;
  onChatComplete: (callback: (data: ChatCompleteEvent) => void) => () => void;
  onChatVerificationDone: (callback: (data: ChatVerificationDoneEvent) => void) => () => void;
  onChatError: (callback: (data: ChatErrorEvent) => void) => () => void;
  onChatStatus: (callback: (data: ChatStatusEvent) => void) => () => void;
}

declare global {
  interface Window {
    redouDesktop?: RedouDesktopApi;
  }
}

export {};
