import { ScrollArea, Tabs } from "radix-ui";
import { BookOpen, ExternalLink, FileText, Images, Quote, Star, StickyNote, X } from "lucide-react";
import { useMemo, useState } from "react";
import { IconButton } from "@/components/IconButton";
import { ProcessingBadge } from "@/components/ProcessingBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tag } from "@/components/Tag";
import { useFiguresByPaper, useFolders, useNotesByPaper, usePaperById, useTogglePaperStar } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper, ProcessingJobStatus } from "@/types/paper";
import { formatNoteDate, noteKindMeta } from "@/features/notes/notePresentation";

function formatAuthors(authors: Paper["authors"]) {
  if (authors.length === 0) return "Unknown authors";
  return authors.map((author) => author.name).join(", ");
}

function formatProcessingLabel(status?: ProcessingJobStatus) {
  if (!status) return "No active pipeline job";
  if (status === "queued") return "Queued";
  if (status === "running") return "Running";
  if (status === "succeeded") return "Ready";
  return "Needs attention";
}

function processingCopy(status?: ProcessingJobStatus) {
  if (status === "queued") {
    return "The PDF is stored and waiting for the next processing worker. Reader review opens into a status-first view until that job is consumed.";
  }

  if (status === "running") {
    return "Metadata and reader preparation are in progress now. This paper should move into the reader path once the current job finishes.";
  }

  if (status === "failed") {
    return "The last pipeline attempt failed. The file remains in the library, but the reader flow needs a retry or manual inspection.";
  }

  if (status === "succeeded") {
    return "The latest processing job completed successfully. This paper is ready for the reader-focused next step.";
  }

  return "No processing job exists for this paper yet.";
}

