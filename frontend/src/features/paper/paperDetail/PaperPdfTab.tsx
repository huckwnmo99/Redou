import { ExternalLink, FileText, FolderOpen, Link2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from "react";

import { ProcessingBadge } from "@/components/ProcessingBadge";
import { formatNoteDate, noteKindMeta } from "@/features/notes/notePresentation";
import { PdfReaderWorkspace } from "@/features/paper/PdfReaderWorkspace";
import { toDesktopFileUrl, useDesktopPdfSelection, useDesktopRuntime, useOpenDesktopFile, useResolvedDesktopFilePath, useRevealInExplorer } from "@/lib/desktop";
import { localeText } from "@/lib/locale";
import {
  useAttachSupplementaryPdf,
  useCreateHighlight,
  useCreateHighlightPreset,
  useCreateNote,
  useDeleteHighlight,
  useDeleteHighlightPreset,
  useHighlightPresets,
  useHighlightsByPaper,
  useNotesByPaper,
  usePrimaryPaperFile,
  useSupplementaryPaperFiles,
  useUpdateHighlight,
  useUpdateNote,
  useUpsertHighlightEmbedding,
} from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { HighlightPreset, Paper, PaperPageAnchor, PaperTextSelectionAnchor, ResearchHighlight } from "@/types/paper";

import { cardStyle, lightButtonStyle } from "./paperDetailStyles";
import { buildFallbackAnchor, formatFileSize, processingCopy, readerActionMessage, summarize } from "./paperDetailUtils";

export function PaperPdfTab({ paper, folderName }: { paper: Paper; folderName?: string }) {
  const locale = useUIStore((s) => s.locale);
  const tl = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: notes = [] } = useNotesByPaper(paper.id);
  const { data: highlights = [] } = useHighlightsByPaper(paper.id);
  const { data: allPresets = [] } = useHighlightPresets();
  const highlightPresets = allPresets;
  const { data: primaryFile, isLoading: isPrimaryFileLoading } = usePrimaryPaperFile(paper.id);
  const { data: supplementaryFiles = [] } = useSupplementaryPaperFiles(paper.id);
  const { data: runtime } = useDesktopRuntime();
  const { data: resolvedPath, isLoading: isPathLoading } = useResolvedDesktopFilePath(primaryFile?.storedPath ?? null);
  const selectSupplementaryPdf = useDesktopPdfSelection();
  const attachSupplementaryPdf = useAttachSupplementaryPdf();
  const openDesktopFile = useOpenDesktopFile();
  const revealInExplorer = useRevealInExplorer();
  const createHighlight = useCreateHighlight();
  const updateHighlight = useUpdateHighlight();
  const deleteHighlight = useDeleteHighlight();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const upsertEmbedding = useUpsertHighlightEmbedding();
  const {
    openNotesWorkspace,
    readerTargetAnchor,
    setReaderTargetAnchor,
  } = useUIStore();
  const [, setActiveAnchor] = useState<PaperPageAnchor | null>(null);
  const [, setSelectionAnchor] = useState<PaperTextSelectionAnchor | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [readerActionError, setReaderActionError] = useState<string | null>(null);
  const showPipelineState = paper.processingStatus && paper.processingStatus !== "succeeded";
  const readerReady = paper.processingStatus === "succeeded";
  const previewUrl = resolvedPath ? toDesktopFileUrl(resolvedPath) : null;
  const canRenderInline = Boolean(readerReady && runtime?.available && previewUrl);
  const resolvedActionPath = resolvedPath ?? primaryFile?.storedPath ?? null;
  const canUseDesktopActions = Boolean(runtime?.available && resolvedActionPath);
  const showMissingFileState = readerReady && !isPrimaryFileLoading && !primaryFile;
  const targetAnchor = readerTargetAnchor?.paperId === paper.id ? readerTargetAnchor : null;
  const linkedNoteCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const note of notes) {
      if (!note.highlightId) {
        continue;
      }

      counts.set(note.highlightId, (counts.get(note.highlightId) ?? 0) + 1);
    }

    return counts;
  }, [notes]);
  const selectionPresetId = selectedPresetId ?? highlightPresets[0]?.id ?? null;

  useEffect(() => {
    if (!canRenderInline) {
      setActiveAnchor(null);
      setSelectionAnchor(null);
    }
  }, [canRenderInline, paper.id]);

  useEffect(() => {
    setReaderActionError(null);
  }, [paper.id]);

  useEffect(() => {
    if (highlightPresets.length === 0) {
      if (selectedPresetId !== null) {
        setSelectedPresetId(null);
      }
      return;
    }

    if (!selectedPresetId || !highlightPresets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId(highlightPresets[0].id);
    }
  }, [highlightPresets, selectedPresetId]);

  async function handleCreateNoteFromHighlight(highlightId: string) {
    setReaderActionError(null);

    try {
      const note = await createNote.mutateAsync({
        paperId: paper.id,
        kind: "quote",
        highlightId,
      });

      openNotesWorkspace(note.paperId, note.id);
    } catch (cause) {
      setReaderActionError(readerActionMessage(cause, "Unable to create a note from the selected highlight."));
    }
  }

  async function handlePresetChange(highlight: ResearchHighlight, presetId: string) {
    if (!presetId || presetId === highlight.presetId) {
      return;
    }

    setReaderActionError(null);

    try {
      await updateHighlight.mutateAsync({
        id: highlight.id,
        paperId: paper.id,
        presetId,
      });
    } catch (cause) {
      setReaderActionError(readerActionMessage(cause, "Unable to update the highlight preset."));
    }
  }

  async function handleDeleteHighlight(highlight: ResearchHighlight) {
    const linkedNotes = linkedNoteCounts.get(highlight.id) ?? 0;
    const accepted = window.confirm(
      linkedNotes > 0
        ? `Delete this highlight? ${linkedNotes} linked note${linkedNotes === 1 ? "" : "s"} will keep page and quote context, but the saved PDF overlay will be removed.`
        : "Delete this saved highlight from the PDF workspace?",
    );

    if (!accepted) {
      return;
    }

    setReaderActionError(null);

    try {
      await deleteHighlight.mutateAsync({
        id: highlight.id,
        paperId: paper.id,
      });

      const deletedAnchorId = highlight.startAnchor?.anchorId;
      if (deletedAnchorId && readerTargetAnchor?.anchorId === deletedAnchorId) {
        setReaderTargetAnchor(null);
      }
    } catch (cause) {
      setReaderActionError(readerActionMessage(cause, "Unable to delete the selected highlight."));
    }
  }

  async function handleAttachSupplementaryPdf() {
    setReaderActionError(null);

    try {
      const selectedPaths = await selectSupplementaryPdf.mutateAsync();
      if (selectedPaths.length === 0) {
        return;
      }

      if (selectedPaths.length > 1) {
        throw new Error(tl("Attach one supplementary PDF at a time.", "Supplementary PDF는 한 번에 하나씩 추가하세요."));
      }

      await attachSupplementaryPdf.mutateAsync({
        paperId: paper.id,
        sourcePath: selectedPaths[0],
        paperTitle: paper.title,
        year: paper.year || undefined,
        firstAuthor: paper.authors[0]?.name,
      });
    } catch (cause) {
      setReaderActionError(readerActionMessage(cause, tl("Unable to attach the supplementary PDF.", "Supplementary PDF를 추가하지 못했습니다.")));
    }
  }

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const createPreset = useCreateHighlightPreset();
  const deletePreset = useDeleteHighlightPreset();

  function handleOpenPresetForm() {
    setSidebarOpen(true);
    setShowPresetForm(true);
  }

  async function handleContextHighlight(anchor: PaperTextSelectionAnchor, presetId: string) {
    setReaderActionError(null);
    try {
      const hl = await createHighlight.mutateAsync({ paperId: paper.id, selectionAnchor: anchor, presetId });
      if (hl.startAnchor) setReaderTargetAnchor(hl.startAnchor);

      // Generate embedding for RAG — fire and forget
      reembedHighlight(hl);
    } catch (cause) {
      setReaderActionError(readerActionMessage(cause, "Unable to save highlight."));
    }
  }

  async function handleContextNote(anchor: PaperTextSelectionAnchor) {
    setReaderActionError(null);
    try {
      const note = await createNote.mutateAsync({ paperId: paper.id, kind: "quote", selectionAnchor: anchor, presetId: selectionPresetId ?? undefined });
      openNotesWorkspace(note.paperId, note.id);
    } catch (cause) {
      setReaderActionError(readerActionMessage(cause, "Unable to create note."));
    }
  }

  async function handleSaveMemo(highlightId: string, content: string) {
    setReaderActionError(null);
    try {
      await createNote.mutateAsync({
        paperId: paper.id,
        kind: "memo",
        highlightId,
        title: "Memo",
        content,
      });

      // Re-embed highlight with memo text included
      const hl = highlights.find((h) => h.id === highlightId);
      if (hl) {
        reembedHighlight(hl, content);
      }
    } catch (cause) {
      setReaderActionError(readerActionMessage(cause, "Unable to save memo."));
    }
  }

  async function handleUpdateMemo(noteId: string, content: string) {
    setReaderActionError(null);
    try {
      const updatedNote = await updateNote.mutateAsync({
        id: noteId,
        title: "Memo",
        content,
        kind: "memo",
      });

      // Re-embed highlight with updated memo text
      if (updatedNote.highlightId) {
        const hl = highlights.find((h) => h.id === updatedNote.highlightId);
        if (hl) {
          reembedHighlight(hl, content);
        }
      }
    } catch (cause) {
      setReaderActionError(readerActionMessage(cause, "Unable to update memo."));
    }
  }

  function reembedHighlight(hl: ResearchHighlight, noteText?: string) {
    const api = window.redouDesktop;
    if (!api?.embedding?.generateQuery) return;
    const combinedText = noteText
      ? `${hl.selectedText}\n\nMemo: ${noteText}`
      : hl.selectedText;
    api.embedding.generateQuery({ text: combinedText }).then((result) => {
      if (!result.success || !result.data) {
        console.warn("[RAG] Embedding generation failed for highlight", hl.id, result);
        return;
      }
      upsertEmbedding.mutate(
        {
          highlightId: hl.id,
          presetId: hl.presetId,
          paperId: paper.id,
          textContent: hl.selectedText,
          noteText: noteText || undefined,
          embedding: result.data,
        },
        { onError: (err) => console.warn("[RAG] Embedding upsert failed for highlight", hl.id, err) },
      );
    }).catch((err) => console.warn("[RAG] Embedding call failed for highlight", hl.id, err));
  }

  // Full-width when reader is inline, otherwise simple card
  if (showPipelineState) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{tl("Reader is waiting on the processing pipeline", "리더가 파이프라인 처리를 기다리고 있습니다")}</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>{processingCopy(paper.processingStatus, locale)}</div>
          </div>
          {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
        </div>
      </div>
    );
  }

  if (!canRenderInline || !previewUrl) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
          {showMissingFileState ? "Primary PDF record is missing" : "Reader is available only inside Electron"}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>
          {showMissingFileState
            ? "Re-import the PDF or inspect the job record."
            : runtime?.available
              ? isPathLoading || isPrimaryFileLoading ? "Resolving the imported PDF path..." : "File path has not been resolved yet."
              : "Open Redou in the Electron shell to render the imported PDF inline."}
        </div>
        {canUseDesktopActions && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button onClick={() => openDesktopFile.mutate(resolvedActionPath!)} disabled={openDesktopFile.isPending} style={lightButtonStyle}>
              <ExternalLink size={13} /> Open in system viewer
            </button>
            <button onClick={() => revealInExplorer.mutate(resolvedActionPath!)} disabled={revealInExplorer.isPending} style={lightButtonStyle}>
              <FolderOpen size={13} /> Reveal in Explorer
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 0, height: "calc(100vh - 260px)", minHeight: 500 }}>
      {/* PDF reader — takes all available space */}
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <PdfReaderWorkspace
          paperId={paper.id}
          fileUrl={previewUrl}
          title={paper.title}
          targetAnchor={targetAnchor}
          savedHighlights={highlights}
          highlightPresets={highlightPresets}
          highlightNotes={notes}
          onAnchorChange={setActiveAnchor}
          onSelectionChange={setSelectionAnchor}
          onTargetAnchorReached={(anchor) => {
            if (readerTargetAnchor?.anchorId === anchor.anchorId) setReaderTargetAnchor(null);
          }}
          onSaveHighlight={handleContextHighlight}
          onCreateNote={handleContextNote}
          onCreatePreset={handleOpenPresetForm}
          onSaveMemo={handleSaveMemo}
          onUpdateMemo={handleUpdateMemo}
        />

        {readerActionError && (
          <div role="alert" style={{
            position: "absolute", bottom: 56, left: 16, right: 16, zIndex: 30,
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(254,242,242,0.96)", border: "1px solid rgba(220,38,38,0.18)",
            color: "#991b1b", fontSize: 12.5, lineHeight: 1.6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}>
            {readerActionError}
          </div>
        )}
      </div>

      {/* Sidebar toggle */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "8px 0", gap: 8, width: sidebarOpen ? 0 : 36,
        overflow: "hidden", transition: "width 0.2s",
      }}>
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Open panel"
            style={{
              width: 30, height: 30, borderRadius: 6,
              border: "1px solid var(--color-border-subtle)",
              background: "var(--color-bg-elevated)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--color-text-muted)", fontSize: 14,
            }}
          >
            ◀
          </button>
        )}
      </div>

      {/* Collapsible sidebar */}
      {sidebarOpen && (
        <div style={{
          width: 320, minWidth: 320, overflow: "auto",
          borderLeft: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-elevated)",
          padding: 14, display: "grid", gap: 12, alignContent: "start",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)" }}>Details</span>
            <button
              onClick={() => setSidebarOpen(false)}
              style={{
                width: 26, height: 26, borderRadius: 6,
                border: "1px solid var(--color-border-subtle)",
                background: "transparent", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--color-text-muted)", fontSize: 13,
              }}
            >
              ▶
            </button>
          </div>

          {/* Presets section */}
          <SidebarSection title={`Presets (${highlightPresets.length})`}>
            {highlightPresets.map((p: HighlightPreset) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                <span style={{ width: 14, height: 14, borderRadius: 999, background: p.colorHex, flexShrink: 0, boxShadow: `0 0 0 2px ${p.colorHex}22` }} />
                <span style={{ flex: 1, fontSize: 12, color: "var(--color-text-primary)", fontWeight: 500 }}>{p.name}</span>
                <button
                  onClick={() => { if (window.confirm(`Delete preset "${p.name}"?`)) deletePreset.mutate(p.id); }}
                  disabled={deletePreset.isPending}
                  style={{ ...sidebarSmallBtn, width: 22, height: 22 }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
            {showPresetForm ? (
              <PresetForm
                onSave={async (name, color) => {
                  await createPreset.mutateAsync({ name, colorHex: color });
                  setShowPresetForm(false);
                }}
                onCancel={() => setShowPresetForm(false)}
                isPending={createPreset.isPending}
              />
            ) : (
              <button
                onClick={() => setShowPresetForm(true)}
                style={{ ...lightButtonStyle, width: "100%", justifyContent: "center", height: 30, fontSize: 11.5 }}
              >
                + New preset
              </button>
            )}
          </SidebarSection>

          {/* Highlights section */}
          <SidebarSection title={`Highlights (${highlights.length})`}>
            {highlights.length > 0 ? (
              highlights.map((highlight) => {
                const jumpAnchor = highlight.startAnchor ?? (highlight.pageNumber ? buildFallbackAnchor(paper.id, highlight.pageNumber) : null);
                const linked = linkedNoteCounts.get(highlight.id) ?? 0;
                const memo = notes.find((n) => n.highlightId === highlight.id && n.kind === "memo");
                return (
                  <div key={highlight.id} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--color-border-subtle)", background: "var(--color-bg-surface)", display: "grid", gap: 8 }}>
                    <button
                      onClick={() => jumpAnchor && setReaderTargetAnchor(jumpAnchor)}
                      disabled={!jumpAnchor}
                      style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: jumpAnchor ? "pointer" : "default" }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: highlight.colorHex ?? "#facc15", flexShrink: 0 }} />
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-text-primary)" }}>
                        {highlight.startAnchor ? `p.${highlight.startAnchor.pageLabel}` : highlight.pageNumber ? `p.${highlight.pageNumber}` : "Highlight"}
                      </span>
                    </button>
                    <div style={{ fontSize: 11.5, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>{summarize(highlight.selectedText, 100)}</div>
                    {memo && (
                      <div style={{
                        padding: "6px 8px", borderRadius: 6,
                        background: "var(--color-bg-panel)", borderLeft: `3px solid ${highlight.colorHex ?? "#facc15"}`,
                        fontSize: 11, lineHeight: 1.5, color: "var(--color-text-secondary)",
                      }}>
                        {summarize(memo.content, 80)}
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {highlightPresets.length > 0 && (
                        <select
                          value={highlight.presetId}
                          onChange={(e) => handlePresetChange(highlight, e.target.value)}
                          disabled={updateHighlight.isPending}
                          style={{ height: 26, borderRadius: 4, border: "1px solid var(--color-border-subtle)", background: "var(--color-bg-surface)", fontSize: 11, padding: "0 6px", flex: 1, minWidth: 0 }}
                        >
                          {highlightPresets.map((p: HighlightPreset) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => handleCreateNoteFromHighlight(highlight.id)} disabled={createNote.isPending} style={sidebarSmallBtn}>
                        <Link2 size={11} />
                      </button>
                      <button onClick={() => handleDeleteHighlight(highlight)} disabled={deleteHighlight.isPending} style={sidebarSmallBtn}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {linked > 0 && <div style={{ fontSize: 10.5, color: "var(--color-text-muted)" }}>{linked} note{linked > 1 ? "s" : ""}</div>}
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                Select text and right-click to save a highlight.
              </div>
            )}
          </SidebarSection>

          {/* Notes section */}
          <SidebarSection title={`Notes (${notes.length})`}>
            {notes.length > 0 ? (
              notes.map((note) => {
                const meta = noteKindMeta[note.kind];
                const linkedHl = note.highlightId ? highlights.find((h) => h.id === note.highlightId) : null;
                const jumpAnchor = linkedHl?.startAnchor ?? (note.pageNumber ? buildFallbackAnchor(paper.id, note.pageNumber) : null);
                return (
                  <div
                    key={note.id}
                    style={{ padding: 10, borderRadius: 8, background: "var(--color-bg-panel)", cursor: jumpAnchor ? "pointer" : "default" }}
                    onClick={() => jumpAnchor && setReaderTargetAnchor(jumpAnchor)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      {linkedHl && (
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: linkedHl.colorHex ?? "#facc15", flexShrink: 0 }} />
                      )}
                      <span style={{ padding: "2px 6px", borderRadius: 999, background: meta.background, color: meta.accent, fontSize: 10, fontWeight: 700 }}>{meta.label}</span>
                      <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{formatNoteDate(note.updatedAt)}</span>
                    </div>
                    {note.kind !== "memo" && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{note.title}</div>}
                    <div style={{ fontSize: 11.5, lineHeight: 1.6, color: "var(--color-text-secondary)" }}>{summarize(note.content, 80)}</div>
                  </div>
                );
              })
            ) : (
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>No notes yet.</div>
            )}
            <button onClick={() => openNotesWorkspace(paper.id)} style={{ ...lightButtonStyle, width: "100%", justifyContent: "center", height: 30, fontSize: 11.5 }}>
              Open notes workspace
            </button>
          </SidebarSection>

          {/* Source section */}
          <SidebarSection title="Source PDF">
            {primaryFile ? (
              <div style={{ display: "grid", gap: 6 }}>
                {[
                  ["File", primaryFile.originalFilename],
                  ["Size", formatFileSize(primaryFile.fileSize)],
                  ["Category", folderName ?? "Uncategorized"],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: "flex", gap: 8, fontSize: 11.5 }}>
                    <span style={{ color: "var(--color-text-muted)", minWidth: 56 }}>{label}</span>
                    <span style={{ color: "var(--color-text-secondary)", wordBreak: "break-word" }}>{value}</span>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <button onClick={() => openDesktopFile.mutate(resolvedActionPath!)} disabled={openDesktopFile.isPending} style={{ ...lightButtonStyle, height: 28, fontSize: 11, padding: "0 8px" }}>
                    <ExternalLink size={11} /> System viewer
                  </button>
                  <button onClick={() => revealInExplorer.mutate(resolvedActionPath!)} disabled={revealInExplorer.isPending} style={{ ...lightButtonStyle, height: 28, fontSize: 11, padding: "0 8px" }}>
                    <FolderOpen size={11} /> Explorer
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>No PDF attached.</div>
            )}
          </SidebarSection>

          <SidebarSection title={`Supplementary PDFs (${supplementaryFiles.length})`}>
            <button
              onClick={handleAttachSupplementaryPdf}
              disabled={!runtime?.available || selectSupplementaryPdf.isPending || attachSupplementaryPdf.isPending}
              style={{ ...lightButtonStyle, width: "100%", justifyContent: "center", height: 30, fontSize: 11.5 }}
            >
              <FileText size={12} />
              {selectSupplementaryPdf.isPending || attachSupplementaryPdf.isPending
                ? tl("Attaching...", "추가 중...")
                : tl("Attach supplementary PDF", "Supplementary PDF 추가")}
            </button>
            {!runtime?.available ? (
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                {tl("Supplementary files can be attached in the Electron app.", "Supplementary 파일은 Electron 앱에서 추가할 수 있습니다.")}
              </div>
            ) : null}
            {supplementaryFiles.length > 0 ? (
              supplementaryFiles.map((file) => (
                <div key={file.id} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--color-border-subtle)", background: "var(--color-bg-surface)", display: "grid", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <FileText size={12} color="var(--color-text-muted)" />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: "var(--color-text-primary)", wordBreak: "break-word" }}>
                      {file.originalFilename}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10.5, color: "var(--color-text-muted)" }}>{formatFileSize(file.fileSize)}</span>
                    {file.processingStatus ? <ProcessingBadge status={file.processingStatus} /> : null}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => openDesktopFile.mutate(file.storedPath)} disabled={openDesktopFile.isPending} style={{ ...lightButtonStyle, height: 28, fontSize: 11, padding: "0 8px" }}>
                      <ExternalLink size={11} /> {tl("System viewer", "시스템 뷰어")}
                    </button>
                    <button onClick={() => revealInExplorer.mutate(file.storedPath)} disabled={revealInExplorer.isPending} style={{ ...lightButtonStyle, height: 28, fontSize: 11, padding: "0 8px" }}>
                      <FolderOpen size={11} /> Explorer
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
                {tl("No supplementary PDFs attached yet.", "아직 추가된 Supplementary PDF가 없습니다.")}
              </div>
            )}
          </SidebarSection>
        </div>
      )}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          border: "none", background: "transparent", padding: "4px 0",
          cursor: "pointer", fontSize: 11, fontWeight: 700,
          color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em",
        }}
      >
        <span style={{ fontSize: 9, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        {title}
      </button>
      {open && <div style={{ display: "grid", gap: 8, paddingTop: 6 }}>{children}</div>}
    </div>
  );
}

const sidebarSmallBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 26, height: 26, borderRadius: 4,
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-surface)", cursor: "pointer",
  color: "var(--color-text-muted)",
};

