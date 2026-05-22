import { FileText, Images, Sigma, Table2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "@/pdf-worker?worker&url";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import katex from "katex";
import "katex/dist/katex.min.css";

import { Tag } from "@/components/Tag";
import { LatexText, containsLatex } from "@/components/LatexText";
import { localeText } from "@/lib/locale";
import { toDesktopFileUrl, useDesktopRuntime, useResolvedDesktopFilePath } from "@/lib/desktop";
import { useFiguresByPaper, usePrimaryPaperFile } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper } from "@/types/paper";

import { cardStyle, eyebrowStyle, lightButtonStyle } from "./paperDetailStyles";
import { buildFallbackAnchor } from "./paperDetailUtils";

GlobalWorkerOptions.workerSrc = workerUrl;

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

export function PaperExtractedItemsTab({ paper, filterType = "figure" }: { paper: Paper; filterType?: "figure" | "table" | "equation" }) {
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
