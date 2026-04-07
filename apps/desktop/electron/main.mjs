import "dotenv/config";
import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { IPC_CHANNELS, IPC_EVENTS } from "./types/ipc-channels.mjs";
import { createClient } from "@supabase/supabase-js";
import zlib from "node:zlib";
import { extractHeuristicPaperData, inspectPdfMetadata, extractFigureImagesFromPdf } from "./pdf-heuristics.mjs";
import { generateEmbedding, generateEmbeddings, generateImageEmbedding, MODEL_NAME, EMBEDDING_DIM } from "./embedding-worker.mjs";
import { waitForOAuthCallback, getOAuthCallbackUrl } from "./oauth-callback-server.mjs";
import { extractTablesAndEquationsWithOcr, isOllamaAvailable, enhanceEquationsWithUniMERNet } from "./ocr-extraction.mjs";
import { isMineruAvailable, parsePdf, parseMineruResult, flattenTableHtml, flattenEquationLatex, saveFigureImages, saveTableImages } from "./mineru-client.mjs";
import { isGrobidAvailable, extractMetadataAndReferences, linkReferencesToExistingPapers } from "./grobid-client.mjs";
import { streamChat, checkGroundedness, isLlmAvailable, isGuardianAvailable, getActiveModel, setActiveModel, OLLAMA_BASE_URL } from "./llm-chat.mjs";
import { generateOrchestratorPlan, generateTableFromSpec, extractMatrixFromHtml } from "./llm-orchestrator.mjs";
import { generateQaResponse, formatSourceAttribution } from "./llm-qa.mjs";
import { parseAllHtmlTables } from "./html-table-parser.mjs";

// ============================================================
// Paths
// ============================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rendererUrl = process.env.REDOU_RENDERER_URL ?? "http://127.0.0.1:4173";
const legacyRendererUrl = process.env.REDOU_LEGACY_RENDERER_URL ?? "http://127.0.0.1:5173";
const frontendDistPath = path.resolve(__dirname, "../../../frontend/dist/index.html");
const desktopDistPath = path.resolve(__dirname, "../dist/index.html");

// Library root: ~/Documents/Redou/Library
const LIBRARY_ROOT = path.join(app.getPath("documents"), "Redou", "Library");

// ============================================================
// Minimal PNG encoder (no external deps)
// ============================================================
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}

function crc32Buf(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Buf(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodeRgbaPng(width, height, rgbaData) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    const src = y * stride;
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgbaData[src + x];
  }
  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", Buffer.alloc(0))]);
}

// ============================================================
// Supabase Client (local)
// ============================================================
const SUPABASE_URL = process.env.REDOU_SUPABASE_URL ?? "http://127.0.0.1:55321";
// Main process uses service_role key to bypass RLS (trusted backend context)
const SUPABASE_SERVICE_KEY = process.env.REDOU_SUPABASE_SERVICE_KEY ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================================
// Window Management
// ============================================================
let mainWindow = null;
const detachedWindows = new Map();
const PROCESSING_POLL_INTERVAL_MS = 2500;
let processingInterval = null;
let extractionInFlight = false;
let embeddingInFlight = false;

// Bump this number whenever extraction logic changes (new item types, better parsing, etc.)
// Papers with extraction_version < CURRENT_EXTRACTION_VERSION will be auto-requeued on startup.
const CURRENT_EXTRACTION_VERSION = 23;
const DB_QUERY_TABLES = new Set([
  "app_users",
  "papers",
  "paper_files",
  "paper_sections",
  "paper_chunks",
  "paper_summaries",
  "figures",
  "folders",
  "paper_folders",
  "tags",
  "paper_tags",
  "notes",
  "highlight_presets",
  "highlights",
  "processing_jobs",
  "user_workspace_preferences",
  "backup_snapshots",
  "paper_references",
  "chunk_embeddings",
  "highlight_embeddings",
  "figure_chunk_links",
  "chat_conversations",
  "chat_messages",
  "chat_generated_tables",
]);
const DB_MUTATE_TABLES = new Set([
  "papers",
  "paper_files",
  "paper_sections",
  "paper_chunks",
  "paper_summaries",
  "figures",
  "folders",
  "paper_folders",
  "tags",
  "paper_tags",
  "notes",
  "highlight_presets",
  "highlights",
  "processing_jobs",
  "user_workspace_preferences",
  "backup_snapshots",
  "paper_references",
  "chunk_embeddings",
  "highlight_embeddings",
  "figure_chunk_links",
  "chat_conversations",
  "chat_messages",
  "chat_generated_tables",
]);

function resolvePackagedRendererPath() {
  if (existsSync(frontendDistPath)) {
    return frontendDistPath;
  }

  if (existsSync(desktopDistPath)) {
    return desktopDistPath;
  }

  return null;
}

function resolveRendererTarget() {
  if (process.env.REDOU_RENDERER_URL) {
    return { type: "url", value: rendererUrl };
  }

  if (!app.isPackaged) {
    return { type: "url", value: rendererUrl };
  }

  const packagedRendererPath = resolvePackagedRendererPath();
  if (packagedRendererPath) {
    return { type: "file", value: packagedRendererPath };
  }

  return { type: "url", value: legacyRendererUrl };
}

function attachRendererFallback(win, loadPackagedRenderer, label) {
  const packagedRendererPath = resolvePackagedRendererPath();
  if (!packagedRendererPath) {
    return;
  }

  let hasFallenBack = false;
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || hasFallenBack || win.isDestroyed()) {
      return;
    }

    hasFallenBack = true;
    console.warn(`[renderer-fallback] ${label} failed to load ${validatedUrl} (${errorCode}: ${errorDescription}). Falling back to ${packagedRendererPath}.`);
    loadPackagedRenderer(packagedRendererPath);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#eef1f4",
    title: "Redou",
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  const rendererTarget = resolveRendererTarget();

  if (rendererTarget.type === "file") {
    mainWindow.loadFile(rendererTarget.value);
  } else {
    attachRendererFallback(mainWindow, (packagedRendererPath) => {
      mainWindow?.loadFile(packagedRendererPath);
    }, "main-window renderer");
    mainWindow.loadURL(rendererTarget.value);
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Block all navigation away — SPA has no browser history
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ============================================================
// Helpers
// ============================================================
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\.+$/, "")
    .replace(/\s+$/g, "")
    .slice(0, 100);
}

async function computeSha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function broadcastToWindows(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }

  for (const win of detachedWindows.values()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizePaperTitle(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function looksFilenameLikeTitle(value) {
  const raw = String(value ?? "").trim();
  const normalized = normalizePaperTitle(raw);

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("s2.0") ||
    (/\bmain\b/.test(normalized) && /\d/.test(normalized)) ||
    /(?:^|\s)\d{5,}(?:\s|$)/.test(normalized) ||
    ((raw.includes("_") || raw.includes("-")) && normalized.split(/\s+/).length <= 8)
  );
}

function shouldReplacePaperTitle(currentTitle, derivedTitle) {
  const next = String(derivedTitle ?? "").trim();
  const current = String(currentTitle ?? "").trim();

  if (!next) {
    return false;
  }

  if (!current) {
    return true;
  }

  if (normalizePaperTitle(current) === normalizePaperTitle(next)) {
    return false;
  }

  if (looksFilenameLikeTitle(current) && !looksFilenameLikeTitle(next)) {
    return true;
  }

  return next.length >= current.length + 10 && !looksFilenameLikeTitle(next);
}

function assertAllowedTable(table, allowedTables, operationName) {
  if (!allowedTables.has(table)) {
    throw new Error(`${operationName} is not allowed for table: ${table}`);
  }
}

function normalizeAbsolutePath(inputPath, label = "Path") {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error(`${label} is required.`);
  }

  const resolvedPath = path.resolve(inputPath);
  if (!path.isAbsolute(resolvedPath)) {
    throw new Error(`${label} must be an absolute path.`);
  }

  return resolvedPath;
}

