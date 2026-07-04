/**
 * docling sidecar client — MEASUREMENT ONLY (tool-ab-adoption slice 02).
 *
 * Talks to the docling table-parse sidecar (apps/docling-server, port 8011) and
 * normalizes its response to a shape symmetric with mineru-client.mjs, so the
 * A/B harness (scripts/ab-docling-tables.mjs) can compare MinerU 3.4 vs docling
 * tables cell-for-cell.
 *
 * NOT wired into the production import pipeline. main.mjs / mineru-client.mjs are
 * untouched; nothing here runs during a real PDF import. This module exists only
 * so the A/B script and the table_fidelity eval can drive docling output.
 *
 * Sidecar: POST /parse (multipart PDF) → { tables:[{cells,html,caption,...}],
 *          equations, num_figures, docling_version, processing_time_ms }.
 * Port: 8011 (REDOU_DOCLING_URL).
 */

const DOCLING_BASE = process.env.REDOU_DOCLING_URL || "http://localhost:8011";
const DOCLING_TIMEOUT_MS = 600_000; // 10분 (대형 논문), MinerU와 동일 상한

// ─── Health Check ───────────────────────────────────────────────

/** mineru-client.mjs의 isMineruAvailable()과 대칭. */
export async function isDoclingAvailable() {
  try {
    const res = await fetch(DOCLING_BASE + "/health", { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── PDF 파싱 ───────────────────────────────────────────────────

/**
 * PDF → docling 표 중심 구조화 데이터.
 * mineru-client.mjs의 parsePdf + parseMineruResult(tables/equations 부분)에
 * 대칭하는 shape을 낸다.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{
 *   tables: { figureNo: string, caption: string, page: number|null, numRows: number,
 *             numCols: number, html: string, cells: { text:string, row:number, col:number,
 *             rowSpan:number, colSpan:number, columnHeader:boolean, rowHeader:boolean,
 *             bbox:number[]|null }[], cellsWithBbox: number }[],
 *   equations: { latex: string, page: number|null }[],
 *   numFigures: number,
 *   doclingVersion: string,
 *   processingTime: number
 * }>}
 */
export async function parsePdfDocling(pdfBuffer) {
  const t0 = Date.now();

  const formData = new FormData();
  formData.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), "paper.pdf");

  const res = await fetch(DOCLING_BASE + "/parse", {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(DOCLING_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`docling API error ${res.status}: ${text}`);
  }

  const raw = await res.json();
  const rawTables = Array.isArray(raw.tables) ? raw.tables : [];

  const tables = rawTables.map((t, i) => {
    const caption = String(t.caption ?? "").trim();
    // 표 번호: 캡션에서 파싱된 caption_ref 우선, 없으면 순번(MinerU parseTables와 동일 관례).
    const figureNo = t.caption_ref && t.caption_ref.trim() ? t.caption_ref.trim() : `Table ${i + 1}`;
    const cells = (Array.isArray(t.cells) ? t.cells : []).map((c) => ({
      text: String(c.text ?? ""),
      row: Number(c.row ?? 0),
      col: Number(c.col ?? 0),
      rowSpan: Number(c.row_span ?? 1),
      colSpan: Number(c.col_span ?? 1),
      columnHeader: Boolean(c.column_header),
      rowHeader: Boolean(c.row_header),
      bbox: Array.isArray(c.bbox) ? c.bbox : null,
    }));
    return {
      figureNo,
      caption,
      page: t.page ?? null,
      numRows: Number(t.num_rows ?? 0),
      numCols: Number(t.num_cols ?? 0),
      html: String(t.html ?? ""),
      cells,
      cellsWithBbox: Number(t.cells_with_bbox ?? cells.filter((c) => c.bbox).length),
    };
  });

  const equations = (Array.isArray(raw.equations) ? raw.equations : []).map((e) => ({
    latex: String(e.latex ?? "").trim(),
    page: e.page ?? null,
  }));

  return {
    tables,
    equations,
    numFigures: Number(raw.num_figures ?? 0),
    doclingVersion: String(raw.docling_version ?? "unknown"),
    // 서버가 잰 파싱 시간(순수 docling.convert)과 별개로, 클라이언트 왕복 총시간도 제공.
    serverProcessingTime: Number(raw.processing_time_ms ?? 0),
    processingTime: Date.now() - t0,
  };
}
