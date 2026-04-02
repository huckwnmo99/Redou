/**
 * MinerU API 클라이언트.
 * PDF → 마크다운 + 구조화 JSON (bbox 포함) + 이미지.
 *
 * Docker: 로컬 빌드 mineru:latest (Dockerfile.mineru)
 * API: POST /file_parse (multipart/form-data)
 * Port: 8001 (default, 내부 8000)
 *
 * content_list 요소 타입:
 *   text (text_level=1 → heading), text (no level → paragraph),
 *   table, equation, image, discarded
 */

import path from "node:path";
import fs from "node:fs/promises";

const MINERU_BASE = process.env.REDOU_MINERU_URL || "http://localhost:8001";
const MINERU_TIMEOUT_MS = 600_000; // 10분 (대형 논문)

// ─── Health Check ───────────────────────────────────────────────

export async function isMineruAvailable() {
  try {
    const res = await fetch(MINERU_BASE + "/docs", { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── PDF 파싱 ───────────────────────────────────────────────────

/**
 * PDF → 구조화 데이터 변환.
 * @param {Buffer} pdfBuffer
 * @param {{ backend?: string, lang?: string }} options
 * @returns {{ mdContent: string, contentList: object[], images: Record<string, string>, backend: string, version: string, processingTime: number }}
 */
export async function parsePdf(pdfBuffer, options = {}) {
  const t0 = Date.now();
  const { backend = "pipeline", lang = "en" } = options;

  const formData = new FormData();
  formData.append("files", new Blob([pdfBuffer], { type: "application/pdf" }), "paper.pdf");
  formData.append("backend", backend);
  formData.append("lang_list", lang);
  formData.append("return_md", "true");
  formData.append("return_content_list", "true");
  formData.append("return_images", "true");
  formData.append("formula_enable", "true");
  formData.append("table_enable", "true");

  const res = await fetch(MINERU_BASE + "/file_parse", {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(MINERU_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MinerU API error ${res.status}: ${text}`);
  }

  const rawJson = await res.json();
  const resultKey = Object.keys(rawJson.results || {})[0];
  if (!resultKey) throw new Error("MinerU returned no results");

  const result = rawJson.results[resultKey];

  // content_list는 JSON 문자열로 반환됨
  const contentList = typeof result.content_list === "string"
    ? JSON.parse(result.content_list)
    : result.content_list || [];

  return {
    mdContent: result.md_content || "",
    contentList,
    images: result.images || {},
    backend: rawJson.backend || backend,
    version: rawJson.version || "unknown",
    processingTime: Date.now() - t0,
  };
}

// ─── 결과 파싱 ──────────────────────────────────────────────────

/**
 * MinerU 결과에서 구조화 데이터 추출.
 * @param {{ mdContent: string, contentList: object[], images: Record<string, string> }} mineruResult
 * @returns {{ sections, chunks, tables, equations, figures, rawText }}
 */
export function parseMineruResult(mineruResult) {
  const { contentList, mdContent, images } = mineruResult;

  const sections = parseSections(contentList);
  const tables = parseTables(contentList, mdContent);
  const equations = parseEquations(contentList);
  const figures = parseFigures(contentList, images);
  const rawText = buildRawText(contentList);
  const chunks = buildChunks(sections);

  return { sections, chunks, tables, equations, figures, rawText };
}

// ── 섹션 파싱 ──

function parseSections(contentList) {
  const sections = [];
  let currentSection = null;
  let sectionOrder = 0;

  for (const el of contentList) {
    if (el.type === "discarded") continue;

    // text_level가 있으면 헤딩
    if (el.type === "text" && el.text_level) {
      if (currentSection) sections.push(currentSection);

      sectionOrder++;
      const headingText = el.text || "";

      // "3. Results" → order 3, name "Results"
      const orderMatch = headingText.match(/^(\d+)[\.\s]/);
      const order = orderMatch ? parseInt(orderMatch[1], 10) : sectionOrder;
      const cleanName = headingText.replace(/^\d+[\.\s]+/, "").trim() || headingText;

      currentSection = {
        sectionName: cleanName,
        sectionOrder: order,
        pageStart: el.page_idx ?? null,
        pageEnd: el.page_idx ?? null,
        rawText: "",
      };
    } else if (el.type === "text" && !el.text_level) {
      const text = el.text || "";
      if (currentSection) {
        currentSection.rawText += (currentSection.rawText ? "\n" : "") + text;
        if (el.page_idx != null) currentSection.pageEnd = el.page_idx;
      } else if (text.length > 30) {
        // 헤딩 전 텍스트 → Abstract 섹션으로
        currentSection = {
          sectionName: "Abstract",
          sectionOrder: 0,
          pageStart: el.page_idx ?? null,
          pageEnd: el.page_idx ?? null,
          rawText: text,
        };
      }
    }
  }

  if (currentSection && currentSection.rawText.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

// ── 테이블 파싱 ──

function parseTables(contentList, mdContent) {
  const tables = [];
  let tableCounter = 0;

  for (const el of contentList) {
    if (el.type !== "table") continue;
    tableCounter++;

    // table_body는 HTML 문자열
    const html = el.table_body || null;

    // 캡션 (배열 형태)
    const captionArr = el.table_caption || [];
    const caption = Array.isArray(captionArr) ? captionArr.join(" ") : String(captionArr);

    // 테이블 번호
    const numMatch = caption.match(/Table\s+(\d+)/i);
    const figureNo = numMatch ? `Table ${numMatch[1]}` : `Table ${tableCounter}`;

    // 각주
    const footnoteArr = el.table_footnote || [];
    const footnote = Array.isArray(footnoteArr) ? footnoteArr.join(" ") : String(footnoteArr);

    // 검색용 평탄화 텍스트
    const plainText = html ? flattenTableHtml(html) : "";

    tables.push({
      figureNo,
      caption: caption.trim(),
      footnote: footnote.trim(),
      page: el.page_idx ?? null,
      html,
      plainText,
      summaryText: html, // figures.summary_text에 저장
      imgPath: el.img_path || null,
      bbox: el.bbox || null,
    });
  }

  return tables;
}

// ── 수식 파싱 ──

function parseEquations(contentList) {
  const equations = [];
  let eqCounter = 0;

  for (const el of contentList) {
    if (el.type !== "equation") continue;
    eqCounter++;

    let latex = el.text || "";

    // $$...$$ 래퍼 제거
    latex = latex.replace(/^\$\$\s*/, "").replace(/\s*\$\$$/, "").trim();

    if (!latex || latex.length < 3) continue;

    // 수식 번호 추출
    const tagMatch = latex.match(/\\tag\{([^}]+)\}/);
    const figureNo = tagMatch ? `Eq. ${tagMatch[1]}` : `Eq. ${eqCounter}`;

    // LaTeX 정리
    const cleanLatex = latex
      .replace(/\\tag\{[^}]+\}/, "")
      .replace(/\\label\{[^}]+\}/, "")
      .trim();

    equations.push({
      figureNo,
      caption: `$$${cleanLatex}$$`,
      page: el.page_idx ?? null,
      latex: cleanLatex,
      summaryText: `$$${cleanLatex}$$`,
      plainText: flattenEquationLatex(cleanLatex),
      imgPath: el.img_path || null,
      bbox: el.bbox || null,
    });
  }

  return equations;
}

// ── 그림 파싱 ──

function parseFigures(contentList, images) {
  const figures = [];
  let figCounter = 0;

  for (const el of contentList) {
    if (el.type !== "image") continue;
    figCounter++;

    // 캡션 (배열 형태)
    const captionArr = el.image_caption || [];
    const caption = Array.isArray(captionArr) ? captionArr.join(" ") : String(captionArr);

    // 그림 번호
    const numMatch = caption.match(/(?:Figure|Fig\.?)\s+(\d+)/i);
    const figureNo = numMatch ? `Figure ${numMatch[1]}` : `Figure ${figCounter}`;

    // images dict에서 base64 이미지 데이터
    // img_path는 "images/xxx.jpg" 형태, dict 키는 "xxx.jpg" (접두사 없음)
    const imgKey = (el.img_path || "").replace(/^images\//, "");
    const imageBase64 = imgKey ? (images[imgKey] || null) : null;

    figures.push({
      figureNo,
      caption: caption.trim(),
      page: el.page_idx ?? null,
      bbox: el.bbox || null,
      imgPath: imgKey,
      imageBase64, // base64 문자열, 저장 시 Buffer 변환 필요
    });
  }

  return figures;
}

// ── 청크 분할 ──

const TARGET_CHUNK_TOKENS = 300;

function buildChunks(sections) {
  const chunks = [];
  let chunkOrder = 0;

  for (const section of sections) {
    if (!section.rawText || section.rawText.length < 10) continue;

    const words = section.rawText.split(/\s+/);
    let buffer = [];
    let startOffset = 0;

    for (const word of words) {
      buffer.push(word);

      if (buffer.length >= TARGET_CHUNK_TOKENS) {
        chunkOrder++;
        const text = buffer.join(" ");
        chunks.push({
          chunkOrder,
          page: section.pageStart ?? null,
          text,
          tokenCount: Math.round(buffer.length * 1.3),
          sectionOrder: section.sectionOrder,
          startCharOffset: startOffset,
          endCharOffset: startOffset + text.length,
        });
        startOffset += text.length + 1;
        buffer = [];
      }
    }

    // 남은 텍스트
    if (buffer.length > 0) {
      chunkOrder++;
      const text = buffer.join(" ");
      chunks.push({
        chunkOrder,
        page: section.pageStart ?? null,
        text,
        tokenCount: Math.round(buffer.length * 1.3),
        sectionOrder: section.sectionOrder,
        startCharOffset: startOffset,
        endCharOffset: startOffset + text.length,
      });
    }
  }

  return chunks;
}

// ── 본문 텍스트 결합 ──

function buildRawText(contentList) {
  const texts = [];
  for (const el of contentList) {
    if (el.type === "text") {
      texts.push(el.text || "");
    }
  }
  return texts.join("\n");
}

// ─── 유틸리티 ────────────────────────────────────────────────────

/** HTML 테이블 → 검색용 평탄화 텍스트 */
export function flattenTableHtml(html) {
  if (!html) return "";
  return html
    .replace(/<\/?(table|thead|tbody|tfoot)[^>]*>/gi, "")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/?(tr|th|td)[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s*\|\s*\|\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
}

/** LaTeX 수식 → 검색용 텍스트 표현 */
export function flattenEquationLatex(latex) {
  if (!latex) return "";
  return latex
    .replace(/\\(?:frac|dfrac)\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\(?:sqrt)\{([^}]*)\}/g, "sqrt($1)")
    .replace(/\\(?:mathrm|text|textit|textbf)\{([^}]*)\}/g, "$1")
    .replace(/[_^]\{([^}]*)\}/g, "$1")
    .replace(/[_^](.)/g, "$1")
    .replace(/\\(?:left|right|Big|big|bigg)[|()[\]{}.]?/g, "")
    .replace(/\\(?:cdot|times)/g, "*")
    .replace(/\\(?:pm)/g, "±")
    .replace(/\\(?:leq|le)/g, "<=")
    .replace(/\\(?:geq|ge)/g, ">=")
    .replace(/\\(?:neq|ne)/g, "!=")
    .replace(/\\(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega|phi|psi|pi|rho|tau|chi|eta|zeta|nu|xi|kappa)/g, (m) => m.slice(1))
    .replace(/\\(?:sum|prod|int|infty|partial|nabla|Delta|Sigma|Omega)/g, (m) => m.slice(1))
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 그림 이미지를 로컬에 저장.
 * @param {string} paperId
 * @param {{ figureNo: string, imageBase64?: string }[]} figures
 * @param {string} libraryRoot
 * @returns {Map<string, string>} figureNo → saved imagePath
 */
export async function saveFigureImages(paperId, figures, libraryRoot) {
  const figureDir = path.join(libraryRoot, "Figures", paperId);
  const imageMap = new Map();

  const hasSaveable = figures.some((f) => f.imageBase64);
  if (!hasSaveable) return imageMap;

  await fs.mkdir(figureDir, { recursive: true });

  for (const fig of figures) {
    if (!fig.imageBase64) continue;

    const safeName = fig.figureNo.replace(/[^a-zA-Z0-9]/g, "_");
    const ext = fig.imgPath?.endsWith(".jpg") || fig.imgPath?.endsWith(".jpeg") ? "jpg" : "png";
    const savePath = path.join(figureDir, `${safeName}.${ext}`);

    try {
      // Strip data URL prefix (e.g. "data:image/jpeg;base64,") if present
      const raw = fig.imageBase64.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(raw, "base64");
      await fs.writeFile(savePath, buffer);
      imageMap.set(fig.figureNo, savePath);
    } catch (err) {
      console.warn(`[mineru-client] Failed to save image for ${fig.figureNo}:`, err.message);
    }
  }

  return imageMap;
}

/**
 * 테이블 이미지를 로컬에 저장.
 * @param {string} paperId
 * @param {{ figureNo: string, imgPath?: string }[]} tables
 * @param {Record<string, string>} images - MinerU images dict
 * @param {string} libraryRoot
 * @returns {Map<string, string>} figureNo → saved imagePath
 */
export async function saveTableImages(paperId, tables, images, libraryRoot) {
  const figureDir = path.join(libraryRoot, "Figures", paperId);
  const imageMap = new Map();

  await fs.mkdir(figureDir, { recursive: true });

  for (const tbl of tables) {
    const imgKey = (tbl.imgPath || "").replace(/^images\//, "");
    if (!imgKey || !images[imgKey]) continue;

    const safeName = tbl.figureNo.replace(/[^a-zA-Z0-9]/g, "_");
    const ext = tbl.imgPath.endsWith(".jpg") || tbl.imgPath.endsWith(".jpeg") ? "jpg" : "png";
    const savePath = path.join(figureDir, `${safeName}.${ext}`);

    try {
      // Strip data URL prefix if present
      const raw = images[imgKey].replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(raw, "base64");
      await fs.writeFile(savePath, buffer);
      imageMap.set(tbl.figureNo, savePath);
    } catch (err) {
      console.warn(`[mineru-client] Failed to save table image for ${tbl.figureNo}:`, err.message);
    }
  }

  return imageMap;
}