function isWithinDirectory(parentDir, targetPath) {
  const relative = path.relative(parentDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertLibraryPath(filePath, label = "File path") {
  const resolvedPath = normalizeAbsolutePath(filePath, label);
  const resolvedRoot = path.resolve(LIBRARY_ROOT);

  if (!isWithinDirectory(resolvedRoot, resolvedPath)) {
    throw new Error(`${label} must stay inside the Redou library.`);
  }

  return resolvedPath;
}

async function ensurePaperSummary(paperId, userId) {
  const { data: existing, error: existingError } = await supabase
    .from("paper_summaries")
    .select("id")
    .eq("paper_id", paperId)
    .eq("is_current", true)
    .limit(1);

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing && existing.length > 0) {
    return;
  }

  const { error: summaryError } = await supabase.from("paper_summaries").insert({
    paper_id: paperId,
    created_by_user_id: userId,
    source_type: "system",
    is_current: true,
    one_line_summary: "Imported PDF is ready for reader review.",
    objective: "This record was prepared by the first desktop import worker and is now ready for the next reader-focused phase.",
    method_summary: "The worker verified the stored PDF, checked the primary file record, and refreshed the paper metadata surface.",
    main_results: "No section, figure, or embedding extraction has run yet in this slice.",
    limitations: "PDF.js parsing and deeper ingestion are still pending.",
  });

  if (summaryError) {
    throw new Error(summaryError.message);
  }
}

function summarizeText(value, maxLength = 320) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) {
    return null;
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}...` : normalized;
}

function sectionTextByName(sections, names) {
  for (const name of names) {
    const section = sections.find((candidate) => candidate.sectionName === name);
    if (section?.rawText) {
      return section.rawText;
    }
  }

  return null;
}

function describeExtractionMode(extracted) {
  if (extracted.ocrUsed) {
    return extracted.layoutMode === "ocr-text" ? "OCR-backed extraction" : "OCR-backed layout-aware extraction";
  }

  if (extracted.extractionMode === "layout-aware") {
    return extracted.layoutMode === "two-column" ? "layout-aware two-column extraction" : "layout-aware PDF extraction";
  }

  return "heuristic PDF text extraction";
}

function buildHeuristicSummaryPayload(extracted) {
  const extractionLabel = describeExtractionMode(extracted);
  const objective = summarizeText(sectionTextByName(extracted.sections, ["Abstract", "Introduction"]) ?? extracted.abstractText, 380);
  const methodFallback = extracted.ocrUsed
    ? "OCR-backed extraction rasterized scanned pages with local desktop tools, recovered readable text, and staged an initial section/chunk structure from the imported file."
    : extracted.extractionMode === "layout-aware"
      ? "Layout-aware PDF extraction reordered readable page text, respected multi-column reading order when detected, and staged an initial section/chunk structure from the imported file."
      : "Fallback heuristic PDF extraction parsed readable text blocks and staged an initial section/chunk structure from the imported file.";
  const methodSummary = summarizeText(sectionTextByName(extracted.sections, ["Method", "Experiments"]) ?? methodFallback, 380);
  const mainResults = summarizeText(
    sectionTextByName(extracted.sections, ["Results", "Discussion"]) ?? extracted.figures[0]?.caption ?? extracted.abstractText,
    380,
  );
  const limitationsFallback = extracted.ocrUsed
    ? "This pass used local OCR and layout-aware ordering, but it still lacks precise bounding boxes, figure crops, and embeddings."
    : extracted.extractionMode === "layout-aware"
      ? "This pass uses layout-aware PDF.js text ordering, but scanned or image-only PDFs still need local OCR tools for fuller recovery."
      : "This is still a fallback heuristic extraction from raw PDF text. Layout-aware parsing, OCR, and embeddings need further improvement.";
  const limitations = summarizeText(sectionTextByName(extracted.sections, ["Conclusion"]) ?? limitationsFallback, 380);

  return {
    one_line_summary:
      extracted.sections.length > 0 || extracted.figures.length > 0 || (extracted.tables && extracted.tables.length > 0)
        ? `${extractionLabel} staged ${extracted.sections.length} sections, ${extracted.chunks.length} chunks, ${extracted.figures.length} figures, ${(extracted.tables ?? []).length} tables, and ${(extracted.equations ?? []).length} equations.`
        : extracted.ocrAvailable
          ? "Imported PDF is ready, but the document still needs stronger OCR recovery to expose richer structure."
          : "Imported PDF is ready, but no strong text structure was detected yet.",
    objective,
    method_summary: methodSummary,
    main_results: mainResults,
    limitations,
  };
}

async function upsertCurrentPaperSummary(paperId, userId, extracted) {
  const summaryPayload = buildHeuristicSummaryPayload(extracted);
  const { data: existing, error: existingError } = await supabase
    .from("paper_summaries")
    .select("id")
    .eq("paper_id", paperId)
    .eq("is_current", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing?.id) {
    const { error } = await supabase
      .from("paper_summaries")
      .update({
        ...summaryPayload,
        source_type: "system",
        created_by_user_id: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  const { error } = await supabase.from("paper_summaries").insert({
    paper_id: paperId,
    created_by_user_id: userId,
    source_type: "system",
    is_current: true,
    ...summaryPayload,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function persistHeuristicExtraction({ paperId, userId, sourceFileId, storedPath, paperTitle, currentAbstract, currentPublicationYear, onProgress }) {
  const pdfBuffer = await fs.readFile(storedPath);
  const extracted = await extractHeuristicPaperData(pdfBuffer, paperTitle, { pdfPath: storedPath });

  const { error: deleteChunksError } = await supabase.from("paper_chunks").delete().eq("paper_id", paperId);
  if (deleteChunksError) {
    throw new Error(deleteChunksError.message);
  }

  const { error: deleteFiguresError } = await supabase.from("figures").delete().eq("paper_id", paperId);
  if (deleteFiguresError) {
    throw new Error(deleteFiguresError.message);
  }

  const { error: deleteSectionsError } = await supabase.from("paper_sections").delete().eq("paper_id", paperId);
  if (deleteSectionsError) {
    throw new Error(deleteSectionsError.message);
  }

  const { error: deleteRefsError } = await supabase.from("paper_references").delete().eq("paper_id", paperId);
  if (deleteRefsError) {
    throw new Error(deleteRefsError.message);
  }

  const sectionIdByOrder = new Map();

  if (extracted.sections.length > 0) {
    const { data: sectionRows, error: sectionError } = await supabase
      .from("paper_sections")
      .insert(
        extracted.sections.map((section) => ({
          paper_id: paperId,
          section_name: section.sectionName,
          section_order: section.sectionOrder,
          page_start: section.pageStart ?? null,
          page_end: section.pageEnd ?? null,
          raw_text: section.rawText,
          parser_confidence: section.parserConfidence,
        })),
      )
      .select("id, section_order");

    if (sectionError) {
      throw new Error(sectionError.message);
    }

    for (const row of sectionRows ?? []) {
      sectionIdByOrder.set(row.section_order, row.id);
    }

    onProgress?.({ progress: 54, message: `${extracted.sections.length} sections extracted.` });
  }

  if (extracted.chunks.length > 0) {
    const { error: chunkError } = await supabase.from("paper_chunks").insert(
      extracted.chunks.map((chunk) => ({
        paper_id: paperId,
        section_id: sectionIdByOrder.get(chunk.sectionOrder) ?? null,
        chunk_order: chunk.chunkOrder,
        page: chunk.page ?? null,
        text: chunk.text,
        token_count: chunk.tokenCount,
        start_char_offset: chunk.startCharOffset,
        end_char_offset: chunk.endCharOffset,
        parser_confidence: chunk.parserConfidence,
      })),
    );

    if (chunkError) {
      throw new Error(chunkError.message);
    }

    onProgress?.({ progress: 57, message: `${extracted.chunks.length} text chunks extracted.` });
  }

  if (extracted.figures.length > 0) {
    // Extract embedded figure images from the PDF
    let figureImageMap = new Map();
    try {
      const figureImages = await extractFigureImagesFromPdf(pdfBuffer, extracted.figures);
      if (figureImages.length > 0) {
        const figureDir = path.join(LIBRARY_ROOT, "Figures", paperId);
        await fs.mkdir(figureDir, { recursive: true });

        for (const fi of figureImages) {
          if (!fi.rgbaData || !fi.width || !fi.height) continue;
          const safeName = fi.figureNo.replace(/[^a-zA-Z0-9]/g, "_");
          const imagePath = path.join(figureDir, `${safeName}.png`);
          const pngBuffer = encodeRgbaPng(fi.width, fi.height, fi.rgbaData);
          await fs.writeFile(imagePath, pngBuffer);
          figureImageMap.set(fi.figureNo, imagePath);
        }

        console.log("[figure-images] saved", figureImageMap.size, "figure images for paper", paperId);
      }
    } catch (imgErr) {
      console.warn("[figure-images] extraction failed, continuing without images:", imgErr?.message ?? imgErr);
    }

    const { error: figureError } = await supabase.from("figures").insert(
      extracted.figures.map((figure) => ({
        paper_id: paperId,
        source_file_id: sourceFileId,
        figure_no: figure.figureNo,
        caption: figure.caption,
        page: figure.page ?? null,
        image_path: figureImageMap.get(figure.figureNo) ?? null,
        summary_text: figure.summaryText,
        is_key_figure: figure.isKeyFigure,
        is_presentation_candidate: figure.isPresentationCandidate,
      })),
    );

    if (figureError) {
      throw new Error(figureError.message);
    }

    onProgress?.({ progress: 62, message: `${extracted.figures.length} figures extracted.` });
  }

  // Persist extracted tables
  if (extracted.tables && extracted.tables.length > 0) {
    const { error: tableError } = await supabase.from("figures").insert(
      extracted.tables.map((table) => ({
        paper_id: paperId,
        source_file_id: sourceFileId,
        figure_no: table.figureNo,
        caption: table.caption,
        page: table.page ?? null,
        image_path: null,
        summary_text: table.summaryText,
        is_key_figure: false,
        is_presentation_candidate: table.isPresentationCandidate,
        item_type: "table",
      })),
    );

    if (tableError) {
      throw new Error(tableError.message);
    }

    onProgress?.({ progress: 65, message: `${extracted.tables.length} tables extracted.` });
  }

  // Persist extracted equations
  if (extracted.equations && extracted.equations.length > 0) {
    const { error: equationError } = await supabase.from("figures").insert(
      extracted.equations.map((eq) => ({
        paper_id: paperId,
        source_file_id: sourceFileId,
        figure_no: eq.figureNo,
        caption: eq.caption,
        page: eq.page ?? null,
        image_path: null,
        summary_text: eq.summaryText,
        is_key_figure: false,
        is_presentation_candidate: false,
        item_type: "equation",
      })),
    );

    if (equationError) {
      throw new Error(equationError.message);
    }

    onProgress?.({ progress: 68, message: `${extracted.equations.length} equations extracted.` });
  }

  const paperPatch = {
    updated_at: new Date().toISOString(),
    extraction_version: CURRENT_EXTRACTION_VERSION,
  };
  let shouldUpdatePaper = true;

  if ((!currentAbstract || !currentAbstract.trim()) && extracted.abstractText) {
    paperPatch.abstract = extracted.abstractText;
    shouldUpdatePaper = true;
  }

  if (shouldReplacePaperTitle(paperTitle, extracted.derivedTitle)) {
    paperPatch.title = extracted.derivedTitle.trim();
    paperPatch.normalized_title = normalizePaperTitle(extracted.derivedTitle);
    shouldUpdatePaper = true;
  }

  if (!currentPublicationYear && extracted.publicationYear) {
    paperPatch.publication_year = extracted.publicationYear;
    shouldUpdatePaper = true;
  }

  if (extracted.authors && extracted.authors.length > 0) {
    paperPatch.authors = extracted.authors;
    shouldUpdatePaper = true;
  }

  if (shouldUpdatePaper) {
    const { error: paperUpdateError } = await supabase.from("papers").update(paperPatch).eq("id", paperId);

    if (paperUpdateError) {
      throw new Error(paperUpdateError.message);
    }
  }

  await upsertCurrentPaperSummary(paperId, userId, extracted);

  return {
    extractedTextLength: extracted.extractedTextLength,
    sectionCount: extracted.sections.length,
    chunkCount: extracted.chunks.length,
    figureCount: extracted.figures.length,
    tableCount: (extracted.tables ?? []).length,
    equationCount: (extracted.equations ?? []).length,
    heuristicTables: extracted.tables ?? [],
    heuristicEquations: extracted.equations ?? [],
    resolvedTitle: paperPatch.title ?? null,
    extractionMode: extracted.extractionMode ?? "heuristic-fallback",
    layoutMode: extracted.layoutMode ?? "unknown",
    ocrAvailable: Boolean(extracted.ocrAvailable),
    ocrUsed: Boolean(extracted.ocrUsed),
    ocrProvider: extracted.ocrProvider ?? null,
    scannedLikelihood: extracted.scannedLikelihood ?? null,
  };
}

// ============================================================
// Pipeline V2: MinerU + GROBID
// ============================================================

function mergeMetadata({ grobid, mineruSections, fallbackTitle, currentPaper }) {
  const gm = grobid || {};
  const title = gm.title || mineruSections?.[0]?.sectionName || fallbackTitle || "";
  const abstract = gm.abstract || currentPaper?.abstract || "";
  const authors = (gm.authors && gm.authors.length > 0) ? gm.authors : (currentPaper?.authors || []);
  const doi = gm.doi || "";
  const year = gm.year || currentPaper?.publication_year || null;
  const journal = gm.journal || "";
  return { title, abstract, authors, doi, year, journal };
}

function crossValidateV2(parsed, pdfjsData) {
  if (!parsed || !pdfjsData) return;
  const v2TableCount = parsed.tables?.length ?? 0;
  const pdfjsTableCount = pdfjsData.tables?.length ?? 0;
  if (pdfjsTableCount > 0 && v2TableCount === 0) {
    console.warn(`[v2-crossval] MinerU found 0 tables but pdfjs heuristic found ${pdfjsTableCount}`);
  }
  const v2EqCount = parsed.equations?.length ?? 0;
  const pdfjsEqCount = pdfjsData.equations?.length ?? 0;
  if (pdfjsEqCount > 0 && v2EqCount === 0) {
    console.warn(`[v2-crossval] MinerU found 0 equations but pdfjs heuristic found ${pdfjsEqCount}`);
  }
  const v2SectionCount = parsed.sections?.length ?? 0;
  const pdfjsSectionCount = pdfjsData.sections?.length ?? 0;
  if (Math.abs(v2SectionCount - pdfjsSectionCount) > 5) {
    console.warn(`[v2-crossval] Section count mismatch: MinerU=${v2SectionCount}, pdfjs=${pdfjsSectionCount}`);
  }
}

async function persistV2Results({
  paperId, userId, sourceFileId, metadata,
  sections, chunks, tables, equations, figures, references,
  storedPath, mineruImages,
}) {
  // Delete existing data for this paper
  await supabase.from("paper_chunks").delete().eq("paper_id", paperId);
  await supabase.from("figures").delete().eq("paper_id", paperId);
  await supabase.from("paper_sections").delete().eq("paper_id", paperId);
  await supabase.from("paper_references").delete().eq("paper_id", paperId);

  // --- Sections ---
  const sectionIdByOrder = new Map();
  if (sections.length > 0) {
    const { data: sectionRows, error: sectionError } = await supabase
      .from("paper_sections")
      .insert(
        sections.map((s) => ({
          paper_id: paperId,
          section_name: s.sectionName,
          section_order: s.sectionOrder,
          page_start: s.pageStart ?? null,
          page_end: s.pageEnd ?? null,
          raw_text: s.rawText,
          parser_confidence: s.parserConfidence ?? null,
        })),
      )
      .select("id, section_order");

    if (sectionError) throw new Error(sectionError.message);
    for (const row of sectionRows ?? []) {
      sectionIdByOrder.set(row.section_order, row.id);
    }
  }

  // --- Chunks (with ID return for figure_chunk_links) ---
  const chunkIdByOrder = new Map();
  if (chunks.length > 0) {
    const { data: chunkRows, error: chunkError } = await supabase
      .from("paper_chunks")
      .insert(
        chunks.map((c) => ({
          paper_id: paperId,
          section_id: sectionIdByOrder.get(c.sectionOrder) ?? null,
          chunk_order: c.chunkOrder,
          page: c.page ?? null,
          text: c.text,
          token_count: c.tokenCount,
          start_char_offset: c.startCharOffset,
          end_char_offset: c.endCharOffset,
          parser_confidence: c.parserConfidence ?? null,
        })),
      )
      .select("id, chunk_order");

    if (chunkError) throw new Error(chunkError.message);
    for (const row of chunkRows ?? []) {
      chunkIdByOrder.set(row.chunk_order, row.id);
    }
  }

  // --- Figures (images) ---
  const figureImageMap = new Map();
  if (figures.length > 0) {
    try {
      const saved = await saveFigureImages(paperId, figures, LIBRARY_ROOT);
      for (const [k, v] of saved) figureImageMap.set(k, v);
    } catch (err) {
      console.warn("[v2] Figure image save failed:", err.message);
    }

    // Also try pdfjs extraction as fallback for figures without images
    const figuresWithoutImages = figures.filter((f) => !figureImageMap.has(f.figureNo));
    if (figuresWithoutImages.length > 0 && storedPath) {
      try {
        const pdfBuffer = await fs.readFile(storedPath);
        // Pass figures as figureCandidates shape
        const candidates = figuresWithoutImages.map((f) => ({
          figureNo: f.figureNo,
          page: f.page ?? 1,
          caption: f.caption || "",
        }));
        const pdfjsImages = await extractFigureImagesFromPdf(pdfBuffer, candidates);
        for (const fi of pdfjsImages) {
          if (fi.jpegBuffer || fi.rgbaData) {
            const safeName = fi.figureNo.replace(/[^a-zA-Z0-9]/g, "_");
            const figureDir = path.join(LIBRARY_ROOT, "Figures", paperId);
            await fs.mkdir(figureDir, { recursive: true });
            if (fi.rgbaData && fi.width && fi.height) {
              const p = path.join(figureDir, `${safeName}.png`);
              await fs.writeFile(p, encodeRgbaPng(fi.width, fi.height, fi.rgbaData));
              figureImageMap.set(fi.figureNo, p);
            }
          }
        }
      } catch (err) {
        console.warn("[v2] pdfjs figure fallback failed:", err.message);
      }
    }

    const { error: figError } = await supabase.from("figures").insert(
      figures.map((f) => ({
        paper_id: paperId,
        source_file_id: sourceFileId,
        figure_no: f.figureNo,
        caption: f.caption || null,
        page: f.page ?? null,
        image_path: figureImageMap.get(f.figureNo) ?? null,
        summary_text: null,
        is_key_figure: false,
        is_presentation_candidate: false,
        item_type: "figure",
      })),
    );
    if (figError) throw new Error(figError.message);
  }

  // --- Tables ---
  const tableImageMap = new Map();
  if (tables.length > 0 && mineruImages) {
    try {
      const saved = await saveTableImages(paperId, tables, mineruImages, LIBRARY_ROOT);
      for (const [k, v] of saved) tableImageMap.set(k, v);
    } catch (err) {
      console.warn("[v2] Table image save failed:", err.message);
    }
  }
  if (tables.length > 0) {
    const { error: tabError } = await supabase.from("figures").insert(
      tables.map((t) => ({
        paper_id: paperId,
        source_file_id: sourceFileId,
        figure_no: t.figureNo,
        caption: t.caption || null,
        page: t.page ?? null,
        image_path: tableImageMap.get(t.figureNo) ?? null,
        summary_text: t.html || t.summaryText || null,
        plain_text: t.plainText || null,
        is_key_figure: false,
        is_presentation_candidate: false,
        item_type: "table",
      })),
    );
    if (tabError) throw new Error(tabError.message);
  }

  // --- Equations ---
  if (equations.length > 0) {
    const { error: eqError } = await supabase.from("figures").insert(
      equations.map((eq) => ({
        paper_id: paperId,
        source_file_id: sourceFileId,
        figure_no: eq.figureNo,
        caption: eq.caption || null,
        page: eq.page ?? null,
        image_path: null,
        summary_text: eq.summaryText || null,
        plain_text: eq.plainText || null,
        is_key_figure: false,
        is_presentation_candidate: false,
        item_type: "equation",
      })),
    );
    if (eqError) throw new Error(eqError.message);
  }

  // --- figure_chunk_links (테이블/수식 → 가장 가까운 청크 연결) ---
  const allFigureItems = [...tables, ...equations];
  if (allFigureItems.length > 0 && chunkIdByOrder.size > 0) {
    // 각 테이블/수식의 페이지에 해당하는 청크 찾기
    const { data: insertedFigures } = await supabase
      .from("figures")
      .select("id, figure_no, page, item_type")
      .eq("paper_id", paperId)
      .in("item_type", ["table", "equation"]);

    if (insertedFigures && insertedFigures.length > 0) {
      const chunksByPage = new Map();
      for (const c of chunks) {
        if (c.page != null) {
          if (!chunksByPage.has(c.page)) chunksByPage.set(c.page, []);
          chunksByPage.get(c.page).push(c);
        }
      }

      const links = [];
      for (const fig of insertedFigures) {
        const pageChunks = chunksByPage.get(fig.page) || [];
        if (pageChunks.length > 0) {
          const chunkId = chunkIdByOrder.get(pageChunks[0].chunkOrder);
          if (chunkId) {
            links.push({ figure_id: fig.id, chunk_id: chunkId, link_type: "contains" });
          }
        }
      }

      if (links.length > 0) {
        const { error: linkError } = await supabase.from("figure_chunk_links").insert(links);
        if (linkError) console.warn("[v2] figure_chunk_links insert error:", linkError.message);
      }
    }
  }

  // --- References ---
  if (references.length > 0) {
    const linkedRefs = await linkReferencesToExistingPapers(references, supabase);
    const { error: refError } = await supabase.from("paper_references").insert(
      linkedRefs.map((r) => ({
        paper_id: paperId,
        ref_order: r.order,
        ref_title: r.title || null,
        ref_authors: r.authors || [],
        ref_year: r.year || null,
        ref_journal: r.journal || null,
        ref_doi: r.doi || null,
        ref_volume: r.volume || null,
        ref_pages: r.pages || null,
        ref_raw_text: r.rawText || null,
        linked_paper_id: r.linked_paper_id || null,
      })),
    );
    if (refError) throw new Error(refError.message);
  }

  // --- Update paper metadata ---
  const paperPatch = {
    updated_at: new Date().toISOString(),
    extraction_version: CURRENT_EXTRACTION_VERSION,
    extraction_source: "mineru+grobid",
  };
  if (metadata.title) {
    paperPatch.title = metadata.title;
    paperPatch.normalized_title = normalizePaperTitle(metadata.title);
  }
  if (metadata.abstract) paperPatch.abstract = metadata.abstract;
  if (metadata.year) paperPatch.publication_year = metadata.year;
  if (metadata.doi) paperPatch.doi = metadata.doi;
  if (metadata.journal) {
    // "저널명 / 출판사" 형식 (publisher가 있고 journal과 다를 때)
    let journalDisplay = metadata.journal;
    if (metadata.publisher && metadata.publisher.toLowerCase() !== metadata.journal.toLowerCase()) {
      journalDisplay = `${metadata.journal} / ${metadata.publisher}`;
    }
    paperPatch.journal_name = journalDisplay;
  }
  if (metadata.authors && metadata.authors.length > 0) paperPatch.authors = metadata.authors;

  const { error: paperUpdateError } = await supabase.from("papers").update(paperPatch).eq("id", paperId);
  if (paperUpdateError) throw new Error(paperUpdateError.message);

  // --- Paper summary ---
  await upsertPaperSummaryV2(paperId, userId, sections, metadata);

  return {
    sectionCount: sections.length,
    chunkCount: chunks.length,
    figureCount: figures.length,
    tableCount: tables.length,
    equationCount: equations.length,
    referenceCount: references.length,
  };
}

async function upsertPaperSummaryV2(paperId, userId, sections, metadata) {
  const sectionText = (names) => {
    const s = sections.find((sec) => names.some((n) => sec.sectionName.toLowerCase().includes(n.toLowerCase())));
    return s?.rawText?.slice(0, 380) || "";
  };

  const oneLine = `V2 extraction: ${sections.length} sections, from MinerU+GROBID.`;
  const objective = sectionText(["abstract", "introduction"]) || metadata.abstract?.slice(0, 380) || "";
  const methodSummary = sectionText(["method", "experiment", "material"]) || "";
  const mainResults = sectionText(["result", "discussion"]) || "";
  const limitations = sectionText(["conclusion", "limitation"]) || "";

  const summaryPayload = {
    one_line_summary: oneLine,
    objective,
    method_summary: methodSummary,
    main_results: mainResults,
    limitations,
  };

  const { data: existing } = await supabase
    .from("paper_summaries")
    .select("id")
    .eq("paper_id", paperId)
    .eq("is_current", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await supabase.from("paper_summaries").update({
      ...summaryPayload,
      source_type: "system",
      created_by_user_id: userId,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    await supabase.from("paper_summaries").insert({
      paper_id: paperId,
      created_by_user_id: userId,
      source_type: "system",
      is_current: true,
      ...summaryPayload,
    });
  }
}

async function processWithMineruGrobid({
  paperId, userId, sourceFileId, storedPath, paperTitle, currentPaper, onProgress,
}) {
  const pdfBuffer = await fs.readFile(storedPath);

  // Phase 1: 병렬 추출 (MinerU + GROBID)
  onProgress?.({ progress: 15, message: "MinerU + GROBID 병렬 추출 중..." });

  const [mineruResult, grobidResult] = await Promise.allSettled([
    parsePdf(pdfBuffer, { backend: "pipeline", lang: "en" }),
    extractMetadataAndReferences(pdfBuffer),
  ]);

  const mineruOk = mineruResult.status === "fulfilled";
  const grobidOk = grobidResult.status === "fulfilled";

  if (!mineruOk) {
    console.error("[pipeline-v2] MinerU failed:", mineruResult.reason?.message || mineruResult.reason);
    return null; // 폴백 시그널
  }

  // Phase 2: MinerU 파싱
  onProgress?.({ progress: 35, message: "추출 결과 파싱 중..." });
  const parsed = parseMineruResult(mineruResult.value);
  const grobid = grobidOk ? grobidResult.value : null;

  console.log(`[pipeline-v2] MinerU v${mineruResult.value.version}: ${parsed.sections.length} sections, ${parsed.tables.length} tables, ${parsed.equations.length} equations, ${parsed.figures.length} figures (${mineruResult.value.processingTime}ms)`);
  if (grobid) {
    console.log(`[pipeline-v2] GROBID: ${grobid.references.length} references, title="${grobid.metadata.title?.slice(0, 50)}" (${grobid.processingTime}ms)`);
  }

  // Phase 3: pdfjs 교차검증
  onProgress?.({ progress: 45, message: "교차 검증 중..." });
  try {
    const pdfjsData = await extractHeuristicPaperData(pdfBuffer, paperTitle);
    crossValidateV2(parsed, pdfjsData);
  } catch (err) {
    console.warn("[pipeline-v2] pdfjs cross-validation failed:", err.message);
  }

  // Phase 4: 메타데이터 병합
  onProgress?.({ progress: 50, message: "메타데이터 병합 중..." });
  const metadata = mergeMetadata({
    grobid: grobid?.metadata,
    mineruSections: parsed.sections,
    fallbackTitle: paperTitle,
    currentPaper,
  });

  // Phase 5: DB 저장 + 이미지 저장
  onProgress?.({ progress: 55, message: "DB 저장 중..." });
  const result = await persistV2Results({
    paperId, userId, sourceFileId, metadata,
    sections: parsed.sections,
    chunks: parsed.chunks,
    tables: parsed.tables,
    equations: parsed.equations,
    figures: parsed.figures,
    references: grobid?.references ?? [],
    storedPath,
    mineruImages: mineruResult.value.images,
  });

  onProgress?.({ progress: 70, message: `V2 추출 완료: ${result.sectionCount}섹션, ${result.tableCount}테이블, ${result.equationCount}수식, ${result.referenceCount}참고문헌` });

  return result;
}

async function updateJobStatus(jobId, patch) {
  const { error } = await supabase.from("processing_jobs").update(patch).eq("id", jobId);
  if (error) {
    throw new Error(error.message);
  }
}

async function processImportPdfJob(job) {
  if (!job.source_path) {
    throw new Error("Queued job is missing a source_path.");
  }

  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id,
    paperId: job.paper_id,
    status: "running",
    progress: 10,
    message: "Queued import picked up by the desktop worker.",
  });

  await sleep(250);
  await fs.access(job.source_path);

  const { data: paperRow, error: paperError } = await supabase
    .from("papers")
    .select("id, title, abstract, publication_year")
    .eq("id", job.paper_id)
    .maybeSingle();

  if (paperError || !paperRow) {
    throw new Error(paperError?.message ?? "The paper row could not be loaded for this processing job.");
  }

  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id,
    paperId: job.paper_id,
    status: "running",
    progress: 28,
    message: "Stored PDF verified inside the desktop library.",
  });

  const { data: primaryFiles, error: fileError } = await supabase
    .from("paper_files")
    .select("id, stored_path")
    .eq("paper_id", job.paper_id)
    .eq("is_primary", true)
    .limit(1);

  if (fileError) {
    throw new Error(fileError.message);
  }

  const primaryFile = primaryFiles?.[0];
  if (!primaryFile) {
    throw new Error("Primary paper file is missing for this processing job.");
  }

  const resolvedStoredPath = assertLibraryPath(primaryFile.stored_path ?? job.source_path, "Primary paper file path");
  await fs.access(resolvedStoredPath);

  // --- Pipeline V2: try MinerU + GROBID first ---
  let usedV2 = false;
  const mineruAvailable = await isMineruAvailable();
  if (mineruAvailable) {
    try {
      broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
        jobId: job.id, paperId: job.paper_id, status: "running",
        progress: 15, message: "Pipeline V2: MinerU + GROBID 시작...",
      });

      const v2Result = await processWithMineruGrobid({
        paperId: job.paper_id,
        userId: job.user_id ?? null,
        sourceFileId: primaryFile.id,
        storedPath: resolvedStoredPath,
        paperTitle: paperRow.title ?? "",
        currentPaper: paperRow,
        onProgress: ({ progress, message }) => {
          broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
            jobId: job.id, paperId: job.paper_id, status: "running", progress, message,
          });
        },
      });

      if (v2Result) {
        usedV2 = true;
        console.log(`[process] V2 pipeline succeeded: ${v2Result.sectionCount} sections, ${v2Result.tableCount} tables, ${v2Result.equationCount} equations, ${v2Result.referenceCount} references`);

        broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
          jobId: job.id, paperId: job.paper_id, status: "running",
          progress: 75, message: `V2 완료: ${v2Result.sectionCount}섹션, ${v2Result.chunkCount}청크, ${v2Result.figureCount}그림, ${v2Result.tableCount}테이블, ${v2Result.equationCount}수식, ${v2Result.referenceCount}참고문헌`,
        });

        // Mark job succeeded and queue embeddings
        await updateJobStatus(job.id, {
          status: "succeeded",
          finished_at: new Date().toISOString(),
          error_message: null,
        });

        broadcastToWindows(IPC_EVENTS.JOB_COMPLETED, {
          jobId: job.id, paperId: job.paper_id,
          result: { paperId: job.paper_id, status: "succeeded", ...v2Result, pipelineVersion: "v2" },
        });

        // Queue embedding generation
        if (v2Result.chunkCount > 0) {
          await supabase.from("processing_jobs").insert({
            paper_id: job.paper_id,
            user_id: job.user_id,
            job_type: "generate_embeddings",
            status: "queued",
            source_path: resolvedStoredPath,
          });
        }
        return; // V2 성공 — 여기서 종료
      }
    } catch (v2Err) {
      console.warn(`[process] V2 pipeline failed, falling back to V1:`, v2Err.message);
    }
  } else {
    console.log("[process] MinerU not available, using V1 pipeline");
  }

  // --- Pipeline V1 fallback: heuristic + GLM-OCR + UniMERNet ---
  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id,
    paperId: job.paper_id,
    status: "running",
    progress: 52,
    message: "Running layout-aware extraction and checking OCR fallback for scanned pages.",
  });

  const extractionResult = await persistHeuristicExtraction({
    paperId: job.paper_id,
    userId: job.user_id ?? null,
    sourceFileId: primaryFile.id,
    storedPath: resolvedStoredPath,
    paperTitle: paperRow.title ?? "",
    currentAbstract: paperRow.abstract ?? "",
    currentPublicationYear: paperRow.publication_year ?? null,
    onProgress: ({ progress, message }) => {
      broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
        jobId: job.id,
        paperId: job.paper_id,
        status: "running",
        progress,
        message,
      });
    },
  });

  await sleep(150);

  // --- OCR-based table/equation extraction via GLM-OCR ---
  let ocrTableCount = 0;
  let ocrEquationCount = 0;
  let glmEquationMap = null; // Map<figureNo, latex> — held for UniMERNet merge
  try {
    broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
      jobId: job.id,
      paperId: job.paper_id,
      status: "running",
      progress: 72,
      message: "Running AI-based table and equation extraction (GLM-OCR)...",
    });

    const pdfBuffer = await fs.readFile(resolvedStoredPath);
    const ocrResult = await extractTablesAndEquationsWithOcr(pdfBuffer, {
      heuristicTables: extractionResult.heuristicTables,
      heuristicEquations: extractionResult.heuristicEquations,
    });

    // --- Per-item merge: GLM-OCR results enhance heuristic baseline ---
    if (ocrResult.ocrUsed) {
      // Tables: update each matched table's summary_text with HTML
      if (ocrResult.tables.length > 0) {
        let tableUpdated = 0;
        for (const t of ocrResult.tables) {
          const { error } = await supabase
            .from("figures")
            .update({ summary_text: t.summaryText })
            .eq("paper_id", job.paper_id)
            .eq("figure_no", t.figureNo)
            .eq("item_type", "table");
          if (!error) tableUpdated++;
        }
        ocrTableCount = tableUpdated;
        console.log(`[process] GLM-OCR enhanced ${tableUpdated}/${ocrResult.tables.length} tables with HTML`);

        broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
          jobId: job.id, paperId: job.paper_id, status: "running",
          progress: 74, message: `${tableUpdated} tables enhanced with AI-OCR.`,
        });
      }

      // Equations: store GLM-OCR LaTeX results for later merge with UniMERNet
      if (ocrResult.equations.length > 0) {
        glmEquationMap = new Map();
        for (const eq of ocrResult.equations) {
          glmEquationMap.set(eq.figureNo, eq.summaryText);
        }
        console.log(`[process] GLM-OCR extracted ${glmEquationMap.size} equations (held for UniMERNet merge)`);

        broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
          jobId: job.id, paperId: job.paper_id, status: "running",
          progress: 76, message: `${glmEquationMap.size} equations extracted by GLM-OCR.`,
        });
      }
    }
  } catch (ocrErr) {
    console.warn(`[process] OCR extraction failed (non-fatal):`, ocrErr.message);
  }

  // --- Equation enhancement: UniMERNet (primary) + GLM-OCR (fallback) ---
  // UniMERNet produces high-quality LaTeX from cropped equation images.
  // GLM-OCR reads the full page and extracts equations — less precise but no crop failures.
  // Strategy: Use UniMERNet result when available and valid; fall back to GLM-OCR otherwise.
  let unimernetEnhanced = 0;
  let glmFallbackUsed = 0;
  try {
    const heuristicEqs = extractionResult.heuristicEquations ?? [];
    if (heuristicEqs.length > 0) {
      broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
        jobId: job.id,
        paperId: job.paper_id,
        status: "running",
        progress: 78,
        message: `Enhancing ${heuristicEqs.length} equations with UniMERNet (image → LaTeX)...`,
      });

      const pdfBuf = await fs.readFile(resolvedStoredPath);
      const enhanced = await enhanceEquationsWithUniMERNet(pdfBuf, heuristicEqs);

      // Build a set of UniMERNet-enhanced equation numbers for tracking
      const unimernetResults = new Map();
      for (const { figureNo, latex } of enhanced) {
        unimernetResults.set(figureNo, latex);
      }

      // --- Equation LaTeX quality gate ---
      function isGoodEquationLatex(latex) {
        if (!latex || latex.length < 8) return false;
        if (!/[=<>]/.test(latex)) return false;

        // Array blocks that survived cleanUniMERNetLatex need extra scrutiny
        if (/\\begin\s*\{array\}/.test(latex)) {
          // Prose contamination: 3+ consecutive lowercase words outside \mathrm/\text
          // Strip \mathrm{...} and \text{...} first, then look for prose
          const stripped = latex.replace(/\\(?:mathrm|text\w*)\s*\{[^}]*\}/g, "");
          if (/[a-z]{3,}(?:\s+[a-z]{3,}){2,}/i.test(stripped)) return false;
          // High \mathrm text ratio (>40%) → OCR read prose as math
          const textLen = (latex.match(/\\mathrm\s*\{[^}]*\}/g) || []).join("").length;
          if (textLen > latex.length * 0.4) return false;
        }

        return true;
      }

      // Merge: for each heuristic equation, pick the best available LaTeX
      let eqDone = 0;
      const totalEqs = heuristicEqs.length;
      for (const eq of heuristicEqs) {
        const uniLatex = unimernetResults.get(eq.figureNo);
        const glmLatex = glmEquationMap?.get(eq.figureNo);

        // Quality-based merge: validate both sources, pick the better one
        let bestLatex = null;
        let source = null;

        const uniValid = isGoodEquationLatex(uniLatex);
        const glmValid = isGoodEquationLatex(glmLatex);

        if (uniValid && glmValid) {
          // Both valid: prefer the one without \begin{array}, or the shorter one
          const uniHasArray = /\\begin\s*\{array\}/.test(uniLatex);
          const glmHasArray = /\\begin\s*\{array\}/.test(glmLatex);
          if (uniHasArray && !glmHasArray) {
            bestLatex = glmLatex; source = "glm-ocr";
          } else if (!uniHasArray && glmHasArray) {
            bestLatex = uniLatex; source = "unimernet";
          } else if (uniLatex.length <= glmLatex.length) {
            bestLatex = uniLatex; source = "unimernet";
          } else {
            bestLatex = glmLatex; source = "glm-ocr";
          }
        } else if (uniValid) {
          bestLatex = uniLatex; source = "unimernet";
        } else if (glmValid) {
          bestLatex = glmLatex; source = "glm-ocr";
        }

        if (bestLatex) {
          const latexCaption = bestLatex.startsWith("$$") ? bestLatex : `$$${bestLatex}$$`;
          const { error: updateErr } = await supabase
            .from("figures")
            .update({ caption: latexCaption, summary_text: latexCaption })
            .eq("paper_id", job.paper_id)
            .eq("figure_no", eq.figureNo)
            .eq("item_type", "equation");

          if (updateErr) {
            console.warn(`[equation-merge] Failed to update ${eq.figureNo}:`, updateErr.message);
          } else {
            if (source === "unimernet") unimernetEnhanced++;
            else glmFallbackUsed++;
          }
        } else {
          // Both OCR failed — check if existing heuristic caption is garbage and clear it
          const { data: existing } = await supabase
            .from("figures")
            .select("caption")
            .eq("paper_id", job.paper_id)
            .eq("figure_no", eq.figureNo)
            .eq("item_type", "equation")
            .single();
          if (existing?.caption) {
            const raw = existing.caption.replace(/^\$\$|\$\$$/g, "").trim();
            // Very short, no LaTeX commands → broken heuristic text, clear it
            if (raw.length > 0 && raw.length < 15 && !/\\[a-zA-Z]/.test(raw)) {
              await supabase
                .from("figures")
                .update({ caption: null, summary_text: null })
                .eq("paper_id", job.paper_id)
                .eq("figure_no", eq.figureNo)
                .eq("item_type", "equation");
              console.log(`[equation-merge] ${eq.figureNo}: cleared broken heuristic caption "${raw}"`);
            }
          }
        }

        eqDone++;
        broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
          jobId: job.id, paperId: job.paper_id, status: "running",
          progress: 78 + Math.round((eqDone / totalEqs) * 6),
          message: `${eq.figureNo} LaTeX ${bestLatex ? `(${source})` : "skipped"} (${eqDone}/${totalEqs}).`,
        });
      }

      console.log(`[process] Equation merge: ${unimernetEnhanced} UniMERNet + ${glmFallbackUsed} GLM-OCR fallback / ${totalEqs} total`);
    }
  } catch (uniErr) {
    console.warn(`[process] Equation enhancement failed (non-fatal):`, uniErr.message);
  }

  const finalTableCount = ocrTableCount || (extractionResult.tableCount ?? 0);
  const finalEquationCount = ocrEquationCount || (extractionResult.equationCount ?? 0);

  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id,
    paperId: job.paper_id,
    status: "running",
    progress: 84,
    message: `Extracted ${extractionResult.sectionCount} sections, ${extractionResult.chunkCount} chunks, ${extractionResult.figureCount} figures, ${finalTableCount} tables, ${finalEquationCount} equations.${unimernetEnhanced || glmFallbackUsed ? ` (LaTeX: ${unimernetEnhanced} UniMERNet + ${glmFallbackUsed} GLM-OCR)` : ""}${ocrTableCount ? ` (${ocrTableCount} table HTML)` : ""}`,
  });

  await updateJobStatus(job.id, {
    status: "succeeded",
    finished_at: new Date().toISOString(),
    error_message: null,
  });

  broadcastToWindows(IPC_EVENTS.JOB_COMPLETED, {
    jobId: job.id,
    paperId: job.paper_id,
    result: {
      paperId: job.paper_id,
      status: "succeeded",
      ...extractionResult,
    },
  });

  // Auto-queue embedding generation after successful extraction
  if (extractionResult.chunkCount > 0) {
    await supabase.from("processing_jobs").insert({
      paper_id: job.paper_id,
      user_id: job.user_id,
      job_type: "generate_embeddings",
      status: "queued",
      source_path: resolvedStoredPath,
    });
  }
}

/**
 * Build a RegExp that matches textual references to a figure/table/equation in chunk text.
 * e.g. "Figure 1" → /\b(?:Figure|Fig\.?)\s*1\b/i
 */
function buildReferencePattern(figureNo) {
  const num = figureNo.replace(/\D/g, "");
  if (!num) return null;
  if (figureNo.startsWith("Figure")) {
    return new RegExp(`\\b(?:Figure|Fig\\.?)\\s*${num}\\b`, "i");
  }
  if (figureNo.startsWith("Table")) {
    return new RegExp(`\\bTable\\s*${num}\\b`, "i");
  }
  if (figureNo.startsWith("Eq.")) {
    return new RegExp(`\\b(?:Eq\\.?|Equation)\\s*[\\(]?${num}[\\)]?\\b`, "i");
  }
  return null;
}

async function processEmbeddingJob(job) {
  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id,
    paperId: job.paper_id,
    status: "running",
    progress: 5,
    message: "Loading embedding model (first use may download ~22MB)...",
  });

  // Fetch all chunks for this paper
  const { data: chunks, error: chunkError } = await supabase
    .from("paper_chunks")
    .select("id, text")
    .eq("paper_id", job.paper_id)
    .order("chunk_order", { ascending: true });

  if (chunkError) {
    throw new Error(chunkError.message);
  }

  if (!chunks || chunks.length === 0) {
    await updateJobStatus(job.id, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      error_message: null,
    });
    broadcastToWindows(IPC_EVENTS.JOB_COMPLETED, {
      jobId: job.id,
      paperId: job.paper_id,
      result: { paperId: job.paper_id, status: "succeeded", embeddedCount: 0 },
    });
    return;
  }

  // Filter out chunks that already have embeddings with the current model
  const { data: existingEmbeddings } = await supabase
    .from("chunk_embeddings")
    .select("chunk_id")
    .in("chunk_id", chunks.map((c) => c.id))
    .eq("embedding_model", MODEL_NAME);

  const existingSet = new Set((existingEmbeddings ?? []).map((e) => e.chunk_id));
  const chunksToEmbed = chunks.filter((c) => !existingSet.has(c.id));

  if (chunksToEmbed.length === 0) {
    await updateJobStatus(job.id, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      error_message: null,
    });
    broadcastToWindows(IPC_EVENTS.JOB_COMPLETED, {
      jobId: job.id,
      paperId: job.paper_id,
      result: { paperId: job.paper_id, status: "succeeded", embeddedCount: 0, skipped: true },
    });
    return;
  }

  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id,
    paperId: job.paper_id,
    status: "running",
    progress: 15,
    message: `Generating embeddings for ${chunksToEmbed.length} chunks...`,
  });

  const texts = chunksToEmbed.map((c) => c.text);
  const embeddings = await generateEmbeddings(texts, (done, total) => {
    const progress = 15 + Math.round((done / total) * 70);
    broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
      jobId: job.id,
      paperId: job.paper_id,
      status: "running",
      progress,
      message: `Embedded ${done}/${total} chunks...`,
    });
  });

  // Upsert embeddings into chunk_embeddings
  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id,
    paperId: job.paper_id,
    status: "running",
    progress: 90,
    message: "Saving embeddings to database...",
  });

  const rows = chunksToEmbed.map((chunk, i) => ({
    chunk_id: chunk.id,
    embedding: JSON.stringify(embeddings[i]),
    embedding_model: MODEL_NAME,
    embedding_dim: EMBEDDING_DIM,
  }));

  // Upsert in batches of 50 to avoid payload limits
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error: upsertError } = await supabase
      .from("chunk_embeddings")
      .upsert(batch, { onConflict: "chunk_id" });

    if (upsertError) {
      throw new Error(upsertError.message);
    }
  }

  // --- Paper-level embedding (title + abstract) ---
  try {
    broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
      jobId: job.id, paperId: job.paper_id, status: "running",
      progress: 92, message: "논문 단위 임베딩 생성 중...",
    });

    const { data: paper } = await supabase
      .from("papers")
      .select("title, abstract, embedding")
      .eq("id", job.paper_id)
      .single();

    if (paper && !paper.embedding) {
      const paperText = `${paper.title || ""} ${paper.abstract || ""}`.trim();
      if (paperText.length > 10) {
        const paperEmb = await generateEmbedding(paperText, "document");
        await supabase.from("papers")
          .update({ embedding: JSON.stringify(paperEmb) })
          .eq("id", job.paper_id);
        console.log(`[embedding] Paper-level embedding generated for ${job.paper_id}`);
      }
    }
  } catch (paperEmbErr) {
    console.warn("[embedding] Paper embedding failed (non-fatal):", paperEmbErr.message);
  }

  // --- Figure/table/equation embeddings (VL model: image + text) ---
  try {
    broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
      jobId: job.id, paperId: job.paper_id, status: "running",
      progress: 95, message: "그림/테이블/수식 임베딩 생성 중...",
    });

    const { data: figureItems } = await supabase
      .from("figures")
      .select("id, item_type, figure_no, summary_text, plain_text, caption, image_path, embedding")
      .eq("paper_id", job.paper_id);

    const toEmbed = (figureItems ?? []).filter((f) => !f.embedding);

    if (toEmbed.length > 0) {
      // --- Context enrichment: find chunks that reference each figure/table/equation ---
      const MAX_CONTEXT_CHARS = 2000;
      let figContextMap = new Map();
      try {
        const figPatterns = toEmbed
          .map((fig) => ({ id: fig.id, pattern: fig.figure_no ? buildReferencePattern(fig.figure_no) : null }))
          .filter((fp) => fp.pattern !== null);

        if (figPatterns.length > 0 && chunks && chunks.length > 0) {
          for (const chunk of chunks) {
            if (!chunk.text) continue;
            for (const fp of figPatterns) {
              if (fp.pattern.test(chunk.text)) {
                if (!figContextMap.has(fp.id)) figContextMap.set(fp.id, []);
                figContextMap.get(fp.id).push(chunk.text);
              }
            }
          }
        }
        const enrichedCount = [...figContextMap.values()].filter((v) => v.length > 0).length;
        if (enrichedCount > 0) {
          console.log(`[embedding] Context enrichment: ${enrichedCount}/${toEmbed.length} items have referencing chunks`);
        }
      } catch (ctxErr) {
        console.warn("[embedding] Context enrichment failed (non-fatal):", ctxErr.message);
        figContextMap = new Map();
      }

      let embeddedCount = 0;
      for (const fig of toEmbed) {
        try {
          let emb;
          const captionText = fig.caption?.replace(/\$\$/g, "").trim() || "";

          if (fig.image_path && existsSync(fig.image_path)) {
            // Has image on disk: use VL image embedding (+ context-enriched caption)
            let enrichedCaption = captionText;
            const ctxChunks = figContextMap.get(fig.id);
            if (ctxChunks && ctxChunks.length > 0) {
              const ctxText = ctxChunks.join("\n").slice(0, MAX_CONTEXT_CHARS);
              enrichedCaption = [captionText, ctxText].filter(Boolean).join("\n");
            }
            emb = await generateImageEmbedding(fig.image_path, enrichedCaption || null);
          } else {
            // No image: text-only embedding (+ context enrichment)
            let text = fig.plain_text || "";
            if (!text && fig.summary_text) {
              text = fig.summary_text
                .replace(/<[^>]+>/g, " ")
                .replace(/\$\$/g, "")
                .replace(/\\[a-zA-Z]+/g, " ")
                .replace(/[{}]/g, "")
                .replace(/\s+/g, " ")
                .trim();
            }
            if (!text) text = captionText;
            // Append referencing context from chunks
            const ctxChunks = figContextMap.get(fig.id);
            if (ctxChunks && ctxChunks.length > 0) {
              const ctxText = ctxChunks.join("\n").slice(0, MAX_CONTEXT_CHARS);
              text = [text, ctxText].filter(Boolean).join("\n");
            }
            if (text.length < 10) continue;
            emb = await generateEmbedding(text, "document");
          }

          const updates = {};
          if (!fig.plain_text && !fig.image_path) {
            let text = fig.summary_text
              ? fig.summary_text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
              : captionText;
            if (text) updates.plain_text = text;
          }

          updates.embedding = JSON.stringify(emb);
          await supabase.from("figures").update(updates).eq("id", fig.id);
          embeddedCount++;
        } catch (figErr) {
          console.warn(`[embedding] Failed to embed figure ${fig.id} (${fig.item_type}):`, figErr.message);
        }
      }

      console.log(`[embedding] Generated embeddings for ${embeddedCount}/${toEmbed.length} figures/tables/equations`);
    }
  } catch (figEmbErr) {
    console.warn("[embedding] Figure embedding failed (non-fatal):", figEmbErr.message);
  }

  await updateJobStatus(job.id, {
    status: "succeeded",
    finished_at: new Date().toISOString(),
    error_message: null,
  });

  broadcastToWindows(IPC_EVENTS.JOB_COMPLETED, {
    jobId: job.id,
    paperId: job.paper_id,
    result: {
      paperId: job.paper_id,
      status: "succeeded",
      embeddedCount: chunksToEmbed.length,
    },
  });
}

async function tryStartExtractionJob() {
  if (extractionInFlight) return;
  extractionInFlight = true;
  let activeJob = null;

  try {
    const { data: queuedJobs, error: jobError } = await supabase
      .from("processing_jobs")
      .select("id, paper_id, user_id, source_path, job_type, status, created_at")
      .eq("status", "queued")
      .neq("job_type", "generate_embeddings")
      .order("created_at", { ascending: true })
      .limit(1);

    if (jobError) throw new Error(jobError.message);
    const job = queuedJobs?.[0];
    if (!job) return;

    activeJob = job;
    if (!job.paper_id) throw new Error("Queued job is missing a paper_id.");

    await updateJobStatus(job.id, {
      status: "running",
      started_at: new Date().toISOString(),
      error_message: null,
    });

    await processImportPdfJob(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (activeJob?.id) {
      try {
        await updateJobStatus(activeJob.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: message,
        });
      } catch { /* best effort */ }
      broadcastToWindows(IPC_EVENTS.JOB_FAILED, {
        jobId: activeJob.id,
        paperId: activeJob.paper_id ?? null,
        error: message,
      });
    }
  } finally {
    extractionInFlight = false;
  }
}

async function tryStartEmbeddingJob() {
  if (embeddingInFlight) return;
  embeddingInFlight = true;
  let activeJob = null;

  try {
    const { data: queuedJobs, error: jobError } = await supabase
      .from("processing_jobs")
      .select("id, paper_id, user_id, source_path, job_type, status, created_at")
      .eq("status", "queued")
      .eq("job_type", "generate_embeddings")
      .order("created_at", { ascending: true })
      .limit(1);

    if (jobError) throw new Error(jobError.message);
    const job = queuedJobs?.[0];
    if (!job) return;

    activeJob = job;
    if (!job.paper_id) throw new Error("Queued job is missing a paper_id.");

    await updateJobStatus(job.id, {
      status: "running",
      started_at: new Date().toISOString(),
      error_message: null,
    });

    await processEmbeddingJob(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (activeJob?.id) {
      try {
        await updateJobStatus(activeJob.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: message,
        });
      } catch { /* best effort */ }
      broadcastToWindows(IPC_EVENTS.JOB_FAILED, {
        jobId: activeJob.id,
        paperId: activeJob.paper_id ?? null,
        error: message,
      });
    }
  } finally {
    embeddingInFlight = false;
  }
}

function processNextQueuedJob() {
  void tryStartExtractionJob();
  void tryStartEmbeddingJob();
}

function startProcessingLoop() {
  if (processingInterval) {
    return;
  }

  processingInterval = setInterval(() => {
    void processNextQueuedJob();
  }, PROCESSING_POLL_INTERVAL_MS);

  void processNextQueuedJob();
}

async function resetStaleRunningJobs() {
  try {
    const { data: staleJobs, error } = await supabase
      .from("processing_jobs")
      .select("id, paper_id")
      .eq("status", "running");
    if (error || !staleJobs || staleJobs.length === 0) return;

    for (const job of staleJobs) {
      await supabase.from("processing_jobs")
        .update({ status: "queued", started_at: null, error_message: null })
        .eq("id", job.id);
      console.log(`[startup] Reset stale running job ${job.id} → queued`);
    }
  } catch (err) {
    console.warn("[startup] Failed to reset stale running jobs:", err?.message ?? err);
  }
}

async function requeueOutdatedPapers() {
  try {
    // Find papers with extraction_version < CURRENT_EXTRACTION_VERSION that have a stored PDF
    const { data: outdatedPapers, error: queryError } = await supabase
      .from("papers")
      .select("id, title, extraction_version, owner_user_id")
      .lt("extraction_version", CURRENT_EXTRACTION_VERSION);

    if (queryError || !outdatedPapers || outdatedPapers.length === 0) {
      return;
    }

    // Check which of these already have a queued/running job to avoid duplicates
    const paperIds = outdatedPapers.map((p) => p.id);
    const { data: existingJobs } = await supabase
      .from("processing_jobs")
      .select("paper_id")
      .in("paper_id", paperIds)
      .in("status", ["queued", "running"]);

    const alreadyQueued = new Set((existingJobs ?? []).map((j) => j.paper_id));

    let queuedCount = 0;
    for (const paper of outdatedPapers) {
      if (alreadyQueued.has(paper.id)) continue;

      // Get the stored PDF path
      const { data: fileRow } = await supabase
        .from("paper_files")
        .select("stored_path")
        .eq("paper_id", paper.id)
        .eq("is_primary", true)
        .limit(1)
        .maybeSingle();

      if (!fileRow?.stored_path) continue;

      const userId = paper.owner_user_id ?? null;

      // Remove old completed/failed jobs for this paper to avoid duplicates
      await supabase.from("processing_jobs")
        .delete()
        .eq("paper_id", paper.id)
        .in("status", ["succeeded", "failed"]);

      await supabase.from("processing_jobs").insert({
        paper_id: paper.id,
        user_id: userId,
        job_type: "import_pdf",
        status: "queued",
        source_path: fileRow.stored_path,
      });

      queuedCount += 1;
      console.log(`[re-extract] Queued re-extraction for "${paper.title}" (v${paper.extraction_version} → v${CURRENT_EXTRACTION_VERSION})`);
    }

    if (queuedCount > 0) {
      console.log(`[re-extract] Queued ${queuedCount} papers for re-extraction.`);
    }
  } catch (err) {
    console.warn("[re-extract] Failed to check for outdated papers:", err?.message ?? err);
  }
}

// ============================================================
// IPC Handlers: DB
// ============================================================

ipcMain.handle(IPC_CHANNELS.DB_QUERY, async (_event, { table, method, params }) => {
  try {
    assertAllowedTable(table, DB_QUERY_TABLES, "DB query");

    if (method !== "select") {
      return { success: false, error: `Unsupported DB query method: ${method}` };
    }

    let query = supabase.from(table).select(params?.columns ?? "*");

    if (params?.filters) {
      for (const [col, op, val] of params.filters) {
        query = query.filter(col, op, val);
      }
    }
    if (params?.order) {
      query = query.order(params.order.column, {
        ascending: params.order.ascending ?? false,
      });
    }
    if (params?.limit) {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.DB_MUTATE, async (_event, { table, method, params }) => {
  try {
    assertAllowedTable(table, DB_MUTATE_TABLES, "DB mutation");

    let result;

    if (method === "insert") {
      result = await supabase.from(table).insert(params.data).select();
    } else if (method === "update") {
      result = await supabase.from(table).update(params.data).match(params.match).select();
    } else if (method === "upsert") {
      result = await supabase.from(table).upsert(params.data).select();
    } else if (method === "delete") {
      result = await supabase.from(table).delete().match(params.match);
    } else {
      return { success: false, error: `Unknown method: ${method}` };
    }

    if (result.error) return { success: false, error: result.error.message };
    return { success: true, data: result.data };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

// ============================================================
// IPC Handlers: File System
// ============================================================

ipcMain.handle(IPC_CHANNELS.FILE_IMPORT_PDF, async (_event, { sourcePath, year, firstAuthor, shortTitle }) => {
  try {
    const resolvedSourcePath = normalizeAbsolutePath(sourcePath, "Source PDF path");
    await fs.access(resolvedSourcePath);

    // Build destination: Library/Papers/{Year}/{FirstAuthor}_{Year}_{ShortTitle}.pdf
    const yearStr = year ? String(year) : "unknown";
    const author = firstAuthor ? sanitizeFilename(firstAuthor) : "Unknown";
    const title = shortTitle ? sanitizeFilename(shortTitle) : "Untitled";
    const filename = `${author}_${yearStr}_${title}.pdf`;
    const destDir = path.join(LIBRARY_ROOT, "Papers", yearStr);
    await ensureDir(destDir);

    let destPath = path.join(destDir, filename);

    let counter = 1;
    while (true) {
      try {
        await fs.access(destPath);
        destPath = path.join(destDir, `${author}_${yearStr}_${title}_${String(counter).padStart(3, "0")}.pdf`);
        counter++;
      } catch {
        break;
      }
    }

    await fs.copyFile(resolvedSourcePath, destPath);
    const checksum = await computeSha256(destPath);
    const stat = await fs.stat(destPath);

    return {
      success: true,
      data: {
        storedPath: destPath,
        storedFilename: path.basename(destPath),
        originalFilename: path.basename(resolvedSourcePath),
        checksum,
        fileSize: stat.size,
      },
    };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.FILE_INSPECT_PDF, async (_event, { sourcePath }) => {
  try {
    const resolvedSourcePath = normalizeAbsolutePath(sourcePath, "Source PDF path");
    await fs.access(resolvedSourcePath);
    const pdfBuffer = await fs.readFile(resolvedSourcePath);
    const inspection = await inspectPdfMetadata(pdfBuffer, path.parse(resolvedSourcePath).name);
    return { success: true, data: inspection };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.FILE_GET_PATH, async (_event, { storedPath }) => {
  try {
    const resolvedPath = assertLibraryPath(storedPath, "Stored PDF path");
    await fs.access(resolvedPath);
    console.log(`[FILE_GET_PATH] OK: ${resolvedPath}`);
    return { success: true, data: resolvedPath };
  } catch (err) {
    console.warn(`[FILE_GET_PATH] FAIL storedPath=${storedPath} error=${getErrorMessage(err)}`);
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.FILE_OPEN_PATH, async (_event, { filePath }) => {
  try {
    const resolvedPath = assertLibraryPath(filePath, "Open path");
    const errorMessage = await shell.openPath(resolvedPath);
    if (errorMessage) {
      return { success: false, error: errorMessage };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_event, { storedPath }) => {
  try {
    const resolvedPath = assertLibraryPath(storedPath, "Delete path");
    await fs.unlink(resolvedPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.FILE_OPEN_IN_EXPLORER, async (_event, { filePath }) => {
  try {
    const resolvedPath = assertLibraryPath(filePath, "Explorer path");
    shell.showItemInFolder(resolvedPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.FILE_SELECT_DIALOG, async () => {
  try {
    const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "PDF Files", extensions: ["pdf"] }],
        })
      : await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
          filters: [{ name: "PDF Files", extensions: ["pdf"] }],
        });

    return { success: !result.canceled, data: result.filePaths };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

// ============================================================
// IPC Handlers: App Info
// ============================================================

ipcMain.handle(IPC_CHANNELS.APP_GET_PLATFORM, () => process.platform);
ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion());
ipcMain.handle(IPC_CHANNELS.APP_GET_LIBRARY_PATH, () => LIBRARY_ROOT);

// ============================================================
// IPC Handlers: Window Management
// ============================================================

ipcMain.handle(IPC_CHANNELS.WINDOW_DETACH_PANEL, async (_event, { panelId, url }) => {
  if (detachedWindows.has(panelId)) {
    detachedWindows.get(panelId).focus();
    return { success: true, windowId: panelId };
  }

  const win = new BrowserWindow({
    width: 700,
    height: 600,
    title: `Redou - ${panelId}`,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  const targetUrl = url ?? `${rendererUrl}#/detached/${panelId}`;
  const detachedHash = `/detached/${panelId}`;
  if (app.isPackaged) {
    const packagedRendererPath = resolvePackagedRendererPath();
    if (!packagedRendererPath) {
      throw new Error("No packaged renderer is available for detached panels.");
    }

    win.loadFile(packagedRendererPath, {
      hash: detachedHash,
    });
  } else {
    attachRendererFallback(
      win,
      (packagedRendererPath) => {
        win.loadFile(packagedRendererPath, { hash: detachedHash });
      },
      `detached panel ${panelId}`
    );
    win.loadURL(targetUrl);
  }

  detachedWindows.set(panelId, win);
  win.on("closed", () => {
    detachedWindows.delete(panelId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_EVENTS.FILE_CHANGED, {
        type: "panel-reattached",
        panelId,
      });
    }
  });

  return { success: true, windowId: panelId };
});

