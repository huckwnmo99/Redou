import { MessageSquarePlus, Minus, Plus, StickyNote } from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { GlobalWorkerOptions, TextLayer, getDocument } from "pdfjs-dist";
import workerUrl from "@/pdf-worker?worker&url";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist/types/src/display/api";
import type {
  HighlightPreset,
  PaperPageAnchor,
  PaperSelectionRect,
  PaperTextSelectionAnchor,
  ResearchHighlight,
  ResearchNote,
} from "@/types/paper";

GlobalWorkerOptions.workerSrc = workerUrl;

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface PdfReaderWorkspaceProps {
  paperId: string;
  fileUrl: string;
  title: string;
  targetAnchor?: PaperPageAnchor | null;
  savedHighlights?: ResearchHighlight[];
  highlightPresets?: HighlightPreset[];
  highlightNotes?: ResearchNote[];
  onAnchorChange?: (anchor: PaperPageAnchor) => void;
  onSelectionChange?: (anchor: PaperTextSelectionAnchor | null) => void;
  onTargetAnchorReached?: (anchor: PaperPageAnchor) => void;
  onSaveHighlight?: (selectionAnchor: PaperTextSelectionAnchor, presetId: string) => void;
  onCreateNote?: (selectionAnchor: PaperTextSelectionAnchor) => void;
  onCreatePreset?: () => void;
  onSaveMemo?: (highlightId: string, content: string) => Promise<void>;
  onUpdateMemo?: (noteId: string, content: string) => Promise<void>;
}

type PdfTextLayer = InstanceType<typeof TextLayer>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildPageAnchor(paperId: string, pageNumber: number, pageLabel: string): PaperPageAnchor {
  return {
    paperId,
    pageNumber,
    pageLabel,
    anchorId: `paper:${paperId}:page:${pageNumber}`,
  };
}

function normalizeSelectedText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function roundVal(v: number) {
  return Number(v.toFixed(4));
}

function buildSelectionRects(range: Range, container: HTMLElement): PaperSelectionRect[] {
  const bounds = container.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return [];
  return Array.from(range.getClientRects())
    .map((r) => ({
      x: roundVal((r.left - bounds.left) / bounds.width),
      y: roundVal((r.top - bounds.top) / bounds.height),
      width: roundVal(r.width / bounds.width),
      height: roundVal(r.height / bounds.height),
    }))
    .filter((r) => r.width > 0 && r.height > 0);
}

function withAlpha(hex: string | undefined, alpha: number) {
  if (!hex) return `rgba(250,204,21,${alpha})`;
  const n = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(n)) return `rgba(250,204,21,${alpha})`;
  return `rgba(${parseInt(n.slice(0, 2), 16)},${parseInt(n.slice(2, 4), 16)},${parseInt(n.slice(4, 6), 16)},${alpha})`;
}

/* ------------------------------------------------------------------ */
/*  Highlight hover group with memo icon                               */
/* ------------------------------------------------------------------ */

interface HighlightGroupProps {
  highlight: ResearchHighlight;
  rects: PaperSelectionRect[];
  lastRect: PaperSelectionRect;
  hasMemo: boolean;
  isActiveMemo: boolean;
  onOpenMemo: () => void;
}

const HIGHLIGHT_HEIGHT_PCT = 1.6; // fixed highlight height as % of page height

