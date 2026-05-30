import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  ImageOff,
  Images,
  Maximize2,
  Search,
  Sigma,
  Table2,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "@/pdf-worker?worker&url";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { localeText } from "@/lib/locale";
import { toDesktopFileUrl, useDesktopRuntime, useResolvedDesktopFilePath } from "@/lib/desktop";
import { useAllFigures, useAllPapers, usePrimaryPaperFile } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { FigureItemType, Paper, PaperFigure } from "@/types/paper";
import { LatexText, containsLatex } from "@/components/LatexText";

GlobalWorkerOptions.workerSrc = workerUrl;

/* ------------------------------------------------------------------ */
/*  Type metadata (kit FIG_META) — labels are localized at call sites  */
/* ------------------------------------------------------------------ */

const TYPE_COLOR: Record<FigureItemType, string> = {
  figure: "#2563eb",
  table: "#0f766e",
  equation: "#a855f7",
};

function typeLabel(t: (en: string, ko: string) => string, itemType: FigureItemType): string {
  if (itemType === "table") return t("Table", "Table");
  if (itemType === "equation") return t("Equation", "Equation");
  return t("Figure", "Figure");
}

/** Extracts a display number from a figureNo string (e.g. "Figure 3" → "3"). */
function figureNumber(figureNo: string): string {
  return figureNo.match(/(\d+)/)?.[1] ?? figureNo;
}

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
/*  Hook: load a single PDF doc for one paper                          */
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
/*  Per-paper PDF doc cache (Direction A-1)                            */
/*  A 1-pane global gallery mixes figures from many papers. Each crop  */
/*  thumbnail needs its own paper's PDF doc. We load one doc per paper */
/*  (shared across all of that paper's cards) and expose it via Map.   */
/* ------------------------------------------------------------------ */

const PaperDocContext = createContext<Map<string, PDFDocumentProxy | null>>(new Map());

function usePaperDoc(paperId: string): PDFDocumentProxy | null {
  const map = useContext(PaperDocContext);
  return map.get(paperId) ?? null;
}

/** Loads exactly one paper's PDF doc and reports it upward. One per paperId. */
function PaperDocLoader({
  paperId,
  onDoc,
}: {
  paperId: string;
  onDoc: (paperId: string, doc: PDFDocumentProxy | null) => void;
}) {
  const doc = usePaperPdfDoc(paperId);
  useEffect(() => {
    onDoc(paperId, doc);
    return () => onDoc(paperId, null);
  }, [paperId, doc, onDoc]);
  return null;
}

/**
 * Provides a shared paperId → PDF doc cache to descendant cards.
 * `paperIds` should list only papers that actually need a rendered crop
 * (i.e. at least one figure without an imagePath). Its identity is derived
 * from the figure set so the loader list stays stable across renders.
 */