ipcMain.handle(IPC_CHANNELS.WINDOW_REATTACH_PANEL, async (_event, { panelId }) => {
  const win = detachedWindows.get(panelId);
  if (win) {
    win.close();
    detachedWindows.delete(panelId);
  }
  return { success: true };
});

ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
  mainWindow?.minimize();
});

ipcMain.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, () => {
  mainWindow?.close();
});

// ============================================================
// IPC Handlers: Backup
// ============================================================

ipcMain.handle(IPC_CHANNELS.BACKUP_CREATE, async () => {
  try {
    const backupDir = path.join(app.getPath("documents"), "Redou", "Backups");
    await ensureDir(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `redou-backup-${timestamp}.json`);

    // Export all tables
    const tables = [
      "app_users", "papers", "paper_files", "paper_sections", "paper_chunks",
      "paper_summaries", "figures", "folders", "paper_folders", "tags",
      "paper_tags", "notes", "highlight_presets", "highlights",
      "processing_jobs", "user_workspace_preferences",
    ];

    const backup = { version: 1, timestamp: new Date().toISOString(), tables: {} };
    const exportErrors = [];
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select("*");
      if (error) {
        exportErrors.push(`${table}: ${error.message}`);
      }
      backup.tables[table] = data ?? [];
    }
    if (exportErrors.length > 0) {
      return { success: false, error: `Failed to export tables: ${exportErrors.join("; ")}` };
    }

    await fs.writeFile(backupPath, JSON.stringify(backup, null, 2), "utf-8");
    const stat = await fs.stat(backupPath);
    const checksum = await computeSha256(backupPath);

    // Record in DB
    const userId = backup.tables.app_users?.[0]?.id;
    if (userId) {
      await supabase.from("backup_snapshots").insert({
        user_id: userId,
        backup_path: backupPath,
        backup_kind: "full_workspace",
        checksum_sha256: checksum,
        file_size_bytes: stat.size,
        status: "created",
      });
    }

    return { success: true, data: { backupPath, fileSize: stat.size } };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.BACKUP_LIST, async () => {
  try {
    const { data, error } = await supabase
      .from("backup_snapshots")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return { success: false, error: error.message };
    return { success: true, data };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.BACKUP_RESTORE, async (_event, { backupPath }) => {
  try {
    // Validate backup path: must be a .json file inside the Redou Backups directory
    const backupDir = path.join(app.getPath("documents"), "Redou", "Backups");
    const resolvedBackup = path.resolve(backupPath);
    if (!isWithinDirectory(backupDir, resolvedBackup)) {
      return { success: false, error: "Backup file must be inside the Redou Backups directory." };
    }
    const content = await fs.readFile(resolvedBackup, "utf-8");
    const backup = JSON.parse(content);

    if (!backup.version || !backup.tables) {
      return { success: false, error: "Invalid backup format" };
    }

    // Restore order matters (foreign keys)
    const restoreOrder = [
      "app_users", "folders", "papers", "paper_files", "paper_sections",
      "paper_chunks", "paper_summaries", "figures", "paper_folders",
      "tags", "paper_tags", "highlight_presets", "highlights", "notes",
      "processing_jobs", "user_workspace_preferences",
    ];

    for (const table of restoreOrder) {
      const rows = backup.tables[table];
      if (rows && rows.length > 0) {
        await supabase.from(table).upsert(rows);
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

// ============================================================
// IPC Handlers: Auth (OAuth)
// ============================================================

ipcMain.handle(IPC_CHANNELS.AUTH_GOOGLE_SIGN_IN, async () => {
  try {
    const callbackUrl = getOAuthCallbackUrl();
    const supabaseAuthUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callbackUrl)}`;

    // Start the callback server BEFORE opening the browser
    const callbackPromise = waitForOAuthCallback(120_000);

    // Open the system browser for Google sign-in
    shell.openExternal(supabaseAuthUrl);

    // Wait for the callback
    const { accessToken, refreshToken } = await callbackPromise;

    return { success: true, data: { accessToken, refreshToken } };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

// ============================================================
// IPC Handlers: Embeddings
// ============================================================

ipcMain.handle(IPC_CHANNELS.EMBEDDING_GENERATE_QUERY, async (_event, { text }) => {
  try {
    const embedding = await generateEmbedding(text, "query");
    return { success: true, data: embedding };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

ipcMain.handle(IPC_CHANNELS.PIPELINE_REQUEUE_ALL, async () => {
  try {
    // Get ALL papers that have a stored PDF
    const { data: allPapers, error: queryError } = await supabase
      .from("papers")
      .select("id, title, owner_user_id");

    if (queryError || !allPapers || allPapers.length === 0) {
      return { success: true, data: { queued: 0 } };
    }

    // Check which already have a queued/running job
    const paperIds = allPapers.map((p) => p.id);
    const { data: existingJobs } = await supabase
      .from("processing_jobs")
      .select("paper_id")
      .in("paper_id", paperIds)
      .in("status", ["queued", "running"]);

    const alreadyQueued = new Set((existingJobs ?? []).map((j) => j.paper_id));

    let queuedCount = 0;
    for (const paper of allPapers) {
      if (alreadyQueued.has(paper.id)) continue;

      const { data: fileRow } = await supabase
        .from("paper_files")
        .select("stored_path")
        .eq("paper_id", paper.id)
        .eq("is_primary", true)
        .limit(1)
        .maybeSingle();

      if (!fileRow?.stored_path) continue;

      // Remove old completed/failed jobs for this paper to avoid duplicates
      await supabase.from("processing_jobs")
        .delete()
        .eq("paper_id", paper.id)
        .in("status", ["succeeded", "failed"]);

      await supabase.from("processing_jobs").insert({
        paper_id: paper.id,
        user_id: paper.owner_user_id ?? null,
        job_type: "import_pdf",
        status: "queued",
        source_path: fileRow.stored_path,
      });

      queuedCount += 1;
      console.log(`[requeue-all] Queued "${paper.title}"`);
    }

    console.log(`[requeue-all] Queued ${queuedCount} papers for re-extraction.`);
    return { success: true, data: { queued: queuedCount } };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

// ============================================================
// App Lifecycle
// ============================================================

// Register custom protocol for serving local files (avoids file:// CORS issues)
protocol.registerSchemesAsPrivileged([
  { scheme: "redou-file", privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } },
]);

app.whenReady().then(async () => {
  // Handle redou-file:// protocol — mirrors file:// for local access
  protocol.handle("redou-file", (request) => {
    const fileUrl = request.url.replace("redou-file:", "file:");
    console.log(`[redou-file] ${request.url} → ${fileUrl}`);
    return net.fetch(fileUrl);
  });

  await ensureDir(LIBRARY_ROOT);
  // Load user-selected LLM model from DB
  try {
    const { data: pref } = await supabase
      .from("user_workspace_preferences")
      .select("llm_model")
      .limit(1)
      .maybeSingle();
    if (pref?.llm_model) {
      setActiveModel(pref.llm_model);
      console.log(`[LLM] Loaded user model from DB: ${getActiveModel()}`);
    } else {
      console.log(`[LLM] No user preference found, using default: ${getActiveModel()}`);
    }
  } catch (err) {
    console.warn(`[LLM] Failed to load model preference from DB:`, err.message);
  }
  createMainWindow();
  await resetStaleRunningJobs();
  await requeueOutdatedPapers();
  startProcessingLoop();
  // Background: fill missing DOIs via CrossRef
  setImmediate(() => fillMissingDois().catch((e) => console.warn("[DOI] fillMissingDois error:", e.message)));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// --- SHELL_OPEN_EXTERNAL ---
ipcMain.handle("shell:open-external", async (_event, url) => {
  if (typeof url === "string" && (url.startsWith("https://") || url.startsWith("http://"))) {
    await shell.openExternal(url);
  }
});

// ============================================================
// DOI auto-fill via CrossRef API
// ============================================================

async function fillMissingDois() {
  const { data: papers } = await supabase
    .from("papers")
    .select("id, title, doi")
    .is("trashed_at", null);

  const missing = (papers ?? []).filter((p) => !p.doi && p.title);
  if (missing.length === 0) return;

  console.log(`[DOI] ${missing.length} papers missing DOI — querying CrossRef...`);

  for (const paper of missing) {
    try {
      const encoded = encodeURIComponent(paper.title);
      const res = await fetch(
        `https://api.crossref.org/works?query.bibliographic=${encoded}&rows=1&select=DOI,title`,
        { headers: { "User-Agent": "Redou/1.0 (mailto:redou@localhost)" }, signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) continue;

      const json = await res.json();
      const item = json?.message?.items?.[0];
      if (!item?.DOI || !item?.title?.[0]) continue;

      // Verify title similarity (Jaccard token overlap)
      const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
      const tokA = new Set(normalize(paper.title).split(/\s+/).filter(t => t.length > 1));
      const tokB = new Set(normalize(item.title[0]).split(/\s+/).filter(t => t.length > 1));
      const intersection = [...tokA].filter(t => tokB.has(t)).length;
      const union = new Set([...tokA, ...tokB]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      if (jaccard < 0.6) continue;

      await supabase.from("papers").update({ doi: item.DOI }).eq("id", paper.id);
      console.log(`[DOI] ${paper.title.slice(0, 50)}... → ${item.DOI}`);
    } catch {
      // Network error or timeout — skip silently
    }
  }

  console.log("[DOI] Done filling missing DOIs.");
}

// ============================================================
// Chat Feature — LLM-based research data comparison tables
// ============================================================

const chatAbortControllers = new Map(); // conversationId → AbortController

/**
 * Recursively collect paper IDs within a folder tree (BFS).
 */
async function getPaperIdsInFolderTree(folderId) {
  const { data: allFolders } = await supabase.from("folders").select("id, parent_folder_id");
  const folderIds = [folderId];
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const f of allFolders ?? []) {
      if (f.parent_folder_id === current) {
        folderIds.push(f.id);
        queue.push(f.id);
      }
    }
  }
  const { data: links } = await supabase.from("paper_folders").select("paper_id").in("folder_id", folderIds);
  return [...new Set((links ?? []).map((l) => l.paper_id))];
}

// --- Chat helper: extract key terms from user messages for re-ranking ---
function extractKeyTerms(text) {
  const terms = new Set();
  // Scientific identifiers: letters+digits like "5A", "13X", "CO2", "H2S", "CH4"
  const alphaNum = text.match(/[a-zA-Z]+\d+[a-zA-Z]*/gi) || [];
  alphaNum.forEach((t) => terms.add(t.toLowerCase()));
  // Digit+letter patterns: "5a", "13x"
  const numAlpha = text.match(/\d+[a-zA-Z]+/gi) || [];
  numAlpha.forEach((t) => terms.add(t.toLowerCase()));
  // English scientific words (4+ chars, excluding common stop words)
  const engWords = text.match(/[a-zA-Z]{4,}/gi) || [];
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "been",
    "have", "has", "had", "will", "would", "could", "should", "about", "which", "their",
    "data", "table", "paper", "make", "please", "want", "need", "also", "than", "them",
    "into", "some", "each", "other", "more", "most", "only", "very", "both", "such",
  ]);
  engWords.forEach((t) => {
    const lower = t.toLowerCase();
    if (!stopWords.has(lower)) terms.add(lower);
  });
  return [...terms];
}

// --- Chat helper: re-rank chunks by keyword relevance ---
function rerankChunksByKeywords(chunks, keyTerms, maxChunks = 40) {
  if (!keyTerms.length || !chunks.length) return chunks.slice(0, maxChunks);

  const scored = chunks.map((chunk) => {
    const lowerText = chunk.text.toLowerCase();
    let matchCount = 0;
    for (const term of keyTerms) {
      // Count occurrences, not just presence — chunks with more mentions of the target rank higher
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = lowerText.match(regex);
      if (matches) matchCount += matches.length;
    }
    return { ...chunk, _keywordScore: matchCount };
  });

  // Sort: keyword score (desc), then similarity (desc)
  scored.sort((a, b) => {
    if (b._keywordScore !== a._keywordScore) return b._keywordScore - a._keywordScore;
    return (b.similarity || 0) - (a.similarity || 0);
  });

  return scored.slice(0, maxChunks);
}

// --- Multi-query RAG: run multiple embedding searches and merge results ---
async function runMultiQueryRag(searchQueries, keywordHints, filterPaperIds) {
  const chunkMap = new Map(); // chunkId → chunk (keep highest similarity)
  const figureMap = new Map(); // figureId → figure

  for (const sq of searchQueries) {
    const emb = await generateEmbedding(sq.query, "query");

    const { data: chunks, error: chunkErr } = await supabase.rpc("match_chunks", {
      query_embedding: emb,
      match_threshold: 0.2,
      match_count: 60,
      filter_paper_ids: filterPaperIds,
    });
    if (chunkErr) console.error("[Chat/RAG] match_chunks error:", chunkErr.message);

    for (const c of chunks ?? []) {
      const existing = chunkMap.get(c.chunk_id);
      if (!existing || (c.similarity > existing.similarity)) {
        chunkMap.set(c.chunk_id, c);
      }
    }

    const { data: figures, error: figErr } = await supabase.rpc("match_figures", {
      query_embedding: emb,
      match_threshold: 0.15,
      match_count: 30,
      filter_item_types: ["table", "figure", "equation"],
      filter_paper_ids: filterPaperIds,
    });
    if (figErr) console.error("[Chat/RAG] match_figures error:", figErr.message);

    for (const f of figures ?? []) {
      const existing = figureMap.get(f.figure_id);
      if (!existing || (f.similarity > existing.similarity)) {
        figureMap.set(f.figure_id, f);
      }
    }
  }

  const allChunks = [...chunkMap.values()];
  const allFigures = [...figureMap.values()];

  // Re-rank by keyword hints + similarity
  const keyTerms = [...(keywordHints ?? []), ...searchQueries.flatMap((sq) => extractKeyTerms(sq.query))];
  const uniqueTerms = [...new Set(keyTerms.map((t) => t.toLowerCase()))];
  const rankedChunks = rerankChunksByKeywords(allChunks, uniqueTerms, 40);

  console.log(`[Chat/RAG] ${searchQueries.length} queries → ${allChunks.length} unique chunks, ${allFigures.length} unique figures → top ${rankedChunks.length} chunks`);

  return { chunks: rankedChunks, figures: allFigures };
}

// --- Clean up cell values from Table Agent (fix common LLM formatting issues) ---
function cleanCellValue(cell) {
  if (typeof cell !== "string") return cell;
  let v = cell;
  // Fix leading dot before digits: ".303" → "0.303", ".25 K" → "0.25 K"
  v = v.replace(/(^|\s)\.(\d)/g, "$10.$2");
  // Fix trailing dot after digits: "303." → "303", "303. K" → "303 K"
  v = v.replace(/(\d)\.\s/g, "$1 ");
  v = v.replace(/(\d)\.$/g, "$1");
  return v;
}

// --- Assemble RAG context string from chunks, figures, and parsed matrices ---
// Three sections: (1) parsed matrices (pre-cleaned TSV), (2) OCR HTML (raw), (3) text chunks.
// Budget caps prevent context window overflow (LLM_CTX ≈ 131K tokens ≈ 400K chars).
const OCR_BUDGET = 60000;    // chars for raw OCR HTML tables
const MATRIX_BUDGET = 30000; // chars for parsed matrix TSV
const TOTAL_BUDGET = 120000; // overall cap

function assembleRagContext(chunks, figures, paperRefMap, parsedMatrices) {
  // --- Section 1: Parsed matrices (TSV) — most accurate, code-cleaned ---
  let matrixStr = "";
  if (parsedMatrices && parsedMatrices.length > 0) {
    const parts = [];
    for (const pm of parsedMatrices) {
      const ref = paperRefMap.get(pm.paperId);
      const refLabel = ref ? `[${ref.refNo}] ${ref.paperTitle || pm.paperTitle}` : pm.paperTitle;
      for (const t of pm.tables) {
        const headerLine = t.headers.join(" | ");
        const rowLines = t.rows.map((r) => r.join(" | ")).join("\n");
        const entry = `[${t.caption} — ${refLabel}]\n${headerLine}\n${rowLines}`;
        parts.push(entry);
      }
    }
    matrixStr = parts.join("\n\n");
    if (matrixStr.length > MATRIX_BUDGET) {
      matrixStr = matrixStr.slice(0, MATRIX_BUDGET) + "\n... (truncated)";
    }
  }

  // --- Section 2: OCR HTML tables (raw — for data LLM can't get from parsed matrices) ---
  const ocrEntries = figures
    .filter((f) => f.summary_text && f.summary_text.length > 30)
    .sort((a, b) => (b.summary_text?.length ?? 0) - (a.summary_text?.length ?? 0))
    .map((f) => {
      const ref = paperRefMap.get(f.paper_id);
      const refLabel = ref ? `[${ref.refNo}] ${ref.title}` : f.paper_id;
      return `[${f.figure_no} — ${refLabel}]\n${f.caption ?? ""}\n${f.summary_text}`;
    });
  let ocrTables = "";
  for (const entry of ocrEntries) {
    if (ocrTables.length + entry.length > OCR_BUDGET) break;
    ocrTables += (ocrTables ? "\n\n" : "") + entry;
  }

  // --- Section 3: Text chunks (supplementary) ---
  const usedBudget = matrixStr.length + ocrTables.length;
  const chunkBudget = Math.max(10000, TOTAL_BUDGET - usedBudget);
  let textChunksStr = "";
  for (let i = 0; i < chunks.length; i++) {
    const ref = paperRefMap.get(chunks[i].paper_id);
    const refLabel = ref ? `[${ref.refNo}]` : chunks[i].paper_id;
    const entry = `[Chunk ${i + 1}, ${refLabel}]\n${chunks[i].text}\n\n`;
    if (textChunksStr.length + entry.length > chunkBudget) break;
    textChunksStr += entry;
  }

  console.log(`[Chat/RAG] Context: matrices ${matrixStr.length} chars, OCR ${ocrTables.length} chars, chunks ${textChunksStr.length} chars`);

  let result = "";
  if (matrixStr) {
    result += `=== 파싱된 테이블 (정리된 수치 데이터 — 가장 정확한 소스) ===\n${matrixStr}\n\n`;
  }
  if (ocrTables) {
    result += `=== OCR 추출 테이블 (원본 HTML — 파싱 테이블에 없는 데이터 확인용) ===\n${ocrTables}\n\n`;
  }
  result += `=== 관련 텍스트 (보조) ===\n${textChunksStr}`;
  return result;
}

// --- Q&A Pipeline Handler ---
async function handleQaPipeline(convId, message, history, scopeFolderId, scopeAll, abortController) {
  console.log("[Chat/QA] Starting Q&A pipeline...");

  // Stage 1: RAG search
  broadcastToWindows(IPC_EVENTS.CHAT_STATUS, { conversationId: convId, stage: "searching", message: "관련 논문 데이터 검색 중..." });

  let filterPaperIds = null;
  if (!scopeAll && scopeFolderId) {
    filterPaperIds = await getPaperIdsInFolderTree(scopeFolderId);
  }

  // Use the user's message directly as the search query (simplified vs table pipeline)
  const searchQueries = [{ query: message, intent: "qa" }];
  const keyTerms = extractKeyTerms(message);
  const ragResults = await runMultiQueryRag(searchQueries, keyTerms, filterPaperIds);

  // If no results, inform user
  if (ragResults.chunks.length === 0 && ragResults.figures.length === 0) {
    const noDataMsg = "관련 데이터를 찾지 못했습니다. 요청을 더 구체적으로 해주시거나, 해당 주제의 논문이 라이브러리에 있는지 확인해주세요.";
    const { data: errMsg } = await supabase
      .from("chat_messages")
      .insert({ conversation_id: convId, role: "assistant", content: noDataMsg, message_type: "text" })
      .select("id")
      .single();
    await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    broadcastToWindows(IPC_EVENTS.CHAT_COMPLETE, { conversationId: convId, messageId: errMsg.id, hasTable: false });
    return { conversationId: convId, messageId: errMsg.id, hasTable: false };
  }

  // Collect paper metadata
  const paperIds = [...new Set([
    ...ragResults.chunks.map((c) => c.paper_id),
    ...ragResults.figures.map((f) => f.paper_id),
  ])];
  const { data: papers } = await supabase.from("papers").select("id, title, authors, publication_year, doi").in("id", paperIds);
  const paperMetadata = (papers ?? []).map((p) => ({
    paperId: p.id,
    title: p.title ?? "Untitled",
    authors: Array.isArray(p.authors) ? p.authors.map((a) => a.family ?? a.name ?? "").join(", ") : "",
    year: p.publication_year ?? 0,
    doi: p.doi ?? "",
  }));

  // Build paper ref map (for assembleRagContext)
  const paperRefMap = new Map();
  paperMetadata.forEach((p, i) => paperRefMap.set(p.paperId, { refNo: i + 1, title: p.title }));

  // Assemble RAG context (text-heavy, no parsed matrices for Q&A)
  const ragContext = assembleRagContext(ragResults.chunks, ragResults.figures, paperRefMap, []);

  // Stage 2: Q&A answering (streaming)
  broadcastToWindows(IPC_EVENTS.CHAT_STATUS, { conversationId: convId, stage: "answering", message: "답변 생성 중..." });
  console.log("[Chat/QA] Streaming Q&A response...");

  let fullResponse = "";
  for await (const token of generateQaResponse(ragContext, history, paperMetadata, abortController.signal)) {
    fullResponse += token;
    broadcastToWindows(IPC_EVENTS.CHAT_TOKEN, { conversationId: convId, token });
  }

  // Post-process: ensure source attribution
  const { text: finalText, referencedPaperIds } = formatSourceAttribution(fullResponse, paperMetadata);

  // Save assistant message
  const { data: msg } = await supabase
    .from("chat_messages")
    .insert({
      conversation_id: convId,
      role: "assistant",
      content: finalText,
      message_type: "text",
      metadata: {
        source_chunk_ids: ragResults.chunks.map((c) => c.chunk_id),
        referenced_paper_ids: referencedPaperIds,
      },
    })
    .select("id")
    .single();

  await supabase.from("chat_conversations").update({ phase: "follow_up", updated_at: new Date().toISOString() }).eq("id", convId);

  broadcastToWindows(IPC_EVENTS.CHAT_COMPLETE, { conversationId: convId, messageId: msg.id, hasTable: false });
  console.log(`[Chat/QA] Response complete. ${referencedPaperIds.length} papers referenced.`);

  return { conversationId: convId, messageId: msg.id, hasTable: false };
}

// --- CHAT_SEND_MESSAGE (Multi-agent pipeline) ---
ipcMain.handle(IPC_CHANNELS.CHAT_SEND_MESSAGE, async (_event, { conversationId, message, scopeFolderId, scopeAll, mode }) => {
  let convId = conversationId;
  let conversationType = mode || "table"; // default to table for backward compatibility

  try {
    // 1. Create or load conversation
    if (!convId) {
      const { data: appUser } = await supabase.from("app_users").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (!appUser?.id) {
        return { conversationId: null, error: "사용자를 찾을 수 없습니다. 먼저 로그인해주세요." };
      }
      const ownerId = appUser.id;
      const title = message.slice(0, 40) + (message.length > 40 ? "…" : "");
      const { data: conv } = await supabase
        .from("chat_conversations")
        .insert({ owner_user_id: ownerId, title, phase: "follow_up", scope_folder_id: scopeFolderId ?? null, scope_all: scopeAll ?? true, conversation_type: conversationType })
        .select("id")
        .single();
      convId = conv.id;
    } else {
      const { data: conv } = await supabase.from("chat_conversations").select("id, scope_folder_id, scope_all, conversation_type").eq("id", convId).single();
      if (!scopeFolderId && conv.scope_folder_id) scopeFolderId = conv.scope_folder_id;
      if (scopeAll === undefined) scopeAll = conv.scope_all;
      conversationType = conv.conversation_type || "table"; // use stored type for existing conversations
    }

    // 2. Insert user message
    await supabase.from("chat_messages").insert({
      conversation_id: convId,
      role: "user",
      content: message,
      message_type: "text",
    });

    // 3. Load conversation history
    const { data: historyRows } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    const history = (historyRows ?? []).map((m) => ({ role: m.role, content: m.content }));

    // Setup abort controller
    const abortController = new AbortController();
    chatAbortControllers.set(convId, abortController);

    // ===== Q&A Pipeline Branch =====
    if (conversationType === "qa") {
      return await handleQaPipeline(convId, message, history, scopeFolderId, scopeAll, abortController);
    }

    // ===== Table Pipeline (existing) =====

    // Fetch paper list for Orchestrator context
    const { data: allPapers } = await supabase.from("papers").select("id, title, authors, publication_year");
    const paperList = (allPapers ?? []).map((p) => ({
      title: p.title ?? "Untitled",
      authors: Array.isArray(p.authors) ? p.authors.map((a) => a.family ?? a.name ?? "").join(", ") : "",
      year: p.publication_year ?? 0,
    }));

    // Fetch previous table for modify_table context
    const { data: prevTables } = await supabase
      .from("chat_generated_tables")
      .select("table_title, headers, rows, source_refs")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: false })
      .limit(1);
    const previousTable = prevTables?.[0] ?? null;

    // ===== Stage 1: Orchestrator =====
    broadcastToWindows(IPC_EVENTS.CHAT_STATUS, { conversationId: convId, stage: "orchestrating", message: "사용자 요청 분석 중..." });
    console.log("[Chat] Stage 1: Orchestrator — analyzing intent...");

    const plan = await generateOrchestratorPlan(history, paperList, previousTable, abortController.signal);
    console.log(`[Chat] Orchestrator result: action=${plan.action}, queries=${plan.search_queries?.length ?? 0}`);

    // ===== Handle clarify action =====
    if (plan.action === "clarify") {
      // Clear pipeline — clarify doesn't need the full stepper
      broadcastToWindows(IPC_EVENTS.CHAT_STATUS, { conversationId: convId, stage: null, message: "" });
      const clarificationText = plan.clarification_response || "요청을 좀 더 구체적으로 해주세요.";
      // Stream clarification token-by-token for natural UX
      const tokens = clarificationText.split(/(?<=\s)/); // split on whitespace boundaries
      for (const token of tokens) {
        broadcastToWindows(IPC_EVENTS.CHAT_TOKEN, { conversationId: convId, token });
      }
      const { data: msg } = await supabase
        .from("chat_messages")
        .insert({ conversation_id: convId, role: "assistant", content: clarificationText, message_type: "text" })
        .select("id")
        .single();
      await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
      broadcastToWindows(IPC_EVENTS.CHAT_COMPLETE, { conversationId: convId, messageId: msg.id, hasTable: false });
      return { conversationId: convId, messageId: msg.id, hasTable: false };
    }

    // ===== Stage 2: Multi-query RAG =====
    broadcastToWindows(IPC_EVENTS.CHAT_STATUS, {
      conversationId: convId,
      stage: "searching",
      message: "관련 논문 데이터 검색 중...",
      detail: `${plan.search_queries.length}개 쿼리 실행`,
    });
    console.log(`[Chat] Stage 2: RAG — ${plan.search_queries.length} queries`);

    let filterPaperIds = null;
    if (!scopeAll && scopeFolderId) {
      filterPaperIds = await getPaperIdsInFolderTree(scopeFolderId);
    }

    const ragResults = await runMultiQueryRag(plan.search_queries, plan.keyword_hints, filterPaperIds);

    // If no RAG results found, inform user
    if (ragResults.chunks.length === 0 && ragResults.figures.length === 0) {
      const noDataMsg = "관련 데이터를 찾지 못했습니다. 요청을 더 구체적으로 해주시거나, 해당 주제의 논문이 라이브러리에 있는지 확인해주세요.";
      const { data: errMsg } = await supabase
        .from("chat_messages")
        .insert({ conversation_id: convId, role: "assistant", content: noDataMsg, message_type: "text" })
        .select("id")
        .single();
      await supabase.from("chat_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
      broadcastToWindows(IPC_EVENTS.CHAT_COMPLETE, { conversationId: convId, messageId: errMsg.id, hasTable: false });
      return { conversationId: convId, messageId: errMsg.id, hasTable: false };
    }

    // Collect paper metadata for Table Agent
    const paperIds = [...new Set([
      ...ragResults.chunks.map((c) => c.paper_id),
      ...ragResults.figures.map((f) => f.paper_id),
    ])];
    const { data: papers } = await supabase.from("papers").select("id, title, authors, publication_year, journal_name, doi").in("id", paperIds);
    const paperMetadata = (papers ?? []).map((p) => ({
      paperId: p.id,
      title: p.title ?? "Untitled",
      authors: Array.isArray(p.authors) ? p.authors.map((a) => a.family ?? a.name ?? "").join(", ") : "",
      year: p.publication_year ?? 0,
      journal: p.journal_name ?? "",
      doi: p.doi ?? "",
    }));

    // Backfill: ensure ALL table-type figures are available for every relevant paper.
    // match_figures uses semantic similarity, so it often misses OCR tables whose captions
    // don't closely match the query. Fetch all item_type='table' figures for papers in scope.
    const existingFigIds = new Set(ragResults.figures.map((f) => f.figure_id));
    const { data: allTableFigures, error: backfillErr } = await supabase
      .from("figures")
      .select("id, paper_id, figure_no, caption, item_type, summary_text, page")
      .in("paper_id", paperIds)
      .eq("item_type", "table");
    if (backfillErr) console.error("[Chat/RAG] backfill query error:", backfillErr.message);
    let backfillCount = 0;
    for (const f of allTableFigures ?? []) {
      if (existingFigIds.has(f.id)) continue;
      ragResults.figures.push({
        figure_id: f.id,
        paper_id: f.paper_id,
        figure_no: f.figure_no,
        caption: f.caption,
        item_type: f.item_type,
        summary_text: f.summary_text,
        page: f.page,
        similarity: 0,
      });
      backfillCount++;
    }
    if (backfillCount > 0) {
      console.log(`[Chat/RAG] Backfilled ${backfillCount} table figures not found by semantic search`);
    }

    // Build paper ref map
    const paperRefMap = new Map();
    paperMetadata.forEach((p, i) => paperRefMap.set(p.paperId, { refNo: i + 1, title: p.title }));

    // ===== Stage 3a: Parse — Code HTML parser + Extractor Agent fallback =====
    broadcastToWindows(IPC_EVENTS.CHAT_STATUS, { conversationId: convId, stage: "parsing", message: "OCR 테이블 파싱 중..." });
    console.log("[Chat] Stage 3a: Parsing OCR tables...");

    const tableSpec = plan.table_spec || {
      title: "비교 테이블",
      column_definitions: [],
    };

    // Group figures by paper_id
    const figuresByPaper = new Map();
    for (const f of ragResults.figures) {
      if (!figuresByPaper.has(f.paper_id)) figuresByPaper.set(f.paper_id, []);
      figuresByPaper.get(f.paper_id).push(f);
    }

    // Group chunks by paper_id (for text context)
    const chunksByPaper = new Map();
    for (const c of ragResults.chunks) {
      if (!chunksByPaper.has(c.paper_id)) chunksByPaper.set(c.paper_id, []);
      chunksByPaper.get(c.paper_id).push(c);
    }

    // Parse all OCR HTML tables per paper
    const parsedMatrices = []; // {paperIndex, paperId, paperTitle, tables: [{headers, rows, caption, source}]}
    let codeParseCount = 0;
    let llmParseCount = 0;

    const allPaperIds = [...new Set([...figuresByPaper.keys(), ...chunksByPaper.keys()])];
    for (let pi = 0; pi < allPaperIds.length; pi++) {
      const pid = allPaperIds[pi];
      const pMeta = paperMetadata.find((p) => p.paperId === pid);
      if (!pMeta) continue;

      const figures = figuresByPaper.get(pid) ?? [];
      const ocrFigures = figures.filter((f) => f.summary_text && f.summary_text.length > 30);

      if (ocrFigures.length === 0) continue;

      const tables = [];
      for (const fig of ocrFigures) {
        // Try code parser first
        const codeParsed = parseAllHtmlTables(fig.summary_text);
        const successTables = codeParsed.filter((t) => t.success);

        if (successTables.length > 0) {
          for (const t of successTables) {
            tables.push({
              headers: t.headers,
              rows: t.rows,
              caption: fig.caption || fig.figure_no || "",
              source: "code",
            });
            codeParseCount++;
          }
        } else {
          // Fallback: Extractor Agent LLM call
          try {
            broadcastToWindows(IPC_EVENTS.CHAT_STATUS, {
              conversationId: convId,
              stage: "parsing",
              message: `LLM 파싱 중... ${pMeta.title.slice(0, 30)}`,
            });
            const extracted = await extractMatrixFromHtml(fig.summary_text, abortController.signal);
            if (extracted.headers?.length > 0 && extracted.rows?.length > 0) {
              tables.push({
                headers: extracted.headers,
                rows: extracted.rows,
                caption: fig.caption || fig.figure_no || "",
                source: "llm",
              });
              llmParseCount++;
            }
          } catch (err) {
            console.error(`[Chat] Extractor Agent failed for ${fig.figure_no}:`, err.message);
          }
        }
      }

      if (tables.length > 0) {
        parsedMatrices.push({
          paperIndex: pi,
          paperId: pid,
          paperTitle: pMeta.title,
          tables,
        });
      }
    }

    console.log(`[Chat] Stage 3a: Parsed ${codeParseCount} tables (code) + ${llmParseCount} tables (LLM) from ${parsedMatrices.length} papers`);

    // ===== Stage 3: Table Agent — LLM-based data extraction =====
    broadcastToWindows(IPC_EVENTS.CHAT_STATUS, { conversationId: convId, stage: "assembling", message: "테이블 생성 중..." });
    console.log("[Chat] Stage 3: Table Agent — generating table from RAG context + parsed matrices...");

    const ragContext = assembleRagContext(ragResults.chunks, ragResults.figures, paperRefMap, parsedMatrices);
    let tableJson = await generateTableFromSpec(tableSpec, ragContext, paperMetadata, abortController.signal);

    // Post-process: clean cell values (fix LLM formatting artifacts)
    if (tableJson.rows) {
      tableJson.rows = tableJson.rows.map((row) => row.map((cell) => cleanCellValue(cell)));
    }
    console.log(`[Chat] Stage 3: Table Agent → ${tableJson.rows?.length ?? 0} rows, ${tableJson.references?.length ?? 0} references`);

    // Insert assistant message
    const { data: msg } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: convId,
        role: "assistant",
        content: JSON.stringify(tableJson),
        message_type: "table_report",
        metadata: { source_chunk_ids: ragResults.chunks.map((c) => c.chunk_id) },
      })
      .select("id")
      .single();

    // Update phase + timestamp
    await supabase.from("chat_conversations").update({ phase: "follow_up", updated_at: new Date().toISOString() }).eq("id", convId);

    // References: use merged refs if available, otherwise generate from paperMetadata
    const doiLookup = new Map(paperMetadata.map((p) => [p.paperId, p.doi]));
    let sourceRefs = tableJson.references?.length > 0 ? tableJson.references : null;
    if (!sourceRefs || sourceRefs.length === 0) {
      console.log("[Chat] No references — generating from paperMetadata");
      sourceRefs = paperMetadata.map((p, i) => ({
        refNo: String(i + 1),
        paperId: p.paperId,
        title: p.title,
        authors: p.authors,
        year: p.year,
        doi: p.doi,
      }));
    } else {
      sourceRefs = sourceRefs.map((ref) => ({
        ...ref,
        doi: ref.doi || doiLookup.get(ref.paperId) || "",
      }));
    }

    // Insert generated table
    const { data: tableRow } = await supabase
      .from("chat_generated_tables")
      .insert({
        message_id: msg.id,
        conversation_id: convId,
        table_title: tableJson.title,
        headers: tableJson.headers,
        rows: tableJson.rows,
        source_refs: sourceRefs,
      })
      .select("id")
      .single();
    const tableId = tableRow.id;

    // Update message metadata with tableId
    await supabase.from("chat_messages").update({
      metadata: { source_chunk_ids: ragResults.chunks.map((c) => c.chunk_id), table_id: tableId },
    }).eq("id", msg.id);

    broadcastToWindows(IPC_EVENTS.CHAT_COMPLETE, {
      conversationId: convId,
      messageId: msg.id,
      hasTable: true,
      tableId,
    });

    // ===== Stage 4: Guardian verification (background, sampled + batched) =====
    setImmediate(async () => {
      try {
        broadcastToWindows(IPC_EVENTS.CHAT_STATUS, { conversationId: convId, stage: "verifying", message: "데이터 검증 중..." });
        console.log("[Chat] Stage 4: Guardian — verifying data...");

        const allSourceTexts = [
          ...ragResults.figures.filter((f) => f.summary_text).map((f) => `${f.caption ?? ""}\n${f.summary_text}`),
          ...ragResults.chunks.slice(0, 20).map((c) => c.text),
        ];
        const combinedSource = allSourceTexts.join("\n\n").slice(0, 16000);

        // Collect all numeric cells to verify
        const cellsToVerify = [];
        for (let r = 0; r < tableJson.rows.length; r++) {
          for (let c = 0; c < tableJson.rows[r].length; c++) {
            const cellValue = tableJson.rows[r][c];
            if (!cellValue || cellValue === "N/A" || cellValue.trim() === "") continue;
            const cleanValue = cellValue.replace(/\[\d+\]/g, "").trim();
            if (!cleanValue || !/\d/.test(cleanValue)) continue;
            cellsToVerify.push({ row: r, col: c, cleanValue });
          }
        }

        // Sample max 50 cells (uniform sampling)
        const MAX_VERIFY = 50;
        const sampled = cellsToVerify.length > MAX_VERIFY
          ? cellsToVerify.filter((_, i) => i % Math.ceil(cellsToVerify.length / MAX_VERIFY) === 0)
          : cellsToVerify;
        console.log(`[Chat] Guardian: ${cellsToVerify.length} numeric cells → sampling ${sampled.length}`);

        // Batch parallel verification (5 concurrent)
        const BATCH_SIZE = 5;
        const verification = [];
        for (let i = 0; i < sampled.length; i += BATCH_SIZE) {
          const batch = sampled.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map((cell) => {
              const claim = `The value of ${tableJson.headers[cell.col]} is ${cell.cleanValue}`;
              return checkGroundedness(combinedSource, claim)
                .then((res) => ({ row: cell.row, col: cell.col, ...res }))
                .catch(() => ({ row: cell.row, col: cell.col, status: "unverified", evidence: "error" }));
            })
          );
          verification.push(...results);
        }

        await supabase.from("chat_generated_tables").update({ verification }).eq("id", tableId);
        broadcastToWindows(IPC_EVENTS.CHAT_VERIFICATION_DONE, { conversationId: convId, tableId, verification });
        console.log(`[Chat] Verification done: ${verification.filter((v) => v.status === "verified").length}/${verification.length} verified`);
      } catch (err) {
        console.error("[Chat] Verification error (non-fatal):", err.message);
      }
    });

    return { conversationId: convId, messageId: msg.id, hasTable: true, tableId };
  } catch (err) {
    if (err.name === "AbortError") {
      broadcastToWindows(IPC_EVENTS.CHAT_ERROR, { conversationId: convId, error: "aborted" });
      return { conversationId: convId, error: "aborted" };
    }
    console.error("[Chat] CHAT_SEND_MESSAGE error:", err);
    broadcastToWindows(IPC_EVENTS.CHAT_ERROR, { conversationId: convId, error: err.message });

    if (convId) {
      await supabase.from("chat_messages").insert({
        conversation_id: convId,
        role: "assistant",
        content: err.message,
        message_type: "error",
      }).catch(() => {});
    }
    return { conversationId: convId, error: err.message };
  } finally {
    chatAbortControllers.delete(convId);
  }
});