function HighlightGroup({ highlight, rects }: HighlightGroupProps) {
  return (
    <>
      {/* Color rects — uniform height, no pointer events so text selection works through */}
      {rects.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${r.x * 100}%`,
            top: `${(r.y + r.height / 2) * 100 - HIGHLIGHT_HEIGHT_PCT / 2}%`,
            width: `${r.width * 100}%`,
            height: `${HIGHLIGHT_HEIGHT_PCT}%`,
            borderRadius: 3,
            background: withAlpha(highlight.colorHex, 0.28),
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

/** Memo icon rendered in a separate layer above the text layer so it's always clickable */
function MemoIcon({ highlight, lastRect, hasMemo, isActiveMemo, onOpenMemo }: {
  highlight: ResearchHighlight;
  lastRect: PaperSelectionRect;
  hasMemo: boolean;
  isActiveMemo: boolean;
  onOpenMemo: () => void;
}) {
  return (
    <button
      className="redou-memo-icon"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpenMemo(); }}
      onMouseDown={(e) => e.stopPropagation()}
      title={hasMemo ? "View memo" : "Add memo"}
      data-has-memo={hasMemo || undefined}
      data-active={isActiveMemo || undefined}
      style={{
        position: "absolute",
        left: `${(lastRect.x + lastRect.width) * 100}%`,
        top: `${(lastRect.y + lastRect.height / 2) * 100 - HIGHLIGHT_HEIGHT_PCT / 2}%`,
        transform: "translate(4px, -2px)",
        pointerEvents: "auto",
        width: 20, height: 20, borderRadius: 4,
        border: "none",
        background: hasMemo ? (highlight.colorHex ?? "#facc15") : "rgba(15,23,42,0.75)",
        color: "#fff",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      }}
    >
      {hasMemo ? <StickyNote size={11} /> : <MessageSquarePlus size={11} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline memo card                                                   */
/* ------------------------------------------------------------------ */

interface InlineMemoCardProps {
  highlightId: string;
  highlight: ResearchHighlight;
  existingNote: ResearchNote | null;
  pageContainerRect: DOMRect | null;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

function InlineMemoCard({ highlight, existingNote, pageContainerRect, onSave, onClose }: InlineMemoCardProps) {
  const [content, setContent] = useState(existingNote?.content ?? "");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Compute fixed position from page container + highlight rect
  const rects = highlight.startAnchor?.rects ?? [];
  const lastRect = rects[rects.length - 1];
  if (!lastRect || !pageContainerRect) return null;

  const fixedLeft = pageContainerRect.left + (lastRect.x + lastRect.width) * pageContainerRect.width + 28;
  const fixedTop = pageContainerRect.top + (lastRect.y + lastRect.height) * pageContainerRect.height;

  const style: CSSProperties = {
    position: "fixed",
    left: Math.min(fixedLeft, window.innerWidth - 280),
    top: Math.min(fixedTop, window.innerHeight - 220),
    zIndex: 9999,
    width: 260,
    background: "var(--color-bg-elevated, #fff)",
    border: `2px solid ${highlight.colorHex ?? "#facc15"}`,
    borderRadius: 10,
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
    padding: 10,
  };

  return (
    <div ref={ref} style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{
          width: 8, height: 8, borderRadius: 999,
          background: highlight.colorHex ?? "#facc15", flexShrink: 0,
        }} />
        <span style={{ fontSize: 10.5, color: "var(--color-text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {highlight.selectedText.slice(0, 50)}{highlight.selectedText.length > 50 ? "..." : ""}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write your memo..."
        disabled={saving}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (content.trim() && !saving) {
              setSaving(true);
              onSave(content.trim()).then(() => onClose()).catch(() => setSaving(false));
            }
          }
          if (e.key === "Escape") onClose();
        }}
        style={{
          width: "100%", minHeight: 70, maxHeight: 160, resize: "vertical",
          borderRadius: 6, border: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-surface, #f8fafc)", padding: 8,
          fontSize: 12, lineHeight: 1.6, color: "var(--color-text-primary)",
          outline: "none", fontFamily: "inherit",
          opacity: saving ? 0.6 : 1,
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>Ctrl+Enter to save</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              height: 26, padding: "0 10px", borderRadius: 6,
              border: "1px solid var(--color-border-subtle)",
              background: "transparent", fontSize: 11, cursor: "pointer",
              color: "var(--color-text-muted)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (content.trim() && !saving) {
                setSaving(true);
                onSave(content.trim()).then(() => onClose()).catch(() => setSaving(false));
              }
            }}
            disabled={!content.trim() || saving}
            style={{
              height: 26, padding: "0 10px", borderRadius: 6,
              border: "none",
              background: content.trim() && !saving ? (highlight.colorHex ?? "#3b82f6") : "var(--color-border-subtle)",
              color: "#fff", fontSize: 11, fontWeight: 600, cursor: content.trim() && !saving ? "pointer" : "default",
            }}
          >
            {saving ? "Saving..." : existingNote ? "Update" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Single-page renderer                                               */
/* ------------------------------------------------------------------ */

interface PageSlotProps {
  doc: PDFDocumentProxy;
  pageNum: number;
  scale: number;
  pageLabel: string;
  paperId: string;
  highlights: ResearchHighlight[];
  highlightNotes: Map<string, ResearchNote>;
  activeMemoHighlightId: string | null;
  onVisible?: (pageNum: number) => void;
  textLayerRefCb?: (pageNum: number, el: HTMLDivElement | null) => void;
  onOpenMemo?: (highlightId: string) => void;
}

function PageSlot({ doc, pageNum, scale, pageLabel, highlights, highlightNotes, activeMemoHighlightId, onVisible, textLayerRefCb, onOpenMemo }: PageSlotProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textDivRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  // Intersection observer — render when visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRendered(true);
          onVisible?.(pageNum);
        }
      },
      { rootMargin: "200px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onVisible, pageNum]);

  // Render canvas + text layer
  useEffect(() => {
    if (!rendered) return;
    const canvas = canvasRef.current;
    const textDiv = textDivRef.current;
    if (!canvas || !textDiv) return;

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayerTask: PdfTextLayer | null = null;
    let page: PDFPageProxy | null = null;

    (async () => {
      page = await doc.getPage(pageNum);
      const vp = page.getViewport({ scale });
      if (cancelled) { page.cleanup(); return; }

      setDims({ w: Math.floor(vp.width), h: Math.floor(vp.height) });

      const ctx = canvas.getContext("2d");
      if (!ctx) { page.cleanup(); return; }

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      textDiv.replaceChildren();

      const textPromise = page.getTextContent();
      renderTask = page.render({
        canvas,
        canvasContext: ctx,
        viewport: vp,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });

      const [textContent] = await Promise.all([textPromise, renderTask.promise]);
      if (cancelled) { page.cleanup(); return; }

      textLayerTask = new TextLayer({ textContentSource: textContent, container: textDiv, viewport: vp });
      await textLayerTask.render();
      page.cleanup();
    })().catch(() => {});

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayerTask?.cancel();
      textDiv.replaceChildren();
      page?.cleanup();
    };
  }, [rendered, doc, pageNum, scale]);

  // Provide text layer ref to parent
  useEffect(() => {
    textLayerRefCb?.(pageNum, textDivRef.current);
    return () => textLayerRefCb?.(pageNum, null);
  }, [pageNum, textLayerRefCb]);

  const visibleHighlights = highlights.filter(
    (h) => h.pageNumber === pageNum && (h.startAnchor?.rects.length ?? 0) > 0,
  );

  const pageStyle: CSSProperties = {
    "--scale-factor": scale,
    width: dims ? `${dims.w}px` : `${Math.floor(816 * scale)}px`,
    height: dims ? `${dims.h}px` : `${Math.floor(1056 * scale)}px`,
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      data-page-num={pageNum}
      style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}
    >
      <div className="redou-pdf-page" style={pageStyle}>
        {/* Page number badge */}
        <div style={{
          position: "absolute", top: 8, right: 10, zIndex: 3,
          padding: "3px 8px", borderRadius: 999,
          background: "rgba(248,250,252,0.88)", border: "1px solid rgba(148,163,184,0.22)",
          fontSize: 10.5, color: "var(--color-text-muted)", backdropFilter: "blur(6px)",
        }}>
          {pageLabel !== String(pageNum) ? `${pageLabel} (p.${pageNum})` : `p.${pageNum}`}
        </div>

        <canvas ref={canvasRef} style={{ display: "block", background: "#fff" }} />

        {/* Highlight overlay — below text layer, no pointer events */}
        <div className="redou-pdf-highlight-layer">
          {visibleHighlights.map((h) => {
            const rects = h.startAnchor?.rects ?? [];
            if (rects.length === 0) return null;
            const lastRect = rects[rects.length - 1];
            return (
              <HighlightGroup
                key={h.id}
                highlight={h}
                rects={rects}
                lastRect={lastRect}
                hasMemo={highlightNotes.has(h.id)}
                isActiveMemo={activeMemoHighlightId === h.id}
                onOpenMemo={() => onOpenMemo?.(h.id)}
              />
            );
          })}
        </div>

        {/* Text layer for selection */}
        <div
          ref={textDivRef}
          className="textLayer redou-pdf-text-layer"
          aria-label={`Text layer page ${pageNum}`}
        />

        {/* Memo icons — above text layer so they're always clickable */}
        <div className="redou-pdf-memo-layer">
          {visibleHighlights.map((h) => {
            const rects = h.startAnchor?.rects ?? [];
            if (rects.length === 0) return null;
            const lastRect = rects[rects.length - 1];
            return (
              <MemoIcon
                key={h.id}
                highlight={h}
                lastRect={lastRect}
                hasMemo={highlightNotes.has(h.id)}
                isActiveMemo={activeMemoHighlightId === h.id}
                onOpenMemo={() => onOpenMemo?.(h.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Context Menu                                                       */
/* ------------------------------------------------------------------ */

interface ContextMenuProps {
  x: number;
  y: number;
  presets: HighlightPreset[];
  onHighlight: (presetId: string) => void;
  onNote: () => void;
  onCreatePreset: () => void;
  onClose: () => void;
}

function ContextMenu({ x, y, presets, onHighlight, onNote, onCreatePreset, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const style: CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 300),
    zIndex: 9999,
    minWidth: 180,
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 10,
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
    padding: "6px 0",
    overflow: "hidden",
  };

  const itemStyle: CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, width: "100%",
    padding: "7px 14px", border: "none", background: "transparent",
    cursor: "pointer", fontSize: 12.5, color: "var(--color-text-primary)", textAlign: "left",
  };
  const hoverIn = (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "var(--color-bg-surface)");
  const hoverOut = (e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "transparent");

  return (
    <div ref={ref} style={style}>
      {presets.length > 0 ? (
        <>
          <div style={{ padding: "6px 12px", fontSize: 10.5, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Highlight as
          </div>
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => { onHighlight(p.id); onClose(); }}
              style={itemStyle}
              onMouseEnter={hoverIn} onMouseLeave={hoverOut}
            >
              <span style={{ width: 12, height: 12, borderRadius: 999, flexShrink: 0, background: p.colorHex, boxShadow: `0 0 0 2px ${p.colorHex}33` }} />
              {p.name}
            </button>
          ))}
        </>
      ) : (
        <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
          No highlight presets yet.
        </div>
      )}
      <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "4px 0" }} />
      <button
        onClick={() => { onCreatePreset(); onClose(); }}
        style={itemStyle}
        onMouseEnter={hoverIn} onMouseLeave={hoverOut}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span>
        New preset
      </button>
      <button
        onClick={() => { onNote(); onClose(); }}
        style={itemStyle}
        onMouseEnter={hoverIn} onMouseLeave={hoverOut}
      >
        <span style={{ fontSize: 13 }}>📝</span>
        Create note
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function PdfReaderWorkspace({
  paperId,
  fileUrl,
  title: _title,
  targetAnchor,
  savedHighlights = [],
  highlightPresets = [],
  highlightNotes = [],
  onAnchorChange,
  onSelectionChange,
  onTargetAnchorReached,
  onSaveHighlight,
  onCreateNote,
  onCreatePreset,
  onSaveMemo,
  onUpdateMemo,
}: PdfReaderWorkspaceProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textLayersRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageLabels, setPageLabels] = useState<string[] | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; anchor: PaperTextSelectionAnchor } | null>(null);

  // Memo state — which highlight's memo card is open
  const [memoHighlightId, setMemoHighlightId] = useState<string | null>(null);

  // Build a Map of highlightId → note for quick lookup
  const highlightNoteMap = useMemo(() => {
    const map = new Map<string, ResearchNote>();
    for (const note of highlightNotes) {
      if (note.highlightId) map.set(note.highlightId, note);
    }
    return map;
  }, [highlightNotes]);

  // Current selection
  const selectionRef = useRef<PaperTextSelectionAnchor | null>(null);

  const getPageLabel = useCallback(
    (pn: number) => pageLabels?.[pn - 1] ?? String(pn),
    [pageLabels],
  );

  // Load document
  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setLoading(true);
    setError(null);

    const task = getDocument(fileUrl);
    task.promise
      .then(async (proxy) => {
        if (cancelled) { await proxy.destroy(); return; }
        loaded = proxy;
        setDoc((prev) => { if (prev && prev !== proxy) void prev.destroy(); return proxy; });
        setPageCount(proxy.numPages);
        try {
          const labels = await proxy.getPageLabels();
          if (!cancelled) setPageLabels(labels);
        } catch { /* ignore */ }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setDoc((prev) => { if (prev) void prev.destroy(); return null; });
          setPageCount(0);
          setError(e instanceof Error ? e.message : "Unable to load the PDF.");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      task.destroy();
      if (loaded) void loaded.destroy();
    };
  }, [fileUrl]);

  // Page visibility callback — update current page
  const handlePageVisible = useCallback((pn: number) => {
    setCurrentPage(pn);
  }, []);

  // Emit anchor change
  useEffect(() => {
    const label = getPageLabel(currentPage);
    onAnchorChange?.(buildPageAnchor(paperId, currentPage, label));
  }, [currentPage, getPageLabel, onAnchorChange, paperId]);

  // Jump to target anchor
  useEffect(() => {
    if (!targetAnchor?.pageNumber || !scrollRef.current) return;
    const resolved = pageCount > 0 ? Math.min(Math.max(1, targetAnchor.pageNumber), pageCount) : targetAnchor.pageNumber;
    const el = scrollRef.current.querySelector(`[data-page-num="${resolved}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      onTargetAnchorReached?.(targetAnchor);
    }
  }, [targetAnchor, pageCount, onTargetAnchorReached]);

  // Register text layer refs
  const textLayerRefCb = useCallback((pn: number, el: HTMLDivElement | null) => {
    if (el) textLayersRef.current.set(pn, el);
    else textLayersRef.current.delete(pn);
  }, []);

  // Selection tracking
  useEffect(() => {
    const flush = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        selectionRef.current = null;
        onSelectionChange?.(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;

      // Find which page's text layer contains this selection
      let foundPage = 0;
      let foundLayer: HTMLDivElement | null = null;
      for (const [pn, layer] of textLayersRef.current) {
        if (layer.contains(ancestor)) {
          foundPage = pn;
          foundLayer = layer;
          break;
        }
      }
      if (!foundPage || !foundLayer) {
        selectionRef.current = null;
        onSelectionChange?.(null);
        return;
      }

      const quote = normalizeSelectedText(sel.toString());
      if (!quote) {
        selectionRef.current = null;
        onSelectionChange?.(null);
        return;
      }

      // Find the page container (the .redou-pdf-page div) for accurate rect computation
      const pageContainer = foundLayer.closest(".redou-pdf-page") as HTMLDivElement | null;
      const rectTarget = pageContainer ?? foundLayer;

      const anchor: PaperTextSelectionAnchor = {
        ...buildPageAnchor(paperId, foundPage, getPageLabel(foundPage)),
        quote,
        capturedAt: new Date().toISOString(),
        rects: buildSelectionRects(range, rectTarget),
      };
      selectionRef.current = anchor;
      onSelectionChange?.(anchor);
    };

    let raf: number | null = null;
    const handler = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => { raf = null; flush(); });
    };
    document.addEventListener("selectionchange", handler);
    return () => {
      document.removeEventListener("selectionchange", handler);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [getPageLabel, onSelectionChange, paperId]);

  // Right-click handler
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const handler = (e: MouseEvent) => {
      const anchor = selectionRef.current;
      if (!anchor) return; // no text selected, let default context menu show
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, anchor });
    };
    scrollEl.addEventListener("contextmenu", handler);
    return () => scrollEl.removeEventListener("contextmenu", handler);
  }, []);

  // Zoom
  const zoomIn = () => startTransition(() => setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2))));
  const zoomOut = () => startTransition(() => setScale((s) => Math.max(0.5, +(s - 0.15).toFixed(2))));

  // Keyboard zoom (Ctrl +/-)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomIn(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") { e.preventDefault(); zoomOut(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Ctrl + mouse wheel zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const pages = useMemo(() => Array.from({ length: pageCount }, (_, i) => i + 1), [pageCount]);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <style>{readerCss}</style>

      {/* Floating toolbar */}
      <div style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 20,
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 10px", borderRadius: 999,
        background: "rgba(15,23,42,0.82)", backdropFilter: "blur(12px)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        color: "#e2e8f0", fontSize: 12,
      }}>
        <button onClick={zoomOut} disabled={scale <= 0.51} style={toolbarBtn}>
          <Minus size={14} />
        </button>
        <span style={{ minWidth: 44, textAlign: "center", fontWeight: 600, fontSize: 11.5 }}>
          {Math.round(scale * 100)}%
        </span>
        <button onClick={zoomIn} disabled={scale >= 2.49} style={toolbarBtn}>
          <Plus size={14} />
        </button>
        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />
        <span style={{ fontSize: 11.5, opacity: 0.8 }}>
          {currentPage} / {pageCount}
        </span>
      </div>

      {/* Scroll container */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflow: "auto", minHeight: 0,
          background: "var(--color-bg-base, #f1f5f9)",
          borderRadius: 8,
        }}
      >
        {loading && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 400, color: "var(--color-text-muted)", fontSize: 13,
          }}>
            Loading PDF...
          </div>
        )}
        {error && (
          <div style={{
            margin: 18, padding: 14, borderRadius: 8,
            background: "rgba(254,242,242,0.95)", border: "1px solid rgba(220,38,38,0.18)",
            color: "#991b1b", fontSize: 13, lineHeight: 1.7,
          }}>
            {error}
          </div>
        )}
        {doc && pages.map((pn) => (
          <PageSlot
            key={pn}
            doc={doc}
            pageNum={pn}
            scale={scale}
            pageLabel={getPageLabel(pn)}
            paperId={paperId}
            highlights={savedHighlights}
            highlightNotes={highlightNoteMap}
            activeMemoHighlightId={memoHighlightId}
            onVisible={handlePageVisible}
            textLayerRefCb={textLayerRefCb}
            onOpenMemo={(hId) => setMemoHighlightId((prev) => prev === hId ? null : hId)}
          />
        ))}
      </div>

      {/* Inline memo card — rendered as a floating overlay */}
      {memoHighlightId && (() => {
        const hl = savedHighlights.find((h) => h.id === memoHighlightId);
        if (!hl || !hl.startAnchor?.rects?.length) return null;
        const pageNum = hl.startAnchor?.pageNumber ?? hl.pageNumber;
        const pageEl = scrollRef.current?.querySelector(`[data-page-num="${pageNum}"] .redou-pdf-page`) as HTMLElement | null;
        const existingNote = highlightNoteMap.get(memoHighlightId) ?? null;
        return (
          <InlineMemoCard
            highlightId={memoHighlightId}
            highlight={hl}
            existingNote={existingNote}
            pageContainerRect={pageEl?.getBoundingClientRect() ?? null}
            onSave={async (content) => {
              if (existingNote) {
                await onUpdateMemo?.(existingNote.id, content);
              } else {
                await onSaveMemo?.(memoHighlightId, content);
              }
            }}
            onClose={() => setMemoHighlightId(null)}
          />
        );
      })()}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          presets={highlightPresets}
          onHighlight={(presetId) => {
            onSaveHighlight?.(ctxMenu.anchor, presetId);
            window.getSelection()?.removeAllRanges();
          }}
          onNote={() => {
            onCreateNote?.(ctxMenu.anchor);
            window.getSelection()?.removeAllRanges();
          }}
          onCreatePreset={() => onCreatePreset?.()}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const toolbarBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, borderRadius: 999,
  border: "none", background: "rgba(255,255,255,0.1)",
  color: "#e2e8f0", cursor: "pointer",
};

