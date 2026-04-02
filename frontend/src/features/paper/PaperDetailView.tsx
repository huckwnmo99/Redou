import { ArrowLeft, ExternalLink, FileText, FolderOpen, Images, Link2, Quote, Sigma, StickyNote, Table2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "@/pdf-worker?worker&url";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import katex from "katex";
import "katex/dist/katex.min.css";
import { ProcessingBadge } from "@/components/ProcessingBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tag } from "@/components/Tag";
import { LatexText, containsLatex } from "@/components/LatexText";
import { localeText } from "@/lib/locale";
import {
  toDesktopFileUrl,
  useDesktopRuntime,
  useOpenDesktopFile,
  useResolvedDesktopFilePath,
  useRevealInExplorer,
} from "@/lib/desktop";
import {
  useCreateHighlight,
  useCreateHighlightPreset,
  useCreateNote,
  useDeleteHighlight,
  useDeleteHighlightPreset,
  useFiguresByPaper,
  useFolders,
  useHighlightPresets,
  useHighlightsByPaper,
  useNotesByPaper,
  usePaperById,
  usePrimaryPaperFile,
  useReferencesByPaper,
  useSectionsByPaper,
  useUpdateHighlight,
  useUpdateNote,
  useUpsertHighlightEmbedding,
} from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { HighlightPreset, Paper, PaperDetailTab, PaperPageAnchor, PaperTextSelectionAnchor, ProcessingJobStatus, ResearchHighlight } from "@/types/paper";
import { formatNoteDate, noteKindMeta } from "@/features/notes/notePresentation";
import { PdfReaderWorkspace } from "@/features/paper/PdfReaderWorkspace";

GlobalWorkerOptions.workerSrc = workerUrl;

const tabDefs: { id: PaperDetailTab; en: string; ko: string }[] = [
  { id: "overview", en: "Overview", ko: "개요" },
  { id: "pdf", en: "PDF", ko: "PDF" },
  { id: "notes", en: "Notes", ko: "노트" },
  { id: "figures", en: "Figures", ko: "Figure" },
  { id: "tables", en: "Tables", ko: "Table" },
  { id: "equations", en: "Equations", ko: "수식" },
  { id: "references", en: "References", ko: "참고문헌" },
  { id: "metadata", en: "Metadata", ko: "메타데이터" },
];

function formatAuthors(paper: Paper) {
  return paper.authors.map((author) => author.name).join(", ");
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function buildInsightCards(paper: Paper) {
  const [first, second, third] = splitSentences(paper.abstract);

  return [
    {
      title: "목적",
      body: first ?? "이 논문의 목적과 현재 연구 흐름에서 중요한 이유를 정리합니다.",
    },
    {
      title: "주요 결과",
      body: second ?? first ?? "기억할 가치가 있는 가장 강력한 결과나 주장을 정리합니다.",
    },
    {
      title: "한계",
      body: third ?? "가정, 부족한 증거, 나중에 재확인할 사항을 기록합니다.",
    },
  ];
}

function summarize(text: string, maxLength = 148) {
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}...` : text;
}

function formatProcessingLabel(status?: ProcessingJobStatus, locale: "en" | "ko" = "en") {
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  if (!status) return t("No active pipeline job", "파이프라인 작업 없음");
  if (status === "queued") return t("Queued", "대기 중");
  if (status === "running") return t("Running", "처리 중");
  if (status === "succeeded") return t("Ready", "완료");
  return t("Failed", "실패");
}

function processingCopy(status: ProcessingJobStatus | undefined, locale: "en" | "ko") {
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  if (status === "queued") {
    return t("The PDF is stored and queued for processing.", "PDF가 저장되었고 처리 대기 중입니다.");
  }
  if (status === "running") {
    return t("Processing the PDF now.", "PDF를 처리하고 있습니다.");
  }
  if (status === "failed") {
    return t("Processing failed. Retry or inspect manually.", "처리에 실패했습니다. 재시도하거나 수동으로 확인하세요.");
  }
  if (status === "succeeded") {
    return t("Processing complete. The PDF reader is ready.", "처리 완료. PDF 리더를 사용할 수 있습니다.");
  }
  return t("Processing signals will appear once a job is created.", "처리 작업이 생성되면 상태가 표시됩니다.");
}

function formatFileSize(fileSize?: number) {
  if (!fileSize || Number.isNaN(fileSize)) {
    return "Unknown size";
  }

  if (fileSize < 1024 * 1024) {
    return `${Math.max(1, Math.round(fileSize / 1024))} KB`;
  }

  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}
function readerActionMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}
function buildFallbackAnchor(paperId: string, pageNumber: number, pageLabel?: string): PaperPageAnchor {
  return {
    paperId,
    pageNumber,
    pageLabel: pageLabel ?? String(pageNumber),
    anchorId: `paper:${paperId}:page:${pageNumber}`,
  };
}

function OverviewTab({ paper, folderName }: { paper: Paper; folderName?: string }) {
  const { data: sections = [] } = useSectionsByPaper(paper.id);
  const { data: figures = [] } = useFiguresByPaper(paper.id);
  const { locale, openPaperDetail, setReaderTargetAnchor } = useUIStore();
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const fallbackCards = buildInsightCards(paper);
  const insightCards =
    sections.length > 0
      ? sections.slice(0, 3).map((section) => ({
          id: section.id,
          title: section.name,
          body: summarize(section.rawText, 188),
        }))
      : fallbackCards;
  const extractionReady = sections.length > 0 || figures.length > 0;
  const outline = sections.slice(0, 6);
  const leadFigure = figures[0];

  function jumpToPage(pageNumber?: number) {
    if (!pageNumber) {
      return;
    }

    setReaderTargetAnchor(buildFallbackAnchor(paper.id, pageNumber));
    openPaperDetail("pdf");
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)",
          gap: 14,
        }}
      >
        <section style={cardStyle}>
          <div style={eyebrowStyle}>{t("Paper Card", "논문 카드")}</div>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.75, marginBottom: 14 }}>
            {paper.abstract || t("This imported paper has not been summarized yet.", "아직 초록이 추출되지 않았습니다. 추출이 완료되면 내용이 채워집니다.")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {paper.tags.map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
            {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={eyebrowStyle}>{t("Status", "상태")}</div>
          {[
            [t("Read status", "읽기 상태"), paper.status],
            [t("Pipeline", "파이프라인"), formatProcessingLabel(paper.processingStatus, locale)],
            [t("Category", "카테고리"), folderName ?? t("Uncategorized", "미분류")],
            [t("Sections", "섹션"), t(`${sections.length} extracted`, `${sections.length}개 추출`)],
            [t("Figures", "Figure"), t(`${figures.length} extracted`, `${figures.length}개 추출`)],
            [t("Notes", "노트"), t(`${paper.noteCount} linked`, `${paper.noteCount}개 연결`)],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 0",
                borderBottom: "1px solid var(--color-border-subtle)",
                fontSize: 13,
              }}
            >
              <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
              <span style={{ color: "var(--color-text-primary)", fontWeight: 600, textTransform: "capitalize" }}>{value}</span>
            </div>
          ))}
        </section>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {insightCards.map((card, index) => (
          <section key={"id" in card ? (card.id as string) : `fallback-${index}`} style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{card.title}</div>
            <p style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>{card.body}</p>
          </section>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 0.7fr)",
          gap: 14,
        }}
      >
        <section style={cardStyle}>
          <div style={eyebrowStyle}>{t("Section Outline", "섹션 목차")}</div>
          {extractionReady && outline.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {outline.map((section, index) => (
                <div key={section.id} style={{ padding: 12, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{section.pageStart ? `${section.name} - Page ${section.pageStart}${section.pageEnd && section.pageEnd !== section.pageStart ? `-${section.pageEnd}` : ""}` : section.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>#{index + 1}</div>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: section.pageStart ? 10 : 0 }}>
                    {summarize(section.rawText, 210)}
                  </div>
                  {section.pageStart ? (
                    <button onClick={() => jumpToPage(section.pageStart)} style={lightButtonStyle}>
                      <FileText size={13} />
                      {t("Open section page", "섹션 페이지 열기")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 14, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)", fontSize: 12.5, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
              {paper.processingStatus === "running"
                ? t("The extraction worker is still assembling the section outline.", "섹션 목차를 추출하고 있습니다.")
                : t("No section outline available yet.", "아직 섹션 목차가 없습니다. PDF를 가져오거나 재추출하면 채워집니다.")}
            </div>
          )}
        </section>

        <section style={cardStyle}>
          <div style={eyebrowStyle}>{t("Figure Signal", "Figure 미리보기")}</div>
          {leadFigure ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ padding: 12, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{leadFigure.figureNo}</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{leadFigure.page ? t(`Page ${leadFigure.page} - ${figures.length} total`, `${leadFigure.page}페이지 · 총 ${figures.length}개`) : t(`${figures.length} total`, `총 ${figures.length}개`)}</div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 10 }}>
                  {containsLatex(leadFigure.caption) ? (
                    <LatexText style={{ fontSize: 12.5 }}>{leadFigure.caption!}</LatexText>
                  ) : (leadFigure.caption ?? t("Caption not extracted yet.", "캡션이 아직 추출되지 않았습니다."))}
                </div>
                {leadFigure.summaryText ? (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.7, marginBottom: leadFigure.page ? 10 : 0 }}>
                    {containsLatex(leadFigure.summaryText) ? (
                      <LatexText style={{ fontSize: 11.5 }}>{leadFigure.summaryText}</LatexText>
                    ) : leadFigure.summaryText}
                  </div>
                ) : null}
                {leadFigure.page ? (
                  <button onClick={() => jumpToPage(leadFigure.page)} style={lightButtonStyle}>
                    <Images size={13} />
                    {t("Open figure page", "Figure 페이지 열기")}
                  </button>
                ) : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {figures.slice(0, 4).map((figure) => (
                  <button
                    key={figure.id}
                    onClick={() => jumpToPage(figure.page)}
                    disabled={!figure.page}
                    style={{
                      ...lightButtonStyle,
                      cursor: figure.page ? "pointer" : "default",
                      opacity: figure.page ? 1 : 0.7,
                    }}
                  >
                    <Images size={12} />
                    {figure.page ? `${figure.figureNo} - p.${figure.page}` : figure.figureNo}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: 14, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)", fontSize: 12.5, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
              {paper.processingStatus === "running"
                ? "Figure captions will appear here once the worker finishes the first extraction pass."
                : "No figures have been extracted for this paper yet."}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PdfTab({ paper, folderName }: { paper: Paper; folderName?: string }) {
  const locale = useUIStore((s) => s.locale);
  const tl = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: notes = [] } = useNotesByPaper(paper.id);
  const { data: highlights = [] } = useHighlightsByPaper(paper.id);
  const { data: allPresets = [] } = useHighlightPresets();
  const highlightPresets = allPresets;
  const { data: primaryFile, isLoading: isPrimaryFileLoading } = usePrimaryPaperFile(paper.id);
  const { data: runtime } = useDesktopRuntime();
  const { data: resolvedPath, isLoading: isPathLoading } = useResolvedDesktopFilePath(primaryFile?.storedPath ?? null);
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
        </div>
      )}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
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

const sidebarSmallBtn: React.CSSProperties = {
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

function NotesTab({ paper }: { paper: Paper }) {
  const { data: notes = [] } = useNotesByPaper(paper.id);
  const { locale, openNotesWorkspace } = useUIStore();
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            {t("Notes Workspace", "노트 워크스페이스")}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {t("Review note summaries here, then jump into the editor.", "노트 요약을 확인하고 편집기로 이동하세요.")}
          </div>
        </div>
        <button onClick={() => openNotesWorkspace(paper.id)} style={lightButtonStyle}>
          <ExternalLink size={13} />
          {t("Open notes workspace", "노트 워크스페이스 열기")}
        </button>
      </div>

      {notes.length > 0 ? (
        notes.map((note) => {
          const meta = noteKindMeta[note.kind];

          return (
            <button
              key={note.id}
              onClick={() => openNotesWorkspace(note.paperId, note.id)}
              style={{
                ...cardStyle,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: "999px", background: meta.background, color: meta.accent, fontSize: 11, fontWeight: 700 }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatNoteDate(note.updatedAt)}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{note.title}</div>
              {note.anchorLabel ? (
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginBottom: 8 }}>{note.anchorLabel}</div>
              ) : null}
              <p style={{ fontSize: 13, lineHeight: 1.75, color: "var(--color-text-secondary)" }}>{note.content}</p>
            </button>
          );
        })
      ) : (
        <div style={{ padding: 28, textAlign: "center", color: "var(--color-text-muted)" }}>
          {t("No notes yet.", "아직 노트가 없습니다.")}
        </div>
      )}
    </div>
  );
}

function FigureDetailImage({ imagePath }: { imagePath: string }) {
  const { data: resolvedPath } = useResolvedDesktopFilePath(imagePath);
  const { data: runtime } = useDesktopRuntime();
  const [broken, setBroken] = useState(false);
  const fileUrl = resolvedPath && runtime?.available ? toDesktopFileUrl(resolvedPath) : null;

  if (!fileUrl || broken) return null;
  return (
    <img
      src={fileUrl}
      style={{ display: "block", width: "100%", borderRadius: "var(--radius-md)", background: "#fff" }}
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

function FigureDetailThumbnail({ doc, page, figureNo, width }: { doc: PDFDocumentProxy; page: number; figureNo?: string; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      const pdfPage = await doc.getPage(Math.min(page, doc.numPages));
      if (cancelled) { pdfPage.cleanup(); return; }

      const baseVp = pdfPage.getViewport({ scale: 1 });
      const renderScale = (width * 2) / baseVp.width;
      const vp = pdfPage.getViewport({ scale: renderScale });
      const pageH = vp.height;

      // Try to crop to the figure region if figureNo is provided
      let cropTop = 0;
      let cropBottom = pageH;

      if (figureNo) {
        const tc = await pdfPage.getTextContent();
        const figNum = figureNo.replace(/\D/g, "");
        const captionRe = new RegExp(`(?:Fig\\.?|Figure)\\s*${figNum}(?![0-9])`, "i");
        const nextRe = /(?:Table\s*\d|Figure\s*\d|Fig\.?\s*\d|\d+\.\s+[A-Z])/i;

        const rawItems: { text: string; y: number }[] = [];
        for (const item of tc.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          rawItems.push({ text: item.str, y: pageH - (item.transform[5] * renderScale) });
        }
        rawItems.sort((a, b) => a.y - b.y);

        const lines: { text: string; y: number }[] = [];
        for (const item of rawItems) {
          const last = lines[lines.length - 1];
          if (last && Math.abs(item.y - last.y) < 6) { last.text += " " + item.text; }
          else { lines.push({ text: item.text, y: item.y }); }
        }

        let captionIdx = -1;
        for (let i = 0; i < lines.length; i++) {
          if (captionRe.test(lines[i].text)) { captionIdx = i; break; }
        }

        if (captionIdx >= 0) {
          cropBottom = Math.min(pageH, lines[captionIdx].y + 30);
          for (let i = captionIdx - 1; i >= 0; i--) {
            if (nextRe.test(lines[i].text) && !captionRe.test(lines[i].text)) {
              cropTop = Math.max(0, lines[i].y + 12);
              break;
            }
          }
        }
      }

      const cropH = Math.max(60, cropBottom - cropTop);
      if (cancelled) { pdfPage.cleanup(); return; }

      const off = document.createElement("canvas");
      off.width = Math.floor(vp.width);
      off.height = Math.floor(pageH);
      const offCtx = off.getContext("2d");
      if (!offCtx) { pdfPage.cleanup(); return; }
      await pdfPage.render({ canvasContext: offCtx, viewport: vp } as any).promise;
      pdfPage.cleanup();
      if (cancelled) return;

      const dpr = window.devicePixelRatio || 1;
      const displayH = (cropH / vp.width) * width;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(displayH * dpr);
      canvas.style.width = `${Math.floor(width)}px`;
      canvas.style.height = `${Math.floor(displayH)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(off, 0, Math.floor(cropTop), Math.floor(vp.width), Math.floor(cropH), 0, 0, canvas.width, canvas.height);
      if (!cancelled) setLoaded(true);
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [doc, page, figureNo, width]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block", width: "100%", borderRadius: "var(--radius-md)",
        background: loaded ? "#fff" : "var(--color-bg-surface)",
        opacity: loaded ? 1 : 0.3, transition: "opacity 0.2s",
      }}
    />
  );
}

