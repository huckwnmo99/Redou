// ============================================================
// window.redouDesktop 타입 선언
// preload.mjs에서 contextBridge로 노출하는 API의 타입
// ============================================================

interface DbQueryParams {
  table: string;
  method: 'select';
  params?: {
    columns?: string;
    filters?: [string, string, unknown][];
    order?: { column: string; ascending?: boolean };
    limit?: number;
  };
}

interface DbMutateParams {
  table: string;
  method: 'insert' | 'update' | 'upsert' | 'delete';
  params: {
    data?: Record<string, unknown> | Record<string, unknown>[];
    match?: Record<string, unknown>;
  };
}

interface DbResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface FileImportParams {
  sourcePath: string;
  year?: number;
  firstAuthor?: string;
  shortTitle?: string;
}

interface FileImportResult {
  storedPath: string;
  storedFilename: string;
  originalFilename: string;
  checksum: string;
  fileSize: number;
}

interface DetachPanelParams {
  panelId: string;
  url?: string;
}

interface BackupRestoreParams {
  backupPath: string;
}

interface BackupCreateResult {
  backupPath: string;
  fileSize: number;
}

interface RedouDesktopApi {
  platform: string;

  db: {
    query: <T = unknown>(args: DbQueryParams) => Promise<DbResult<T[]>>;
    mutate: <T = unknown>(args: DbMutateParams) => Promise<DbResult<T>>;
  };

  file: {
    importPdf: (args: FileImportParams) => Promise<DbResult<FileImportResult>>;
    getPath: (args: { storedPath: string }) => Promise<DbResult<string>>;
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

  // Events (main → renderer), returns unsubscribe function
  onJobProgress: (callback: (data: { jobId: string; status: string; progress: number }) => void) => () => void;
  onJobCompleted: (callback: (data: { jobId: string; result: unknown }) => void) => () => void;
  onJobFailed: (callback: (data: { jobId: string; error: string }) => void) => () => void;
  onBackupAutoCompleted: (callback: (data: { backupPath: string }) => void) => () => void;
}

declare global {
  interface Window {
    redouDesktop: RedouDesktopApi;
  }
}

export {};
