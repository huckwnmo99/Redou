import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BackupCreateResult,
  DbResult,
  DesktopJobCompletedEvent,
  DesktopJobFailedEvent,
  DesktopJobProgressEvent,
  FileImportParams,
  FileImportResult,
  PdfInspectionResult,
  RedouDesktopApi,
} from "@/types/desktop";

export interface DesktopSnapshot {
  available: boolean;
  runtime: "electron" | "browser";
  platform: string;
  version: string | null;
  libraryPath: string | null;
}

export interface DesktopJobFeed {
  kind: "progress" | "completed" | "failed";
  jobId: string;
  paperId?: string | null;
  progress?: number;
  title: string;
  description: string;
}

export const desktopKeys = {
  status: ["desktop", "status"] as const,
  filePath: (storedPath: string) => ["desktop", "file-path", storedPath] as const,
};

function getDesktopApi(): RedouDesktopApi | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.redouDesktop ?? null;
}

function fallbackPlatform(): string {
  if (typeof navigator === "undefined") {
    return "Browser";
  }

  return navigator.userAgent.includes("Windows") ? "Browser preview on Windows" : navigator.platform || "Browser preview";
}

async function settleString(task: Promise<string>, fallback: string | null): Promise<string | null> {
  try {
    return await task;
  } catch {
    return fallback;
  }
}

async function readDesktopSnapshot(): Promise<DesktopSnapshot> {
  const api = getDesktopApi();

  if (!api) {
    return {
      available: false,
      runtime: "browser",
      platform: fallbackPlatform(),
      version: null,
      libraryPath: null,
    };
  }

  const [platform, version, libraryPath] = await Promise.all([
    settleString(api.app.getPlatform(), api.platform),
    settleString(api.app.getVersion(), null),
    settleString(api.app.getLibraryPath(), null),
  ]);

  return {
    available: true,
    runtime: "electron",
    platform: platform ?? api.platform,
    version,
    libraryPath,
  };
}

function expectSuccess<T>(result: DbResult<T> | undefined, fallbackMessage: string): T {
  if (!result) {
    throw new Error(fallbackMessage);
  }

  if (!result.success) {
    throw new Error(result.error ?? fallbackMessage);
  }

  if (result.data === undefined) {
    throw new Error(fallbackMessage);
  }

  return result.data;
}

function requireDesktopApi(): RedouDesktopApi {
  const api = getDesktopApi();

  if (!api) {
    throw new Error("Desktop actions are only available inside the Electron shell.");
  }

  return api;
}

function resolveCompletedPaperId(event: DesktopJobCompletedEvent): string | null {
  if (event.paperId) {
    return event.paperId;
  }

  if (event.result && typeof event.result === "object" && "paperId" in event.result) {
    const paperId = (event.result as { paperId?: unknown }).paperId;
    return typeof paperId === "string" ? paperId : null;
  }

  return null;
}

function invalidateWorkspaceQueries(queryClient: ReturnType<typeof useQueryClient>, paperId?: string | null) {
  queryClient.invalidateQueries({ queryKey: ["papers"] });
  queryClient.invalidateQueries({ queryKey: ["folders"] });
  queryClient.invalidateQueries({ queryKey: ["notes"] });

  if (paperId) {
    queryClient.invalidateQueries({ queryKey: ["papers", "detail", paperId] });
    queryClient.invalidateQueries({ queryKey: ["paper-files", "primary", paperId] });
    queryClient.invalidateQueries({ queryKey: ["paper-sections", "paper", paperId] });
    queryClient.invalidateQueries({ queryKey: ["paper-figures", "paper", paperId] });
    queryClient.invalidateQueries({ queryKey: ["notes", "paper", paperId] });
    queryClient.invalidateQueries({ queryKey: ["highlights", "paper", paperId] });
  }
}

function progressDescription(event: DesktopJobProgressEvent) {
  if (event.message) {
    return event.message;
  }

  if (event.status === "running") {
    return `Processing job ${event.jobId} is running.`;
  }

  return `Processing job ${event.jobId} changed to ${event.status}.`;
}

export function toDesktopFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  // Use custom redou-file:// protocol to avoid file:// CORS issues
  // Must use triple slash (redou-file:///) so drive letter isn't parsed as host
  if (/^[A-Za-z]:\//.test(normalized)) {
    const [drive, ...segments] = normalized.split("/");
    return `redou-file:///${drive}/${segments.map(encodeURIComponent).join("/")}`;
  }

  if (normalized.startsWith("//")) {
    const [, , host, ...segments] = normalized.split("/");
    return `redou-file://${host}/${segments.map(encodeURIComponent).join("/")}`;
  }

  const trimmedPath = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  return `redou-file:///${trimmedPath.split("/").map(encodeURIComponent).join("/")}`;
}

export async function importPdfToLibrary(args: FileImportParams): Promise<FileImportResult> {
  const api = requireDesktopApi();
  const result = await api.file.importPdf(args);
  return expectSuccess(result, "Unable to import the selected PDF into the desktop library.");
}

