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
  onJobProgress: (callback: (data: DesktopJobProgressEvent) => void) => () => void;
  onJobCompleted: (callback: (data: DesktopJobCompletedEvent) => void) => () => void;
  onJobFailed: (callback: (data: DesktopJobFailedEvent) => void) => () => void;
  onBackupAutoCompleted: (callback: (data: { backupPath: string }) => void) => () => void;
}

declare global {
  interface Window {
    redouDesktop?: RedouDesktopApi;
  }
}

export {};
