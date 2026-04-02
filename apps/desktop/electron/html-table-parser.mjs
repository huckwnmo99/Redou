// HTML Table Parser — Pure-code OCR HTML → {headers, rows} conversion
// Handles colspan/rowspan expansion, multi-row header flattening, tag stripping.
// Zero external dependencies — uses regex + state machine for the controlled
// OCR HTML subset (<table>, <thead>, <tbody>, <tr>, <th>, <td>, <sub>, <sup>).

// ============================================================
// Helpers
// ============================================================

/**
 * Strip HTML tags, keeping text content.
 * Converts <sub>X</sub> → ₓ (common subscripts) and <sup>X</sup> → superscript.
 * Falls back to plain text for uncommon characters.
 */
function stripTags(html) {
  if (!html) return "";
  let s = html;
  // <sub> → subscript approximation
  s = s.replace(/<sub[^>]*>(.*?)<\/sub>/gi, (_, inner) => {
    const subMap = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉" };
    return inner.replace(/./g, (ch) => subMap[ch] || ch);
  });
  // <sup> → superscript approximation
  s = s.replace(/<sup[^>]*>(.*?)<\/sup>/gi, (_, inner) => {
    const supMap = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "-": "⁻", "+": "⁺" };
    return inner.replace(/./g, (ch) => supMap[ch] || ch);
  });
  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&minus;/g, "−").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  // Normalize whitespace
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Extract all <tr> blocks from HTML string.
 * Returns array of raw HTML strings for each row.
 */
function extractRows(tableHtml) {
  const rows = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(tableHtml)) !== null) {
    rows.push(m[1]);
  }
  return rows;
}

/**
 * Extract all <td> and <th> cells from a row HTML string.
 * Returns array of { text, colspan, rowspan, isHeader }.
 */
function extractCells(rowHtml) {
  const cells = [];
  const re = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const content = m[3];

    let colspan = 1;
    let rowspan = 1;
    const csMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
    const rsMatch = attrs.match(/rowspan\s*=\s*["']?(\d+)/i);
    if (csMatch) colspan = parseInt(csMatch[1], 10);
    if (rsMatch) rowspan = parseInt(rsMatch[1], 10);

    cells.push({
      text: stripTags(content),
      colspan,
      rowspan,
      isHeader: tag === "th",
    });
  }
  return cells;
}

// ============================================================
// Core: Grid builder with colspan/rowspan expansion
// ============================================================

/**
 * Build a 2D grid from table rows, expanding colspan/rowspan.
 * Returns { grid: string[][], headerRowCount: number }.
 *
 * headerRowCount is determined by:
 * - If <thead> is present: rows inside <thead>
 * - Otherwise: rows where all cells are <th>
 * - Fallback: first row
 */
function buildGrid(tableHtml) {
  // Detect thead/tbody split
  const theadMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);

  let allRowsHtml;
  let theadRowCount = 0;

  if (theadMatch && tbodyMatch) {
    const theadRows = extractRows(theadMatch[1]);
    const tbodyRows = extractRows(tbodyMatch[1]);
    allRowsHtml = [...theadRows, ...tbodyRows];
    theadRowCount = theadRows.length;
  } else {
    // No explicit thead/tbody — extract all rows
    allRowsHtml = extractRows(tableHtml);
  }

  if (allRowsHtml.length === 0) return { grid: [], headerRowCount: 0 };

  // Parse cells per row
  const parsedRows = allRowsHtml.map((rh) => extractCells(rh));

  // Determine total columns (max across all rows considering colspan)
  let maxCols = 0;
  for (const row of parsedRows) {
    let count = 0;
    for (const cell of row) count += cell.colspan;
    if (count > maxCols) maxCols = count;
  }
  // Also account for rowspan-occupied positions
  maxCols = Math.max(maxCols, 1);

  // Build grid with fill tracking
  // fillMap[r][c] = string | undefined
  const totalRows = allRowsHtml.length;
  const grid = Array.from({ length: totalRows }, () => Array(maxCols).fill(""));
  const occupied = Array.from({ length: totalRows }, () => Array(maxCols).fill(false));

  for (let r = 0; r < totalRows; r++) {
    const cells = parsedRows[r];
    let cellIdx = 0;
    let c = 0;

    while (c < maxCols && cellIdx < cells.length) {
      // Skip occupied positions (from previous rowspans)
      if (occupied[r][c]) {
        c++;
        continue;
      }

      const cell = cells[cellIdx];
      cellIdx++;

      // Fill the grid for this cell's span
      for (let dr = 0; dr < cell.rowspan && r + dr < totalRows; dr++) {
        for (let dc = 0; dc < cell.colspan && c + dc < maxCols; dc++) {
          // Expand grid if needed
          while (c + dc >= grid[r + dr].length) {
            grid[r + dr].push("");
            occupied[r + dr].push(false);
          }
          grid[r + dr][c + dc] = cell.text;
          occupied[r + dr][c + dc] = true;
        }
      }

      c += cell.colspan;
    }

    // Update maxCols if grid expanded
    for (let row of grid) {
      if (row.length > maxCols) maxCols = row.length;
    }
  }

  // Normalize all rows to same column count
  for (let r = 0; r < totalRows; r++) {
    while (grid[r].length < maxCols) grid[r].push("");
  }

  // Determine header row count
  // Strategy: scan from top — a row is a header if:
  //  (a) it was inside <thead>, OR
  //  (b) all cells are <th>, OR
  //  (c) any original cell has colspan > 1 (grouping header), OR
  //  (d) fewer than 30% of cells look numeric (text-only → labels/units)
  // Stop at first row that looks like data (majority numeric cells).
  let headerRowCount = theadRowCount;
  if (headerRowCount === 0) {
    // A cell "looks numeric" if it starts with a digit/sign and parses as a number.
    // "0.50" → true, "303.15" → true, "uptake(5kPa)" → false, "[kPa]" → false
    const looksNumeric = (text) => {
      const t = text.trim().replace(/−/g, "-");
      if (!t) return false;
      return /^[-+]?\d/.test(t) && !isNaN(parseFloat(t));
    };

    for (let r = 0; r < Math.min(parsedRows.length, 6); r++) {
      const cells = parsedRows[r];
      const allTh = cells.length > 0 && cells.every((c) => c.isHeader);
      const hasColspan = cells.some((c) => c.colspan > 1);
      const hasRowspan = cells.some((c) => c.rowspan > 1);
      // Check how many non-empty grid cells in this row look like data numbers
      const rowCells = grid[r].filter((c) => c.trim() !== "");
      const numericCount = rowCells.filter((c) => looksNumeric(c)).length;
      const numericRatio = rowCells.length > 0 ? numericCount / rowCells.length : 0;

      if (allTh || hasColspan || hasRowspan || numericRatio < 0.4) {
        headerRowCount = r + 1;
      } else {
        break; // first data row found
      }
    }
  }
  // Fallback: at least 1 header row
  if (headerRowCount === 0) headerRowCount = 1;
  // But header can't be all rows
  if (headerRowCount >= totalRows) headerRowCount = 1;

  return { grid, headerRowCount };
}

