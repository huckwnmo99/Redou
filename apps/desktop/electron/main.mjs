import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { IPC_CHANNELS, IPC_EVENTS } from "./types/ipc-channels.mjs";
import { createClient } from "@supabase/supabase-js";
import zlib from "node:zlib";
import { extractHeuristicPaperData, inspectPdfMetadata, extractFigureImagesFromPdf } from "./pdf-heuristics.mjs";
import { generateEmbedding, generateEmbeddings, MODEL_NAME, EMBEDDING_DIM } from "./embedding-worker.mjs";
import { waitForOAuthCallback, getOAuthCallbackUrl } from "./oauth-callback-server.mjs";

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
const SUPABASE_KEY = process.env.REDOU_SUPABASE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// Window Management
// ============================================================
let mainWindow = null;
const detachedWindows = new Map();
const PROCESSING_POLL_INTERVAL_MS = 2500;
let processingInterval = null;
let processingJobInFlight = false;

// Bump this number whenever extraction logic changes (new item types, better parsing, etc.)
// Papers with extraction_version < CURRENT_EXTRACTION_VERSION will be auto-requeued on startup.
const CURRENT_EXTRACTION_VERSION = 3;
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

  mainWindow.webContents.openDevTools({ mode: "detach" });

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

async function persistHeuristicExtraction({ paperId, userId, sourceFileId, storedPath, paperTitle, currentAbstract, currentPublicationYear }) {
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
          const safeName = fi.figureNo.replace(/[^a-zA-Z0-9]/g, "_");

          if (fi.jpegBuffer) {
            // Raw JPEG from binary scan — save directly as .jpg
            const imagePath = path.join(figureDir, `${safeName}.jpg`);
            await fs.writeFile(imagePath, fi.jpegBuffer);
            figureImageMap.set(fi.figureNo, imagePath);
          } else if (fi.rgbaData && fi.width && fi.height) {
            // Decoded pixel data — encode as PNG
            const imagePath = path.join(figureDir, `${safeName}.png`);
            const pngBuffer = encodeRgbaPng(fi.width, fi.height, fi.rgbaData);
            await fs.writeFile(imagePath, pngBuffer);
            figureImageMap.set(fi.figureNo, imagePath);
          }
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
    resolvedTitle: paperPatch.title ?? null,
    extractionMode: extracted.extractionMode ?? "heuristic-fallback",
    layoutMode: extracted.layoutMode ?? "unknown",
    ocrAvailable: Boolean(extracted.ocrAvailable),
    ocrUsed: Boolean(extracted.ocrUsed),
    ocrProvider: extracted.ocrProvider ?? null,
    scannedLikelihood: extracted.scannedLikelihood ?? null,
  };
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
  });

  await sleep(150);

  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id,
    paperId: job.paper_id,
    status: "running",
    progress: 84,
    message: `${extractionResult.ocrUsed ? "OCR-backed extraction" : extractionResult.extractionMode === "layout-aware" ? extractionResult.layoutMode === "two-column" ? "Layout-aware two-column extraction" : "Layout-aware extraction" : "Fallback extraction"} staged ${extractionResult.sectionCount} sections, ${extractionResult.chunkCount} chunks, ${extractionResult.figureCount} figures, ${extractionResult.tableCount ?? 0} tables, and ${extractionResult.equationCount ?? 0} equations.`,
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

async function processNextQueuedJob() {
  if (processingJobInFlight) {
    return;
  }

  processingJobInFlight = true;
  let activeJob = null;

  try {
    const { data: queuedJobs, error: jobError } = await supabase
      .from("processing_jobs")
      .select("id, paper_id, user_id, source_path, job_type, status, created_at")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1);

    if (jobError) {
      throw new Error(jobError.message);
    }

    const job = queuedJobs?.[0];
    if (!job) {
      return;
    }

    activeJob = job;

    if (!job.paper_id) {
      throw new Error("Queued job is missing a paper_id.");
    }

    await updateJobStatus(job.id, {
      status: "running",
      started_at: new Date().toISOString(),
      error_message: null,
    });

    // ---- Route by job type ----
    if (job.job_type === "generate_embeddings") {
      await processEmbeddingJob(job);
    } else {
      await processImportPdfJob(job);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (activeJob?.id) {
      try {
        await updateJobStatus(activeJob.id, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: message,
        });
      } catch {
        // Best effort failure status update.
      }

      broadcastToWindows(IPC_EVENTS.JOB_FAILED, {
        jobId: activeJob.id,
        paperId: activeJob.paper_id ?? null,
        error: message,
      });
    }
  } finally {
    processingJobInFlight = false;
  }
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
    return { success: true, data: resolvedPath };
  } catch (err) {
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
    if (mainWindow) {
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
    for (const table of tables) {
      const { data } = await supabase.from(table).select("*");
      backup.tables[table] = data ?? [];
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
    return { success: false, error: err.message };
  }
});

ipcMain.handle(IPC_CHANNELS.BACKUP_LIST, async () => {
  const { data, error } = await supabase
    .from("backup_snapshots")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { success: false, error: error.message };
  return { success: true, data };
});

ipcMain.handle(IPC_CHANNELS.BACKUP_RESTORE, async (_event, { backupPath }) => {
  try {
    const content = await fs.readFile(backupPath, "utf-8");
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
    return { success: false, error: err.message };
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
    const embedding = await generateEmbedding(text);
    return { success: true, data: Array.from(embedding) };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
});

// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(async () => {
  await ensureDir(LIBRARY_ROOT);
  createMainWindow();
  await requeueOutdatedPapers();
  startProcessingLoop();

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




