function PaperDocCacheProvider({
  paperIds,
  children,
}: {
  paperIds: string[];
  children: React.ReactNode;
}) {
  const [docs, setDocs] = useState<Map<string, PDFDocumentProxy | null>>(new Map());

  const handleDoc = useCallback((paperId: string, doc: PDFDocumentProxy | null) => {
    setDocs((prev) => {
      if (prev.get(paperId) === doc) return prev;
      const next = new Map(prev);
      if (doc) next.set(paperId, doc);
      else next.delete(paperId);
      return next;
    });
  }, []);

  return (
    <PaperDocContext.Provider value={docs}>
      {paperIds.map((id) => (
        <PaperDocLoader key={id} paperId={id} onDoc={handleDoc} />
      ))}
      {children}
    </PaperDocContext.Provider>
  );
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
/*  Real thumbnail visual — picks the right renderer per figure        */
/*  Replaces the kit's fake FigureThumb placeholder.                   */
/* ------------------------------------------------------------------ */

function FigureThumb({ figure, width, big = false }: { figure: PaperFigure; width: number; big?: boolean }) {
  const doc = usePaperDoc(figure.paperId);

  if (figure.imagePath) {
    return <FigureImage imagePath={figure.imagePath} />;
  }
  if (doc && figure.page && figure.itemType === "table") {
    return <TableCropThumbnailCard doc={doc} page={figure.page} figureNo={figure.figureNo} width={width} />;
  }
  if (doc && figure.page && figure.itemType === "figure") {
    return <FigureCropThumbnailCard doc={doc} page={figure.page} figureNo={figure.figureNo} width={width} />;
  }
  if (doc && figure.page) {
    return <PageThumbnail doc={doc} page={figure.page} width={width} />;
  }
  return (
    <div style={{ padding: big ? 40 : 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {figure.itemType === "table" ? (
        <Table2 size={big ? 40 : 24} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
      ) : figure.itemType === "equation" ? (
        <Sigma size={big ? 40 : 24} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
      ) : (
        <Images size={big ? 40 : 24} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Figure card (kit style + real thumbnail)                           */
/* ------------------------------------------------------------------ */

function FigureCard({
  figure,
  paper,
  onOpen,
  t,
}: {
  figure: PaperFigure;
  paper: Paper | undefined;
  onOpen: () => void;
  t: (en: string, ko: string) => string;
}) {
  const color = TYPE_COLOR[figure.itemType];

  return (
    <button
      onClick={onOpen}
      className="fig-card"
      style={{
        textAlign: "left", padding: 0, cursor: "pointer",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        display: "flex", flexDirection: "column",
        transition: "border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast)",
      }}
    >
      <div style={{
        position: "relative",
        borderBottom: "1px solid var(--color-border-subtle)",
        background: "var(--color-bg-base)",
        minHeight: 80,
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden",
      }}>
        <FigureThumb figure={figure} width={240} />
        <span style={{
          position: "absolute", top: 8, left: 8,
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 8px", borderRadius: 999,
          background: `color-mix(in oklab, ${color} 14%, #ffffff)`,
          color, fontSize: 10.5, fontWeight: 700,
          boxShadow: "var(--shadow-xs)", whiteSpace: "nowrap",
        }}>
          {typeLabel(t, figure.itemType)} {figureNumber(figure.figureNo)}
        </span>
        <span className="fig-zoom" style={{
          position: "absolute", top: 8, right: 8,
          width: 26, height: 26, borderRadius: "var(--radius-sm)",
          background: "rgba(255,255,255,0.92)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "var(--shadow-xs)", opacity: 0,
          transition: "opacity var(--transition-fast)",
        }}>
          <Maximize2 size={13} style={{ color: "var(--color-text-secondary)" }} />
        </span>
      </div>
      <div style={{ padding: "10px 12px", display: "grid", gap: 6, flex: 1 }}>
        {figure.caption ? (
          <div style={{
            fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5, overflow: "hidden",
            ...(containsLatex(figure.caption) ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }),
          }}>
            {containsLatex(figure.caption) ? (
              <LatexText style={{ fontSize: 12 }}>{figure.caption}</LatexText>
            ) : (
              figure.caption
            )}
          </div>
        ) : null}
        {paper ? (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginTop: "auto",
            fontSize: 10.5, color: "var(--color-text-muted)", minWidth: 0,
          }}>
            <FileText size={10} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {paper.title}
            </span>
            {figure.page ? (
              <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>p.{figure.page}</span>
            ) : null}
          </div>
        ) : figure.page ? (
          <div style={{ fontSize: 10.5, color: "var(--color-text-muted)", marginTop: "auto", fontVariantNumeric: "tabular-nums" }}>
            p.{figure.page}
          </div>
        ) : null}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable grid of asset cards                                       */
/* ------------------------------------------------------------------ */

function FigureGallery({
  figures,
  paperMap,
  onOpen,
  t,
}: {
  figures: PaperFigure[];
  paperMap: Map<string, Paper>;
  onOpen: (index: number) => void;
  t: (en: string, ko: string) => string;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
      gap: 14,
    }}>
      {figures.map((fig, index) => (
        <FigureCard
          key={fig.id}
          figure={fig}
          paper={paperMap.get(fig.paperId)}
          onOpen={() => onOpen(index)}
          t={t}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Lightbox — large view with keyboard nav (real thumbnail)           */
/* ------------------------------------------------------------------ */

function FigureLightbox({
  figures,
  index,
  setIndex,
  paperMap,
  onClose,
  onOpenPaper,
  t,
}: {
  figures: PaperFigure[];
  index: number;
  setIndex: (updater: (i: number) => number) => void;
  paperMap: Map<string, Paper>;
  onClose: () => void;
  onOpenPaper: (figure: PaperFigure) => void;
  t: (en: string, ko: string) => string;
}) {
  const figure = figures[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(figures.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [figures.length, onClose, setIndex]);

  if (!figure) return null;
  const color = TYPE_COLOR[figure.itemType];
  const paper = paperMap.get(figure.paperId);

  const navBtn = (dir: "prev" | "next", disabled: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 40, height: 40, flexShrink: 0,
        borderRadius: "50%", border: "none",
        background: disabled ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.14)",
        color: disabled ? "rgba(255,255,255,0.3)" : "#fff",
        cursor: disabled ? "default" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {dir === "next"
        ? <ChevronRight size={20} style={{ color: disabled ? "rgba(255,255,255,0.3)" : "#fff" }} />
        : <ChevronLeft size={20} style={{ color: disabled ? "rgba(255,255,255,0.3)" : "#fff" }} />}
    </button>
  );

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "absolute", inset: 0, zIndex: 70,
        display: "flex", flexDirection: "column",
        background: "rgba(10, 16, 28, 0.72)", backdropFilter: "blur(4px)",
      }}
    >
      {/* top bar */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", color: "#fff", flexShrink: 0 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 999,
          background: color, color: "#fff", fontSize: 12, fontWeight: 700,
          whiteSpace: "nowrap", flexShrink: 0,
        }}>{typeLabel(t, figure.itemType)} {figureNumber(figure.figureNo)}</span>
        <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
          {index + 1} / {figures.length}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          title={t("Close (Esc)", "닫기 (Esc)")}
          style={{
            width: 34, height: 34, borderRadius: "var(--radius-sm)", border: "none",
            background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        ><X size={17} style={{ color: "#fff" }} /></button>
      </div>

      {/* stage */}
      <div
        style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", gap: 14, padding: "0 18px 8px" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {navBtn("prev", index === 0, () => setIndex((i) => Math.max(0, i - 1)))}
        <div style={{ flex: 1, height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            maxWidth: 820, width: "100%", maxHeight: "100%",
            background: "var(--color-bg-elevated)",
            borderRadius: "var(--radius-lg)", overflow: "auto",
            boxShadow: "var(--shadow-lg)",
            display: "flex", flexDirection: "column",
          }}>
            <FigureThumb figure={figure} width={820} big />
          </div>
        </div>
        {navBtn("next", index === figures.length - 1, () => setIndex((i) => Math.min(figures.length - 1, i + 1)))}
      </div>

      {/* caption bar */}
      <div
        style={{ flexShrink: 0, padding: "12px 64px 20px", color: "#fff", display: "flex", alignItems: "flex-start", gap: 16, justifyContent: "center" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ maxWidth: 760, width: "100%" }}>
          {figure.caption ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.92)" }}>
              {containsLatex(figure.caption) ? (
                <LatexText style={{ fontSize: 13.5 }}>{figure.caption}</LatexText>
              ) : (
                figure.caption
              )}
            </div>
          ) : null}
          {paper ? (
            <button
              onClick={() => onOpenPaper(figure)}
              style={{
                marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6,
                background: "transparent", border: "none", cursor: "pointer", padding: 0,
                color: "var(--color-accent)", fontSize: 12, fontWeight: 600,
              }}
            >
              <ExternalLink size={12} style={{ color: "var(--color-accent)" }} />
              {paper.title}{figure.page ? ` · p.${figure.page}` : ""}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main view — library-wide gallery                                   */
/* ------------------------------------------------------------------ */

const TYPE_ORDER: Record<FigureItemType, number> = { figure: 0, table: 1, equation: 2 };

export function FiguresView() {
  const { data: papers = [] } = useAllPapers();
  const { data: figures = [] } = useAllFigures();
  const { locale, setActiveNav, setReaderTargetAnchor, setSelectedPaperId, openPaperDetail } = useUIStore();
  const t = (english: string, korean: string) => localeText(locale, english, korean);

  const [filter, setFilter] = useState<"all" | FigureItemType>("all");
  const [query, setQuery] = useState("");
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const paperMap = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);

  // Stable list of all figures, grouped by type then numeric figure number.
  const sortedFigures = useMemo(
    () => [...figures].sort((a, b) => {
      const ta = TYPE_ORDER[a.itemType] ?? 0;
      const tb = TYPE_ORDER[b.itemType] ?? 0;
      if (ta !== tb) return ta - tb;
      const na = parseInt(a.figureNo.match(/(\d+)/)?.[1] ?? "0", 10);
      const nb = parseInt(b.figureNo.match(/(\d+)/)?.[1] ?? "0", 10);
      if (na !== nb) return na - nb;
      return (paperMap.get(a.paperId)?.title ?? "").localeCompare(paperMap.get(b.paperId)?.title ?? "");
    }),
    [figures, paperMap],
  );

  const counts = useMemo(() => {
    const c = { all: figures.length, figure: 0, table: 0, equation: 0 };
    for (const f of figures) c[f.itemType] = (c[f.itemType] ?? 0) + 1;
    return c;
  }, [figures]);

  const filtered = useMemo(() => {
    let list = sortedFigures;
    if (filter !== "all") list = list.filter((f) => f.itemType === filter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((f) =>
        (f.caption?.toLowerCase().includes(q) ?? false) ||
        (paperMap.get(f.paperId)?.title.toLowerCase().includes(q) ?? false),
      );
    }
    return list;
  }, [sortedFigures, filter, query, paperMap]);

  // Papers that need a rendered crop (have at least one visible figure without an imagePath).
  const docPaperIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of filtered) {
      if (!f.imagePath && f.page) ids.add(f.paperId);
    }
    return Array.from(ids);
  }, [filtered]);

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

  const openPaperFromLightbox = useCallback((figure: PaperFigure) => {
    setOpenIdx(null);
    jumpToPage(figure.paperId, figure.page);
  }, [jumpToPage]);

  const chips: { id: "all" | FigureItemType; label: string }[] = [
    { id: "all", label: t("All", "전체") },
    { id: "figure", label: t("Figures", "Figure") },
    { id: "table", label: t("Tables", "Table") },
    { id: "equation", label: t("Equations", "Equation") },
  ];

  return (
    <PaperDocCacheProvider paperIds={docPaperIds}>
      <div className="scroll-y" style={{ height: "100%", overflowY: "auto", background: "var(--color-bg-surface)" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 28px 40px" }}>
          {/* header */}
          <div style={{ marginBottom: 16 }}>
            <h1 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em" }}>
              {t("Figures", "Figure")}
            </h1>
            <p style={{ fontSize: 12.5, color: "var(--color-text-muted)", marginTop: 3 }}>
              {t(
                `${figures.length} figures, tables & equations extracted from your library`,
                `라이브러리에서 추출된 그림 · 표 · 수식 ${figures.length}개`,
              )}
            </p>
          </div>

          {/* controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {chips.map((chip) => {
                const active = filter === chip.id;
                return (
                  <button
                    key={chip.id}
                    onClick={() => setFilter(chip.id)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", borderRadius: 999,
                      border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
                      background: active ? "var(--color-accent)" : "var(--color-bg-elevated)",
                      color: active ? "#fff" : "var(--color-text-secondary)",
                      fontSize: 12, fontWeight: active ? 600 : 500, cursor: "pointer",
                      whiteSpace: "nowrap", transition: "all var(--transition-fast)",
                    }}
                  >
                    {chip.label}
                    <span style={{
                      fontSize: 10.5, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                      color: active ? "rgba(255,255,255,0.85)" : "var(--color-text-muted)",
                    }}>{counts[chip.id] ?? 0}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 1 }} />

            <div style={{
              display: "flex", alignItems: "center", gap: 8, height: 36,
              padding: "0 12px", minWidth: 220,
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-sm)",
            }}>
              <Search size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search caption · paper…", "캡션 · 논문 검색…")}
                style={{
                  flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
                  color: "var(--color-text-primary)", fontSize: 12.5,
                }}
              />
            </div>
          </div>

          {/* gallery */}
          {filtered.length > 0 ? (
            <FigureGallery
              figures={filtered}
              paperMap={paperMap}
              onOpen={(index) => setOpenIdx(index)}
              t={t}
            />
          ) : (
            <div style={{ display: "grid", placeItems: "center", padding: "60px 0", gap: 10, color: "var(--color-text-muted)" }}>
              <ImageOff size={26} style={{ color: "var(--color-text-muted)" }} />
              <div style={{ fontSize: 13 }}>
                {figures.length === 0
                  ? t("No extracted figures yet.", "아직 추출된 Figure가 없습니다.")
                  : t("No matching results.", "일치하는 결과가 없습니다.")}
              </div>
            </div>
          )}
        </div>

        {openIdx !== null ? (
          <FigureLightbox
            figures={filtered}
            index={Math.min(openIdx, filtered.length - 1)}
            setIndex={(updater) => setOpenIdx((i) => updater(i ?? 0))}
            paperMap={paperMap}
            onClose={() => setOpenIdx(null)}
            onOpenPaper={openPaperFromLightbox}
            t={t}
          />
        ) : null}
      </div>
    </PaperDocCacheProvider>
  );
}