export function RightInspector() {
  const {
    selectedPaperId,
    setInspectorOpen,
    setSelectedPaperId,
    openNotesWorkspace,
    openPaperDetail,
    setReaderTargetAnchor,
  } = useUIStore();
  const { data: paper } = usePaperById(selectedPaperId);
  const { data: notes = [] } = useNotesByPaper(paper?.id ?? null);
  const { data: figures = [] } = useFiguresByPaper(paper?.id ?? null);
  const { data: folders = [] } = useFolders();
  const toggleStar = useTogglePaperStar();
  const [activeTab, setActiveTab] = useState("overview");
  const folderName = useMemo(
    () => folders.find((folder) => folder.id === paper?.folderId)?.name,
    [folders, paper?.folderId],
  );

  function openFigurePage(page?: number) {
    if (!paper || !page) {
      return;
    }

    setReaderTargetAnchor({
      paperId: paper.id,
      pageNumber: page,
      pageLabel: String(page),
      anchorId: `paper:${paper.id}:page:${page}`,
    });
    openPaperDetail("pdf");
  }

  function handleClose() {
    setInspectorOpen(false);
    setSelectedPaperId(null);
  }

  return (
    <aside
      style={{
        width: "var(--inspector-width)",
        minWidth: "var(--inspector-width)",
        background: "var(--color-bg-panel)",
        borderLeft: "1px solid var(--color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "var(--topbar-height)",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", flex: 1, letterSpacing: "0.03em", textTransform: "uppercase" }}>
          Inspector
        </span>
        <IconButton aria-label="Close inspector" size="sm" onClick={handleClose}>
          <X size={13} />
        </IconButton>
      </div>

      {!paper ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "var(--color-text-muted)",
            padding: 24,
            textAlign: "center",
          }}
        >
          <BookOpen size={32} style={{ opacity: 0.25 }} />
          <span style={{ fontSize: 12 }}>Select a paper to see details.</span>
        </div>
      ) : (
        <ScrollArea.Root style={{ flex: 1, overflow: "hidden" }}>
          <ScrollArea.Viewport style={{ height: "100%", width: "100%" }}>
            <Tabs.Root value={activeTab} onValueChange={setActiveTab} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <Tabs.List
                style={{
                  display: "flex",
                  borderBottom: "1px solid var(--color-border-subtle)",
                  padding: "0 12px",
                  gap: 2,
                  flexShrink: 0,
                }}
              >
                {[
                  { value: "overview", label: "Overview" },
                  { value: "notes", label: "Notes" },
                  { value: "figures", label: "Figures" },
                ].map((tab) => (
                  <Tabs.Trigger
                    key={tab.value}
                    value={tab.value}
                    style={{
                      padding: "8px 10px",
                      background: "transparent",
                      border: "none",
                      borderBottom: `2px solid ${activeTab === tab.value ? "var(--color-accent)" : "transparent"}`,
                      color: activeTab === tab.value ? "var(--color-accent)" : "var(--color-text-muted)",
                      fontSize: 11.5,
                      fontWeight: activeTab === tab.value ? 600 : 400,
                      cursor: "pointer",
                      marginBottom: -1,
                    }}
                  >
                    {tab.label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              <Tabs.Content value="overview" style={{ flex: 1 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  <div style={{ padding: "14px 14px 12px", borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.45, marginBottom: 8 }}>
                      {paper.title}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.5, marginBottom: 8 }}>
                      {formatAuthors(paper.authors)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 500 }}>{paper.venue}</span>
                      <span style={{ color: "var(--color-border)", fontSize: 10 }}>|</span>
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{paper.year}</span>
                      {folderName ? <Tag label={folderName} /> : null}
                      <div style={{ flex: 1 }} />
                      <StatusBadge status={paper.status} />
                      {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 1,
                      background: "var(--color-border-subtle)",
                      borderBottom: "1px solid var(--color-border-subtle)",
                    }}
                  >
                    {[
                      { icon: <Quote size={12} />, value: paper.citationCount.toLocaleString(), label: "Citations" },
                      { icon: <Images size={12} />, value: String(paper.figureCount), label: "Figures" },
                      { icon: <StickyNote size={12} />, value: String(paper.noteCount), label: "Notes" },
                    ].map(({ icon, value, label }) => (
                      <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 8px", background: "var(--color-bg-panel)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--color-text-muted)" }}>{icon}</div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
                        <span style={{ fontSize: 9.5, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: 8 }}>
                      Pipeline
                    </div>
                    <div
                      style={{
                        padding: 12,
                        borderRadius: "var(--radius-md)",
                        background: "var(--color-bg-elevated)",
                        border: "1px solid var(--color-border-subtle)",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 600 }}>
                          {formatProcessingLabel(paper.processingStatus)}
                        </span>
                        {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                        {processingCopy(paper.processingStatus)}
                      </div>
                      {paper.processingUpdatedAt ? (
                        <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          Latest signal: {paper.processingUpdatedAt}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border-subtle)" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: 8 }}>
                      Tags
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {paper.tags.map((tag) => (
                        <Tag key={tag} label={tag} />
                      ))}
                    </div>
                  </div>

                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <button
                      onClick={() => openPaperDetail("overview")}
                      style={actionButtonStyle}
                    >
                      <FileText size={13} />
                      Open detail workspace
                    </button>
                    <button
                      onClick={() => openPaperDetail("pdf")}
                      style={actionButtonStyle}
                    >
                      <ExternalLink size={13} />
                      {paper.processingStatus && paper.processingStatus !== "succeeded" ? "Open reader status" : "Open reader tab"}
                    </button>
                    <button
                      onClick={() => openNotesWorkspace(paper.id)}
                      style={actionButtonStyle}
                    >
                      <StickyNote size={13} />
                      Open notes workspace
                    </button>
                    <button
                      onClick={() => toggleStar.mutate(paper.id)}
                      style={actionButtonStyle}
                      disabled={toggleStar.isPending}
                    >
                      <Star size={13} />
                      {paper.starred ? "Remove from starred" : "Add to starred"}
                    </button>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="notes" style={{ flex: 1 }}>
                <div style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 700 }}>
                      {notes.length} linked notes
                    </div>
                    <button onClick={() => openNotesWorkspace(paper.id)} style={miniButtonStyle}>
                      <ExternalLink size={12} />
                      Open workspace
                    </button>
                  </div>

                  {notes.length > 0 ? (
                    notes.slice(0, 4).map((note) => {
                      const meta = noteKindMeta[note.kind];

                      return (
                        <button
                          key={note.id}
                          onClick={() => openNotesWorkspace(note.paperId, note.id)}
                          style={{
                            padding: 12,
                            borderRadius: "var(--radius-md)",
                            background: "var(--color-bg-elevated)",
                            border: "1px solid var(--color-border-subtle)",
                            textAlign: "left",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: "999px", background: meta.background, color: meta.accent, fontSize: 11, fontWeight: 700 }}>
                              {meta.label}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatNoteDate(note.updatedAt)}</span>
                          </div>
                          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{note.title}</div>
                          <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{note.content}</div>
                        </button>
                      );
                    })
                  ) : (
                    <div style={{ padding: 18, textAlign: "center", color: "var(--color-text-muted)", fontSize: 12.5 }}>
                      No notes yet. Start a note from the workspace.
                    </div>
                  )}
                </div>
              </Tabs.Content>

              <Tabs.Content value="figures" style={{ flex: 1 }}>
                <div style={{ padding: 14, display: "grid", gap: 10 }}>
                  {figures.length > 0 ? (
                    figures.slice(0, 4).map((figure) => (
                      <div key={figure.id} style={{ padding: 12, borderRadius: "var(--radius-md)", background: "var(--color-bg-elevated)", border: "1px solid var(--color-border-subtle)", display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{figure.page ? `${figure.figureNo} · p.${figure.page}` : figure.figureNo}</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            {figure.isKeyFigure ? <Tag label="Key" /> : null}
                            {figure.isPresentationCandidate ? <Tag label="Deck" /> : null}
                          </div>
                        </div>
                        <div style={{ height: 72, borderRadius: "var(--radius-md)", background: "linear-gradient(135deg, rgba(37,99,235,0.12), rgba(15,118,110,0.14))", border: "1px solid var(--color-border-subtle)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Images size={20} style={{ color: "var(--color-accent)", opacity: 0.68 }} />
                        </div>
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                          {figure.caption ?? "Caption not extracted yet."}
                          {figure.page ? (
                            <button
                              onClick={() => openFigurePage(figure.page)}
                              style={miniButtonStyle}
                            >
                              <ExternalLink size={12} />
                              Open page
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: 18, textAlign: "center", color: "var(--color-text-muted)", fontSize: 12.5 }}>
                      {paper.processingStatus === "running"
                        ? "Figure extraction is still running for this paper."
                        : "No extracted figures are available yet."}
                    </div>
                  )}
                </div>
              </Tabs.Content>
            </Tabs.Root>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar orientation="vertical">
            <ScrollArea.Thumb />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      )}
    </aside>
  );
}

const actionButtonStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-secondary)",
  fontSize: 12,
  cursor: "pointer",
  width: "100%",
};

const miniButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 28,
  padding: "0 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-surface)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  fontSize: 11.5,
};









