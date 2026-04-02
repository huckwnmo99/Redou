import { ChevronRight, ExternalLink, FileText, Images, Sigma, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "@/pdf-worker?worker&url";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { localeText } from "@/lib/locale";
import { toDesktopFileUrl, useDesktopRuntime, useResolvedDesktopFilePath } from "@/lib/desktop";
import { useAllFigures, useAllPapers, useFolders, usePrimaryPaperFile } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper, PaperFigure } from "@/types/paper";
import { LatexText, containsLatex } from "@/components/LatexText";

GlobalWorkerOptions.workerSrc = workerUrl;

/* ------------------------------------------------------------------ */
/*  PDF page thumbnail — receives shared doc                           */
/* ------------------------------------------------------------------ */

function PageThumbnail({ doc, page, width }: { doc: PDFDocumentProxy; page: number; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      const p = await doc.getPage(Math.min(page, doc.numPages));
      if (cancelled) { p.cleanup(); return; }
      const vp = p.getViewport({ scale: 1 });
      const scale = width / vp.width;
      const svp = p.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(svp.width * dpr);
      canvas.height = Math.floor(svp.height * dpr);
      canvas.style.width = `${Math.floor(svp.width)}px`;
      canvas.style.height = `${Math.floor(svp.height)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) { p.cleanup(); return; }
      await p.render({ canvas, canvasContext: ctx, viewport: svp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] } as any).promise;
      p.cleanup();
      if (!cancelled) setLoaded(true);
    })().catch(() => {});

    return () => { cancelled = true; };
  }, [doc, page, width]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block", width: "100%", borderRadius: 6,
        background: loaded ? "#fff" : "var(--color-bg-surface)",
        opacity: loaded ? 1 : 0.3, transition: "opacity 0.2s",
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Hook: load a single PDF doc for the selected paper                 */
/* ------------------------------------------------------------------ */

function usePaperPdfDoc(paperId: string | null) {
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

  // Cleanup on unmount
  useEffect(() => {
    return () => { setDoc((prev) => { if (prev) void prev.destroy(); return null; }); };
  }, []);

  return doc;
}

/* ------------------------------------------------------------------ */
/*  Figure image (resolved from stored path)                           */
/* ------------------------------------------------------------------ */

function FigureImage({ imagePath }: { imagePath: string }) {
  const { data: resolvedPath } = useResolvedDesktopFilePath(imagePath);
  const { data: runtime } = useDesktopRuntime();
  const [broken, setBroken] = useState(false);
  const fileUrl = resolvedPath && runtime?.available ? toDesktopFileUrl(resolvedPath) : null;

  if (!fileUrl || broken) return null;
  return (
    <img
      src={fileUrl}
      style={{ display: "block", width: "100%", borderRadius: 6, background: "#fff" }}
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Table crop thumbnail — crops PDF page to show only table region    */
/* ------------------------------------------------------------------ */

function TableCropThumbnailCard({ doc, page, figureNo, width }: { doc: PDFDocumentProxy; page: number; figureNo: string; width: number }) {
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

      const tc = await pdfPage.getTextContent();
      const tableNum = figureNo.replace(/\D/g, "");
      const captionRe = new RegExp(`Table\\s*${tableNum}\\b`, "i");
      const nextRe = /(?:Table\s*\d|Figure\s*\d|Fig\.?\s*\d|\d+\.\s+[A-Z])/i;

      // Convert PDF coords (bottom-left origin) to canvas coords (top-left origin)
      const rawItems: { text: string; y: number }[] = [];
      for (const item of tc.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const canvasY = pageH - (item.transform[5] * renderScale);
        rawItems.push({ text: item.str, y: canvasY });
      }
      rawItems.sort((a, b) => a.y - b.y);

      // Group text runs into lines (within 6px = same line)
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
        display: "block", width: "100%", borderRadius: 6,
        background: loaded ? "#fff" : "var(--color-bg-surface)",
        opacity: loaded ? 1 : 0.3, transition: "opacity 0.2s",
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Figure crop thumbnail — crops PDF page to show only figure region  */
/* ------------------------------------------------------------------ */

function FigureCropThumbnailCard({ doc, page, figureNo, width }: { doc: PDFDocumentProxy; page: number; figureNo: string; width: number }) {
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

      const tc = await pdfPage.getTextContent();
      const figNum = figureNo.replace(/\D/g, "");
      // Match "Fig. N", "Figure N", "Fig N"
      const captionRe = new RegExp(`(?:Fig\\.?|Figure)\\s*${figNum}(?![0-9])`, "i");
      const nextRe = /(?:Table\s*\d|Figure\s*\d|Fig\.?\s*\d|\d+\.\s+[A-Z])/i;

      const rawItems: { text: string; y: number }[] = [];
      for (const item of tc.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const canvasY = pageH - (item.transform[5] * renderScale);
        rawItems.push({ text: item.str, y: canvasY });
      }
      rawItems.sort((a, b) => a.y - b.y);

      const lines: { text: string; y: number }[] = [];
      for (const item of rawItems) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(item.y - last.y) < 6) {
          last.text += " " + item.text;
        } else {
          lines.push({ text: item.text, y: item.y });
        }
      }

      // Find the caption line for this figure
      let captionIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (captionRe.test(lines[i].text)) { captionIdx = i; break; }
      }

      let cropTop = 0;
      let cropBottom = pageH;

      if (captionIdx >= 0) {
        const captionY = lines[captionIdx].y;

        // Figure images are typically ABOVE the caption (unlike tables where content is below)
        // Scan upward from caption to find the start of the figure region
        cropBottom = Math.min(pageH, captionY + 30); // include caption + small margin

        // Find previous boundary (another caption, section heading) above this figure
        for (let i = captionIdx - 1; i >= 0; i--) {
          const lineText = lines[i].text;
          if (nextRe.test(lineText) && !captionRe.test(lineText)) {
            cropTop = Math.max(0, lines[i].y + 12); // start just below previous element's text
            break;
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
        display: "block", width: "100%", borderRadius: 6,
        background: loaded ? "#fff" : "var(--color-bg-surface)",
        opacity: loaded ? 1 : 0.3, transition: "opacity 0.2s",
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Figure card                                                        */
/* ------------------------------------------------------------------ */

function FigureCard({
  figure,
  doc,
  onJumpToPage,
}: {
  figure: PaperFigure;
  doc: PDFDocumentProxy | null;
  onJumpToPage: () => void;
}) {
  return (
    <div
      style={{
        borderRadius: 8, background: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
        overflow: "hidden", cursor: figure.page ? "pointer" : "default",
      }}
      onClick={() => figure.page && onJumpToPage()}
    >
      <div style={{
        background: "var(--color-bg-base)",
        borderBottom: "1px solid var(--color-border-subtle)",
        minHeight: 80, display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
      }}>
        {figure.imagePath ? (
          <FigureImage imagePath={figure.imagePath} />
        ) : doc && figure.page && figure.itemType === "table" ? (
          <TableCropThumbnailCard doc={doc} page={figure.page} figureNo={figure.figureNo} width={240} />
        ) : doc && figure.page && figure.itemType === "figure" ? (
          <FigureCropThumbnailCard doc={doc} page={figure.page} figureNo={figure.figureNo} width={240} />
        ) : doc && figure.page ? (
          <PageThumbnail doc={doc} page={figure.page} width={240} />
        ) : (
          <div style={{ padding: 20 }}>
            {figure.itemType === "table" ? (
              <Table2 size={24} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
            ) : figure.itemType === "equation" ? (
              <Sigma size={24} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
            ) : (
              <Images size={24} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
            )}
          </div>
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
          {figure.figureNo}{figure.page ? ` — p.${figure.page}` : ""}
        </div>
        {figure.caption && (
          <div style={{
            fontSize: 11.5, lineHeight: 1.6, color: "var(--color-text-secondary)",
            overflow: "hidden",
            ...(containsLatex(figure.caption) ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }),
          }}>
            {containsLatex(figure.caption) ? (
              <LatexText style={{ fontSize: 11.5 }}>{figure.caption}</LatexText>
            ) : (
              figure.caption
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Paper list item                                                    */
/* ------------------------------------------------------------------ */

function PaperRow({ paper, figureCount, selected, onClick }: {
  paper: Paper; figureCount: number; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%",
        padding: "10px 12px", border: "none", textAlign: "left", cursor: "pointer",
        borderRadius: 8,
        background: selected ? "var(--color-accent-subtle)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <FileText size={14} style={{ color: selected ? "var(--color-accent)" : "var(--color-text-muted)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12.5, fontWeight: selected ? 600 : 500,
          color: selected ? "var(--color-accent)" : "var(--color-text-primary)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {paper.title}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: 2 }}>
          {paper.year} · {figureCount} fig
        </div>
      </div>
      <ChevronRight size={12} style={{ color: "var(--color-text-muted)", flexShrink: 0, opacity: selected ? 1 : 0.4 }} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Folder group                                                       */
/* ------------------------------------------------------------------ */

function FolderGroup({ folder, papers, figureCounts, selectedPaperId, onSelectPaper }: {
  folder: { id: string; name: string } | null;
  papers: Paper[];
  figureCounts: Map<string, number>;
  selectedPaperId: string | null;
  onSelectPaper: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const label = folder?.name ?? "Uncategorized";

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          border: "none", background: "transparent", padding: "6px 10px",
          cursor: "pointer", fontSize: 10.5, fontWeight: 700,
          color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em",
        }}
      >
        <span style={{ fontSize: 8, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
        {label}
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 500, opacity: 0.7 }}>{papers.length}</span>
      </button>
      {open && papers.map((p) => (
        <PaperRow
          key={p.id}
          paper={p}
          figureCount={figureCounts.get(p.id) ?? 0}
          selected={selectedPaperId === p.id}
          onClick={() => onSelectPaper(p.id)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Selected paper figures panel                                       */
/* ------------------------------------------------------------------ */

function SelectedPaperPanel({ paper, figures, onJumpToPage }: {
  paper: Paper;
  figures: PaperFigure[];
  onJumpToPage: (paperId: string, page?: number) => void;
}) {
  const doc = usePaperPdfDoc(paper.id);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
          {paper.venue} · {paper.year}
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, lineHeight: 1.4 }}>
          {paper.title}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {figures.length} figures
          </span>
          <button
            onClick={() => onJumpToPage(paper.id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              height: 28, padding: "0 10px", borderRadius: 6,
              border: "1px solid var(--color-border-subtle)",
              background: "var(--color-bg-surface)", color: "var(--color-text-secondary)",
              cursor: "pointer", fontSize: 11.5,
            }}
          >
            <ExternalLink size={11} /> Open paper
          </button>
        </div>
      </div>

      {figures.length > 0 ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 14,
        }}>
          {figures.map((fig) => (
            <FigureCard
              key={fig.id}
              figure={fig}
              doc={doc}
              onJumpToPage={() => onJumpToPage(paper.id, fig.page)}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
          No figures extracted for this paper.
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main view                                                          */
/* ------------------------------------------------------------------ */

export function FiguresView() {
  const { data: papers = [] } = useAllPapers();
  const { data: figures = [] } = useAllFigures();
  const { data: folders = [] } = useFolders();
  const { locale, setActiveNav, setReaderTargetAnchor, setSelectedPaperId, openPaperDetail } = useUIStore();
  const t = (english: string, korean: string) => localeText(locale, english, korean);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const figureCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const fig of figures) counts.set(fig.paperId, (counts.get(fig.paperId) ?? 0) + 1);
    return counts;
  }, [figures]);

  const papersWithFigures = useMemo(
    () => papers.filter((p) => (figureCounts.get(p.id) ?? 0) > 0),
    [papers, figureCounts],
  );

  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const grouped = useMemo(() => {
    const groups = new Map<string | null, Paper[]>();
    for (const p of papersWithFigures) {
      const key = p.folderId ?? null;
      const list = groups.get(key);
      if (list) list.push(p);
      else groups.set(key, [p]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return (folderMap.get(a)?.name ?? "").localeCompare(folderMap.get(b)?.name ?? "");
    });
  }, [papersWithFigures, folderMap]);

  useEffect(() => {
    if (!selectedId && papersWithFigures.length > 0) setSelectedId(papersWithFigures[0].id);
  }, [papersWithFigures, selectedId]);

  const selectedPaper = papers.find((p) => p.id === selectedId);
  const selectedFigures = useMemo(
    () => figures.filter((f) => f.paperId === selectedId).sort((a, b) => {
      // Group by item type: figure → table → equation
      const typeOrder = { figure: 0, table: 1, equation: 2 } as Record<string, number>;
      const ta = typeOrder[a.itemType ?? "figure"] ?? 0;
      const tb = typeOrder[b.itemType ?? "figure"] ?? 0;
      if (ta !== tb) return ta - tb;
      // Within same type, sort by extracted number (numeric, not lexicographic)
      const na = parseInt(a.figureNo.match(/(\d+)/)?.[1] ?? "0", 10);
      const nb = parseInt(b.figureNo.match(/(\d+)/)?.[1] ?? "0", 10);
      return na - nb;
    }),
    [figures, selectedId],
  );

  const jumpToPage = useCallback((paperId: string, page?: number) => {
    setActiveNav("library");
    setSelectedPaperId(paperId);
    if (page) {
      setReaderTargetAnchor({
        paperId, pageNumber: page, pageLabel: String(page),
        anchorId: `paper:${paperId}:page:${page}`,
      });
      openPaperDetail("pdf");
    } else {
      openPaperDetail("figures");
    }
  }, [setActiveNav, setSelectedPaperId, setReaderTargetAnchor, openPaperDetail]);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left: Paper list */}
      <div style={{
        width: 280, minWidth: 280,
        borderRight: "1px solid var(--color-border-subtle)",
        background: "var(--color-bg-panel)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 14px 10px",
          borderBottom: "1px solid var(--color-border-subtle)", flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>
            {t("Figures & Tables", "Figure & Table")}
          </h2>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            {papersWithFigures.length} {t("papers", "논문")} · {figures.filter(f => f.itemType === "figure").length} fig · {figures.filter(f => f.itemType === "table").length} tbl · {figures.filter(f => f.itemType === "equation").length} eq
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px" }}>
          {grouped.length > 0 ? grouped.map(([folderId, folderPapers]) => (
            <FolderGroup
              key={folderId ?? "__none"}
              folder={folderId ? (folderMap.get(folderId) ?? { id: folderId, name: folderId }) : null}
              papers={folderPapers}
              figureCounts={figureCounts}
              selectedPaperId={selectedId}
              onSelectPaper={setSelectedId}
            />
          )) : (
            <div style={{ padding: 16, fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>
              {t("No papers with figures yet.", "Figure가 있는 논문이 없습니다.")}
            </div>
          )}
        </div>
      </div>

      {/* Right: Figures grid */}
      <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
        {selectedPaper ? (
          <SelectedPaperPanel
            key={selectedPaper.id}
            paper={selectedPaper}
            figures={selectedFigures}
            onJumpToPage={jumpToPage}
          />
        ) : (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", color: "var(--color-text-muted)", fontSize: 13,
          }}>
            {papersWithFigures.length > 0
              ? t("Select a paper to view its figures.", "논문을 선택하면 Figure를 볼 수 있습니다.")
              : t("No extracted figures yet.", "아직 추출된 Figure가 없습니다.")}
          </div>
        )}
      </div>
    </div>
  );
}
