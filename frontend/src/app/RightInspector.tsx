import { ScrollArea, Tabs } from "radix-ui";
import { BookOpen, ExternalLink, FileText, Star, StickyNote, X } from "lucide-react";
import { useMemo, useState } from "react";
import { IconButton } from "@/components/IconButton";
import { ProcessingBadge } from "@/components/ProcessingBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tag } from "@/components/Tag";
import { localeText } from "@/lib/locale";
import { useFiguresByPaper, useFolders, useNotesByPaper, usePaperById, useTogglePaperStar } from "@/lib/queries";
import { LatexText, containsLatex } from "@/components/LatexText";
import { useUIStore } from "@/stores/uiStore";
import type { Paper } from "@/types/paper";
import { formatNoteDate, noteKindMeta } from "@/features/notes/notePresentation";

function formatAuthors(authors: Paper["authors"], locale: "en" | "ko") {
  if (authors.length === 0) return localeText(locale, "Unknown authors", "저자 미상");
  return authors.map((author) => author.name).join(", ");
}

export function RightInspector() {
  const {
    locale,
    selectedPaperId,
    setInspectorOpen,
    setSelectedPaperId,
    openNotesWorkspace,
    openPaperDetail,
    setReaderTargetAnchor,
  } = useUIStore();
  const t = (en: string, ko: string) => localeText(locale, en, ko);
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
        width: "100%",
        background: "var(--color-bg-panel)",
        borderTop: "1px solid var(--color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 36,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-secondary)", flex: 1, letterSpacing: "0.03em", textTransform: "uppercase" }}>
          {t("Inspector", "인스펙터")}
        </span>
        <IconButton aria-label={t("Close inspector", "인스펙터 닫기")} size="sm" onClick={handleClose}>
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
          <span style={{ fontSize: 12 }}>{t("Select a paper to see details.", "논문을 선택하면 상세 정보가 표시됩니다.")}</span>
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
                  { value: "overview", label: t("Overview", "개요") },
                  { value: "notes", label: t("Notes", "노트") },
                  { value: "figures", label: t("Figures", "Figure") },
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
                <div style={{ display: "flex", gap: 0, height: "100%" }}>
                  {/* Left: paper info */}
                  <div style={{ flex: 1, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, borderRight: "1px solid var(--color-border-subtle)" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {paper.title}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {formatAuthors(paper.authors, locale)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontWeight: 500 }}>{paper.venue}</span>
                      <span style={{ color: "var(--color-border)", fontSize: 10 }}>|</span>
                      <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{paper.year}</span>
                      {folderName ? <Tag label={folderName} /> : null}
                      <StatusBadge status={paper.status} />
                      {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 2 }}>
                      {[
                        { value: paper.citationCount.toLocaleString(), label: t("Citations", "인용") },
                        { value: String(paper.figureCount), label: t("Figures", "Figure") },
                        { value: String(paper.noteCount), label: t("Notes", "노트") },
                      ].map(({ value, label }) => (
                        <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
                          <span style={{ fontSize: 9.5, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
                        </div>
                      ))}
                    </div>
                    {paper.tags.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                        {paper.tags.map((tag) => (
                          <Tag key={tag} label={tag} />
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* Right: action buttons */}
                  <div style={{ width: 200, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                    <button onClick={() => openPaperDetail("overview")} style={actionButtonStyle}>
                      <FileText size={12} /> {t("Detail", "상세")}
                    </button>
                    <button onClick={() => openPaperDetail("pdf")} style={actionButtonStyle}>
                      <ExternalLink size={12} />
                      {paper.processingStatus && paper.processingStatus !== "succeeded" ? t("Reader status", "리더 상태") : t("Reader", "리더")}
                    </button>
                    <button onClick={() => openNotesWorkspace(paper.id)} style={actionButtonStyle}>
                      <StickyNote size={12} /> {t("Notes", "노트")}
                    </button>
                    <button onClick={() => toggleStar.mutate(paper.id)} style={actionButtonStyle} disabled={toggleStar.isPending}>
                      <Star size={12} /> {paper.starred ? t("Unstar", "중요 해제") : t("Star", "중요 표시")}
                    </button>
                  </div>
                </div>
              </Tabs.Content>

              <Tabs.Content value="notes" style={{ flex: 1 }}>
                <div style={{ padding: "10px 14px", display: "flex", gap: 10, alignItems: "flex-start", overflowX: "auto" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontWeight: 700, whiteSpace: "nowrap" }}>
                      {t(`${notes.length} notes`, `노트 ${notes.length}개`)}
                    </span>
                    <button onClick={() => openNotesWorkspace(paper.id)} style={miniButtonStyle}>
                      <ExternalLink size={12} /> {t("Open", "열기")}
                    </button>
                  </div>

                  {notes.length > 0 ? (
                    notes.slice(0, 6).map((note) => {
                      const meta = noteKindMeta[note.kind];
                      return (
                        <button
                          key={note.id}
                          onClick={() => openNotesWorkspace(note.paperId, note.id)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "var(--radius-md)",
                            background: "var(--color-bg-elevated)",
                            border: "1px solid var(--color-border-subtle)",
                            textAlign: "left",
                            cursor: "pointer",
                            minWidth: 200,
                            maxWidth: 280,
                            flexShrink: 0,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span style={{ display: "inline-flex", padding: "2px 6px", borderRadius: "999px", background: meta.background, color: meta.accent, fontSize: 10, fontWeight: 700 }}>
                              {meta.label}
                            </span>
                            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>{formatNoteDate(note.updatedAt)}</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note.title}</div>
                          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{note.content}</div>
                        </button>
                      );
                    })
                  ) : (
                    <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>{t("No notes yet.", "노트가 없습니다.")}</div>
                  )}
                </div>
              </Tabs.Content>

              <Tabs.Content value="figures" style={{ flex: 1 }}>
                <div style={{ padding: "10px 14px", display: "flex", gap: 10, overflowX: "auto" }}>
                  {figures.length > 0 ? (
                    figures.slice(0, 8).map((figure) => (
                      <div key={figure.id} style={{ padding: "8px 12px", borderRadius: "var(--radius-md)", background: "var(--color-bg-elevated)", border: "1px solid var(--color-border-subtle)", display: "flex", flexDirection: "column", gap: 4, minWidth: 180, maxWidth: 240, flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 700 }}>{figure.page ? `${figure.figureNo} · p.${figure.page}` : figure.figureNo}</div>
                          <div style={{ display: "flex", gap: 4 }}>
                            {figure.isKeyFigure ? <Tag label="Key" /> : null}
                            {figure.isPresentationCandidate ? <Tag label="Deck" /> : null}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.5, overflow: "hidden" }}>
                          {containsLatex(figure.caption) ? (
                            <LatexText style={{ fontSize: 11 }}>{figure.caption!}</LatexText>
                          ) : (
                            figure.caption ?? t("Caption not extracted yet.", "캡션이 아직 추출되지 않았습니다.")
                          )}
                        </div>
                        {figure.page ? (
                          <button onClick={() => openFigurePage(figure.page)} style={miniButtonStyle}>
                            <ExternalLink size={11} /> {t("Open page", "페이지 열기")}
                          </button>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                      {paper.processingStatus === "running" ? t("Figure extraction running...", "Figure 추출 중...") : t("No figures yet.", "Figure가 없습니다.")}
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









