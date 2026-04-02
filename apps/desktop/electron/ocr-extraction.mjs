/**
 * OCR-based table and equation extraction using GLM-OCR via Ollama.
 *
 * Strategy: Heuristic text extraction identifies WHICH pages contain tables/equations
 * and their numbering (e.g., "Table 1", "Eq. 3"). OCR then extracts the actual
 * structured content (HTML tables, LaTeX equations) from only those pages.
 *
 * Flow: Heuristic hints → filter pages → render to PNG (mupdf) → Ollama API → parse
 */

import * as mupdf from "mupdf";

const OLLAMA_BASE = process.env.OLLAMA_HOST || "http://localhost:11434";
const GLM_OCR_MODEL = process.env.REDOU_OCR_MODEL || "glm-ocr";

/* ------------------------------------------------------------------ */
/*  Render a single PDF page to PNG buffer using mupdf                 */
/* ------------------------------------------------------------------ */

// Ollama has a GGML tensor bug where certain image dimensions crash.
// 1.15 has fewest failures empirically; 1.0 and 1.2 as fallbacks.
const RENDER_SCALES = [1.15, 1.0, 1.3, 0.85, 1.5];

export function renderPageToPng(pdfBuffer, pageNumber, scale = RENDER_SCALES[0]) {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pageIndex = Math.min(pageNumber - 1, doc.countPages() - 1);
  const page = doc.loadPage(pageIndex);
  const matrix = mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  return Buffer.from(pixmap.asPNG());
}

/* ------------------------------------------------------------------ */
/*  Call Ollama GLM-OCR (with auto-retry on GGML dimension errors)     */
/* ------------------------------------------------------------------ */

