/**
 * V2 OCR fallback for MinerU table gaps.
 *
 * MinerU remains the single structural PDF pipeline. This module only keeps the
 * GLM-OCR path used to fill empty table bodies after a V2 extraction succeeds.
 */

import * as mupdf from "mupdf";
import { flattenTableHtml } from "./mineru-client.mjs";

const OLLAMA_BASE = process.env.OLLAMA_HOST || "http://localhost:11434";
const GLM_OCR_MODEL = process.env.REDOU_OCR_MODEL || "glm-ocr";

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
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama GLM-OCR error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.response ?? "";
}

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
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`All render scales failed for page ${pageNumber}`);
}

export async function isOllamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    const models = data.models ?? [];
    return models.some((model) => model.name.startsWith(GLM_OCR_MODEL));
  } catch {
    return false;
  }
}

const FULLPAGE_TABLE_PROMPT = `OCR this document page. Extract only data tables (with rows and columns of data).
Output each table as HTML <table> tags.
If there are no data tables on this page, output exactly: NO_TABLES`;

function parseAllTablesFromResponse(text) {
  if (!text || text.includes("NO_TABLES")) return [];

  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const results = [];
  let match;

  while ((match = tableRegex.exec(text)) !== null) {
    const tableHtml = match[0];
    const thCount = (tableHtml.match(/<th[\s>]/gi) || []).length;
    const tdCount = (tableHtml.match(/<td[\s>]/gi) || []).length;
    const trCount = (tableHtml.match(/<tr[\s>]/gi) || []).length;

    if (thCount <= 1 && tdCount <= 1) continue;
    if (trCount <= 2 && thCount <= 1) continue;

    const lowerHtml = tableHtml.toLowerCase();
    const fakeHeaders = [
      "data label",
      "data description",
      "data value",
      "data element",
      "article info",
      "journal name",
      "abstract",
      "authors",
      "publication date",
    ];
    if (fakeHeaders.some((header) => lowerHtml.includes(header))) continue;

    const cellTexts = tableHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    const longCells = cellTexts.filter((cell) => cell.replace(/<[^>]+>/g, "").length > 200);
    if (longCells.length > cellTexts.length * 0.5) continue;

    results.push(tableHtml);
  }

  return results;
}

function validateTableHtml(html) {
  if (!html) return false;

  const theadMatch = html.match(/<thead[\s\S]*?<\/thead>/i);
  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/i);

  if (theadMatch && tbodyMatch) {
    const firstRow = (section) => {
      const tr = section.match(/<tr[\s\S]*?<\/tr>/i);
      if (!tr) return "";
      return (tr[0].match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) || [])
        .map((cell) => cell.replace(/<[^>]+>/g, "").trim())
        .join("|");
    };
    const headText = firstRow(theadMatch[0]);
    const bodyText = firstRow(tbodyMatch[0]);
    if (headText && bodyText && headText === bodyText) return false;
  }

  const tbodyTrCount = tbodyMatch
    ? (tbodyMatch[0].match(/<tr[\s>]/gi) || []).length
    : 0;
  const totalTrCount = (html.match(/<tr[\s>]/gi) || []).length;
  if (tbodyMatch && tbodyTrCount <= 1) return false;
  if (!tbodyMatch && totalTrCount <= 2) return false;

  const theadTrCount = theadMatch
    ? (theadMatch[0].match(/<tr[\s>]/gi) || []).length
    : 0;
  const dataRows = tbodyMatch ? tbodyTrCount : totalTrCount - theadTrCount;
  if (dataRows > 0 && dataRows <= theadTrCount) return false;

  return true;
}

/**
 * Fill empty MinerU table bodies with full-page GLM-OCR.
 *
 * @param {Buffer} pdfBuffer
 * @param {Array<{figureNo: string, page: number}>} emptyTables
 * @returns {Promise<Array<{figureNo: string, page: number, summaryText: string, plainText: string}>>}
 */
export async function enhanceEmptyTablesWithOcr(pdfBuffer, emptyTables) {
  const available = await isOllamaAvailable();
  if (!available) {
    console.log("[ocr-extract] Ollama/GLM-OCR not available, skipping V2 empty-table fallback");
    return [];
  }

  if (!emptyTables || emptyTables.length === 0) return [];

  const byPage = new Map();
  for (const table of emptyTables) {
    if (!table.page) continue;
    if (!byPage.has(table.page)) byPage.set(table.page, []);
    byPage.get(table.page).push(table);
  }

  const results = [];

  for (const [page, tables] of byPage) {
    try {
      const { result } = await callWithScaleRetry(pdfBuffer, page, FULLPAGE_TABLE_PROMPT);
      const ocrTables = parseAllTablesFromResponse(result);

      let consumed = 0;
      for (const table of tables) {
        if (consumed >= ocrTables.length) break;
        const candidate = ocrTables[consumed];
        consumed += 1;

        if (validateTableHtml(candidate)) {
          results.push({
            figureNo: table.figureNo,
            page,
            summaryText: candidate,
            plainText: flattenTableHtml(candidate),
          });
          console.log(`[ocr-extract] V2 fallback: ${table.figureNo} on page ${page} enhanced via full-page OCR`);
        } else {
          console.warn(`[ocr-extract] V2 fallback: ${table.figureNo} on page ${page} OCR returned shell table, skipping`);
        }
      }
    } catch (err) {
      console.warn(`[ocr-extract] V2 fallback failed for page ${page}:`, err.message);
    }
  }

  return results;
}
