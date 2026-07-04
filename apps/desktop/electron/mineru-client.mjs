/**
 * MinerU API 클라이언트.
 * PDF → 마크다운 + 구조화 JSON (bbox 포함) + 이미지.
 *
 * Docker: 로컬 빌드 mineru:latest (Dockerfile.mineru), MinerU 3.4.2
 * API: POST /file_parse (multipart/form-data)
 * Port: 8001 (default, 내부 8000)
 *
 * content_list 요소 타입 (MinerU 3.4.2, 실 응답 실측 2026-07-04):
 *   text (text_level → heading, 없으면 paragraph), equation (text_format=latex),
 *   image (image_caption/image_footnote/img_path), table (table_body/…),
 *   chart (img_path + content + chart_caption/chart_footnote) — 3.4 신규,
 *   list (list_items[] + sub_type) — 3.4 신규,
 *   header/footer/page_number/page_footnote — 3.4 신규(페이지 보일러플레이트),
 *   discarded.
 * 처리 방침: chart→figure 경로, list→본문(ref_text 제외), 보일러플레이트→명시적 무시.
 * (equation.text_format·image.image_footnote는 신규 필드지만 기존 파서가 읽는
 *  el.text / el.image_caption 계약은 그대로라 파싱 무영향.)
 */

import path from "node:path";
import fs from "node:fs/promises";

/**
 * 페이지 보일러플레이트 요소 타입 — 본문/그림/표/수식이 아닌 러닝헤드·꼬리말·
 * 페이지 번호·각주(코레스폰딩 저자 등). MinerU 3.4가 새로 분류해 준다.
 * 실측(2022 CEJ 논문): header="Chemical Engineering Journal 431 (2022) …"(저널
 * 러닝헤드), footer=copyright/DOI 줄, page_number="2", page_footnote=
 * "* Corresponding authors." → 전부 검색/임베딩 가치 없음 → **의도적 무시**.
 * (묵시 무시가 아니라 명시적 스킵으로 두어, 향후 이 중 하나를 본문에 넣고 싶으면
 *  여기서 빼면 된다.)
 */
const IGNORED_BOILERPLATE_TYPES = new Set([
  "header",
  "footer",
  "page_number",
  "page_footnote",
]);

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

/**
 * MinerU 3.4 `list` 요소를 본문 텍스트로 환원. `list_items[]`를 줄바꿈으로 조인.
 * 단, `sub_type === "ref_text"`(참고문헌 목록)는 **본문에서 제외**한다 — 참고문헌은
 * GROBID→`paper_references` 경로가 소유하며, 68개 인용 문자열을 본문 청크로 넣으면
 * 임베딩/검색을 오염시킨다(실측: 이 논문의 list 2건 전부 ref_text = 서지 68항목).
 * 그 외 sub_type(결론·절차 등 실질 목록 본문)은 유실 없이 본문으로 수용한다.
 * @returns {string} 본문에 넣을 텍스트(제외 대상이거나 비어 있으면 "").
 */
function listElementToBodyText(el) {
  if (el.sub_type === "ref_text") return ""; // 참고문헌 → GROBID 소유, 본문 제외
  const items = Array.isArray(el.list_items) ? el.list_items : [];
  return items.map((s) => (typeof s === "string" ? s : String(s ?? ""))).join("\n").trim();
}

function parseSections(contentList) {
  const sections = [];
  let currentSection = null;
  let sectionOrder = 0;

  for (const el of contentList) {
    if (el.type === "discarded") continue;
    if (IGNORED_BOILERPLATE_TYPES.has(el.type)) continue; // header/footer/page_number/page_footnote 명시적 무시

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
    } else {
      // 본문 텍스트: text 문단(text_level 없음) 또는 list(ref_text 제외).
      // 두 경로 모두 현재 섹션 rawText로 흘려보낸다(3.4 list 본문 유실 방지).
      let text = "";
      if (el.type === "text" && !el.text_level) text = el.text || "";
      else if (el.type === "list") text = listElementToBodyText(el);
      if (!text) continue;

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

/**
 * `image`와 MinerU 3.4 신규 `chart`를 모두 그림으로 수용한다.
 * chart도 `img_path`를 갖는 그림형 요소라 기존 image 경로에 준해 처리한다.
 * 캡션은 image는 `image_caption[]`, chart는 `chart_caption[]`를 쓰고, chart에
 * 캡션이 없고 구조화 `content`(예: 차트 데이터 텍스트)가 있으면 그것을 캡션 대체로
 * 삼아 검색 가능하게 남긴다(그림 자체는 유실 없이 figures로 저장).
 */
function parseFigures(contentList, images) {
  const figures = [];
  let figCounter = 0;

  for (const el of contentList) {
    if (el.type !== "image" && el.type !== "chart") continue;
    figCounter++;

    // 캡션 (배열 형태) — image_caption 또는 chart_caption
    const captionArr = (el.type === "chart" ? el.chart_caption : el.image_caption) || [];
    let caption = Array.isArray(captionArr) ? captionArr.join(" ") : String(captionArr);
    // 캡션 없는 chart는 구조화 content를 캡션 대체로(검색 텍스트 보존)
    if (!caption.trim() && el.type === "chart" && typeof el.content === "string") {
      caption = el.content;
    }

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
    } else if (el.type === "list") {
      // 3.4 list 본문(ref_text 제외)도 rawText에 포함 (섹션 파싱과 대칭)
      const listText = listElementToBodyText(el);
      if (listText) texts.push(listText);
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