async function callGlmOcrRaw(base64Image, prompt) {
  const url = `${OLLAMA_BASE}/api/generate`;
  const body = {
    model: GLM_OCR_MODEL,
    prompt,
    images: [base64Image],
    stream: false,
    options: {
      num_ctx: 10240,
      temperature: 0,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama GLM-OCR error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.response ?? "";
}

/** Call GLM-OCR with automatic scale retry on GGML errors. Returns { result, base64 }. */
async function callWithScaleRetry(pdfBuffer, pageNumber, prompt, knownBase64) {
  if (knownBase64) {
    return { result: await callGlmOcrRaw(knownBase64, prompt), base64: knownBase64 };
  }
  for (const scale of RENDER_SCALES) {
    try {
      const pngBuffer = renderPageToPng(pdfBuffer, pageNumber, scale);
      const base64 = pngBuffer.toString("base64");
      const result = await callGlmOcrRaw(base64, prompt);
      return { result, base64 };
    } catch (err) {
      if (err.message?.includes("GGML_ASSERT") || err.message?.includes("health resp")) {
        console.warn(`[ocr-extract] GGML error at scale ${scale} for page ${pageNumber}, trying next...`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`All render scales failed for page ${pageNumber}`);
}

/* ------------------------------------------------------------------ */
/*  Check if Ollama + GLM-OCR model is available                       */
/* ------------------------------------------------------------------ */

export async function isOllamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    const models = data.models ?? [];
    return models.some((m) => m.name.startsWith(GLM_OCR_MODEL));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Parse table HTML from OCR response                                 */
/* ------------------------------------------------------------------ */

const FULLPAGE_TABLE_PROMPT = `OCR this document page. Extract only data tables (with rows and columns of data).
Output each table as HTML <table> tags.
If there are no data tables on this page, output exactly: NO_TABLES`;

const CROPPED_TABLE_PROMPT = `This image contains exactly one data table from a scientific paper.
Convert it to a single HTML <table> element.
Rules:
- Use <thead> for header row(s) and <tbody> for ALL data rows.
- IMPORTANT: Include every data row below the header, not just the header.
- Use colspan/rowspan for merged cells.
- Preserve all numeric values exactly as shown.
- For subscripts use <sub>, for superscripts use <sup>.
- Empty cells: use empty <td></td>.
- Output only the <table> tag, no other text.
- If no table visible, output: NO_TABLES`;

/** Returns an array of all valid <table> HTML blocks from OCR response. */
function parseAllTablesFromResponse(text) {
  if (!text || text.includes("NO_TABLES")) return [];

  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const results = [];
  let match;

  while ((match = tableRegex.exec(text)) !== null) {
    const tableHtml = match[0];

    // Validate: reject non-data tables
    const thCount = (tableHtml.match(/<th[\s>]/gi) || []).length;
    const tdCount = (tableHtml.match(/<td[\s>]/gi) || []).length;
    const trCount = (tableHtml.match(/<tr[\s>]/gi) || []).length;

    if (thCount <= 1 && tdCount <= 1) continue;
    if (trCount <= 2 && thCount <= 1) continue;

    // Reject GLM-OCR's generic fake headers
    const lowerHtml = tableHtml.toLowerCase();
    const fakeHeaders = ["data label", "data description", "data value", "data element",
      "article info", "journal name", "abstract", "authors", "publication date"];
    if (fakeHeaders.some((h) => lowerHtml.includes(h))) continue;

    // Reject tables where >50% of cells are paragraph-length text
    const cellTexts = tableHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    const longCells = cellTexts.filter((c) => c.replace(/<[^>]+>/g, "").length > 200);
    if (longCells.length > cellTexts.length * 0.5) continue;

    results.push(tableHtml);
  }

  return results;
}

/**
 * Validate that a table HTML block contains real data, not just header duplication or truncation.
 * Returns false if the table is a "shell" (header-only, duplicated, or truncated).
 */
function validateTableHtml(html) {
  if (!html) return false;

  const theadMatch = html.match(/<thead[\s\S]*?<\/thead>/i);
  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/i);

  // Check 1: thead/tbody header duplication — first row text identical
  if (theadMatch && tbodyMatch) {
    const firstRow = (section) => {
      const tr = section.match(/<tr[\s\S]*?<\/tr>/i);
      if (!tr) return "";
      return (tr[0].match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [])
        .map((c) => c.replace(/<[^>]+>/g, "").trim())
        .join("|");
    };
    const headText = firstRow(theadMatch[0]);
    const bodyText = firstRow(tbodyMatch[0]);
    if (headText && bodyText && headText === bodyText) return false;
  }

  // Check 2: minimum data rows — tbody with <=1 row is a shell
  const tbodyTrCount = tbodyMatch
    ? (tbodyMatch[0].match(/<tr[\s>]/gi) || []).length
    : 0;
  const totalTrCount = (html.match(/<tr[\s>]/gi) || []).length;
  if (tbodyMatch && tbodyTrCount <= 1) return false;
  if (!tbodyMatch && totalTrCount <= 2) return false;

  // Check 3: data rows vs header rows — fewer data rows than header rows = likely truncated
  const theadTrCount = theadMatch
    ? (theadMatch[0].match(/<tr[\s>]/gi) || []).length
    : 0;
  const dataRows = tbodyMatch ? tbodyTrCount : totalTrCount - theadTrCount;
  if (dataRows > 0 && dataRows <= theadTrCount) return false;

  return true;
}

/* ------------------------------------------------------------------ */
/*  Parse equations from OCR response                                  */
/* ------------------------------------------------------------------ */

const EQUATION_PROMPT = `OCR this document page. Extract all mathematical equations.
For each equation, output the equation number (if visible) and the LaTeX representation.
Use $$ delimiters around each equation. Example:
(1) $$E = mc^2$$
If no equations exist, output: NO_EQUATIONS`;

function parseEquationsFromResponse(text) {
  if (!text || text.includes("NO_EQUATIONS")) return [];

  const foundLatex = [];
  let match;

  // Strategy 1: $$...$$ delimited
  const displayRegex = /\$\$([\s\S]+?)\$\$/g;
  while ((match = displayRegex.exec(text)) !== null) {
    let latex = match[1].trim();
    if (!latex) continue;
    const before = text.slice(Math.max(0, match.index - 30), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 20);
    const eqNum = before.match(/\((\d{1,3})\)\s*$/)?.[1] ?? after.match(/^\s*\((\d{1,3})\)/)?.[1] ?? null;
    foundLatex.push({ latex, eqNum });
  }

  // Strategy 2: \[...\] delimited
  if (foundLatex.length === 0) {
    const bracketRegex = /\\\[([\s\S]+?)\\\]/g;
    while ((match = bracketRegex.exec(text)) !== null) {
      let latex = match[1].trim();
      if (!latex) continue;
      const before = text.slice(Math.max(0, match.index - 30), match.index);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 20);
      const eqNum = before.match(/\((\d{1,3})\)\s*$/)?.[1] ?? after.match(/^\s*\((\d{1,3})\)/)?.[1] ?? null;
      foundLatex.push({ latex, eqNum });
    }
  }

  // Filter out junk
  return foundLatex.filter(({ latex }) => {
    if (latex.length > 300) return false;
    const plain = latex.replace(/\\[a-zA-Z]+/g, "").replace(/[{}^_$\\]/g, "");
    if (plain.length > 100 && !/[=<>]/.test(latex)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  Main: heuristic-guided OCR extraction                              */
/* ------------------------------------------------------------------ */

export async function extractTablesAndEquationsWithOcr(pdfBuffer, options = {}) {
  const available = await isOllamaAvailable();
  if (!available) {
    console.log("[ocr-extract] Ollama/GLM-OCR not available, skipping OCR extraction");
    return { tables: [], equations: [], ocrUsed: false };
  }

  const heuristicTables = options.heuristicTables ?? [];
  const heuristicEquations = options.heuristicEquations ?? [];

  if (heuristicTables.length === 0 && heuristicEquations.length === 0) {
    console.log("[ocr-extract] No heuristic hints — skipping OCR (nothing to extract)");
    return { tables: [], equations: [], ocrUsed: false };
  }

  // Build page → task mapping from heuristic hints
  // Key insight: only OCR pages where heuristic found something
  const pageJobs = new Map(); // page -> { tables: [...heuristicHints], equations: [...heuristicHints] }

  for (const t of heuristicTables) {
    if (!t.page) continue;
    if (!pageJobs.has(t.page)) pageJobs.set(t.page, { tables: [], equations: [] });
    pageJobs.get(t.page).tables.push(t);
  }
  for (const eq of heuristicEquations) {
    if (!eq.page) continue;
    if (!pageJobs.has(eq.page)) pageJobs.set(eq.page, { tables: [], equations: [] });
    pageJobs.get(eq.page).equations.push(eq);
  }

  const sortedPages = [...pageJobs.keys()].sort((a, b) => a - b);
  console.log(`[ocr-extract] Heuristic found: ${heuristicTables.length} tables, ${heuristicEquations.length} equations`);
  console.log(`[ocr-extract] OCR will process ${sortedPages.length} pages: [${sortedPages.join(", ")}]`);

  const allTables = [];
  const allEquations = [];

  for (const p of sortedPages) {
    const job = pageJobs.get(p);

    try {
      let workingBase64 = null;

      // --- Table extraction (per-table crop → individual OCR) ---
      if (job.tables.length > 0) {
        // Cache full-page fallback results to avoid duplicate API calls and duplicate HTML
        let fullPageOcrTables = null; // lazy: only computed if a crop fails
        let fullPageConsumed = 0;     // index tracker for 1:1 assignment from full-page results

        for (const hint of job.tables) {
          try {
            let tableHtml = null;

            // Strategy 1: Crop the table region and OCR the cropped image
            if (hint._captionY != null) {
              try {
                const croppedPng = cropTableRegion(pdfBuffer, p, {
                  captionY: hint._captionY,
                  bodyYEnd: hint._bodyYEnd,
                  xStart: hint._xStart,
                  xEnd: hint._xEnd,
                  pageWidth: hint._pageWidth,
                  splitX: hint._splitX,
                });
                const croppedBase64 = croppedPng.toString("base64");
                const croppedResult = await callGlmOcrRaw(croppedBase64, CROPPED_TABLE_PROMPT);
                const croppedTables = parseAllTablesFromResponse(croppedResult);
                if (croppedTables.length > 0 && validateTableHtml(croppedTables[0])) {
                  tableHtml = croppedTables[0];
                  console.log(`[ocr-extract] ${hint.figureNo} on page ${p}: cropped OCR success`);
                } else if (croppedTables.length > 0) {
                  console.warn(`[ocr-extract] ${hint.figureNo} on page ${p}: cropped OCR returned shell table, trying fallback`);
                }
              } catch (cropErr) {
                console.warn(`[ocr-extract] ${hint.figureNo} crop OCR failed:`, cropErr.message);
              }
            }

            // Strategy 2: Fallback to full-page render (cached, assigned by index)
            if (!tableHtml) {
              try {
                if (fullPageOcrTables === null) {
                  const { result, base64 } = await callWithScaleRetry(pdfBuffer, p, FULLPAGE_TABLE_PROMPT, workingBase64);
                  if (!workingBase64) workingBase64 = base64;
                  fullPageOcrTables = parseAllTablesFromResponse(result);
                }
                if (fullPageConsumed < fullPageOcrTables.length) {
                  const candidate = fullPageOcrTables[fullPageConsumed];
                  fullPageConsumed++;
                  if (validateTableHtml(candidate)) {
                    tableHtml = candidate;
                    console.log(`[ocr-extract] ${hint.figureNo} on page ${p}: full-page fallback [${fullPageConsumed}/${fullPageOcrTables.length}]`);
                  } else {
                    console.warn(`[ocr-extract] ${hint.figureNo} on page ${p}: full-page fallback also shell table, keeping heuristic text`);
                  }
                }
              } catch (fullErr) {
                console.warn(`[ocr-extract] ${hint.figureNo} full-page fallback failed:`, fullErr.message);
                fullPageOcrTables = []; // prevent retrying
              }
            }

            if (tableHtml) {
              allTables.push({
                figureNo: hint.figureNo,
                caption: hint.caption,
                page: p,
                summaryText: tableHtml,
                isKeyFigure: false,
                isPresentationCandidate: hint.isPresentationCandidate ?? false,
                itemType: "table",
              });
            }
          } catch (err) {
            console.warn(`[ocr-extract] Table OCR failed for ${hint.figureNo} on page ${p}:`, err.message);
          }
        }
      }

      // --- Equation extraction ---
      if (job.equations.length > 0) {
        try {
          const { result } = await callWithScaleRetry(pdfBuffer, p, EQUATION_PROMPT, workingBase64);
          const ocrEquations = parseEquationsFromResponse(result);

          if (ocrEquations.length > 0) {
            // Match OCR equations to heuristic hints by equation number
            const hintsByNum = new Map();
            for (const hint of job.equations) {
              const num = hint.figureNo.match(/\d+/)?.[0];
              if (num) hintsByNum.set(num, hint);
            }

            for (const ocrEq of ocrEquations) {
              // Try to match OCR equation number to a heuristic hint
              let matchedHint = null;
              if (ocrEq.eqNum && hintsByNum.has(ocrEq.eqNum)) {
                matchedHint = hintsByNum.get(ocrEq.eqNum);
                hintsByNum.delete(ocrEq.eqNum); // consume the hint
              }

              const figureNo = matchedHint
                ? matchedHint.figureNo
                : ocrEq.eqNum
                  ? `Eq. ${ocrEq.eqNum}`
                  : null; // skip unnumbered equations without heuristic match

              if (!figureNo) continue;

              allEquations.push({
                figureNo,
                caption: ocrEq.latex,
                page: p,
                summaryText: ocrEq.latex,
                isKeyFigure: false,
                isPresentationCandidate: false,
                itemType: "equation",
              });
            }

            // For heuristic hints that didn't match any OCR output,
            // try to assign remaining OCR equations (unnumbered ones)
            const unmatched = [...hintsByNum.values()];
            const unassignedOcr = ocrEquations.filter((e) => !e.eqNum);
            for (let i = 0; i < Math.min(unmatched.length, unassignedOcr.length); i++) {
              allEquations.push({
                figureNo: unmatched[i].figureNo,
                caption: unassignedOcr[i].latex,
                page: p,
                summaryText: unassignedOcr[i].latex,
                isKeyFigure: false,
                isPresentationCandidate: false,
                itemType: "equation",
              });
            }
          }
        } catch (err) {
          console.warn(`[ocr-extract] Equation OCR failed for page ${p}:`, err.message);
        }
      }

      if (allTables.length || allEquations.length) {
        const tOnPage = allTables.filter((t) => t.page === p).length;
        const eOnPage = allEquations.filter((e) => e.page === p).length;
        if (tOnPage || eOnPage) {
          console.log(`[ocr-extract] Page ${p}: ${tOnPage} tables, ${eOnPage} equations`);
        }
      }
    } catch (err) {
      console.warn(`[ocr-extract] Failed to process page ${p}:`, err.message);
    }
  }

  // Deduplicate by figureNo
  const seenTables = new Set();
  const uniqueTables = allTables.filter((t) => {
    if (seenTables.has(t.figureNo)) return false;
    seenTables.add(t.figureNo);
    return true;
  });

  const seenEqs = new Set();
  const uniqueEquations = allEquations.filter((e) => {
    if (seenEqs.has(e.figureNo)) return false;
    seenEqs.add(e.figureNo);
    return true;
  });

  console.log(`[ocr-extract] Done: ${uniqueTables.length} tables, ${uniqueEquations.length} equations`);

  return { tables: uniqueTables, equations: uniqueEquations, ocrUsed: true };
}

/* ------------------------------------------------------------------ */
/*  UniMERNet: equation image → LaTeX via local Docker server          */
/* ------------------------------------------------------------------ */

const UNIMERNET_BASE = process.env.REDOU_UNIMERNET_URL || "http://localhost:8010";

/**
 * Check if the UniMERNet OCR server is reachable.
 */
export async function isUniMERNetAvailable() {
  try {
    const res = await fetch(`${UNIMERNET_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Render a clipped region of a PDF page to PNG with structure-tree error resilience.
 * Strategy 1: runPageContents (fast, skips annotations).
 * Strategy 2: toDisplayList (structure-tree independent fallback).
 *
 * @param {object} page - mupdf Page object
 * @param {number[]} scaledClip - [x0, y0, x1, y1] in scaled pixel coordinates
 * @param {object} mat - mupdf Matrix (scale transform)
 * @returns {Buffer} PNG buffer
 */
function renderClippedRegion(page, scaledClip, mat) {
  // Strategy 1: Direct clipped render via runPageContents
  try {
    const clipPx = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, scaledClip, false);
    clipPx.clear(255);
    const dev = new mupdf.DrawDevice(mat, clipPx);
    page.runPageContents(dev, mupdf.Matrix.identity);
    dev.close();
    const png = Buffer.from(clipPx.asPNG());
    // Sanity check: a blank/broken render produces a very small PNG
    if (png.length > 256) return png;
    console.warn(`[crop] Suspiciously small PNG (${png.length} bytes), trying display list fallback`);
  } catch (err) {
    console.warn(`[crop] runPageContents failed: ${err.message}, trying display list fallback`);
  }

  // Strategy 2: Display list (structure-tree independent)
  const list = page.toDisplayList(false);
  const clipPx2 = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, scaledClip, false);
  clipPx2.clear(255);
  const dev2 = new mupdf.DrawDevice(mat, clipPx2);
  list.run(dev2, mupdf.Matrix.identity);
  dev2.close();
  return Buffer.from(clipPx2.asPNG());
}

/**
 * Crop a region around an equation from a PDF page using mupdf.
 * Uses x-coordinates from pdfjs line data to focus on the equation area,
 * avoiding body text from adjacent columns in multi-column layouts.
 *
 * @param {Buffer} pdfBuffer - Full PDF file buffer
 * @param {number} pageNumber - 1-based page number
 * @param {number} pdfjsLineY - Y coordinate from pdfjs (origin at bottom-left)
 * @param {object} [opts] - Optional x-coordinate hints
 * @param {number} [opts.xStart] - pdfjs line xStart
 * @param {number} [opts.xEnd] - pdfjs line xEnd
 * @param {number} [opts.pageWidth] - pdfjs page width
 * @returns {Buffer} PNG image buffer of the cropped region
 */
export function cropEquationRegion(pdfBuffer, pageNumber, pdfjsLineY, opts = {}) {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pageIndex = Math.min(pageNumber - 1, doc.countPages() - 1);
  const page = doc.loadPage(pageIndex);
  const bounds = page.getBounds(); // [x0, y0, x1, y1], y0=top in mupdf
  const pageWidth = bounds[2] - bounds[0];
  const pageHeight = bounds[3] - bounds[1];

  // Convert pdfjs Y (origin bottom-left) → mupdf Y (origin top-left)
  const mupdfY = pageHeight - pdfjsLineY;

  // Use dynamic vertical extent if available (multi-line equation support),
  // otherwise fall back to fixed padding.
  let clipY0, clipY1;
  if (opts.yTop != null && opts.yBottom != null && opts.yTop !== opts.yBottom) {
    // Dynamic: use scanned extent from adjacent lines + generous margin
    const mupdfYTop = pageHeight - opts.yTop;     // highest line (smallest mupdf Y)
    const mupdfYBottom = pageHeight - opts.yBottom; // lowest line (largest mupdf Y)
    const yMin = Math.min(mupdfYTop, mupdfYBottom);
    const yMax = Math.max(mupdfYTop, mupdfYBottom);
    clipY0 = Math.max(bounds[1], yMin - 15);
    clipY1 = Math.min(bounds[3], yMax + 20);
  } else {
    // Fixed fallback
    const PADDING_ABOVE = 12; // points
    const PADDING_BELOW = 18; // points
    clipY0 = Math.max(bounds[1], mupdfY - PADDING_ABOVE);
    clipY1 = Math.min(bounds[3], mupdfY + PADDING_BELOW);
  }

  // Determine horizontal crop from line x-coordinates
  // Use column boundary as hard cutoff to exclude adjacent-column body text
  let clipX0 = bounds[0];
  let clipX1 = bounds[2];

  if (opts.xStart != null && opts.xEnd != null && opts.pageWidth > 0) {
    // Use detected column boundary if available, otherwise assume page center
    const colBoundary = opts.splitX ?? opts.pageWidth / 2;
    const xCenter = (opts.xStart + opts.xEnd) / 2;
    const X_PAD = 15;

    if (xCenter > colBoundary) {
      // Right column equation: hard cutoff at column boundary
      clipX0 = Math.max(bounds[0] + colBoundary - X_PAD, opts.xStart - 30);
      clipX1 = Math.min(bounds[2], opts.xEnd + X_PAD);
    } else if (opts.xEnd < colBoundary + 30) {
      // Left column equation: hard cutoff at column boundary
      clipX0 = Math.max(bounds[0], opts.xStart - X_PAD);
      clipX1 = Math.min(bounds[0] + colBoundary + X_PAD, opts.xEnd + 30);
    } else {
      // Centered/full-width equation: use tight bounds with padding
      clipX0 = Math.max(bounds[0], opts.xStart - 30);
      clipX1 = Math.min(bounds[2], opts.xEnd + X_PAD);
    }

    // Ensure minimum width of 200pt
    const minWidth = 200;
    const currentWidth = clipX1 - clipX0;
    if (currentWidth < minWidth) {
      const center = (clipX0 + clipX1) / 2;
      clipX0 = Math.max(bounds[0], center - minWidth / 2);
      clipX1 = Math.min(bounds[2], center + minWidth / 2);
    }
  }

  const scale = 3; // high-res for OCR accuracy
  const mat = mupdf.Matrix.scale(scale, scale);

  const scaledClip = [
    Math.round(clipX0 * scale),
    Math.round(clipY0 * scale),
    Math.round(clipX1 * scale),
    Math.round(clipY1 * scale),
  ];

  return renderClippedRegion(page, scaledClip, mat);
}

/**
 * Crop a region around a table from a PDF page using mupdf.
 * Uses caption Y and body-end Y from heuristic extraction to determine vertical bounds.
 * For horizontal bounds, uses caption x-coordinates to detect column position.
 *
 * @param {Buffer} pdfBuffer - Full PDF file buffer
 * @param {number} pageNumber - 1-based page number
 * @param {object} opts - Coordinate hints from heuristic extraction
 * @param {number} opts.captionY - pdfjs Y of caption line (origin bottom-left)
 * @param {number} [opts.bodyYEnd] - pdfjs Y of last body line (lower on page = smaller Y)
 * @param {number} [opts.xStart] - pdfjs caption xStart
 * @param {number} [opts.xEnd] - pdfjs caption xEnd
 * @param {number} [opts.pageWidth] - pdfjs page width
 * @returns {Buffer} PNG image buffer of the cropped table region
 */
export function cropTableRegion(pdfBuffer, pageNumber, opts = {}) {
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pageIndex = Math.min(pageNumber - 1, doc.countPages() - 1);
  const page = doc.loadPage(pageIndex);
  const bounds = page.getBounds(); // [x0, y0, x1, y1], y0=top in mupdf
  const pageWidth = bounds[2] - bounds[0];
  const pageHeight = bounds[3] - bounds[1];

  // Convert pdfjs Y (origin bottom-left) → mupdf Y (origin top-left)
  const captionMupdfY = pageHeight - (opts.captionY ?? pageHeight / 2);

  // Table typically extends below the caption.
  // If bodyYEnd is available, use it; otherwise estimate ~40% of page height below caption.
  let bodyEndMupdfY;
  if (opts.bodyYEnd != null && opts.bodyYEnd !== opts.captionY) {
    bodyEndMupdfY = pageHeight - opts.bodyYEnd;
  } else {
    // Fallback: assume table extends ~200pt below caption
    bodyEndMupdfY = captionMupdfY + 200;
  }

  // Ensure captionY is above bodyYEnd (smaller mupdf Y = higher on page)
  const yTop = Math.min(captionMupdfY, bodyEndMupdfY);
  const yBottom = Math.max(captionMupdfY, bodyEndMupdfY);

  // Generous padding: tables have ruled lines and footnotes beyond text bounds
  const PAD_ABOVE = 20;  // space above caption for table top border
  const PAD_BELOW = 50;  // space below last body line for table bottom border + footnotes
  const clipY0 = Math.max(bounds[1], yTop - PAD_ABOVE);
  const clipY1 = Math.min(bounds[3], yBottom + PAD_BELOW);

  // Determine horizontal crop — full page width for tables (they're usually full-column)
  // but respect column boundaries for 2-column layouts
  let clipX0 = bounds[0];
  let clipX1 = bounds[2];

  if (opts.xStart != null && opts.xEnd != null && opts.pageWidth > 0) {
    const colBoundary = opts.splitX ?? opts.pageWidth / 2;
    const xCenter = (opts.xStart + opts.xEnd) / 2;
    const COL_PAD = 10;

    if (xCenter > colBoundary) {
      // Right column: crop from near column boundary to right edge
      clipX0 = Math.max(bounds[0], bounds[0] + colBoundary - COL_PAD);
      clipX1 = bounds[2];
    } else if (opts.xEnd < colBoundary + 30) {
      // Left column: crop from left edge to near column boundary
      clipX0 = bounds[0];
      clipX1 = Math.min(bounds[2], bounds[0] + colBoundary + COL_PAD);
    }
    // else: full-width table, use full page width (default)
  }

  const scale = 2.5; // high-res for OCR accuracy
  const mat = mupdf.Matrix.scale(scale, scale);

  const scaledClip = [
    Math.round(clipX0 * scale),
    Math.round(clipY0 * scale),
    Math.round(clipX1 * scale),
    Math.round(clipY1 * scale),
  ];

  return renderClippedRegion(page, scaledClip, mat);
}

/**
 * Clean up UniMERNet LaTeX output.
 * Extracts the core equation from array wrappers and removes body-text noise.
 */
function cleanUniMERNetLatex(raw) {
  if (!raw || !raw.trim()) return null;
  let latex = raw.trim();

  // Strip $$ delimiters so trailing-pattern anchors ($) work correctly
  if (latex.startsWith("$$") && latex.endsWith("$$") && latex.length > 4) {
    latex = latex.slice(2, -2).trim();
  } else if (latex.startsWith("$") && latex.endsWith("$") && latex.length > 2) {
    latex = latex.slice(1, -1).trim();
  }

  // Remove trailing equation number tags in various forms
  // Allow spaces within digits (OCR sometimes adds spaces: "1 2" instead of "12")
  latex = latex.replace(/\\eqno\s*\(\s*[\d\s]{1,5}\s*\)/g, "");
  latex = latex.replace(/\s*\\mathrm\s*\{\s*~?\s*\(\s*[\d\s]{1,5}\s*\)\s*~?\s*\}\s*/g, " ");
  latex = latex.replace(/\s*\(\s*[\d\s]{1,5}\s*\)\s*$/g, "");

  // If wrapped in \begin{array}, try to extract the best math cell
  if (/\\begin\s*\{\s*array\s*\}/.test(latex)) {
    const extracted = extractBestCellFromArray(latex);
    if (extracted) {
      latex = extracted;
    } else {
      // No valid cell found in array → entire result is garbage
      return null;
    }
  }

  // Incomplete array remnant (\begin without \end) — strip the wrapper
  if (/\\begin\s*\{array\}/.test(latex) && !/\\end\s*\{array\}/.test(latex)) {
    latex = latex.replace(/\\begin\s*\{array\}\s*\{[^}]*\}\s*/, "");
    latex = latex.replace(/\{?\{?\s*$/, ""); // trailing incomplete braces
  }

  // Remove excessive tilde (~) spacing noise from OCR
  latex = latex.replace(/(~\s*){4,}/g, " ");
  latex = latex.replace(/^(~\s*)+/g, "").replace(/(~\s*)+$/g, "");

  // Remove excessive \; \, \! spacing noise
  latex = latex.replace(/(\\[;,!]\s*){5,}/g, " ");
  latex = latex.replace(/^(\\[;,!]\s*)+/g, "").replace(/(\\[;,!]\s*)+$/g, "");

  // Remove excessive \quad / \qquad padding
  latex = latex.replace(/(\\qquad\s*){3,}/g, " ");
  latex = latex.replace(/(\\quad\s*){4,}/g, " ");
  latex = latex.replace(/^\s*\\q(?:q?uad)\s*/g, "").replace(/\s*\\q(?:q?uad)\s*$/g, "");

  // Remove stray \mathrm{text} fragments that are body text (>15 chars with spaces)
  latex = latex.replace(/\\mathrm\s*\{[^}]{15,}\}/g, "");

  // Remove trailing \mathrm noise: short word fragments at end of equation
  // e.g. \mathrm{of}, \mathrm{cand}, \mathrm{{kinhe}}, \mathrm{~ \ \ } \alpha
  // These are OCR artifacts from adjacent body text bleeding into the crop.
  // Use [\s{]* to handle nested braces with spaces like \mathrm { { k i n h e } }
  // Allow optional trailing stray token (e.g. \alpha after \mathrm{~})
  latex = latex.replace(/\s*\\mathrm\s*[\s{]*[a-zA-Z~\\][a-zA-Z\s~\\]{0,12}[\s}]*(?:\s*\\?[a-zA-Z]{1,8})?\s*$/g, "");
  // Also remove trailing \quad(s) + \mathrm noise inline
  latex = latex.replace(/(\s*\\quad\s*)+\\mathrm\s*[\s{]*[a-zA-Z~\\][a-zA-Z\s~\\]{0,12}[\s}]*(?:\s*\\?[a-zA-Z]{1,8})?/g, "");

  // Remove leading/trailing & or \\ (line breaks) from array extraction
  // Be careful not to strip single backslash (LaTeX command prefix)
  latex = latex.replace(/^(\s*&\s*)+/g, "").replace(/^(\s*\\\\\s*)+/g, "");
  latex = latex.replace(/(\s*&\s*)+$/g, "").replace(/(\s*\\\\\s*)+$/g, "");

  // Iteratively strip trailing noise: short fragments, \quad padding, equation numbers.
  // Multiple passes needed because removing one layer exposes the next.
  for (let pass = 0; pass < 3; pass++) {
    const before = latex;
    // Remove trailing short noise: isolated "0 ." or ". 5" fragments (not part of math)
    // Only match if preceded by whitespace and the fragment is purely digits/dots/spaces
    latex = latex.replace(/\s{2,}[\d\s.]{1,4}\s*$/g, "");
    // Remove trailing \quad / \qquad padding
    latex = latex.replace(/(\s*\\q(?:q?uad)\s*)+$/g, "");
    // Remove trailing equation numbers like (1), ( 1 2 )
    latex = latex.replace(/\s*\(\s*[\d\s]{1,5}\s*\)\s*$/g, "");
    if (latex === before) break;
  }

  latex = latex.trim();
  // Reject if too short or no math content
  if (latex.length < 5) return null;
  if (!/[=<>]/.test(latex)) return null; // must contain an operator
  // Very short result without any LaTeX commands is likely broken heuristic text, not math
  if (latex.length < 15 && !/\\[a-zA-Z]/.test(latex)) return null;

  return latex;
}

/**
 * Extract the most "math-like" cell from a \begin{array} LaTeX block.
 * Scores each cell by math content density and returns the best one.
 */
function extractBestCellFromArray(latex) {
  // Remove outer \begin{array}{...} ... \end{array}
  const inner = latex
    .replace(/^\s*\{?\s*\\begin\s*\{\s*array\s*\}\s*\{[^}]*\}/g, "")
    .replace(/\\end\s*\{\s*array\s*\}\s*\}?\s*$/g, "");

  // Split by & and \\ to get individual cells
  const cells = inner
    .split(/(?:\\\\|&)/)
    .map((c) => c.trim())
    .filter((c) => c.length > 2);

  if (cells.length === 0) return null;

  // Score each cell by math content
  function mathScore(cell) {
    let score = 0;
    // Penalize body text (\mathrm with spaces inside)
    const textMatches = cell.match(/\\mathrm\s*\{[^}]*\s[^}]*\}/g) || [];
    score -= textMatches.length * 50;
    // Reward math operators and structures
    if (/[=<>]/.test(cell)) score += 20;
    if (/\\frac/.test(cell)) score += 15;
    if (/[_^]/.test(cell)) score += 10;
    if (/\\(sum|int|prod|lim|partial|Delta|alpha|beta|rho|infty)/.test(cell)) score += 10;
    if (/\\left|\\right/.test(cell)) score += 5;
    // Reward reasonable length (not too short, not too long)
    if (cell.length > 10 && cell.length < 300) score += 10;
    // Penalize cells that are just numbers or spacing
    if (/^\s*\{?\s*\d+\s*\}?\s*$/.test(cell)) score -= 100;
    if (/^\s*\\qquad/.test(cell)) score -= 20;
    // Penalize cells that are mostly body text
    const totalLen = cell.length;
    const textLen = (cell.match(/\\mathrm\s*\{[^}]*\}/g) || []).join("").length;
    if (textLen > totalLen * 0.5) score -= 30;
    return score;
  }

  const scored = cells.map((c) => ({ cell: c, score: mathScore(c) }));
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < 0) return null;

  // Clean up the extracted cell
  let result = best.cell;
  // Remove leading/trailing braces if they're wrapper braces
  if (result.startsWith("{") && result.endsWith("}")) {
    const inner = result.slice(1, -1);
    // Only unwrap if the braces are balanced
    let depth = 0;
    let balanced = true;
    for (const ch of inner) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth < 0) { balanced = false; break; }
    }
    if (balanced && depth === 0) result = inner;
  }

  return result.trim() || null;
}

/**
 * Enhance equation captions using UniMERNet.
 * Crops each equation region from the PDF, sends to UniMERNet, returns LaTeX.
 *
 * @param {Buffer} pdfBuffer - Full PDF file buffer
 * @param {Array} equations - Heuristic equations with _lineY and page fields
 * @returns {Array<{figureNo: string, latex: string}>} Enhanced equations
 */
export async function enhanceEquationsWithUniMERNet(pdfBuffer, equations) {
  if (!equations || equations.length === 0) return [];

  const available = await isUniMERNetAvailable();
  if (!available) {
    console.log("[unimernet] UniMERNet server not available, skipping equation enhancement");
    return [];
  }

  console.log(`[unimernet] Enhancing ${equations.length} equations with UniMERNet...`);

  // Crop all equation regions
  const croppedImages = [];
  for (const eq of equations) {
    if (!eq.page || eq._lineY == null) {
      croppedImages.push(null);
      continue;
    }
    try {
      const png = cropEquationRegion(pdfBuffer, eq.page, eq._lineY, {
        xStart: eq._xStart,
        xEnd: eq._xEnd,
        pageWidth: eq._pageWidth,
        yTop: eq._yTop,
        yBottom: eq._yBottom,
        splitX: eq._splitX,
      });
      croppedImages.push(png.toString("base64"));
    } catch (err) {
      console.warn(`[unimernet] Failed to crop ${eq.figureNo}:`, err.message);
      croppedImages.push(null);
    }
  }

  // Collect valid (non-null) images with their original indices
  const validIndices = croppedImages
    .map((img, i) => (img ? i : -1))
    .filter((i) => i >= 0);

  if (validIndices.length === 0) {
    console.log("[unimernet] No equation regions could be cropped");
    return [];
  }

  const results = [];
  const validImages = validIndices.map((i) => croppedImages[i]);

  // Send in batches of 64 (server limit)
  const BATCH_SIZE = 64;
  for (let batchStart = 0; batchStart < validImages.length; batchStart += BATCH_SIZE) {
    const batch = validImages.slice(batchStart, batchStart + BATCH_SIZE);
    const batchIndices = validIndices.slice(batchStart, batchStart + BATCH_SIZE);

    try {
      const res = await fetch(`${UNIMERNET_BASE}/predict/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: batch }),
        signal: AbortSignal.timeout(120_000), // 2min timeout for large batches
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[unimernet] Batch request failed: ${res.status} ${text}`);
        continue;
      }

      const data = await res.json();
      for (let j = 0; j < data.results.length; j++) {
        const eqIndex = batchIndices[j];
        const raw = data.results[j];
        const latex = cleanUniMERNetLatex(raw);
        if (latex) {
          results.push({
            figureNo: equations[eqIndex].figureNo,
            latex,
          });
        }
      }

      console.log(
        `[unimernet] Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ` +
          `${data.results.length} equations → LaTeX in ${data.elapsed_ms}ms`,
      );
    } catch (err) {
      console.warn(`[unimernet] Batch request error:`, err.message);
    }
  }

  console.log(`[unimernet] Done: ${results.length}/${equations.length} equations enhanced`);
  return results;
}