// --- CHAT_ABORT ---
ipcMain.handle(IPC_CHANNELS.CHAT_ABORT, (_event, { conversationId }) => {
  const ctrl = chatAbortControllers.get(conversationId);
  if (ctrl) {
    ctrl.abort();
    chatAbortControllers.delete(conversationId);
  }
  return { success: true };
});

// --- CHAT_EXPORT_CSV ---
ipcMain.handle(IPC_CHANNELS.CHAT_EXPORT_CSV, async (_event, { tableId }) => {
  const { data: table } = await supabase
    .from("chat_generated_tables")
    .select("table_title, headers, rows, source_refs")
    .eq("id", tableId)
    .single();

  if (!table) return { success: false, error: "Table not found" };

  // Build CSV string with BOM for Korean Excel compatibility
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    table.headers.map(escape).join(","),
    ...table.rows.map((row) => row.map(escape).join(",")),
  ];

  // Add References section
  if (table.source_refs && table.source_refs.length > 0) {
    lines.push(""); // blank line separator
    lines.push(escape("References"));
    lines.push([escape("No."), escape("Authors"), escape("Title"), escape("Year"), escape("DOI")].join(","));
    for (const ref of table.source_refs) {
      lines.push([
        escape(`[${ref.refNo}]`),
        escape(ref.authors ?? ""),
        escape(ref.title ?? ""),
        escape(ref.year ?? ""),
        escape(ref.doi ? `https://doi.org/${ref.doi}` : ""),
      ].join(","));
    }
  }

  const csv = "\uFEFF" + lines.join("\n");

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `${table.table_title ?? "table"}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });

  if (canceled || !filePath) return { success: false, error: "canceled" };

  await fs.writeFile(filePath, csv, "utf8");
  return { success: true, filePath };
});

// --- LLM Model Selection IPC Handlers ---

// Models to exclude from the user-facing list (Guardian, OCR)
const LLM_EXCLUDED_MODEL_PREFIXES = ["granite3-guardian", "glm-ocr"];

ipcMain.handle(IPC_CHANNELS.LLM_LIST_MODELS, async () => {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { success: false, error: `Ollama responded with ${res.status}` };
    const json = await res.json();
    const models = (json.models ?? [])
      .filter((m) => !LLM_EXCLUDED_MODEL_PREFIXES.some((prefix) => m.name.startsWith(prefix)))
      .map((m) => ({
        name: m.name,
        size: m.size,
        modified_at: m.modified_at,
        details: m.details ?? null,
      }));
    return { success: true, data: models };
  } catch (err) {
    return { success: false, error: err.message || "Ollama 연결 실패" };
  }
});

ipcMain.handle(IPC_CHANNELS.LLM_GET_MODEL, async () => {
  try {
    const model = getActiveModel();
    // Determine source: check DB first, then env, then default
    const { data: pref } = await supabase
      .from("user_workspace_preferences")
      .select("llm_model")
      .limit(1)
      .maybeSingle();
    let source = "default";
    if (pref?.llm_model) {
      source = "user";
    } else if (process.env.REDOU_LLM_MODEL) {
      source = "env";
    }
    return { success: true, data: { model, source } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(IPC_CHANNELS.LLM_SET_MODEL, async (_event, { model }) => {
  try {
    // Upsert into user_workspace_preferences
    const { data: existing } = await supabase
      .from("user_workspace_preferences")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("user_workspace_preferences")
        .update({ llm_model: model || null })
        .eq("id", existing.id);
    } else {
      // Get user ID for insert
      const { data: appUser } = await supabase
        .from("app_users")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (appUser?.id) {
        await supabase
          .from("user_workspace_preferences")
          .insert({ user_id: appUser.id, llm_model: model || null });
      }
    }

    // Update runtime variable
    setActiveModel(model);
    console.log(`[LLM] Active model changed to: ${getActiveModel()}`);
    return { success: true, data: { model: getActiveModel() } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


















