import "dotenv/config";
import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { IPC_CHANNELS, IPC_EVENTS } from "./types/ipc-channels.mjs";
import { throwIfChatAborted } from "./chat/abort-guards.mjs";
import { extractKeyTerms } from "./chat/extraction-utils.mjs";
import { createChatStatusEmitter } from "./chat/status-events.mjs";
import { assembleRagContext } from "./chat/table-extraction.mjs";
import { runTableConversationPipeline } from "./chat/table-pipeline.mjs";
import {
  buildEvidenceLocationsByPaper,
  serializeEvidenceLocations,
} from "./chat/source-evidence.mjs";
import { createClient } from "@supabase/supabase-js";
import zlib from "node:zlib";
import { inspectPdfMetadata, extractFigureImagesFromPdf } from "./pdf-heuristics.mjs";
import { generateEmbedding, generateEmbeddings, generateImageEmbedding, MODEL_NAME, EMBEDDING_DIM } from "./embedding-worker.mjs";
import { waitForOAuthCallback, getOAuthCallbackUrl } from "./oauth-callback-server.mjs";
import { enhanceEmptyTablesWithOcr } from "./ocr-extraction.mjs";
import { isMineruAvailable, parsePdf, parseMineruResult, saveFigureImages, saveTableImages } from "./mineru-client.mjs";
import { isGrobidAvailable, extractMetadataAndReferences, linkReferencesToExistingPapers } from "./grobid-client.mjs";
import { streamChat, checkGroundedness, isLlmAvailable, isGuardianAvailable, getActiveModel, setActiveModel, OLLAMA_BASE_URL } from "./llm-chat.mjs";
import { generateOrchestratorPlan, generateTableFromSpec, extractMatrixFromHtml, extractColumnsFromPaper, extractNullCellsFromPaper } from "./llm-orchestrator.mjs";
import { generateQaResponse, formatSourceAttribution } from "./llm-qa.mjs";
import { parseAllHtmlTables } from "./html-table-parser.mjs";
import { rerankChunks, isRerankerAvailable } from "./reranker-worker.mjs";

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
const fileDeleteCleanupTokens = new Map();
const PROCESSING_POLL_INTERVAL_MS = 2500;
let processingInterval = null;
let extractionInFlight = false;
let embeddingInFlight = false;

// Bump this number whenever extraction logic changes (new item types, better parsing, etc.)
// Papers with extraction_version < CURRENT_EXTRACTION_VERSION will be auto-requeued on startup.
// v25: V2 single pipeline (MinerU + GROBID). V1 heuristic fallback removed.
const CURRENT_EXTRACTION_VERSION = 25;
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
]);

// --- Contextual chunking helpers ---
const MAX_TITLE_LEN = 200;
const MAX_SECTION_LEN = 100;

function buildContextualText(paperTitle, sectionName, chunkText) {
  const title = (paperTitle ?? "Untitled").slice(0, MAX_TITLE_LEN);
  if (sectionName) {
    const section = sectionName.slice(0, MAX_SECTION_LEN);
    return `[Paper: ${title} | Section: ${section}] ${chunkText}`;
  }
  return `[Paper: ${title}] ${chunkText}`;
}

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

// Supabase single() 결과를 throw-on-error로 강제. 호출 측에서 구조분해 없이 사용.
function unwrapSingle({ data, error }, label) {
  if (error) throw new Error(`[supabase] ${label}: ${error.message}`);
  if (!data) throw new Error(`[supabase] ${label}: no row returned`);
  return data;
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

function resolveRedouFilePath(requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== "redou-file:") {
    throw new Error("Unsupported file protocol.");
  }

  let localPath = decodeURIComponent(url.pathname);
  if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(localPath)) {
    localPath = localPath.slice(1);
  } else if (url.hostname) {
    localPath = `//${url.hostname}${localPath}`;
  }

  return assertLibraryPath(localPath, "redou-file path");
}

function normalizePanelId(panelId) {
  if (typeof panelId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(panelId)) {
    throw new Error("Invalid detached panel id.");
  }

  return panelId;
}

