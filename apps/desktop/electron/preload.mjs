const { contextBridge, ipcRenderer, webUtils } = require("electron");

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
  PIPELINE_REQUEUE_ALL: "pipeline:requeue-all",
  CHAT_SEND_MESSAGE: "chat:send-message",
  CHAT_ABORT: "chat:abort",
  CHAT_EXPORT_CSV: "chat:export-csv",
  SHELL_OPEN_EXTERNAL: "shell:open-external",
  LLM_LIST_MODELS: "llm:list-models",
  LLM_GET_MODEL: "llm:get-model",
  LLM_SET_MODEL: "llm:set-model",
  ENTITY_BACKFILL: "entity:backfill",
  ENTITY_BACKFILL_STATUS: "entity:backfill-status",
  ENTITY_GET_MODEL: "entity:get-model",
  ENTITY_SET_MODEL: "entity:set-model",
};

const IPC_EVENTS = {
  JOB_PROGRESS: "job:progress",
  JOB_COMPLETED: "job:completed",
  JOB_FAILED: "job:failed",
  FILE_CHANGED: "file:changed",
  BACKUP_AUTO_COMPLETED: "backup:auto-completed",
  CHAT_TOKEN: "chat:token",
  CHAT_COMPLETE: "chat:complete",
  CHAT_VERIFICATION_DONE: "chat:verification-done",
  CHAT_ERROR: "chat:error",
  CHAT_STATUS: "chat:status",
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

  pipeline: {
    requeueAll: () => ipcRenderer.invoke(IPC_CHANNELS.PIPELINE_REQUEUE_ALL),
  },

  chat: {
    sendMessage: (args) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND_MESSAGE, args),
    abort: (args) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_ABORT, args),
    exportCsv: (args) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_EXPORT_CSV, args),
  },

  llm: {
    listModels: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_LIST_MODELS),
    getModel: () => ipcRenderer.invoke(IPC_CHANNELS.LLM_GET_MODEL),
    setModel: (args) => ipcRenderer.invoke(IPC_CHANNELS.LLM_SET_MODEL, args),
  },

  entity: {
    backfill: () => ipcRenderer.invoke(IPC_CHANNELS.ENTITY_BACKFILL),
    backfillStatus: () => ipcRenderer.invoke(IPC_CHANNELS.ENTITY_BACKFILL_STATUS),
    getModel: () => ipcRenderer.invoke(IPC_CHANNELS.ENTITY_GET_MODEL),
    setModel: (args) => ipcRenderer.invoke(IPC_CHANNELS.ENTITY_SET_MODEL, args),
  },

  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),

  getFilePathForDrop: (file) => webUtils.getPathForFile(file),

  onJobProgress: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onJobProgress callback error:", e); } };
    ipcRenderer.on(IPC_EVENTS.JOB_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.JOB_PROGRESS, handler);
  },
  onJobCompleted: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onJobCompleted callback error:", e); } };
    ipcRenderer.on(IPC_EVENTS.JOB_COMPLETED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.JOB_COMPLETED, handler);
  },
  onJobFailed: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onJobFailed callback error:", e); } };
    ipcRenderer.on(IPC_EVENTS.JOB_FAILED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.JOB_FAILED, handler);
  },
  onBackupAutoCompleted: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onBackupAutoCompleted callback error:", e); } };
    ipcRenderer.on(IPC_EVENTS.BACKUP_AUTO_COMPLETED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.BACKUP_AUTO_COMPLETED, handler);
  },

  onChatToken: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onChatToken error:", e); } };
    ipcRenderer.on(IPC_EVENTS.CHAT_TOKEN, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_TOKEN, handler);
  },
  onChatComplete: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onChatComplete error:", e); } };
    ipcRenderer.on(IPC_EVENTS.CHAT_COMPLETE, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_COMPLETE, handler);
  },
  onChatVerificationDone: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onChatVerificationDone error:", e); } };
    ipcRenderer.on(IPC_EVENTS.CHAT_VERIFICATION_DONE, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_VERIFICATION_DONE, handler);
  },
  onChatError: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onChatError error:", e); } };
    ipcRenderer.on(IPC_EVENTS.CHAT_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_ERROR, handler);
  },
  onChatStatus: (callback) => {
    const handler = (_event, data) => { try { callback(data); } catch (e) { console.error("[preload] onChatStatus error:", e); } };
    ipcRenderer.on(IPC_EVENTS.CHAT_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.CHAT_STATUS, handler);
  },
});