function TableCropThumbnail({ doc, page, figureNo, width }: { doc: PDFDocumentProxy; page: number; figureNo: string; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      const pdfPage = await doc.getPage(Math.min(page, doc.numPages));
      if (cancelled) { pdfPage.cleanup(); return; }

      const baseVp = pdfPage.getViewport({ scale: 1 });
      const renderScale = (width * 2) / baseVp.width;
      const vp = pdfPage.getViewport({ scale: renderScale });
      const pageH = vp.height;

      // Locate table region via text content positions
      const tc = await pdfPage.getTextContent();
      const tableNum = figureNo.replace(/\D/g, "");
      const captionRe = new RegExp(`Table\\s*${tableNum}\\b`, "i");
      const nextRe = /(?:Table\s*\d|Figure\s*\d|Fig\.?\s*\d|\d+\.\s+[A-Z])/i;

      // Convert PDF coords (origin bottom-left, y-up) to canvas coords (origin top-left, y-down)
      const rawItems: { text: string; y: number }[] = [];
      for (const item of tc.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const pdfY = item.transform[5];
        const canvasY = pageH - (pdfY * renderScale);
        rawItems.push({ text: item.str, y: canvasY });
      }
      rawItems.sort((a, b) => a.y - b.y);

      // Group text runs into lines by approximate y-position (within 6px = same line)
      const lines: { text: string; y: number }[] = [];
      for (const item of rawItems) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(item.y - last.y) < 6) {
          last.text += " " + item.text;
        } else {
          lines.push({ text: item.text, y: item.y });
        }
      }

      let cropTop = 0;
      let cropBottom = pageH;
      let found = false;

      for (const line of lines) {
        if (captionRe.test(line.text)) {
          cropTop = Math.max(0, line.y - 20);
          found = true;
          break;
        }
      }

      if (found) {
        for (const line of lines) {
          if (line.y <= cropTop + 30) continue;
          if (nextRe.test(line.text) && !captionRe.test(line.text)) {
            cropBottom = line.y - 10;
            break;
          }
        }
      }

      console.log(`[TableCrop] "${figureNo}" found=${found} cropTop=${Math.round(cropTop)} cropBottom=${Math.round(cropBottom)} pageH=${Math.round(pageH)} lines=${lines.length}`);

      const cropH = Math.max(60, cropBottom - cropTop);
      if (cancelled) { pdfPage.cleanup(); return; }

      // Render full page to offscreen canvas
      const off = document.createElement("canvas");
      off.width = Math.floor(vp.width);
      off.height = Math.floor(pageH);
      const offCtx = off.getContext("2d");
      if (!offCtx) { pdfPage.cleanup(); return; }
      await pdfPage.render({ canvasContext: offCtx, viewport: vp } as any).promise;
      pdfPage.cleanup();
      if (cancelled) return;

      // Crop table region to display canvas
      const dpr = window.devicePixelRatio || 1;
      const aspectRatio = cropH / vp.width;
      const displayW = width;
      const displayH = displayW * aspectRatio;
      canvas.width = Math.floor(displayW * dpr);
      canvas.height = Math.floor(displayH * dpr);
      canvas.style.width = `${Math.floor(displayW)}px`;
      canvas.style.height = `${Math.floor(displayH)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(off, 0, Math.floor(cropTop), Math.floor(vp.width), Math.floor(cropH), 0, 0, canvas.width, canvas.height);
      if (!cancelled) setLoaded(true);
    })().catch((err) => { console.error("[TableCrop] error:", err); });

    return () => { cancelled = true; };
  }, [doc, page, figureNo, width]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block", width: "100%", borderRadius: "var(--radius-md)",
        background: loaded ? "#fff" : "var(--color-bg-surface)",
        opacity: loaded ? 1 : 0.3, transition: "opacity 0.2s",
      }}
    />
  );
}

function useFigureTabPdfDoc(paperId: string) {
  const { data: primaryFile } = usePrimaryPaperFile(paperId);
  const { data: resolvedPath } = useResolvedDesktopFilePath(primaryFile?.storedPath ?? null);
  const { data: runtime } = useDesktopRuntime();
  const fileUrl = resolvedPath && runtime?.available ? toDesktopFileUrl(resolvedPath) : null;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (!fileUrl) { setDoc(null); return; }
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;

    getDocument(fileUrl).promise
      .then((proxy) => {
        if (cancelled) { void proxy.destroy(); return; }
        loaded = proxy;
        setDoc((prev) => { if (prev && prev !== proxy) void prev.destroy(); return proxy; });
      })
      .catch(() => { if (!cancelled) setDoc(null); });

    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
    };
  }, [fileUrl]);

  useEffect(() => {
    return () => { setDoc((prev) => { if (prev) void prev.destroy(); return null; }); };
  }, []);

  return doc;
}

/* ------------------------------------------------------------------ */
/*  Markdown table → HTML                                              */
/* ------------------------------------------------------------------ */

function tableDataToHtml(raw: string): string | null {
  const trimmed = raw.trim();

  // If it's already HTML (from GLM-OCR), return as-is
  if (trimmed.startsWith("<table") || trimmed.startsWith("<TABLE")) {
    return trimmed;
  }

  // Otherwise try markdown pipe-table format
  const lines = trimmed.split("\n").filter((l) => l.trim());
  if (lines.length < 2 || !lines[0].includes("|")) return null;

  const parseRow = (line: string) =>
    line.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);

  const headers = parseRow(lines[0]);
  // skip separator line (line[1])
  const rows = lines.slice(2).map(parseRow);

  const ths = headers.map((h) => `<th>${h}</th>`).join("");
  const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

/* ------------------------------------------------------------------ */
/*  LaTeX equation renderer                                            */
/* ------------------------------------------------------------------ */

function stripLatexDelimiters(raw: string): string {
  let s = raw.trim();
  // Strip $$...$$ (display mode delimiters)
  if (s.startsWith("$$") && s.endsWith("$$") && s.length > 4) {
    s = s.slice(2, -2).trim();
  }
  // Strip $...$ (inline delimiters)
  else if (s.startsWith("$") && s.endsWith("$") && s.length > 2) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function LatexBlock({ latex }: { latex: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cleaned = stripLatexDelimiters(latex);
    try {
      katex.render(cleaned, ref.current, {
        displayMode: true,
        throwOnError: false,
        strict: false,
      });
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Render error");
    }
  }, [latex]);

  if (error) {
    return (
      <pre style={{ fontSize: 12, color: "var(--color-text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {latex}
      </pre>
    );
  }
  return <div ref={ref} style={{ overflow: "auto", padding: "8px 0" }} />;
}

/** Renders OCR HTML table with post-render KaTeX processing for $...$ patterns in cells. */
function OcrTableHtml({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cells = ref.current.querySelectorAll("td, th");
    for (const cell of cells) {
      const text = cell.textContent ?? "";
      if (!text.includes("$")) continue;
      // Replace $...$ patterns with KaTeX-rendered spans
      const parts: (string | { latex: string })[] = [];
      let lastIndex = 0;
      const regex = /\$([^$]+)\$/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
        parts.push({ latex: m[1] });
        lastIndex = m.index + m[0].length;
      }
      if (parts.length === 0) continue;
      if (lastIndex < text.length) parts.push(text.slice(lastIndex));
      cell.innerHTML = parts
        .map((p) => {
          if (typeof p === "string") return p;
          try {
            return katex.renderToString(p.latex, { throwOnError: false, strict: false });
          } catch {
            return `$${p.latex}$`;
          }
        })
        .join("");
    }
  }, [html]);

  return (
    <div
      ref={ref}
      className="ocr-table"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        overflow: "auto", maxHeight: 400, fontSize: 12.5, lineHeight: 1.6,
        borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border-subtle)",
      }}
    />
  );
}

const itemTypeLabels: Record<string, { en: string; ko: string; emptyEn: string; emptyKo: string; emptyRunEn: string; emptyRunKo: string; icon: typeof Images }> = {
  figure: { en: "Figures", ko: "Figure", emptyEn: "No extracted figures yet.", emptyKo: "추출된 Figure가 없습니다.", emptyRunEn: "Figure 추출 중...", emptyRunKo: "Figure 추출 중...", icon: Images },
  table: { en: "Tables", ko: "Table", emptyEn: "No extracted tables yet.", emptyKo: "추출된 Table이 없습니다.", emptyRunEn: "Table 추출 중...", emptyRunKo: "Table 추출 중...", icon: Table2 },
  equation: { en: "Equations", ko: "수식", emptyEn: "No extracted equations yet.", emptyKo: "추출된 수식이 없습니다.", emptyRunEn: "수식 추출 중...", emptyRunKo: "수식 추출 중...", icon: Sigma },
};

function FiguresTab({ paper, filterType = "figure" }: { paper: Paper; filterType?: "figure" | "table" | "equation" }) {
  const { data: allItems = [] } = useFiguresByPaper(paper.id);
  const { locale, openPaperDetail, setReaderTargetAnchor } = useUIStore();
  const doc = useFigureTabPdfDoc(paper.id);
  const items = allItems
    .filter((f) => f.itemType === filterType)
    .sort((a, b) => {
      const na = parseInt(a.figureNo.match(/(\d+)/)?.[1] ?? "0", 10);
      const nb = parseInt(b.figureNo.match(/(\d+)/)?.[1] ?? "0", 10);
      return na - nb;
    });
  const rawMeta = itemTypeLabels[filterType] ?? itemTypeLabels.figure;
  const meta = {
    title: localeText(locale, rawMeta.en, rawMeta.ko),
    empty: localeText(locale, rawMeta.emptyEn, rawMeta.emptyKo),
    emptyRunning: localeText(locale, rawMeta.emptyRunEn, rawMeta.emptyRunKo),
    icon: rawMeta.icon,
  };
  const FallbackIcon = meta.icon;

  function jumpToPage(page?: number) {
    if (!page) return;
    setReaderTargetAnchor(buildFallbackAnchor(paper.id, page));
    openPaperDetail("pdf");
  }

  if (items.length === 0) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{meta.title}</div>
          <div style={{ fontSize: 12.5, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
            {paper.processingStatus === "running" ? meta.emptyRunning : meta.empty}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={eyebrowStyle}>{meta.title}</div>
          </div>
          <div style={{ padding: "6px 10px", borderRadius: "999px", background: "var(--color-bg-surface)", border: "1px solid var(--color-border-subtle)", fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>
            {localeText(locale, `${items.length} total`, `총 ${items.length}개`)}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: filterType === "table" ? "1fr" : filterType === "equation" ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {items.map((item) => {
            const tableHtml = filterType === "table" && item.summaryText ? tableDataToHtml(item.summaryText) : null;

            return (
            <div key={item.id} style={{ padding: 14, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)", border: "1px solid var(--color-border-subtle)", display: "grid", gap: 10 }}>
              {filterType === "table" ? (
                /* Tables: HTML table from OCR or fallback crop */
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Table2 size={15} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{item.page ? `${item.figureNo} - p.${item.page}` : item.figureNo}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {item.isPresentationCandidate ? <Tag label="Deck" /> : null}
                    </div>
                  </div>
                  {item.caption ? (
                    <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.6, fontStyle: "italic" }}>
                      {containsLatex(item.caption) ? (
                        <LatexText style={{ fontSize: 12.5 }}>{item.caption}</LatexText>
                      ) : item.caption}
                    </div>
                  ) : null}
                  {tableHtml ? (
                    <OcrTableHtml html={tableHtml} />
                  ) : item.summaryText ? (
                    <pre style={{
                      overflow: "auto", maxHeight: 400, fontSize: 11.5, lineHeight: 1.5,
                      padding: 12, borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border-subtle)",
                      background: "var(--color-bg-surface)",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                      color: "var(--color-text-secondary)", fontFamily: "var(--font-mono, monospace)",
                    }}>{item.summaryText}</pre>
                  ) : doc && item.page ? (
                    <TableCropThumbnail doc={doc} page={item.page} figureNo={item.figureNo} width={460} />
                  ) : null}
                  {item.page ? (
                    <button onClick={() => jumpToPage(item.page)} style={lightButtonStyle}>
                      <FileText size={13} />
                      Open page
                    </button>
                  ) : null}
                </>
              ) : filterType === "equation" ? (
                /* Equations: LaTeX rendered with KaTeX */
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Sigma size={15} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{item.page ? `${item.figureNo} - p.${item.page}` : item.figureNo}</div>
                    </div>
                  </div>
                  <div style={{
                    padding: 16, borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--color-border-subtle)",
                    background: "#fff", overflow: "auto",
                  }}>
                    <LatexBlock latex={item.summaryText ?? item.caption ?? ""} />
                  </div>
                  {item.page ? (
                    <button onClick={() => jumpToPage(item.page)} style={lightButtonStyle}>
                      <FileText size={13} />
                      Open page
                    </button>
                  ) : null}
                </>
              ) : (
                /* Figures: show image or page thumbnail */
                <>
                  <div style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--color-border-subtle)", overflow: "hidden", background: "var(--color-bg-surface)", minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {item.imagePath ? (
                      <FigureDetailImage imagePath={item.imagePath} />
                    ) : doc && item.page ? (
                      <FigureDetailThumbnail doc={doc} page={item.page} figureNo={item.figureNo} width={220} />
                    ) : (
                      <div style={{ padding: 20 }}>
                        <FallbackIcon size={24} style={{ color: "var(--color-accent)", opacity: 0.72 }} />
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{item.page ? `${item.figureNo} - p.${item.page}` : item.figureNo}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {item.isKeyFigure ? <Tag label="Key" /> : null}
                      {item.isPresentationCandidate ? <Tag label="Deck" /> : null}
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                    {containsLatex(item.caption) ? (
                      <LatexText style={{ fontSize: 12.5 }}>{item.caption!}</LatexText>
                    ) : (item.caption ?? "Caption not extracted yet.")}
                  </div>
                  {item.summaryText ? (
                    <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
                      {containsLatex(item.summaryText) ? (
                        <LatexText style={{ fontSize: 11.5 }}>{item.summaryText}</LatexText>
                      ) : item.summaryText}
                    </div>
                  ) : null}
                  {item.page ? (
                    <button onClick={() => jumpToPage(item.page)} style={lightButtonStyle}>
                      <FileText size={13} />
                      Open page
                    </button>
                  ) : null}
                </>
              )}
            </div>
          );
          })}
        </div>
      </div>
    </div>
  );
}

function ReferencesTab({ paper }: { paper: Paper }) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: references = [], isLoading } = useReferencesByPaper(paper.id);

  if (isLoading) {
    return (
      <div style={cardStyle}>
        <div style={eyebrowStyle}>{t("References", "참고문헌")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{t("Loading references...", "참고문헌 불러오는 중...")}</p>
      </div>
    );
  }

  if (references.length === 0) {
    return (
      <div style={cardStyle}>
        <div style={eyebrowStyle}>{t("References", "참고문헌")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          {t("No references extracted yet.", "아직 참고문헌이 추출되지 않았습니다.")}
        </p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={eyebrowStyle}>{t("References", "참고문헌")} ({references.length})</div>
      <div style={{ display: "grid", gap: 2 }}>
        {references.map((ref) => {
          const authorStr = ref.refAuthors.map((a) => a.name).join(", ");
          return (
            <div
              key={ref.id}
              style={{
                padding: "10px 0",
                borderBottom: "1px solid var(--color-border-subtle)",
                display: "grid",
                gridTemplateColumns: "32px minmax(0, 1fr)",
                gap: 8,
                alignItems: "start",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600, paddingTop: 2 }}>
                [{ref.refOrder}]
              </span>
              <div>
                <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6, marginBottom: 2 }}>
                  {ref.refTitle || ref.refRawText || t("Untitled reference", "제목 없는 참고문헌")}
                </p>
                {authorStr && (
                  <p style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{authorStr}</p>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {ref.refJournal && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic" }}>{ref.refJournal}</span>
                  )}
                  {ref.refYear && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{ref.refYear}</span>
                  )}
                  {ref.refVolume && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Vol. {ref.refVolume}</span>
                  )}
                  {ref.refPages && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>pp. {ref.refPages}</span>
                  )}
                  {ref.refDoi && (
                    <a
                      href={`https://doi.org/${ref.refDoi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "var(--color-accent)", textDecoration: "none" }}
                    >
                      DOI
                    </a>
                  )}
                  {ref.linkedPaperId && (
                    <span style={{ fontSize: 11, color: "var(--color-success)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <Link2 size={10} /> {t("In Library", "라이브러리에 있음")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetadataTab({ paper, folderName }: { paper: Paper; folderName?: string }) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  return (
    <div style={cardStyle}>
      {[
        [t("Title", "제목"), paper.title],
        [t("Authors", "저자"), formatAuthors(paper)],
        [t("Venue", "학술지"), paper.venue],
        [t("Year", "연도"), String(paper.year)],
        [t("DOI", "DOI"), paper.doi || "—"],
        [t("Category", "카테고리"), folderName ?? t("Uncategorized", "미분류")],
        [t("Added", "추가일"), paper.addedAt],
        [t("Read status", "읽기 상태"), paper.status],
        [t("Pipeline", "파이프라인"), formatProcessingLabel(paper.processingStatus, locale)],
      ].map(([label, value]) => (
        <div
          key={label}
          style={{
            display: "grid",
            gridTemplateColumns: "140px minmax(0, 1fr)",
            gap: 14,
            padding: "11px 0",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{label}</span>
          {label === "DOI" && paper.doi ? (
            <span
              onClick={() => window.redouDesktop?.openExternal(`https://doi.org/${paper.doi}`)}
              style={{ fontSize: 13, color: "var(--color-accent)", lineHeight: 1.6, cursor: "pointer" }}
            >
              {paper.doi}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{value}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function PaperDetailView() {
  const { locale, selectedPaperId, paperDetailTab, setPaperDetailTab, closePaperDetail } = useUIStore();
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: paper } = usePaperById(selectedPaperId);
  const { data: folders = [] } = useFolders();

  const folderName = useMemo(
    () => folders.find((folder) => folder.id === paper?.folderId)?.name,
    [folders, paper?.folderId],
  );

  if (!paper) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)" }}>
        {t("Select a paper to open the detail workspace.", "논문을 선택하면 상세 화면이 열립니다.")}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "18px 20px 26px" }}>
      <div style={{ display: "grid", gap: 18 }}>
        <div
          style={{
            padding: 20,
            borderRadius: "var(--radius-xl)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 14 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <StatusBadge status={paper.status} />
                {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
                {folderName ? <Tag label={folderName} /> : null}
              </div>
              <h2 style={{ fontSize: 24, lineHeight: 1.3, marginBottom: 8 }}>{paper.title}</h2>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.75 }}>
                {formatAuthors(paper)}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, color: "var(--color-text-muted)", fontSize: 12.5, flexWrap: "wrap" }}>
                <span>{paper.venue || t("Venue pending", "학술지 대기중")}</span>
                <span>|</span>
                <span>{paper.year || t("Year pending", "연도 대기중")}</span>
                <span>|</span>
                <span>{t(`${paper.citationCount.toLocaleString()} citations`, `인용 ${paper.citationCount.toLocaleString()}회`)}</span>
                {paper.doi && (
                  <>
                    <span>|</span>
                    <span
                      onClick={() => window.redouDesktop?.openExternal(`https://doi.org/${paper.doi}`)}
                      style={{ color: "var(--color-accent)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}
                    >
                      <ExternalLink size={11} />
                      DOI
                    </span>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button onClick={closePaperDetail} style={lightButtonStyle}>
                <ArrowLeft size={14} />
                {t("Back to Library", "라이브러리로")}
              </button>
              <button
                onClick={() => setPaperDetailTab("pdf")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 34,
                  padding: "0 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  background: "var(--color-accent)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <FileText size={14} />
                {t("Open Reader", "리더 열기")}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--color-text-muted)", fontSize: 12.5, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Quote size={13} />
              {paper.citationCount.toLocaleString()}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Images size={13} />
              {t(`${paper.figureCount} figures`, `Figure ${paper.figureCount}개`)}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <StickyNote size={13} />
              {t(`${paper.noteCount} notes`, `노트 ${paper.noteCount}개`)}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ExternalLink size={13} />
              {formatProcessingLabel(paper.processingStatus, locale)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabDefs.map((tab) => {
            const active = tab.id === paperDetailTab;
            return (
              <button
                key={tab.id}
                onClick={() => setPaperDetailTab(tab.id)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "999px",
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
                  background: active ? "var(--color-accent-subtle)" : "var(--color-bg-elevated)",
                  color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                  fontSize: 12.5,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {localeText(locale, tab.en, tab.ko)}
              </button>
            );
          })}
        </div>

        {paperDetailTab === "overview" ? <OverviewTab paper={paper} folderName={folderName} /> : null}
        {paperDetailTab === "pdf" ? <PdfTab paper={paper} folderName={folderName} /> : null}
        {paperDetailTab === "notes" ? <NotesTab paper={paper} /> : null}
        {paperDetailTab === "figures" ? <FiguresTab paper={paper} filterType="figure" /> : null}
        {paperDetailTab === "tables" ? <FiguresTab paper={paper} filterType="table" /> : null}
        {paperDetailTab === "equations" ? <FiguresTab paper={paper} filterType="equation" /> : null}
        {paperDetailTab === "references" ? <ReferencesTab paper={paper} /> : null}
        {paperDetailTab === "metadata" ? <MetadataTab paper={paper} folderName={folderName} /> : null}
      </div>
    </div>
  );
}

const cardStyle = {
  padding: 18,
  borderRadius: "var(--radius-lg)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
  boxShadow: "var(--shadow-sm)",
};

const eyebrowStyle = {
  fontSize: 11,
  color: "var(--color-text-muted)",
  marginBottom: 8,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
};

const lightButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "0 12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-surface)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};
