export async function deleteImportedLibraryFile(storedPath: string, cleanupToken?: string): Promise<void> {
  const api = getDesktopApi();
  if (!api) return;

  const result = await api.file.delete({ storedPath, cleanupToken });
  if (!result.success) {
    console.warn("[desktop] Unable to clean up imported PDF:", result.error);
  }
}

export async function inspectDesktopPdfMetadata(sourcePath: string): Promise<PdfInspectionResult> {
  const api = requireDesktopApi();
  const result = await api.file.inspectPdf({ sourcePath });
  return expectSuccess(result, "Unable to inspect the selected PDF metadata.");
}

export function useDesktopRuntime() {
  return useQuery({
    queryKey: desktopKeys.status,
    queryFn: readDesktopSnapshot,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useResolvedDesktopFilePath(storedPath: string | null) {
  return useQuery({
    queryKey: desktopKeys.filePath(storedPath ?? "none"),
    queryFn: async () => {
      if (!storedPath) {
        return null;
      }

      const api = getDesktopApi();
      if (!api) {
        return null;
      }

      const result = await api.file.getPath({ storedPath });
      return expectSuccess(result, "Unable to resolve the stored PDF path.");
    },
    enabled: Boolean(storedPath),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useDesktopPdfSelection() {
  return useMutation({
    mutationFn: async () => {
      const api = requireDesktopApi();
      const result = await api.file.selectDialog();

      if (!result.success && !result.error) {
        return [] as string[];
      }

      return expectSuccess(result, "Unable to open the PDF selection dialog.");
    },
  });
}

export function useOpenDesktopFile() {
  return useMutation({
    mutationFn: async (filePath: string) => {
      const api = requireDesktopApi();
      const result = await api.file.openPath({ filePath });

      if (!result.success) {
        throw new Error(result.error ?? "Unable to open the PDF in the system viewer.");
      }
    },
  });
}

export function useCreateDesktopBackup() {
  return useMutation({
    mutationFn: async (): Promise<BackupCreateResult> => {
      const api = requireDesktopApi();
      const result = await api.backup.create();
      return expectSuccess(result, "Unable to create a workspace backup.");
    },
  });
}

export function useRevealInExplorer() {
  return useMutation({
    mutationFn: async (filePath: string) => {
      const api = requireDesktopApi();
      const result = await api.file.openInExplorer({ filePath });

      if (!result.success) {
        throw new Error(result.error ?? "Unable to reveal the requested path.");
      }
    },
  });
}

export function useDesktopJobBridge() {
  const queryClient = useQueryClient();
  const [latestJob, setLatestJob] = useState<DesktopJobFeed | null>(null);

  useEffect(() => {
    const api = getDesktopApi();

    if (!api || typeof window === "undefined") {
      return undefined;
    }

    let clearTimer: number | null = null;

    const scheduleClear = (delayMs: number) => {
      if (clearTimer !== null) {
        window.clearTimeout(clearTimer);
      }

      clearTimer = window.setTimeout(() => {
        setLatestJob(null);
        clearTimer = null;
      }, delayMs);
    };

    const handleProgress = (event: DesktopJobProgressEvent) => {
      invalidateWorkspaceQueries(queryClient, event.paperId ?? null);
      setLatestJob({
        kind: "progress",
        jobId: event.jobId,
        paperId: event.paperId ?? null,
        progress: event.progress,
        title: event.status === "running" ? "Processing import" : "Import queued",
        description: progressDescription(event),
      });
    };

    const handleCompleted = (event: DesktopJobCompletedEvent) => {
      const paperId = resolveCompletedPaperId(event);
      invalidateWorkspaceQueries(queryClient, paperId);
      setLatestJob({
        kind: "completed",
        jobId: event.jobId,
        paperId,
        title: "Paper ready",
        description: paperId
          ? "The desktop worker finished the current import. The paper is ready for the next reader step."
          : "The desktop worker finished the current import.",
      });
      scheduleClear(4500);
    };

    const handleFailed = (event: DesktopJobFailedEvent) => {
      invalidateWorkspaceQueries(queryClient, event.paperId ?? null);
      setLatestJob({
        kind: "failed",
        jobId: event.jobId,
        paperId: event.paperId ?? null,
        title: "Processing failed",
        description: event.error || "The current desktop job failed.",
      });
      scheduleClear(6500);
    };

    const unsubscribeProgress = api.onJobProgress(handleProgress);
    const unsubscribeCompleted = api.onJobCompleted(handleCompleted);
    const unsubscribeFailed = api.onJobFailed(handleFailed);

    return () => {
      if (clearTimer !== null) {
        window.clearTimeout(clearTimer);
      }
      unsubscribeProgress();
      unsubscribeCompleted();
      unsubscribeFailed();
    };
  }, [queryClient]);

  return latestJob;
}