// ============================================================
// Multi-row header flattening
// ============================================================

/**
 * Flatten multi-row headers into a single header row.
 * Strategy: concatenate vertically with " / " separator, but skip
 * repeated values from colspan expansion.
 *
 * Example: Row 0: ["", "303K", "303K", "323K", "323K"]
 *          Row 1: ["time", "uptake(5kPa)", "uptake(10kPa)", "uptake(5kPa)", "uptake(10kPa)"]
 *   → ["time", "303K / uptake(5kPa)", "303K / uptake(10kPa)", "323K / uptake(5kPa)", "323K / uptake(10kPa)"]
 */
function flattenHeaders(grid, headerRowCount) {
  if (headerRowCount <= 0) return [];
  const numCols = grid[0]?.length ?? 0;
  const headers = [];

  for (let c = 0; c < numCols; c++) {
    const parts = [];
    for (let r = 0; r < headerRowCount; r++) {
      const val = (grid[r][c] || "").trim();
      if (!val) continue;
      // Skip if same as previous part (from colspan duplication across header rows)
      if (parts.length > 0 && parts[parts.length - 1] === val) continue;
      // Skip very generic group headers that span the entire row (e.g., "KACa" spanning all cols)
      // Keep them only if they differ per column
      const isUniformAcrossRow = grid[r].every((cell) => (cell || "").trim() === val || !(cell || "").trim());
      if (isUniformAcrossRow && numCols > 2 && r < headerRowCount - 1) continue;
      parts.push(val);
    }
    headers.push(parts.join(" / ") || `Col${c + 1}`);
  }

  return headers;
}

// ============================================================
// Public API
// ============================================================

/**
 * Parse a single HTML <table> into {headers, rows, success}.
 * @param {string} html — HTML string containing a <table>
 * @returns {{headers: string[], rows: string[][], success: boolean}}
 */
export function parseHtmlTable(html) {
  try {
    const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return { headers: [], rows: [], success: false };

    const tableInner = tableMatch[1];
    const { grid, headerRowCount } = buildGrid(tableMatch[0]);

    if (grid.length < 2) return { headers: [], rows: [], success: false };

    const headers = flattenHeaders(grid, headerRowCount);
    const dataRows = grid.slice(headerRowCount);

    // Filter out completely empty rows
    const rows = dataRows.filter((row) => row.some((cell) => cell.trim() !== ""));

    if (rows.length < 1) return { headers, rows: [], success: false };

    // Validate: if >40% of all data cells are empty, likely malformed
    const totalCells = rows.length * headers.length;
    const emptyCells = rows.reduce((acc, row) => acc + row.filter((c) => !c.trim()).length, 0);
    if (totalCells > 0 && emptyCells / totalCells > 0.4) {
      return { headers, rows, success: false };
    }

    return { headers, rows, success: true };
  } catch (err) {
    console.error("[HTMLParser] parseHtmlTable error:", err.message);
    return { headers: [], rows: [], success: false };
  }
}

/**
 * Parse all <table> elements from a summary_text string.
 * @param {string} summaryText — may contain multiple <table>...</table> blocks
 * @returns {Array<{headers: string[], rows: string[][], sourceHtml: string, success: boolean}>}
 */
export function parseAllHtmlTables(summaryText) {
  if (!summaryText) return [];
  const tables = [];
  const re = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(summaryText)) !== null) {
    const sourceHtml = m[0];
    const parsed = parseHtmlTable(sourceHtml);
    tables.push({ ...parsed, sourceHtml });
  }
  return tables;
}