async function resolveAuthenticatedUserId(authContext) {
  const userId = typeof authContext?.userId === "string" ? authContext.userId : "";
  const accessToken = typeof authContext?.accessToken === "string" ? authContext.accessToken : "";
  if (!userId || !accessToken) {
    throw new Error("Authentication is required.");
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(accessToken);

  if (error || user?.id !== userId) {
    throw new Error("Invalid auth session.");
  }

  return userId;
}

async function isOwnedDeletableLibraryPath(resolvedPath, userId) {
  const { data: paperFile, error: paperFileError } = await supabase
    .from("paper_files")
    .select("id, papers!inner(owner_user_id)")
    .eq("stored_path", resolvedPath)
    .eq("papers.owner_user_id", userId)
    .limit(1)
    .maybeSingle();
  if (paperFileError) throw new Error(paperFileError.message);
  if (paperFile?.id) return true;

  const { data: figureFile, error: figureFileError } = await supabase
    .from("figures")
    .select("id, papers!inner(owner_user_id)")
    .eq("image_path", resolvedPath)
    .eq("papers.owner_user_id", userId)
    .limit(1)
    .maybeSingle();
  if (figureFileError) throw new Error(figureFileError.message);

  return Boolean(figureFile?.id);
}

async function applyUserLlmPreference(userId) {
  const { data: pref, error } = await supabase
    .from("user_workspace_preferences")
    .select("llm_model")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  setActiveModel(pref?.llm_model || null);
  return getActiveModel();
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

// ============================================================
// Pipeline: MinerU + GROBID
// ============================================================

function mergeMetadata({ grobid, mineruSections, fallbackTitle, currentPaper }) {
  const gm = grobid || {};
  const title = gm.title || currentPaper?.title || fallbackTitle || mineruSections?.[0]?.sectionName || "";
  const abstract = gm.abstract || currentPaper?.abstract || "";
  const authors = (gm.authors && gm.authors.length > 0) ? gm.authors : (currentPaper?.authors || []);
  const doi = gm.doi || "";
  const year = gm.year || currentPaper?.publication_year || null;
  const journal = gm.journal || "";
  return { title, abstract, authors, doi, year, journal };
}

async function persistV2Results({
  paperId, userId, sourceFileId, metadata,
  sections, chunks, tables, equations, figures, references,
  storedPath, mineruImages, grobid, shouldUpdatePaperMetadata = true,
}) {
  // Delete only the rows produced by this source file so supplementary
  // processing cannot wipe the main PDF extraction output.
  await supabase.from("paper_chunks").delete().eq("paper_id", paperId).eq("source_file_id", sourceFileId);
  await supabase.from("figures").delete().eq("paper_id", paperId).eq("source_file_id", sourceFileId);
  await supabase.from("paper_sections").delete().eq("paper_id", paperId).eq("source_file_id", sourceFileId);

  // --- Sections ---
  const sectionIdByOrder = new Map();
  if (sections.length > 0) {
    const { data: sectionRows, error: sectionError } = await supabase
      .from("paper_sections")
      .insert(
        sections.map((s) => ({
          paper_id: paperId,
          source_file_id: sourceFileId,
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
          source_file_id: sourceFileId,
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
      const saved = await saveFigureImages(path.join(paperId, sourceFileId), figures, LIBRARY_ROOT);
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
            const figureDir = path.join(LIBRARY_ROOT, "Figures", paperId, sourceFileId);
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
      const saved = await saveTableImages(path.join(paperId, sourceFileId), tables, mineruImages, LIBRARY_ROOT);
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
      .eq("source_file_id", sourceFileId)
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
  if (shouldUpdatePaperMetadata && references && references.length > 0) {
    await supabase.from("paper_references").delete().eq("paper_id", paperId);
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

  if (shouldUpdatePaperMetadata) {
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
  await upsertPaperSummaryV2(paperId, userId, sections, metadata, grobid);
  }

  return {
    sectionCount: sections.length,
    chunkCount: chunks.length,
    figureCount: figures.length,
    tableCount: tables.length,
    equationCount: equations.length,
    referenceCount: references?.length ?? 0,
  };
}

async function upsertPaperSummaryV2(paperId, userId, sections, metadata, grobid) {
  const sectionText = (names) => {
    const s = sections.find((sec) => names.some((n) => sec.sectionName.toLowerCase().includes(n.toLowerCase())));
    return s?.rawText?.slice(0, 380) || "";
  };

  const sourceText = grobid ? "MinerU+GROBID" : "MinerU only (GROBID unavailable)";
  const oneLine = `V2 extraction: ${sections.length} sections, from ${sourceText}.`;
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
  paperId, userId, sourceFileId, storedPath, paperTitle, currentPaper, grobidAvailable = true,
  shouldUpdatePaperMetadata = true, onProgress,
}) {
  const pdfBuffer = await fs.readFile(storedPath);

  // Phase 1: 병렬 추출 (MinerU + GROBID)
  onProgress?.({ progress: 15, message: "MinerU + GROBID 병렬 추출 중..." });

  const grobidTask = grobidAvailable
    ? extractMetadataAndReferences(pdfBuffer)
    : Promise.resolve(null);

  const [mineruResult, grobidResult] = await Promise.allSettled([
    parsePdf(pdfBuffer, { backend: "pipeline", lang: "en" }),
    grobidTask,
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

  console.log(`[pipeline] MinerU v${mineruResult.value.version}: ${parsed.sections.length} sections, ${parsed.tables.length} tables, ${parsed.equations.length} equations, ${parsed.figures.length} figures (${mineruResult.value.processingTime}ms)`);
  if (grobid) {
    console.log(`[pipeline] GROBID: ${grobid.references.length} references, title="${grobid.metadata.title?.slice(0, 50)}" (${grobid.processingTime}ms)`);
  } else {
    console.warn("[pipeline] GROBID unavailable — proceeding with MinerU-only metadata (degraded mode)");
  }

  // Phase 3: 메타데이터 병합
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
    grobid,
    shouldUpdatePaperMetadata,
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

  let sourceFile = null;
  if (job.source_file_id) {
    const { data, error } = await supabase
      .from("paper_files")
      .select("id, stored_path, file_kind, is_primary")
      .eq("paper_id", job.paper_id)
      .eq("id", job.source_file_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    sourceFile = data ?? null;
  }

  if (!sourceFile) {
    const { data, error } = await supabase
      .from("paper_files")
      .select("id, stored_path, file_kind, is_primary")
      .eq("paper_id", job.paper_id)
      .eq("stored_path", job.source_path)
      .maybeSingle();
    if (error) throw new Error(error.message);
    sourceFile = data ?? null;
  }

  if (!sourceFile) {
    const { data: primaryFiles, error: fileError } = await supabase
      .from("paper_files")
      .select("id, stored_path, file_kind, is_primary")
      .eq("paper_id", job.paper_id)
      .eq("is_primary", true)
      .limit(1);
    if (fileError) throw new Error(fileError.message);
    sourceFile = primaryFiles?.[0] ?? null;
  }

  if (!sourceFile) {
    throw new Error("Paper source file is missing for this processing job.");
  }

  const resolvedStoredPath = assertLibraryPath(sourceFile.stored_path ?? job.source_path, "Paper source file path");
  await fs.access(resolvedStoredPath);
  const shouldUpdatePaperMetadata = sourceFile.is_primary && sourceFile.file_kind === "main_pdf";

  // --- Single pipeline: MinerU + GROBID (V2) ---
  // MinerU is REQUIRED. GROBID is optional (degraded mode: warn and proceed).
  const [mineruAvailable, grobidAvailable] = await Promise.all([
    isMineruAvailable(),
    isGrobidAvailable(),
  ]);

  if (!mineruAvailable) {
    throw new Error(
      "MinerU 서비스가 실행되지 않았습니다 (http://localhost:8001). " +
      "PDF 임포트 전에 MinerU Docker 컨테이너를 시작해주세요.",
    );
  }
  if (!grobidAvailable) {
    console.warn("[process] GROBID unavailable — proceeding in degraded mode (metadata/references may be incomplete)");
  }

  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id, paperId: job.paper_id, status: "running",
    progress: 15, message: "PDF 분석 중 (MinerU + GROBID)...",
  });

  const extractionResult = await processWithMineruGrobid({
    paperId: job.paper_id,
    userId: job.user_id ?? null,
    sourceFileId: sourceFile.id,
    storedPath: resolvedStoredPath,
    paperTitle: paperRow.title ?? "",
    currentPaper: paperRow,
    grobidAvailable,
    shouldUpdatePaperMetadata,
    onProgress: ({ progress, message }) => {
      broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
        jobId: job.id, paperId: job.paper_id, status: "running", progress, message,
      });
    },
  });

  if (!extractionResult) {
    throw new Error(
      "PDF 분석에 실패했습니다. MinerU가 PDF를 처리하지 못했습니다. " +
      "PDF가 손상되었거나 지원되지 않는 형식일 수 있습니다.",
    );
  }

  console.log(`[process] Pipeline succeeded: ${extractionResult.sectionCount} sections, ${extractionResult.tableCount} tables, ${extractionResult.equationCount} equations, ${extractionResult.referenceCount} references`);

  broadcastToWindows(IPC_EVENTS.JOB_PROGRESS, {
    jobId: job.id, paperId: job.paper_id, status: "running",
    progress: 75,
    message: `PDF 분석 완료: ${extractionResult.sectionCount}섹션, ${extractionResult.chunkCount}청크, ${extractionResult.figureCount}그림, ${extractionResult.tableCount}테이블, ${extractionResult.equationCount}수식, ${extractionResult.referenceCount}참고문헌`,
  });

  // --- Empty-table OCR fallback (GLM-OCR) ---
  // MinerU가 빈 테이블을 반환한 경우 GLM-OCR로 보강 시도.
  try {
    const { data: emptyTables } = await supabase
      .from("figures")
      .select("id, figure_no, page")
      .eq("paper_id", job.paper_id)
      .eq("source_file_id", sourceFile.id)
      .eq("item_type", "table")
      .or("summary_text.is.null,summary_text.eq.");

    if (emptyTables && emptyTables.length > 0) {
      console.log(`[process] ${emptyTables.length} empty tables detected, attempting GLM-OCR fallback...`);
      const pdfBuffer = await fs.readFile(resolvedStoredPath);
      const ocrResults = await enhanceEmptyTablesWithOcr(
        pdfBuffer,
        emptyTables.map((t) => ({ figureNo: t.figure_no, page: t.page })),
      );
      let updated = 0;
      for (const r of ocrResults) {
        const match = emptyTables.find((t) => t.figure_no === r.figureNo);
        if (match) {
          const { error } = await supabase
            .from("figures")
            .update({ summary_text: r.summaryText, plain_text: r.plainText || null })
            .eq("id", match.id);
          if (!error) updated++;
        }
      }
      console.log(`[process] Empty-table OCR fallback: ${updated}/${emptyTables.length} tables enhanced`);
    }
  } catch (ocrErr) {
    console.warn(`[process] Empty-table OCR fallback failed (non-fatal):`, ocrErr.message);
  }

  // Mark job succeeded
  await updateJobStatus(job.id, {
    status: "succeeded",
    finished_at: new Date().toISOString(),
    error_message: null,
  });

  broadcastToWindows(IPC_EVENTS.JOB_COMPLETED, {
    jobId: job.id,
    paperId: job.paper_id,
    result: { paperId: job.paper_id, status: "succeeded", ...extractionResult },
  });

  // Queue embedding generation
  if (extractionResult.chunkCount > 0) {
    await supabase.from("processing_jobs").insert({
      paper_id: job.paper_id,
      user_id: job.user_id,
      job_type: "generate_embeddings",
      status: "queued",
      source_path: resolvedStoredPath,
      source_file_id: sourceFile.id,
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
  let chunkQuery = supabase
    .from("paper_chunks")
    .select("id, text, section_id")
    .eq("paper_id", job.paper_id)
    .order("chunk_order", { ascending: true });
  if (job.source_file_id) {
    chunkQuery = chunkQuery.eq("source_file_id", job.source_file_id);
  }
  const { data: chunks, error: chunkError } = await chunkQuery;

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

  // Load paper title and section map for contextual prefix
  let paperTitle = "Untitled";
  try {
    const paperMeta = unwrapSingle(await supabase
      .from("papers").select("title")
      .eq("id", job.paper_id)
      .single(), "embedding-paper-title");
    paperTitle = paperMeta.title ?? "Untitled";
  } catch (e) {
    console.warn("[Embedding] paper title lookup failed:", e.message);
  }

  const { data: sections } = await supabase
    .from("paper_sections")
    .select("id, section_name")
    .eq("paper_id", job.paper_id);
  const sectionMap = new Map((sections ?? []).map((s) => [s.id, s.section_name]));

  const texts = chunksToEmbed.map((c) =>
    buildContextualText(paperTitle, sectionMap.get(c.section_id), c.text)
  );
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

    let paper = null;
    try {
      paper = unwrapSingle(await supabase
        .from("papers").select("title, abstract, embedding")
        .eq("id", job.paper_id)
        .single(), "doc-embedding-paper");
    } catch (e) {
      console.warn("[Embedding] paper lookup failed:", e.message);
    }
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
      .select("id, paper_id, user_id, source_path, source_file_id, job_type, status, created_at")
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
      .select("id, paper_id, user_id, source_path, source_file_id, job_type, status, created_at")
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
        .select("id, stored_path")
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
        source_file_id: fileRow.id,
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
    const cleanupToken = crypto.randomUUID();
    fileDeleteCleanupTokens.set(cleanupToken, destPath);

    return {
      success: true,
      data: {
        storedPath: destPath,
        storedFilename: path.basename(destPath),
        originalFilename: path.basename(resolvedSourcePath),
        checksum,
        fileSize: stat.size,
        cleanupToken,
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

ipcMain.handle(IPC_CHANNELS.FILE_DELETE, async (_event, { storedPath, cleanupToken, userId, accessToken }) => {
  try {
    const resolvedPath = assertLibraryPath(storedPath, "Delete path");
    let tokenMatched = false;
    if (typeof cleanupToken === "string") {
      const tokenPath = fileDeleteCleanupTokens.get(cleanupToken);
      tokenMatched = Boolean(tokenPath) && path.resolve(tokenPath) === resolvedPath;
    }

    if (!tokenMatched) {
      const ownerId = await resolveAuthenticatedUserId({ userId, accessToken });
      const isOwned = await isOwnedDeletableLibraryPath(resolvedPath, ownerId);
      if (!isOwned) {
        return { success: false, error: "Delete path is not registered to the current workspace user." };
      }
    }

    await fs.unlink(resolvedPath);
    if (tokenMatched) {
      fileDeleteCleanupTokens.delete(cleanupToken);
    }
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

ipcMain.handle(IPC_CHANNELS.WINDOW_DETACH_PANEL, async (_event, { panelId }) => {
  const safePanelId = normalizePanelId(panelId);
  if (detachedWindows.has(safePanelId)) {
    detachedWindows.get(safePanelId).focus();
    return { success: true, windowId: safePanelId };
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

  const targetUrl = `${rendererUrl}#/detached/${safePanelId}`;
  const detachedHash = `/detached/${safePanelId}`;
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
      `detached panel ${safePanelId}`
    );
    win.loadURL(targetUrl);
  }

  detachedWindows.set(safePanelId, win);
  win.on("closed", () => {
    detachedWindows.delete(safePanelId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_EVENTS.FILE_CHANGED, {
        type: "panel-reattached",
        panelId: safePanelId,
      });
    }
  });

  return { success: true, windowId: safePanelId };
});

ipcMain.handle(IPC_CHANNELS.WINDOW_REATTACH_PANEL, async (_event, { panelId }) => {
  const safePanelId = normalizePanelId(panelId);
  const win = detachedWindows.get(safePanelId);
  if (win) {
    win.close();
    detachedWindows.delete(safePanelId);
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
  // Handle redou-file:// protocol for files inside the Redou library only.
  protocol.handle("redou-file", (request) => {
    const resolvedPath = resolveRedouFilePath(request.url);
    const fileUrl = pathToFileURL(resolvedPath).toString();
    console.log(`[redou-file] ${request.url} -> ${fileUrl}`);
    return net.fetch(fileUrl);
  });

  await ensureDir(LIBRARY_ROOT);
  console.log(`[LLM] Startup model: ${getActiveModel()}. User preference is applied per authenticated request.`);
  createMainWindow();
  await resetStaleRunningJobs();
  await requeueOutdatedPapers();
  startProcessingLoop();
  // Background DOI lookup is opt-in because it sends paper titles to CrossRef.
  if (process.env.REDOU_ENABLE_CROSSREF_DOI === "1") {
    setImmediate(() => fillMissingDois().catch((e) => console.warn("[DOI] fillMissingDois error:", e.message)));
  } else {
    console.log("[DOI] CrossRef auto lookup disabled. Set REDOU_ENABLE_CROSSREF_DOI=1 to enable it.");
  }

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

async function getPaperIdsForUser(userId) {
  const { data, error } = await supabase
    .from("papers")
    .select("id")
    .eq("owner_user_id", userId)
    .is("trashed_at", null);
  if (error) throw new Error(`[supabase] papers owner filter: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}

function intersectPaperIds(basePaperIds, scopedPaperIds) {
  const allowed = new Set(basePaperIds);
  return scopedPaperIds.filter((paperId) => allowed.has(paperId));
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

// --- RRF (Reciprocal Rank Fusion): merge vector + BM25 results ---
function rrfFusion(vectorChunks, bm25Chunks, mode = "table", k = 60) {
  // Mode-dependent weights
  const wBM25 = mode === "qa" ? 0.3 : 0.6;
  const wVector = mode === "qa" ? 0.7 : 0.4;
  const MISSING_RANK = 1000;

  // Build rank maps (chunk_id → rank, 0-based)
  const vectorRankMap = new Map();
  vectorChunks.forEach((c, idx) => vectorRankMap.set(c.chunk_id, idx));

  const bm25RankMap = new Map();
  bm25Chunks.forEach((c, idx) => bm25RankMap.set(c.chunk_id, idx));

  // Union of all chunk_ids → keep the chunk object (prefer vector copy for similarity field)
  const chunkObjMap = new Map();
  for (const c of vectorChunks) chunkObjMap.set(c.chunk_id, c);
  for (const c of bm25Chunks) {
    if (!chunkObjMap.has(c.chunk_id)) chunkObjMap.set(c.chunk_id, c);
  }

  // Compute RRF score for each chunk
  const scored = [];
  for (const [chunkId, chunk] of chunkObjMap) {
    const vRank = vectorRankMap.has(chunkId) ? vectorRankMap.get(chunkId) : MISSING_RANK;
    const bRank = bm25RankMap.has(chunkId) ? bm25RankMap.get(chunkId) : MISSING_RANK;
    const rrfScore = wVector * (1 / (k + vRank)) + wBM25 * (1 / (k + bRank));
    scored.push({ ...chunk, _rrfScore: rrfScore });
  }

  // Sort by RRF score descending
  scored.sort((a, b) => b._rrfScore - a._rrfScore);

  return scored.slice(0, 40);
}

// --- RRF Fusion for Figures (BM25 + Vector) ---
function rrfFusionFigures(vectorFigures, bm25Figures, k = 60) {
  const wBM25 = 0.6;
  const wVector = 0.4;
  const TABLE_BOOST = 0.005;
  const MISSING_RANK = 1000;

  // Build rank maps (figure_id → rank, 0-based)
  const vectorRankMap = new Map();
  vectorFigures.forEach((f, idx) => vectorRankMap.set(f.figure_id, idx));

  const bm25RankMap = new Map();
  bm25Figures.forEach((f, idx) => bm25RankMap.set(f.figure_id, idx));

  // Union of all figure_ids — prefer vector copy for similarity field
  const figObjMap = new Map();
  for (const f of vectorFigures) figObjMap.set(f.figure_id, f);
  for (const f of bm25Figures) {
    if (!figObjMap.has(f.figure_id)) figObjMap.set(f.figure_id, f);
  }

  // Compute RRF score for each figure
  const scored = [];
  for (const [figId, fig] of figObjMap) {
    const vRank = vectorRankMap.has(figId) ? vectorRankMap.get(figId) : MISSING_RANK;
    const bRank = bm25RankMap.has(figId) ? bm25RankMap.get(figId) : MISSING_RANK;
    let rrfScore = wVector * (1 / (k + vRank)) + wBM25 * (1 / (k + bRank));
    // Boost tables (item_type='table') for table generation pipeline
    if (fig.item_type === "table") rrfScore += TABLE_BOOST;
    scored.push({ ...fig, _rrfScore: rrfScore });
  }

  // Sort by RRF score descending
  scored.sort((a, b) => b._rrfScore - a._rrfScore);

  return scored;
}

// --- Reranker: cross-encoder re-scoring after RRF fusion ---
const RERANKER_TOPK = { table: 15, qa: 10 };

async function rerankChunksIfAvailable(query, chunks, mode) {
  const topK = RERANKER_TOPK[mode] ?? 15;
  try {
    const available = await isRerankerAvailable();
    if (!available) {
      console.log("[reranker] Not available, using RRF order");
      return chunks.slice(0, topK);
    }
    const start = Date.now();
    const result = await rerankChunks(query, chunks, topK);
    console.log(`[reranker] Reranked ${chunks.length} → ${result.length} chunks in ${Date.now() - start}ms`);
    return result;
  } catch (err) {
    console.warn("[reranker] Failed, falling back to RRF order:", err.message);
    return chunks.slice(0, topK);
  }
}

// --- Multi-query RAG: run multiple embedding searches and merge results ---
async function runMultiQueryRag(searchQueries, keywordHints, filterPaperIds, mode = "table") {
  const vectorChunkMap = new Map(); // chunkId → chunk (keep highest similarity)
  const bm25ChunkMap = new Map(); // chunkId → chunk (keep highest bm25_rank)
  const vectorFigureMap = new Map(); // figureId → figure (vector search)
  const bm25FigureMap = new Map(); // figureId → figure (BM25 search, table mode only)

  for (const sq of searchQueries) {
    const emb = await generateEmbedding(sq.query, "query");

    // BM25 query text = search query only (keyword_hints는 Orchestrator가 이미 search_queries에 반영.
    // 합치면 OR tsquery에서 불필요한 단어가 늘어 랭킹 품질 저하)
    const bm25QueryText = sq.query;

    // Run vector search, BM25 search, figure search (+ figure BM25 in table mode) in parallel
    const promises = [
      supabase.rpc("match_chunks", {
        query_embedding: emb,
        match_threshold: 0.2,
        match_count: 60,
        filter_paper_ids: filterPaperIds,
      }),
      supabase.rpc("match_chunks_bm25", {
        query_text: bm25QueryText,
        match_count: 60,
        filter_paper_ids: filterPaperIds,
      }),
      supabase.rpc("match_figures", {
        query_embedding: emb,
        match_threshold: 0.15,
        match_count: 30,
        filter_item_types: ["table", "figure", "equation"],
        filter_paper_ids: filterPaperIds,
      }),
    ];
    // In table mode, also run BM25 search on figures (tables only)
    if (mode === "table") {
      promises.push(
        supabase.rpc("match_figures_bm25", {
          query_text: bm25QueryText,
          match_count: 30,
          filter_item_types: ["table"],
          filter_paper_ids: filterPaperIds,
        })
      );
    }

    const results = await Promise.all(promises);
    const [vectorResult, bm25Result, figureResult] = results;
    const figureBm25Result = mode === "table" ? results[3] : null;

    // Accumulate vector chunks
    if (vectorResult.error) console.error("[Chat/RAG] match_chunks error:", vectorResult.error.message);
    for (const c of vectorResult.data ?? []) {
      const existing = vectorChunkMap.get(c.chunk_id);
      if (!existing || (c.similarity > existing.similarity)) {
        vectorChunkMap.set(c.chunk_id, c);
      }
    }

    // Accumulate BM25 chunks
    if (bm25Result.error) console.error("[Chat/RAG] match_chunks_bm25 error:", bm25Result.error.message);
    for (const c of bm25Result.data ?? []) {
      const existing = bm25ChunkMap.get(c.chunk_id);
      if (!existing || (c.bm25_rank > existing.bm25_rank)) {
        bm25ChunkMap.set(c.chunk_id, c);
      }
    }

    // Accumulate vector figures
    if (figureResult.error) console.error("[Chat/RAG] match_figures error:", figureResult.error.message);
    for (const f of figureResult.data ?? []) {
      const existing = vectorFigureMap.get(f.figure_id);
      if (!existing || (f.similarity > existing.similarity)) {
        vectorFigureMap.set(f.figure_id, f);
      }
    }

    // Accumulate BM25 figures (table mode only)
    if (figureBm25Result) {
      if (figureBm25Result.error) console.error("[Chat/RAG] match_figures_bm25 error:", figureBm25Result.error.message);
      for (const f of figureBm25Result.data ?? []) {
        const existing = bm25FigureMap.get(f.figure_id);
        if (!existing || (f.bm25_rank > existing.bm25_rank)) {
          bm25FigureMap.set(f.figure_id, f);
        }
      }
    }
  }

  const allVectorChunks = [...vectorChunkMap.values()];
  const allBm25Chunks = [...bm25ChunkMap.values()];
  const allVectorFigures = [...vectorFigureMap.values()];
  const allBm25Figures = [...bm25FigureMap.values()];

  // RRF fusion for chunks
  const rankedChunks = rrfFusion(allVectorChunks, allBm25Chunks, mode);

  // RRF fusion for figures (table mode) or plain vector figures (qa mode)
  let allFigures;
  if (mode === "table" && allBm25Figures.length > 0) {
    allFigures = rrfFusionFigures(allVectorFigures, allBm25Figures);
    console.log(`[Chat/RAG] Figure RRF: ${allVectorFigures.length} vector + ${allBm25Figures.length} BM25 → ${allFigures.length} fused`);
  } else {
    allFigures = allVectorFigures;
  }

  // Reranker: cross-encoder re-scoring for higher-quality top-K
  const originalQuery = searchQueries.map(sq => sq.query).join(" ");
  const rerankedChunks = await rerankChunksIfAvailable(originalQuery, rankedChunks, mode);

  console.log(`[Chat/RAG] ${searchQueries.length} queries → ${allVectorChunks.length} vector + ${allBm25Chunks.length} BM25 chunks, ${allFigures.length} figures → RRF ${rankedChunks.length} → reranked ${rerankedChunks.length} (mode=${mode})`);

  return { chunks: rerankedChunks, figures: allFigures };
}

async function loadSourceFileMetadataMap(sourceFileIds) {
  const ids = [...new Set((sourceFileIds ?? []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("paper_files")
    .select("id, file_kind, original_filename, stored_filename")
    .in("id", ids);
  if (error) {
    console.error("[Chat/RAG] source file metadata lookup error:", error.message);
    return new Map();
  }

  return new Map((data ?? []).map((file) => [file.id, {
    source_file_kind: file.file_kind,
    source_filename: file.original_filename || file.stored_filename || "",
  }]));
}

// --- Generic groupBy helper ---
function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items ?? []) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

async function runPaperScopedRecoverySearch(queries, paperId, abortSignal) {
  if (abortSignal?.aborted) {
    const err = new Error("Agentic NULL recovery aborted");
    err.name = "AbortError";
    throw err;
  }
  if (!paperId || !Array.isArray(queries) || queries.length === 0) {
    return { chunks: [], figures: [] };
  }
  const result = await runMultiQueryRag(queries, [], [paperId], "table");
  if (abortSignal?.aborted) {
    const err = new Error("Agentic NULL recovery aborted");
    err.name = "AbortError";
    throw err;
  }
  return {
    chunks: result?.chunks ?? [],
    figures: result?.figures ?? [],
  };
}

// --- Q&A Pipeline Handler ---
async function handleQaPipeline(convId, message, history, scopeFolderId, scopeAll, abortController, ownerPaperIds) {
  console.log("[Chat/QA] Starting Q&A pipeline...");
  const emitStatus = createChatStatusEmitter({ conversationId: convId, send: broadcastToWindows });

  // Stage 1: RAG search
  emitStatus({ stage: "searching", message: "관련 논문 데이터 검색 중..." });

  let filterPaperIds = ownerPaperIds;
  if (!scopeAll && scopeFolderId) {
    filterPaperIds = intersectPaperIds(ownerPaperIds, await getPaperIdsInFolderTree(scopeFolderId));
  }

  // Use the user's message directly as the search query (simplified vs table pipeline)
  const searchQueries = [{ query: message, intent: "qa" }];
  const keyTerms = extractKeyTerms(message);
  const ragResults = await runMultiQueryRag(searchQueries, keyTerms, filterPaperIds, "qa");
  throwIfChatAborted(abortController.signal);

  // If no results, inform user
  if (ragResults.chunks.length === 0 && ragResults.figures.length === 0) {
    const noDataMsg = "관련 데이터를 찾지 못했습니다. 요청을 더 구체적으로 해주시거나, 해당 주제의 논문이 라이브러리에 있는지 확인해주세요.";
    const errMsg = unwrapSingle(await supabase
      .from("chat_messages")
      .insert({ conversation_id: convId, role: "assistant", content: noDataMsg, message_type: "text" })
      .select("id")
      .single(), "chat_messages insert (qa/no-data)");
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
  const evidenceLocationsByPaper = buildEvidenceLocationsByPaper(ragResults.chunks, ragResults.figures);

  // Assemble RAG context (text-heavy, no parsed matrices for Q&A)
  const ragContext = assembleRagContext(ragResults.chunks, ragResults.figures, paperRefMap, []);

  // Stage 2: Q&A answering (streaming)
  emitStatus({ stage: "answering", message: "답변 생성 중..." });
  console.log("[Chat/QA] Streaming Q&A response...");

  let fullResponse = "";
  for await (const token of generateQaResponse(ragContext, history, paperMetadata, abortController.signal)) {
    fullResponse += token;
    broadcastToWindows(IPC_EVENTS.CHAT_TOKEN, { conversationId: convId, token });
  }
  throwIfChatAborted(abortController.signal);

  // Post-process: ensure source attribution
  const { text: finalText, referencedPaperIds } = formatSourceAttribution(fullResponse, paperMetadata, evidenceLocationsByPaper);

  // Save assistant message
  const msg = unwrapSingle(await supabase
    .from("chat_messages")
    .insert({
      conversation_id: convId,
      role: "assistant",
      content: finalText,
      message_type: "text",
      metadata: {
        source_chunk_ids: ragResults.chunks.map((c) => c.chunk_id),
        referenced_paper_ids: referencedPaperIds,
        source_evidence_locations: serializeEvidenceLocations(evidenceLocationsByPaper),
      },
    })
    .select("id")
    .single(), "chat_messages insert (qa/final)");

  await supabase.from("chat_conversations").update({ phase: "follow_up", updated_at: new Date().toISOString() }).eq("id", convId);

  broadcastToWindows(IPC_EVENTS.CHAT_COMPLETE, { conversationId: convId, messageId: msg.id, hasTable: false });
  console.log(`[Chat/QA] Response complete. ${referencedPaperIds.length} papers referenced.`);

  return { conversationId: convId, messageId: msg.id, hasTable: false };
}

// --- CHAT_SEND_MESSAGE (Multi-agent pipeline) ---
ipcMain.handle(IPC_CHANNELS.CHAT_SEND_MESSAGE, async (_event, { conversationId, message, scopeFolderId, scopeAll, mode, userId, accessToken }) => {
  let convId = conversationId;
  let conversationType = mode || "table"; // default to table for backward compatibility

  try {
    const ownerId = await resolveAuthenticatedUserId({ userId, accessToken });
    await applyUserLlmPreference(ownerId);
    const ownerPaperIds = await getPaperIdsForUser(ownerId);

    // 1. Create or load conversation
    if (!convId) {
      const title = message.slice(0, 40) + (message.length > 40 ? "…" : "");
      const conv = unwrapSingle(await supabase
        .from("chat_conversations")
        .insert({ owner_user_id: ownerId, title, phase: "follow_up", scope_folder_id: scopeFolderId ?? null, scope_all: scopeAll ?? true, conversation_type: conversationType })
        .select("id")
        .single(), "chat_conversations insert");
      convId = conv.id;
    } else {
      const { data: conv, error: convErr } = await supabase
        .from("chat_conversations")
        .select("id, scope_folder_id, scope_all, conversation_type")
        .eq("id", convId)
        .eq("owner_user_id", ownerId)
        .maybeSingle();
      if (convErr) throw new Error(`[supabase] chat_conversations load: ${convErr.message}`);
      if (!conv) throw new Error(`[supabase] chat_conversations load: 존재하지 않는 대화입니다 (${convId})`);
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
      .select("role, content, message_type")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    const history = (historyRows ?? []).map((m) => ({ role: m.role, content: m.content, message_type: m.message_type }));

    // Setup abort controller
    const abortController = new AbortController();
    chatAbortControllers.set(convId, abortController);
    const emitStatus = createChatStatusEmitter({ conversationId: convId, send: broadcastToWindows });

    // ===== Q&A Pipeline Branch =====
    if (conversationType === "qa") {
      return await handleQaPipeline(convId, message, history, scopeFolderId, scopeAll, abortController, ownerPaperIds);
    }

    // ===== Table Pipeline =====
    return await runTableConversationPipeline({
      supabase,
      emitStatus,
      emitToken: (token) => broadcastToWindows(IPC_EVENTS.CHAT_TOKEN, { conversationId: convId, token }),
      emitComplete: (payload) => broadcastToWindows(IPC_EVENTS.CHAT_COMPLETE, payload),
      emitVerificationDone: (payload) => broadcastToWindows(IPC_EVENTS.CHAT_VERIFICATION_DONE, payload),
      abortSignal: abortController.signal,
      conversationId: convId,
      ownerId,
      ownerPaperIds,
      scopeFolderId,
      scopeAll,
      history,
      generateOrchestratorPlanFn: generateOrchestratorPlan,
      runMultiQueryRagFn: runMultiQueryRag,
      getPaperIdsInFolderTreeFn: getPaperIdsInFolderTree,
      intersectPaperIdsFn: intersectPaperIds,
      loadSourceFileMetadataMapFn: loadSourceFileMetadataMap,
      parseAllHtmlTablesFn: parseAllHtmlTables,
      extractMatrixFromHtmlFn: extractMatrixFromHtml,
      extractColumnsFromPaperFn: extractColumnsFromPaper,
      generateTableFromSpecFn: generateTableFromSpec,
      runPaperScopedRecoverySearchFn: runPaperScopedRecoverySearch,
      extractNullCellsFromPaperFn: extractNullCellsFromPaper,
      checkGroundednessFn: checkGroundedness,
      unwrapSingleFn: unwrapSingle,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      broadcastToWindows(IPC_EVENTS.CHAT_ERROR, { conversationId: convId, error: "aborted" });
      return { conversationId: convId, error: "aborted" };
    }
    console.error("[Chat] CHAT_SEND_MESSAGE error:", err);
    broadcastToWindows(IPC_EVENTS.CHAT_ERROR, { conversationId: convId, error: err.message });

    if (convId) {
      try {
        const { error: logErr } = await supabase.from("chat_messages").insert({
          conversation_id: convId,
          role: "assistant",
          content: err.message,
          message_type: "error",
        });
        if (logErr) console.warn("[Chat] failed to persist error message:", logErr.message);
      } catch (logCrash) {
        console.warn("[Chat] failed to persist error message (exception):", logCrash.message);
      }
    }
    return { conversationId: convId, error: err.message };
  } finally {
    chatAbortControllers.delete(convId);
  }
});

// --- CHAT_ABORT ---
ipcMain.handle(IPC_CHANNELS.CHAT_ABORT, async (_event, { conversationId, userId, accessToken }) => {
  let ownerId;
  try {
    ownerId = await resolveAuthenticatedUserId({ userId, accessToken });
  } catch (err) {
    return { success: false, error: err.message };
  }
  if (conversationId && conversationId !== "pending") {
    const { data: conv, error } = await supabase
      .from("chat_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("owner_user_id", ownerId)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!conv) return { success: false, error: "Conversation is not available for this user." };
  }
  const ctrl = chatAbortControllers.get(conversationId);
  if (ctrl) {
    ctrl.abort();
    chatAbortControllers.delete(conversationId);
  }
  return { success: true };
});

// --- CHAT_EXPORT_CSV ---
ipcMain.handle(IPC_CHANNELS.CHAT_EXPORT_CSV, async (_event, { tableId, userId, accessToken }) => {
  let table;
  try {
    const ownerId = await resolveAuthenticatedUserId({ userId, accessToken });
    table = unwrapSingle(await supabase
      .from("chat_generated_tables")
      .select("table_title, headers, rows, source_refs, chat_conversations!inner(owner_user_id)")
      .eq("id", tableId)
      .eq("chat_conversations.owner_user_id", ownerId)
      .single(), "csv-export-table");
  } catch (e) {
    return { success: false, error: e.message };
  }

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
    lines.push([escape("No."), escape("Authors"), escape("Title"), escape("Year"), escape("DOI"), escape("Evidence")].join(","));
    for (const ref of table.source_refs) {
      const evidence = ref.evidenceSummary || (Array.isArray(ref.evidenceLocations) ? ref.evidenceLocations.join("; ") : "");
      lines.push([
        escape(`[${ref.refNo}]`),
        escape(ref.authors ?? ""),
        escape(ref.title ?? ""),
        escape(ref.year ?? ""),
        escape(ref.doi ? `https://doi.org/${ref.doi}` : ""),
        escape(evidence),
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

ipcMain.handle(IPC_CHANNELS.LLM_GET_MODEL, async (_event, authContext = {}) => {
  try {
    const userId = await resolveAuthenticatedUserId(authContext);
    // Determine source: check DB first, then env, then default
    const { data: pref, error } = await supabase
      .from("user_workspace_preferences")
      .select("llm_model")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    let model;
    let source = "default";
    if (pref?.llm_model) {
      model = pref.llm_model;
      setActiveModel(model);
      source = "user";
    } else {
      setActiveModel(null);
      model = getActiveModel();
      if (process.env.REDOU_LLM_MODEL) {
        source = "env";
      }
    }
    return { success: true, data: { model, source } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(IPC_CHANNELS.LLM_SET_MODEL, async (_event, { model, userId, accessToken }) => {
  try {
    const ownerId = await resolveAuthenticatedUserId({ userId, accessToken });
    const { error } = await supabase
      .from("user_workspace_preferences")
      .upsert({ user_id: ownerId, llm_model: model || null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    // Update runtime variable
    setActiveModel(model);
    console.log(`[LLM] Active model changed to: ${getActiveModel()}`);
    return { success: true, data: { model: getActiveModel() } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
