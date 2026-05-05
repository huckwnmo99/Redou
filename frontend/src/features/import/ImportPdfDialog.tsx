import { CheckCircle2, FileUp, FolderOpen, LoaderCircle, X, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { inspectDesktopPdfMetadata, useDesktopPdfSelection, useDesktopRuntime } from "@/lib/desktop";
import { useImportDesktopPapers } from "@/lib/queries";
import type { ImportedPaperDraft, ImportedPaperResult } from "@/types/paper";
import type { DesktopJobProgressEvent, DesktopJobCompletedEvent, DesktopJobFailedEvent } from "@/types/desktop";

interface ImportPdfDialogProps {
  open: boolean;
  defaultFolderId: string | null;
  defaultFolderName?: string;
  initialPaths?: string[] | null;
  onClose: () => void;
  onOpenImportedPaper: (paperId: string) => void;
}

function getFilename(filePath: string): string {
  const segments = filePath.split(/[/\\]/);
  return segments[segments.length - 1] ?? filePath;
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferDraftFromPath(sourcePath: string, folderId: string | null): ImportedPaperDraft {
  const filename = getFilename(sourcePath);
  const stem = filename.replace(/\.pdf$/i, "");
  const yearMatch = stem.match(/(?:19|20)\d{2}/);
  const year = yearMatch ? Number(yearMatch[0]) : undefined;
  const withoutYear = yearMatch ? stem.replace(yearMatch[0], " ") : stem;
  const segments = withoutYear
    .split(/[_-]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const firstAuthor = segments.length > 1 ? toTitleCase(segments[0]) : "";
  const titleSource = segments.length > 1 ? segments.slice(1).join(" ") : stem;
  const title = toTitleCase(titleSource.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || stem);

  return {
    sourcePath,
    title,
    year,
    firstAuthor,
    venue: "",
    folderId,
  };
}

export function ImportPdfDialog({
  open,
  defaultFolderId,
  defaultFolderName,
  initialPaths,
  onClose,
  onOpenImportedPaper,
}: ImportPdfDialogProps) {
  const { data: desktop } = useDesktopRuntime();
  const selectPdfFiles = useDesktopPdfSelection();
  const importPapers = useImportDesktopPapers();
  const [drafts, setDrafts] = useState<ImportedPaperDraft[]>([]);
  const [results, setResults] = useState<ImportedPaperResult[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Per-job processing status tracking
  const [jobStatuses, setJobStatuses] = useState<Record<string, {
    status: "queued" | "running" | "completed" | "failed";
    progress: number;
    message: string;
  }>>({});

  const desktopReady = desktop?.available ?? false;
  const canImport = drafts.length > 0 && drafts.every((draft) => draft.title.trim().length > 0) && !importPapers.isPending;

  const processedPathsRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (!open) {
      setDrafts([]);
      setResults([]);
      setFeedback(null);
      setJobStatuses({});
      processedPathsRef.current = null;
    }
  }, [open]);

  // Subscribe to job events to track processing status of imported papers
  const trackedJobIds = useRef(new Set<string>());
  useEffect(() => {
    if (results.length === 0) {
      trackedJobIds.current.clear();
      return;
    }
    const ids = new Set(results.map((r) => r.processingJobId));
    trackedJobIds.current = ids;

    // Initialize all as queued
    setJobStatuses((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (!next[id]) {
          next[id] = { status: "queued", progress: 0, message: "Waiting in queue..." };
        }
      }
      return next;
    });

    const api = window.redouDesktop;
    if (!api) return;

    const onProgress = (e: DesktopJobProgressEvent) => {
      if (!trackedJobIds.current.has(e.jobId)) return;
      setJobStatuses((prev) => ({
        ...prev,
        [e.jobId]: {
          status: "running",
          progress: e.progress,
          message: e.message || e.status || "Processing...",
        },
      }));
    };
    const onCompleted = (e: DesktopJobCompletedEvent) => {
      if (!trackedJobIds.current.has(e.jobId)) return;
      setJobStatuses((prev) => ({
        ...prev,
        [e.jobId]: { status: "completed", progress: 100, message: "Complete" },
      }));
    };
    const onFailed = (e: DesktopJobFailedEvent) => {
      if (!trackedJobIds.current.has(e.jobId)) return;
      setJobStatuses((prev) => ({
        ...prev,
        [e.jobId]: { status: "failed", progress: 0, message: e.error || "Failed" },
      }));
    };

    const unsub1 = api.onJobProgress(onProgress);
    const unsub2 = api.onJobCompleted(onCompleted);
    const unsub3 = api.onJobFailed(onFailed);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [results]);

  // Auto-process dropped file paths
  useEffect(() => {
    if (!open || !initialPaths || initialPaths.length === 0) return;
    if (processedPathsRef.current === initialPaths) return;
    processedPathsRef.current = initialPaths;

    (async () => {
      const nextDrafts = await Promise.all(
        initialPaths.map(async (filePath) => {
          const fallbackDraft = inferDraftFromPath(filePath, defaultFolderId);
          try {
            const inspected = await inspectDesktopPdfMetadata(filePath);
            return {
              ...fallbackDraft,
              title: inspected.title?.trim() || fallbackDraft.title,
              year: inspected.year ?? fallbackDraft.year,
              firstAuthor: inspected.firstAuthor?.trim() || fallbackDraft.firstAuthor,
              venue: inspected.venue?.trim() || fallbackDraft.venue,
            };
          } catch {
            return fallbackDraft;
          }
        }),
      );
      setFeedback(`${initialPaths.length} PDF files added. Review the titles below before importing.`);
      setDrafts(nextDrafts);
    })();
  }, [open, initialPaths, defaultFolderId]);

  const fileCountLabel = useMemo(() => {
    if (drafts.length === 0) {
      return "No files selected yet";
    }

    if (drafts.length === 1) {
      return "1 PDF ready to import";
    }

    return `${drafts.length} PDFs ready to import`;
  }, [drafts.length]);

  if (!open) {
    return null;
  }

  async function handleSelectFiles() {
    try {
      const filePaths = await selectPdfFiles.mutateAsync();
      setResults([]);

      if (filePaths.length === 0) {
        setDrafts([]);
        setFeedback("No PDF files selected.");
        return;
      }

      const nextDrafts = await Promise.all(
        filePaths.map(async (filePath) => {
          const fallbackDraft = inferDraftFromPath(filePath, defaultFolderId);

          try {
            const inspected = await inspectDesktopPdfMetadata(filePath);
            return {
              ...fallbackDraft,
              title: inspected.title?.trim() || fallbackDraft.title,
              year: inspected.year ?? fallbackDraft.year,
              firstAuthor: inspected.firstAuthor?.trim() || fallbackDraft.firstAuthor,
              venue: inspected.venue?.trim() || fallbackDraft.venue,
            };
          } catch {
            return fallbackDraft;
          }
        }),
      );

      setFeedback(filePaths.length + " PDF files selected. Review the titles below before importing.");
      setDrafts(nextDrafts);
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "Unable to open the PDF selection dialog.");
    }
  }

  async function handleImport() {
    try {
      const imported = await importPapers.mutateAsync(drafts);
      setResults(imported);
      setFeedback(`${imported.length} PDFs added to Redou. Background processing has started.`);
    } catch (caught) {
      setFeedback(caught instanceof Error ? caught.message : "Unable to complete the PDF import flow.");
    }
  }

  function updateDraft(index: number, patch: Partial<ImportedPaperDraft>) {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? { ...draft, ...patch } : draft)));
  }

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Redou Style / Import</div>
            <h2 style={{ fontSize: 24, letterSpacing: "-0.03em", marginBottom: 6 }}>Add PDFs to Redou</h2>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--color-text-secondary)", maxWidth: 620 }}>
              Choose local PDF files, confirm the paper titles, and Redou will start processing them in the background.
            </p>
          </div>
          <button type="button" aria-label="Close import dialog" onClick={onClose} style={closeButtonStyle}>
            <X size={16} />
          </button>
        </div>

        <div style={statusRowStyle}>
          <div style={statusCardStyle}>
            <span style={eyebrowStyle}>App</span>
            <strong style={{ fontSize: 16 }}>{desktopReady ? "Redou Desktop" : "Preview mode"}</strong>
            <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
              {desktopReady ? "PDF selection and library import are available." : "Open Redou Desktop to import PDFs."}
            </span>
          </div>
          <div style={statusCardStyle}>
            <span style={eyebrowStyle}>Destination</span>
            <strong style={{ fontSize: 16 }}>{defaultFolderName ?? "All Papers"}</strong>
            <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
              Imported papers will be attached here when a custom folder is active.
            </span>
          </div>
          <div style={statusCardStyle}>
            <span style={eyebrowStyle}>Selection</span>
            <strong style={{ fontSize: 16 }}>{fileCountLabel}</strong>
            <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
              Select one or more PDFs. Redou will fill in title details where possible.
            </span>
          </div>
        </div>

        <div style={actionRowStyle}>
          <button type="button" onClick={handleSelectFiles} disabled={!desktopReady || selectPdfFiles.isPending} style={primaryButtonStyle}>
            {selectPdfFiles.isPending ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}
            {selectPdfFiles.isPending ? "Opening file picker..." : "Choose PDFs"}
          </button>
          <button type="button" onClick={handleImport} disabled={!desktopReady || !canImport} style={secondaryButtonStyle}>
            {importPapers.isPending ? <LoaderCircle size={15} className="spin" /> : <FileUp size={15} />}
            {importPapers.isPending ? "Creating records..." : "Import to workspace"}
          </button>
        </div>

        {feedback ? <div style={feedbackStyle}>{feedback}</div> : null}

        <div style={contentGridStyle}>
          <div style={draftColumnStyle}>
            {results.length > 0 ? (
              <>
                <div style={sectionHeaderStyle}>Processing Status</div>
                <div style={{ display: "grid", gap: 10, maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
                  {results.map((result) => {
                    const job = jobStatuses[result.processingJobId];
                    const status = job?.status ?? "queued";
                    const progress = job?.progress ?? 0;
                    const message = job?.message ?? "Waiting in queue...";

                    const tones: Record<string, { bg: string; accent: string; border: string }> = {
                      queued: { bg: "rgba(148, 163, 184, 0.08)", accent: "#64748b", border: "rgba(148, 163, 184, 0.2)" },
                      running: { bg: "rgba(37, 99, 235, 0.06)", accent: "#2563eb", border: "rgba(37, 99, 235, 0.18)" },
                      completed: { bg: "rgba(15, 118, 110, 0.06)", accent: "#0f766e", border: "rgba(15, 118, 110, 0.18)" },
                      failed: { bg: "rgba(220, 38, 38, 0.06)", accent: "#dc2626", border: "rgba(220, 38, 38, 0.18)" },
                    };
                    const tone = tones[status] ?? tones.queued;

                    return (
                      <div key={result.processingJobId} style={{ ...jobCardStyle, background: tone.bg, borderColor: tone.border }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          {status === "running" ? (
                            <LoaderCircle size={14} style={{ color: tone.accent, animation: "spin 1s linear infinite" }} />
                          ) : status === "completed" ? (
                            <CheckCircle2 size={14} style={{ color: tone.accent }} />
                          ) : status === "failed" ? (
                            <AlertCircle size={14} style={{ color: tone.accent }} />
                          ) : (
                            <div style={{ width: 14, height: 14, borderRadius: 999, border: `2px solid ${tone.accent}`, opacity: 0.5 }} />
                          )}
                          <div style={{ flex: 1, fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em", minWidth: 0 }}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {result.paper.title}
                            </div>
                          </div>
                          <div style={{ ...jobChipStyle, background: `${tone.accent}14`, color: tone.accent }}>
                            {status === "running" ? `${Math.round(progress)}%` : status}
                          </div>
                        </div>
                        {status === "running" ? (
                          <div style={{ height: 3, borderRadius: 2, background: `${tone.accent}22`, overflow: "hidden", marginBottom: 6 }}>
                            <div style={{ height: "100%", width: `${Math.min(100, progress)}%`, background: tone.accent, borderRadius: 2, transition: "width 0.4s ease" }} />
                          </div>
                        ) : null}
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
                          {message}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={() => onOpenImportedPaper(results[0].paper.id)} style={openPaperButtonStyle}>
                  Open first imported paper
                </button>
              </>
            ) : (
              <>
                <div style={sectionHeaderStyle}>Selected PDFs</div>
                {drafts.length === 0 ? (
                  <div style={emptyStateStyle}>
                    <FileUp size={28} style={{ opacity: 0.4 }} />
                    <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      Choose one or more PDFs to start importing.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12, maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
                    {drafts.map((draft, index) => (
                      <div key={`${draft.sourcePath}-${index}`} style={draftCardStyle}>
                        <div style={{ display: "grid", gap: 4, marginBottom: 12 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>{getFilename(draft.sourcePath)}</div>
                        </div>
                        <div style={fieldGridStyle}>
                          <Field label="Title">
                            <input value={draft.title} onChange={(event) => updateDraft(index, { title: event.target.value })} style={inputStyle} />
                          </Field>
                          <Field label="Year">
                            <input
                              value={draft.year ?? ""}
                              onChange={(event) => updateDraft(index, { year: event.target.value ? Number(event.target.value) : undefined })}
                              inputMode="numeric"
                              style={inputStyle}
                            />
                          </Field>
                          <Field label="First Author">
                            <input
                              value={draft.firstAuthor ?? ""}
                              onChange={(event) => updateDraft(index, { firstAuthor: event.target.value })}
                              style={inputStyle}
                            />
                          </Field>
                          <Field label="Venue">
                            <input value={draft.venue ?? ""} onChange={(event) => updateDraft(index, { venue: event.target.value })} style={inputStyle} />
                          </Field>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={resultsColumnStyle}>
            <div style={sectionHeaderStyle}>Import Result</div>
            {results.length === 0 ? (
              <div style={emptyStateStyle}>
                <CheckCircle2 size={28} style={{ opacity: 0.25 }} />
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)", textAlign: "center" }}>
                  Imported PDFs will appear here while Redou starts processing them.
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {results.map((result) => (
                  <div key={result.processingJobId} style={resultCardStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{result.paper.title}</div>
                      <div style={queuedChipStyle}>{(jobStatuses[result.processingJobId]?.status ?? "queued").toUpperCase()}</div>
                    </div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--color-text-secondary)", wordBreak: "break-word" }}>
                      Redou added this PDF to the workspace and started background processing.
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.34)",
  backdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 10000,
};

const dialogStyle: CSSProperties = {
  width: "min(1120px, 100%)",
  maxHeight: "min(820px, calc(100vh - 48px))",
  overflow: "auto",
  padding: 24,
  borderRadius: 28,
  background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)",
  border: "1px solid rgba(255,255,255,0.72)",
  boxShadow: "0 36px 80px rgba(15, 23, 42, 0.22)",
  display: "grid",
  gap: 18,
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "flex-start",
};

const closeButtonStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 999,
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-elevated)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  flexShrink: 0,
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const statusRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const statusCardStyle: CSSProperties = {
  display: "grid",
  gap: 8,
  padding: 16,
  borderRadius: 18,
  background: "rgba(255,255,255,0.88)",
  border: "1px solid var(--color-border-subtle)",
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
};

const contentGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.25fr) minmax(320px, 0.75fr)",
  gap: 14,
  alignItems: "start",
};

const draftColumnStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 18,
  borderRadius: 22,
  background: "rgba(255,255,255,0.76)",
  border: "1px solid var(--color-border-subtle)",
};

const resultsColumnStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 18,
  borderRadius: 22,
  background: "rgba(244, 248, 252, 0.92)",
  border: "1px solid var(--color-border-subtle)",
};

const sectionHeaderStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-secondary)",
};

const emptyStateStyle: CSSProperties = {
  minHeight: 220,
  borderRadius: 18,
  border: "1px dashed var(--color-border)",
  background: "rgba(255,255,255,0.68)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: 20,
};

const draftCardStyle: CSSProperties = {
  padding: 16,
  borderRadius: 18,
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
};

const fieldGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const inputStyle: CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-surface)",
  color: "var(--color-text-primary)",
  outline: "none",
};

const feedbackStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 16,
  background: "rgba(37, 99, 235, 0.08)",
  border: "1px solid rgba(37, 99, 235, 0.12)",
  color: "var(--color-text-secondary)",
  fontSize: 12.5,
  lineHeight: 1.7,
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 40,
  padding: "0 16px",
  borderRadius: 999,
  border: "none",
  background: "var(--color-accent)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const secondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 40,
  padding: "0 16px",
  borderRadius: 999,
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const resultCardStyle: CSSProperties = {
  padding: 14,
  borderRadius: 16,
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
};

const queuedChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(37, 99, 235, 0.08)",
  color: "var(--color-accent)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const openPaperButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 40,
  padding: "0 16px",
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(135deg, #2563eb 0%, #0f766e 100%)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const jobCardStyle: CSSProperties = {
  padding: 14,
  borderRadius: 16,
  border: "1px solid",
  transition: "background 0.3s ease, border-color 0.3s ease",
};

const jobChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "3px 8px",
  borderRadius: 999,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  flexShrink: 0,
};

