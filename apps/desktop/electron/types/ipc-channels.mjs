// ============================================================
// IPC Channel Definitions
// main <-> renderer communication channel names and event definitions
// ============================================================

/** renderer -> main (ipcRenderer.invoke <-> ipcMain.handle) */
export const IPC_CHANNELS = {
  DB_QUERY: 'db:query',
  DB_MUTATE: 'db:mutate',

  FILE_IMPORT_PDF: 'file:import-pdf',
  FILE_INSPECT_PDF: 'file:inspect-pdf',
  FILE_GET_PATH: 'file:get-path',
  FILE_OPEN_PATH: 'file:open-path',
  FILE_DELETE: 'file:delete',
  FILE_OPEN_IN_EXPLORER: 'file:open-in-explorer',
  FILE_SELECT_DIALOG: 'file:select-dialog',

  APP_GET_PLATFORM: 'app:get-platform',
  APP_GET_VERSION: 'app:get-version',
  APP_GET_LIBRARY_PATH: 'app:get-library-path',

  WINDOW_DETACH_PANEL: 'window:detach-panel',
  WINDOW_REATTACH_PANEL: 'window:reattach-panel',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_LIST: 'backup:list',

  EMBEDDING_GENERATE_QUERY: 'embedding:generate-query',
  AUTH_GOOGLE_SIGN_IN: 'auth:google-sign-in',
  PIPELINE_REQUEUE_ALL: 'pipeline:requeue-all',

  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_ABORT: 'chat:abort',
  CHAT_EXPORT_CSV: 'chat:export-csv',
};

/** main -> renderer (mainWindow.webContents.send) */
export const IPC_EVENTS = {
  JOB_PROGRESS: 'job:progress',
  JOB_COMPLETED: 'job:completed',
  JOB_FAILED: 'job:failed',
  FILE_CHANGED: 'file:changed',
  BACKUP_AUTO_COMPLETED: 'backup:auto-completed',

  CHAT_TOKEN: 'chat:token',
  CHAT_COMPLETE: 'chat:complete',
  CHAT_VERIFICATION_DONE: 'chat:verification-done',
  CHAT_ERROR: 'chat:error',
  CHAT_STATUS: 'chat:status',
};