const readerCss = `
.redou-pdf-page {
  --user-unit: 1;
  --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
  position: relative;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 2px 12px rgba(15,23,42,0.10);
  border-radius: 4px;
}
.redou-pdf-highlight-layer {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
}
.redou-pdf-memo-layer {
  position: absolute; inset: 0; z-index: 3; pointer-events: none;
}
.redou-memo-icon {
  opacity: 0; transition: opacity 0.15s;
}
.redou-memo-icon[data-has-memo], .redou-memo-icon[data-active] {
  opacity: 1;
}
.redou-pdf-page:hover .redou-memo-icon {
  opacity: 0.7;
}
.redou-pdf-page:hover .redou-memo-icon:hover,
.redou-memo-icon[data-has-memo],
.redou-memo-icon[data-active] {
  opacity: 1;
}
.redou-pdf-text-layer {
  color-scheme: only light;
  position: absolute; inset: 0; overflow: clip; opacity: 1;
  line-height: 1; text-size-adjust: none; forced-color-adjust: none;
  transform-origin: 0 0; caret-color: CanvasText; z-index: 2;
}
.redou-pdf-text-layer :is(span, br) {
  color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%;
}
.redou-pdf-text-layer {
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.redou-pdf-text-layer > :not(.markedContent),
.redou-pdf-text-layer .markedContent span:not(.markedContent) {
  z-index: 1; --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1; --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.redou-pdf-text-layer .markedContent { display: contents; }
.redou-pdf-text-layer ::selection {
  background: color-mix(in srgb, #3b82f6, transparent 65%);
}
.redou-pdf-text-layer br::selection { background: transparent; }
`;
