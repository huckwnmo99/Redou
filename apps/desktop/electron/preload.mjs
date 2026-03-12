const { contextBridge, ipcRenderer } = require("electron");

const IPC_CHANNELS = {
  DB_QUERY: "db:query",
  DB_MUTATE: "db:mutate",
  FILE_IMPORT_PDF: "file:import-pdf",
  FILE_INSPECT_PDF: "file:inspect-pdf",
  FILE_GET_PATH: "file:get-path",
  FILE_OPEN_PATH: "file:open-path",
  FILE_DELETE: "file:delete",
  FILE_OPEN_IN_EXPLORER: "file:open-in-explorer",
  FILE_SELECT_DIALOG: "file:select-dialog",
  APP_GET_PLATFORM: "app:get-platform",
  APP_GET_VERSION: "app:get-version",
  APP_GET_LIBRARY_PATH: "app:get-library-path",
  WINDOW_DETACH_PANEL: "window:detach-panel",
  WINDOW_REATTACH_PANEL: "window:reattach-panel",
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  BACKUP_CREATE: "backup:create",
  BACKUP_RESTORE: "backup:restore",
  BACKUP_LIST: "backup:list",
  EMBEDDING_GENERATE_QUERY: "embedding:generate-query",
  AUTH_GOOGLE_SIGN_IN: "auth:google-sign-in",
};

const IPC_EVENTS = {
  JOB_PROGRESS: "job:progress",
  JOB_COMPLETED: "job:completed",
  JOB_FAILED: "job:failed",
  FILE_CHANGED: "file:changed",
  BACKUP_AUTO_COMPLETED: "backup:auto-completed",
};

contextBridge.exposeInMainWorld("redouDesktop", {
  platform: process.platform,

  db: {
    query: (args) => ipcRenderer.invoke(IPC_CHANNELS.DB_QUERY, args),
    mutate: (args) => ipcRenderer.invoke(IPC_CHANNELS.DB_MUTATE, args),
  },

  file: {
    importPdf: (args) => ipcRenderer.invoke(IPC_CHANNELS.FILE_IMPORT_PDF, args),
    inspectPdf: (args) => ipcRenderer.invoke(IPC_CHANNELS.FILE_INSPECT_PDF, args),
    getPath: (args) => ipcRenderer.invoke(IPC_CHANNELS.FILE_GET_PATH, args),
    openPath: (args) => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_PATH, args),
    delete: (args) => ipcRenderer.invoke(IPC_CHANNELS.FILE_DELETE, args),
    openInExplorer: (args) => ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_IN_EXPLORER, args),
    selectDialog: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_SELECT_DIALOG),
  },

  app: {
    getPlatform: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PLATFORM),
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
    getLibraryPath: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_LIBRARY_PATH),
  },

  window: {
    detachPanel: (args) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_DETACH_PANEL, args),
    reattachPanel: (args) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_REATTACH_PANEL, args),
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_CLOSE),
  },

  backup: {
    create: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_CREATE),
    restore: (args) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_RESTORE, args),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_LIST),
  },

  embedding: {
    generateQuery: (args) => ipcRenderer.invoke(IPC_CHANNELS.EMBEDDING_GENERATE_QUERY, args),
  },

  auth: {
    googleSignIn: () => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GOOGLE_SIGN_IN),
  },

  onJobProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(IPC_EVENTS.JOB_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.JOB_PROGRESS, handler);
  },
  onJobCompleted: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(IPC_EVENTS.JOB_COMPLETED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.JOB_COMPLETED, handler);
  },
  onJobFailed: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(IPC_EVENTS.JOB_FAILED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.JOB_FAILED, handler);
  },
  onBackupAutoCompleted: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(IPC_EVENTS.BACKUP_AUTO_COMPLETED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.BACKUP_AUTO_COMPLETED, handler);
  },
});