const PRESET_COLORS = [
  "#EF4444", "#F97316", "#F59E0B", "#FACC15",
  "#22C55E", "#14B8A6", "#3B82F6", "#6366F1",
  "#8B5CF6", "#EC4899", "#64748B", "#0EA5E9",
];

function PresetForm({ onSave, onCancel, isPending }: {
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);

  return (
    <div style={{ padding: 10, borderRadius: 8, border: "1px solid var(--color-border-subtle)", background: "var(--color-bg-surface)", display: "grid", gap: 8 }}>
      <input
        autoFocus
        placeholder="Preset name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          height: 30, borderRadius: 6, border: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-elevated)", padding: "0 8px",
          fontSize: 12, color: "var(--color-text-primary)", outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{
              width: 22, height: 22, borderRadius: 999, border: c === color ? "2px solid var(--color-text-primary)" : "2px solid transparent",
              background: c, cursor: "pointer", padding: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => name.trim() && onSave(name.trim(), color)}
          disabled={!name.trim() || isPending}
          style={{
            flex: 1, height: 28, borderRadius: 6, border: "none",
            background: "var(--color-accent)", color: "#fff",
            fontSize: 11.5, fontWeight: 600, cursor: "pointer",
            opacity: !name.trim() || isPending ? 0.5 : 1,
          }}
        >
          Create
        </button>
        <button
          onClick={onCancel}
          style={{
            height: 28, padding: "0 10px", borderRadius: 6,
            border: "1px solid var(--color-border-subtle)",
            background: "transparent", fontSize: 11.5,
            color: "var(--color-text-muted)", cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
