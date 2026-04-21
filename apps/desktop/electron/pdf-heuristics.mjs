import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function uniquePaths(paths) {
  return Array.from(new Set(paths.filter(Boolean).map((candidate) => path.resolve(String(candidate)))));
}

const pdfJsModuleCandidates = uniquePaths([
  process.env.REDOU_DESKTOP_PDFJS_PATH,
  path.resolve(__dirname, "../node_modules/pdfjs-dist/legacy/build/pdf.mjs"),
  path.resolve(__dirname, "../../node_modules/pdfjs-dist/legacy/build/pdf.mjs"),
  path.resolve(__dirname, "../../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs"),
]);

function resolvePdfJsModuleUrl() {
  for (const candidate of pdfJsModuleCandidates) {
    if (candidate && existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }

  throw new Error("Unable to resolve pdfjs-dist for the desktop extraction helper. Install pdfjs-dist in apps/desktop or set REDOU_DESKTOP_PDFJS_PATH.");
}

const pdfJsModuleUrl = resolvePdfJsModuleUrl();

function roundMetric(value, precision = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function averageValue(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const SECTION_PATTERNS = [
  { name: "Abstract", patterns: [/^abstract$/i, /^abstract\s*[:.-]?\s+(.+)$/i] },
  { name: "Introduction", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*introduction$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*introduction\s*[:.-]?\s+(.+)$/i] },
  { name: "Background", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:related work|background|literature review)$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:related work|background|literature review)\s*[:.-]?\s+(.+)$/i] },
  { name: "Theory", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:theory|theoretical (?:background|framework))$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:theory|theoretical (?:background|framework))\s*[:.-]?\s+(.+)$/i] },
  { name: "Method", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:method|methods|methodology|approach|model|materials and methods|materials|preparation|characterization|analytical methods?)$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:method|methods|methodology|approach|model|materials and methods|materials|preparation|characterization|analytical methods?)\s*[:.-]?\s+(.+)$/i] },
  { name: "Experiments", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:experiment|experiments|experimental|evaluation|experimental (?:setup|section|procedure|details|work))$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:experiment|experiments|experimental|evaluation|experimental (?:setup|section|procedure|details|work))\s*[:.-]?\s+(.+)$/i] },
  { name: "Results", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:result|results|results and discussion|findings)$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*(?:result|results|results and discussion|findings)\s*[:.-]?\s+(.+)$/i] },
  { name: "Discussion", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*discussion$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*discussion\s*[:.-]?\s+(.+)$/i] },
  { name: "Conclusion", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*conclusion(?:s)?$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*conclusion(?:s)?\s*[:.-]?\s+(.+)$/i] },
  { name: "References", patterns: [/^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*references$/i, /^(?:\d+(?:\.\d+)*)?\s*[.)]?\s*references\s*[:.-]?\s+(.+)$/i] },
];

const FRONT_MATTER_NOISE_PATTERNS = [
  /\bdoi\b/i,
  /\bavailable online\b/i,
  /\breceived\b/i,
  /\baccepted\b/i,
  /\bcorresponding author\b/i,
  /\bkeywords?\b/i,
  /\bhighlights\b/i,
  /\babstracted\/indexed\b/i,
  /\bcrown copyright\b/i,
  /\ball rights reserved\b/i,
  /\belsevier\b/i,
  /\bspringer\b/i,
  /\bwiley\b/i,
  /\btaylor\s*&\s*francis\b/i,
  /\bcreativecommons\b/i,
  /\bjournal homepage\b/i,
  /https?:\/\//i,
  /www\./i,
  /@/,
  /^\d+\s*$/,
  /^page\s+\d+$/i,
  /^\d+\s*[-–]\s*\d+$/,
  /^vol\.?\s*\d+/i,
  /^\d{4}[,;:]?\s*\d+/i,
];

function normalizeWhitespace(value) {
  return value.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLineKey(value) {
  return normalizeWhitespace(value).toLowerCase();
}

function cleanDetectedTitle(value) {
  return normalizeWhitespace(value)
    .replace(/^[\d\W_]+/, "")
    .replace(/[\s:;,.\-–]+$/, "")
    .trim();
}

function lineFontSizeFromItem(item) {
  const transform = Array.isArray(item?.transform) ? item.transform : [0, 0, 0, 0, 0, 0];
  const horizontal = Number.isFinite(transform[0]) ? Math.abs(transform[0]) : 0;
  const vertical = Number.isFinite(transform[3]) ? Math.abs(transform[3]) : 0;
  return Math.max(horizontal, vertical, 0);
}

function isLikelyMarginLine(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }

  if (normalized.length > 140) {
    return false;
  }

  return FRONT_MATTER_NOISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isLikelyMetadataLine(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }

  if (FRONT_MATTER_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return /^\(?[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}(?:\s*[,*]\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})+\)?$/.test(normalized);
}

function isLikelyAuthorLine(text) {
  // Remove superscript markers and digits, but keep commas for splitting
  const normalized = normalizeWhitespace(text).replace(/\d+/g, " ").replace(/[*†‡§●•]/g, " ").trim();
  if (!normalized || normalized.length > 200) {
    return false;
  }

  if (/@|https?:\/\//i.test(normalized) || /\bdepartment\b|\buniversity\b|\binstitute\b/i.test(normalized)) {
    return false;
  }

  // Split by comma or " and " to get individual author names
  const parts = normalized.split(/,|\band\b/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return false;
  }

  // Each part should look like a person name: 1-4 capitalized words (allow hyphens, dots, apostrophes)
  const nameRe = /^[A-Z][A-Za-z.'\-]+(?:[\s\-]+[A-Z][A-Za-z.'\-]+){0,3}$/;
  return parts.every((part) => nameRe.test(part));
}

function isLikelyTitleCandidate(text) {
  const normalized = cleanDetectedTitle(text);
  if (!normalized || normalized.length < 16 || normalized.length > 220) {
    return false;
  }

  if (isLikelyMetadataLine(normalized) || isLikelyAuthorLine(normalized)) {
    return false;
  }

  if (/^abstract$|^keywords?$/i.test(normalized)) {
    return false;
  }

  if (/\bvol\.?\b|\bissue\b|\bpages?\b|\bdoi\b|https?:\/\//i.test(normalized)) {
    return false;
  }

  if (/^[\d\W_]+$/.test(normalized)) {
    return false;
  }

  return /[A-Za-z]/.test(normalized);
}

/**
 * Matches a numbered section heading like "2. OVERVIEW OF CO ADSORPTION..." or "3.1. Raw materials".
 * Must start with a number (e.g. "2.", "3.1.", "2.1.1)"), followed by a short title (2-15 words),
 * no trailing sentence-end punctuation, and short enough to be a heading (< 120 chars).
 */
const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+)*)\s*[.)]\s+(.+)$/;

function detectHeading(lineText) {
  const normalized = normalizeWhitespace(lineText);

  // First try known section patterns (keyword-based)
  for (const candidate of SECTION_PATTERNS) {
    for (const pattern of candidate.patterns) {
      const match = normalized.match(pattern);
      if (!match) {
        continue;
      }

      return {
        name: candidate.name,
        body: typeof match[1] === "string" ? normalizeWhitespace(match[1]) : "",
      };
    }
  }

  // Then try generic numbered heading detection
  if (normalized.length <= 120) {
    const numberedMatch = normalized.match(NUMBERED_HEADING_RE);
    if (numberedMatch) {
      const title = numberedMatch[2].trim();
      const wordCount = title.split(/\s+/).length;
      // Must be 2-15 words, no sentence-end punctuation at the end, and contain a letter
      if (wordCount >= 2 && wordCount <= 15 && !/[.?!;]$/.test(title) && /[A-Za-z]/.test(title)) {
        // Avoid matching figure/table captions or equation labels
        if (!/^(?:fig(?:ure)?|table|eq(?:uation)?|scheme|chart|plate)\b/i.test(title)) {
          return {
            name: title,
            body: "",
          };
        }
      }
    }
  }

  return null;
}

function pruneRepeatedMarginLines(pages) {
  const frequency = new Map();

  for (const page of pages) {
    const edgeLines = [...page.lines.slice(0, 3), ...page.lines.slice(-3)];
    const uniqueOnPage = new Set(
      edgeLines.map((line) => normalizeLineKey(line.text)).filter((text) => text && isLikelyMarginLine(text)),
    );

    for (const key of uniqueOnPage) {
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  }

  const minRepeats = Math.max(2, Math.ceil(pages.length * 0.4));
  const repeated = new Set([...frequency.entries()].filter(([, count]) => count >= minRepeats).map(([key]) => key));

  if (repeated.size === 0) {
    return pages;
  }

  return pages.map((page) => {
    const lines = page.lines.filter((line, index) => {
      const nearEdge = index < 3 || index >= page.lines.length - 3;
      if (!nearEdge) {
        return true;
      }

      return !repeated.has(normalizeLineKey(line.text));
    });

    return {
      ...page,
      lines,
      text: normalizeWhitespace(lines.map((line) => line.text).join("\n")),
    };
  });
}

function medianValue(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function sortPageLines(lines) {
  return [...lines].sort((left, right) => {
    if (right.y !== left.y) {
      return right.y - left.y;
    }

    return (left.xStart ?? 0) - (right.xStart ?? 0);
  });
}

function detectPageLayout(lines, pageWidth) {
  const safePageWidth = Number.isFinite(pageWidth) ? pageWidth : 0;
  const candidateLines = lines.filter(
    (line) =>
      line.text.length >= 36 &&
      line.width > 0 &&
      (!safePageWidth || line.width < safePageWidth * 0.78) &&
      !isLikelyMetadataLine(line.text) &&
      !isLikelyAuthorLine(line.text) &&
      !detectHeading(line.text),
  );
  const bodyFontSize = medianValue(candidateLines.map((line) => line.fontSize)) || medianValue(lines.map((line) => line.fontSize)) || 11;
  const wideThreshold = safePageWidth > 0 ? safePageWidth * 0.72 : Number.POSITIVE_INFINITY;
  const topBodyY = candidateLines.length > 0 ? Math.max(...candidateLines.map((line) => line.y)) : 0;
  const headerBoundaryY = topBodyY + Math.max(12, bodyFontSize * 1.2);

  if (!safePageWidth || candidateLines.length < 8) {
    return {
      mode: "single-column",
      splitX: safePageWidth / 2,
      bodyFontSize,
      wideThreshold,
      topBodyY,
      headerBoundaryY,
    };
  }

  const leftLines = candidateLines.filter((line) => line.xCenter <= safePageWidth * 0.48);
  const rightLines = candidateLines.filter((line) => line.xCenter >= safePageWidth * 0.52);
  const leftEdge = medianValue(leftLines.map((line) => line.xEnd));
  const rightEdge = medianValue(rightLines.map((line) => line.xStart));
  const gapWidth = rightEdge - leftEdge;
  const narrowShare = candidateLines.filter((line) => line.width < safePageWidth * 0.56).length / candidateLines.length;
  const isTwoColumn = leftLines.length >= 4 && rightLines.length >= 4 && gapWidth > safePageWidth * 0.06 && narrowShare >= 0.55;

  return {
    mode: isTwoColumn ? "two-column" : "single-column",
    splitX: isTwoColumn ? roundMetric((leftEdge + rightEdge) / 2) : safePageWidth / 2,
    bodyFontSize,
    wideThreshold,
    topBodyY,
    headerBoundaryY,
  };
}

function orderPageLinesForReading(page) {
  const sortedLines = sortPageLines(page.lines);
  const layout = detectPageLayout(sortedLines, page.pageWidth);

  if (layout.mode !== "two-column") {
    return {
      ...page,
      layoutMode: "single-column",
      lines: sortedLines,
      text: normalizeWhitespace(sortedLines.map((line) => line.text).join("\n")),
    };
  }

  const headerLines = [];
  const leftLines = [];
  const rightLines = [];
  const fullWidthLines = [];

  for (const line of sortedLines) {
    const isWide = line.width >= layout.wideThreshold;
    const isHeaderCandidate =
      line.y >= layout.headerBoundaryY ||
      (line.fontSize >= layout.bodyFontSize * 1.18 && line.y >= layout.topBodyY - Math.max(18, layout.bodyFontSize * 1.4)) ||
      (isWide && line.y >= layout.topBodyY);

    if (isHeaderCandidate) {
      headerLines.push(line);
      continue;
    }

    if (isWide) {
      fullWidthLines.push(line);
      continue;
    }

    if (line.xCenter <= layout.splitX) {
      leftLines.push(line);
    } else {
      rightLines.push(line);
    }
  }

  const orderedLines = [
    ...sortPageLines(headerLines),
    ...sortPageLines(leftLines),
    ...sortPageLines(rightLines),
    ...sortPageLines(fullWidthLines),
  ];

  return {
    ...page,
    layoutMode: "two-column",
    _splitX: layout.splitX,
    lines: orderedLines,
    text: normalizeWhitespace(orderedLines.map((line) => line.text).join("\n")),
  };
}

function cleanPdfJsPages(pages) {
  return pruneRepeatedMarginLines(pages)
    .map((page) => {
      const filteredLines = page.lines.filter((line, index) => {
        if (!line.text || line.text.length < 2) {
          return false;
        }

        if (isLikelyMarginLine(line.text) && (index < 3 || index >= page.lines.length - 3)) {
          return false;
        }

        return true;
      });

      return {
        ...page,
        lines: filteredLines,
        text: normalizeWhitespace(filteredLines.map((line) => line.text).join("\n")),
      };
    })
    .filter((page) => page.lines.length > 0 && page.text.length > 0)
    .map(orderPageLinesForReading);
}

function detectTitleGroup(pageLines) {
  const earlyCandidates = pageLines
    .map((line, index) => ({ ...line, index }))
    .filter((line) => line.index < 10 && isLikelyTitleCandidate(line.text));

  if (earlyCandidates.length === 0) {
    return null;
  }

  const maxFontSize = Math.max(...earlyCandidates.map((line) => line.fontSize || 0), 0);
  const threshold = maxFontSize > 0 ? maxFontSize * 0.82 : 0;
  const titleLines = earlyCandidates.filter((line) => (line.fontSize || 0) >= threshold);

  if (titleLines.length === 0) {
    return null;
  }

  const grouped = [];
  let currentGroup = [];

  for (const line of titleLines) {
    const previous = currentGroup[currentGroup.length - 1];
    if (!previous || line.index === previous.index + 1) {
      currentGroup.push(line);
      continue;
    }

    grouped.push(currentGroup);
    currentGroup = [line];
  }

  if (currentGroup.length > 0) {
    grouped.push(currentGroup);
  }

  const bestGroup = grouped
    .map((group) => {
      const text = cleanDetectedTitle(group.map((line) => line.text).join(" "));
      const score = group.reduce((sum, line) => sum + (line.fontSize || 0), 0) + Math.max(0, 12 - group[0].index) * 2;
      return {
        lines: group,
        text,
        startIndex: group[0].index,
        endIndex: group[group.length - 1].index,
        score,
      };
    })
    .filter((group) => isLikelyTitleCandidate(group.text))
    .sort((left, right) => right.score - left.score)[0];

  return bestGroup ?? null;
}

function chooseDerivedTitle({ metadataTitle, pageLines, fallbackTitle }) {
  const titleGroup = detectTitleGroup(pageLines);
  const cleanedMetadataTitle = cleanDetectedTitle(metadataTitle ?? "");

  if (titleGroup?.text) {
    return {
      title: titleGroup.text,
      titleRangeEnd: titleGroup.endIndex,
    };
  }

  if (isLikelyTitleCandidate(cleanedMetadataTitle)) {
    return {
      title: cleanedMetadataTitle,
      titleRangeEnd: -1,
    };
  }

  const cleanedFallbackTitle = cleanDetectedTitle(fallbackTitle ?? "");
  return {
    title: cleanedFallbackTitle || undefined,
    titleRangeEnd: -1,
  };
}

function extractFirstAuthor(pageLines, titleRangeEnd) {
  const authors = extractAuthors(pageLines, titleRangeEnd);
  return authors.length > 0 ? authors[0].name : undefined;
}

/**
 * Extract all authors from the first page of a PDF.
 * Scans lines after the title for author-like patterns.
 * Returns array of { name: string } objects.
 */
function extractAuthors(pageLines, titleRangeEnd) {
  const startIdx = Math.max(0, (titleRangeEnd ?? 0) + 1);
  const endIdx = Math.min(pageLines.length, startIdx + 8);
  const candidateLines = pageLines.slice(startIdx, endIdx);
  const nameRe = /^[A-Z][A-Za-z.'\-]+(?:[\s\-]+[A-Z][A-Za-z.'\-]+){0,3}$/;

  // Collect all consecutive author lines (some papers split authors across 2-3 lines)
  const authorNames = [];
  let foundAuthorLine = false;

  for (const line of candidateLines) {
    if (isLikelyAuthorLine(line.text)) {
      foundAuthorLine = true;
      const cleaned = normalizeWhitespace(line.text).replace(/\d+/g, " ").replace(/[*†‡§●•]/g, " ").trim();
      const parts = cleaned.split(/,|\band\b/i).map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        if (nameRe.test(part) && !authorNames.some((a) => a.name === part)) {
          authorNames.push({ name: part });
        }
      }
    } else if (foundAuthorLine) {
      // Stop once we leave the author block (hit affiliation, abstract, etc.)
      break;
    }
  }

  return authorNames;
}

function detectPublicationYearFromText(text) {
  const matches = [...normalizeWhitespace(text).matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) => Number(match[1]));
  const validYears = matches.filter((year) => year >= 1900 && year <= 2035);
  if (validYears.length === 0) {
    return undefined;
  }

  return Math.max(...validYears);
}

// Finite verbs that indicate a sentence (body text), not a caption noun phrase.
// Used to filter "Fig. N. <sentence>" from being detected as a figure caption.
const BODY_TEXT_VERB_RE =
  /\b(?:is|are|was|were|has|have|had|shows?|showed|can|could|would|may|might|shall|should|must|did|does|do)\b/i;

// Body-text preposition/verb phrases before a figure/table reference.
const BODY_REF_BEFORE_RE =
  /\b(?:in|see|from|shown|given|presented|described|illustrated|depicted|displayed|plotted|compared|reported|listed|as)\s+(?:Fig\.?|Figure|Table)\s/i;

// "Figure 3 shows that..." — verb right after figure number = body text, not caption.
// Captions use noun phrases ("Fig. 3 Comparison of..."), not finite verbs.
// Matches "Fig. N shows...", "Fig. 6(c) and (d) presents...", "Figure 5 represents..."
// The optional sub-figure group handles "(a)", "(c) and (d)", "a,b" etc. between number and verb
const FIG_THEN_VERB_RE =
  /(?:[Ff]ig\.?|[Ff]igure|FIG\.?|FIGURE)\s*\d+\s*(?:[a-z]?\s+|(?:\([a-z](?:[,\s]*(?:and\s+)?\([a-z]\))*\)\s*(?:and\s+\([a-z]\)\s*)?))(?:[Ss]hows?|[Ss]howed|[Dd]epicts?|[Ii]llustrates?|[Pp]resents?|[Dd]isplays?|[Ii]ndicates?|[Dd]emonstrates?|[Rr]eveals?|[Dd]escribes?|[Cc]ompares?|[Cc]onfirms?|[Pp]roves?|[Ss]ummarizes?|[Ll]ists?|[Pp]rovides?|[Gg]ives?|[Cc]ontains?|[Rr]epresents?|[Ss]uggests?|[Ee]xhibits?)\b/;

function inferItemWidth(item, fontSize, text) {
  const rawWidth = Number(item?.width);
  if (Number.isFinite(rawWidth) && rawWidth > 0) {
    return rawWidth;
  }

  return Math.max(fontSize * Math.max(String(text ?? "").length * 0.42, 1.6), 8);
}

function joinOrderedParts(orderedParts) {
  let text = "";
  let previousEnd = null;

  for (const part of orderedParts) {
    const nextText = normalizeWhitespace(part.text);
    if (!nextText) {
      continue;
    }

    if (!text) {
      text = nextText;
      previousEnd = part.xEnd;
      continue;
    }

    const gap = Number.isFinite(previousEnd) ? part.x - previousEnd : 0;
    text += gap > Math.max(12, part.fontSize * 0.9) ? "  " : " ";
    text += nextText;
    previousEnd = part.xEnd;
  }

  return normalizeWhitespace(text);
}

function buildPageTextFromItems(pageNumber, items, viewport = { width: 0, height: 0 }) {
  const lineBuckets = new Map();

  for (const item of items) {
    const text = normalizeWhitespace(item?.str ?? "");
    if (!text) {
      continue;
    }

    const transform = Array.isArray(item?.transform) ? item.transform : [0, 0, 0, 0, 0, 0];
    const x = Number.isFinite(transform[4]) ? transform[4] : 0;
    const y = Number.isFinite(transform[5]) ? transform[5] : 0;
    const fontSize = lineFontSizeFromItem(item);
    const width = inferItemWidth(item, fontSize, text);
    const xEnd = x + width;
    const bucketKey = String(Math.round(y * 2) / 2);
    const existing = lineBuckets.get(bucketKey);

    if (existing) {
      existing.push({ x, xEnd, text, fontSize, y });
    } else {
      lineBuckets.set(bucketKey, [{ x, xEnd, text, fontSize, y }]);
    }
  }

  const lines = Array.from(lineBuckets.entries())
    .sort((left, right) => Number(right[0]) - Number(left[0]))
    .map(([bucket, parts]) => {
      const orderedParts = parts.sort((left, right) => left.x - right.x);
      const text = joinOrderedParts(orderedParts);
      const fontSize = averageValue(orderedParts.map((part) => part.fontSize));
      const xStart = orderedParts[0]?.x ?? 0;
      const xEnd = Math.max(...orderedParts.map((part) => part.xEnd ?? part.x));
      const width = Math.max(0, xEnd - xStart);
      return {
        pageNumber,
        text,
        fontSize: roundMetric(fontSize),
        y: Number(bucket),
        xStart: roundMetric(xStart),
        xEnd: roundMetric(xEnd),
        xCenter: roundMetric(xStart + width / 2),
        width: roundMetric(width),
      };
    })
    .filter((line) => line.text.length > 0);

  return {
    pageNumber,
    pageWidth: roundMetric(viewport?.width ?? 0),
    pageHeight: roundMetric(viewport?.height ?? 0),
    layoutMode: "single-column",
    lines,
    text: normalizeWhitespace(lines.map((line) => line.text).join("\n")),
  };
}

async function readPdfPagesWithPdfJs(pdfBuffer) {
  const { getDocument } = await import(pdfJsModuleUrl);
  const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer) });

  try {
    const pdfDocument = await loadingTask.promise;
    let metadataTitle = "";

    try {
      const metadata = await pdfDocument.getMetadata();
      metadataTitle = normalizeWhitespace(metadata?.info?.Title ?? "");
    } catch {
      metadataTitle = "";
    }

    const rawPages = [];

    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);

      try {
        const viewport = page.getViewport({ scale: 1 });
        const textContent = await page.getTextContent();
        rawPages.push(buildPageTextFromItems(pageNumber, textContent.items ?? [], viewport));
      } finally {
        try {
          page.cleanup();
        } catch {
          // Best effort cleanup only.
        }
      }
    }

    return {
      metadataTitle,
      pageCount: pdfDocument.numPages,
      pages: cleanPdfJsPages(rawPages.filter((page) => page.text.length > 0)),
    };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      // Best effort cleanup only.
    }
  }
}

function resolveOptionalCommand(explicitPath, fallbackCommand) {
  const candidate = typeof explicitPath === "string" && explicitPath.trim() ? explicitPath.trim() : fallbackCommand;
  if (!candidate) {
    return null;
  }

  if (path.isAbsolute(candidate) && !existsSync(candidate)) {
    return null;
  }

  return candidate;
}

function isMissingCommandError(error) {
  return Boolean(error && typeof error === "object" && error.code === "ENOENT");
}

function runProcessCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr.trim() || stdout.trim() || `${command} exited with code ${code}`;
      reject(new Error(message));
    });
  });
}

function splitTextIntoPseudoLines(pageNumber, text, fontSize = 11) {
  const normalizedText = String(text ?? "").replace(/\r/g, "\n");
  const paragraphs = normalizedText
    .split(/\n{2,}/)
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
  const segments = paragraphs.length > 0 ? paragraphs : [normalizeWhitespace(normalizedText)];
  const lines = [];

  for (const segment of segments) {
    const sentenceCandidates = segment
      .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean);
    const workingSegments = sentenceCandidates.length > 0 ? sentenceCandidates : [segment];

    for (const candidate of workingSegments) {
      let cursor = 0;

      while (cursor < candidate.length) {
        let end = Math.min(cursor + 260, candidate.length);

        if (end < candidate.length) {
          const boundary = candidate.lastIndexOf(" ", end);
          if (boundary > cursor + 120) {
            end = boundary;
          }
        }

        const slice = normalizeWhitespace(candidate.slice(cursor, end));
        if (slice) {
          lines.push(slice);
        }

        cursor = end;
        while (cursor < candidate.length && /\s/.test(candidate[cursor])) {
          cursor += 1;
        }
      }
    }
  }

  return lines.map((lineText, index) => {
    const width = Math.min(560, Math.max(140, lineText.length * fontSize * 0.48));
    return {
      pageNumber,
      text: lineText,
      fontSize,
      y: 980 - index * 14,
      xStart: 56,
      xEnd: 56 + width,
      xCenter: 56 + width / 2,
      width,
    };
  });
}

export async function inspectPdfMetadata(pdfBuffer, fallbackTitle = "") {
  try {
    const { metadataTitle, pages } = await readPdfPagesWithPdfJs(pdfBuffer);
    const firstPage = pages[0];
    const titleChoice = chooseDerivedTitle({
      metadataTitle,
      pageLines: firstPage?.lines ?? [],
      fallbackTitle,
    });
    const mergedText = normalizeWhitespace(pages.slice(0, 2).map((page) => page.text).join("\n\n"));

    return {
      title: titleChoice.title,
      year: detectPublicationYearFromText(mergedText),
      firstAuthor: extractFirstAuthor(firstPage?.lines ?? [], titleChoice.titleRangeEnd),
      authors: extractAuthors(firstPage?.lines ?? [], titleChoice.titleRangeEnd),
      venue: undefined,
      abstractPreview: normalizeWhitespace(mergedText.slice(0, 320)),
    };
  } catch {
    const rawPdfText = pdfBuffer.toString("latin1");
    return {
      title: cleanDetectedTitle(fallbackTitle) || undefined,
      year: detectPublicationYearFromText(rawPdfText),
      firstAuthor: undefined,
      authors: [],
      venue: undefined,
      abstractPreview: normalizeWhitespace(rawPdfText.slice(0, 320)),
    };
  }
}

/**
 * Extract embedded figure images from a PDF.
 *
 * Strategy 1: pdfjs getOperatorList → page.objs.get() for decoded pixel data.
 * Strategy 2 (fallback): scan PDF binary for raw JPEG streams (DCTDecode).
 *
 * Returns: [{ figureNo, page, jpegBuffer? , rgbaData?, width?, height? }]
 *   - jpegBuffer: raw JPEG bytes (preferred, from fallback scanner)
 *   - rgbaData + width + height: decoded pixels (from pdfjs approach)
 */
export async function extractFigureImagesFromPdf(pdfBuffer, figureCandidates) {
  if (!figureCandidates || figureCandidates.length === 0) return [];

  // Strategy 1: pdfjs decoded images (best quality for standard embedded images)
  const pdfjsResults = await extractViaOperatorList(pdfBuffer, figureCandidates);
  if (pdfjsResults.length > 0) {
    console.log("[figure-images] pdfjs approach extracted", pdfjsResults.length, "images");
  }

  // Strategy 2: mupdf page render + crop (universal fallback — works for image masks,
  // vector graphics, CCITT, and any other encoding)
  const extractedSet = new Set(pdfjsResults.map((r) => r.figureNo));
  const remaining = figureCandidates.filter((f) => !extractedSet.has(f.figureNo));
  let cropResults = [];
  if (remaining.length > 0) {
    console.log("[figure-images] Attempting mupdf page crop for", remaining.length, "remaining figures");
    cropResults = await extractViaPageCrop(pdfBuffer, remaining);
    if (cropResults.length > 0) {
      console.log("[figure-images] mupdf crop extracted", cropResults.length, "images");
    }
  }

  const allResults = [...pdfjsResults, ...cropResults];
  if (allResults.length === 0) {
    console.log("[figure-images] all strategies yielded 0 images");
  }
  return allResults;
}

async function extractViaOperatorList(pdfBuffer, figureCandidates) {
  const pdfjsModule = await import(pdfJsModuleUrl);
  const { getDocument, OPS } = pdfjsModule;
  if (!OPS) return [];

  const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer) });

  try {
    const doc = await loadingTask.promise;
    const results = [];

    const figsByPage = new Map();
    for (const fig of figureCandidates) {
      if (!fig.page || fig.page < 1 || fig.page > doc.numPages) continue;
      const list = figsByPage.get(fig.page) || [];
      list.push(fig);
      figsByPage.set(fig.page, list);
    }

    for (const [pageNum, figs] of figsByPage) {
      const page = await doc.getPage(pageNum);
      try {
        const ops = await page.getOperatorList();
        const images = [];

        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue;

          try {
            let imgData;
            if (fn === OPS.paintInlineImageXObject) {
              imgData = ops.argsArray[i][0];
            } else {
              const imgName = ops.argsArray[i][0];
              imgData = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error("timeout")), 5000);
                page.objs.get(imgName, (data) => {
                  clearTimeout(timeout);
                  resolve(data);
                });
              });
            }

            if (imgData && imgData.width > 60 && imgData.height > 60 && imgData.data) {
              images.push({
                width: imgData.width,
                height: imgData.height,
                data: imgData.data,
                kind: imgData.kind ?? 3,
              });
            }
          } catch (imgErr) {
            console.warn("[figure-images] objs.get failed for page", pageNum, imgErr?.message);
          }
        }

        if (images.length > 0) {
          images.sort((a, b) => (b.width * b.height) - (a.width * a.height));
          for (let fi = 0; fi < figs.length; fi++) {
            const img = images[Math.min(fi, images.length - 1)];
            results.push({
              figureNo: figs[fi].figureNo,
              page: pageNum,
              width: img.width,
              height: img.height,
              rgbaData: normalizeImageToRgba(img.data, img.width, img.height, img.kind),
            });
          }
        }
      } finally {
        try { page.cleanup(); } catch { /* best effort */ }
      }
    }

    return results;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

/**
 * Scan rendered page pixels upward from caption to find the figure's top boundary.
 * Uses the caption's x-range so only the figure's column is analyzed — this handles
 * multi-column layouts where the other column has body text at the same y-positions.
 *
 * Algorithm: scan upward from caption through figure content, find the first significant
 * whitespace band (>= MIN_GAP_HEIGHT). That band separates body text / previous elements
 * from the current figure.
 */
function findFigureTopByPixels(pixels, fullWidth, fullHeight, channels, captionPx, scanLeftPx, scanRightPx) {
  const WHITE_THRESHOLD = 240;
  const MIN_GAP_HEIGHT = 24;         // 12pt at 2x — whitespace band to count as boundary
  const MIN_FIGURE_CONTENT = 40;     // need ≥40px of figure content before accepting a gap
  const MARGIN = 4;                  // include a few px of whitespace above figure
  const SCAN_STEP = 4;              // check every 4th pixel in row for performance

  const colWidth = scanRightPx - scanLeftPx;
  const noiseThreshold = Math.max(3, Math.floor(colWidth / SCAN_STEP * 0.10)); // 10% of sampled pixels — accounts for anti-aliased edges and thin border lines

  let figureContentRows = 0;
  let consecutiveWhite = 0;

  for (let row = captionPx - 1; row >= 0; row--) {
    // Count non-white pixels within the scan column
    let nonWhite = 0;
    const rowStart = row * fullWidth * channels;
    for (let col = scanLeftPx; col < scanRightPx; col += SCAN_STEP) {
      const idx = rowStart + col * channels;
      if (pixels[idx] < WHITE_THRESHOLD || pixels[idx + 1] < WHITE_THRESHOLD || pixels[idx + 2] < WHITE_THRESHOLD) {
        nonWhite++;
      }
    }

    if (nonWhite <= noiseThreshold) {
      // Whitespace row
      consecutiveWhite++;
    } else {
      // Content row
      if (consecutiveWhite >= MIN_GAP_HEIGHT && figureContentRows >= MIN_FIGURE_CONTENT) {
        // Found significant gap above figure content → this separates text from figure
        return Math.max(0, row + consecutiveWhite + 1 - MARGIN);
      }
      // Small gap within figure: absorb it
      figureContentRows += consecutiveWhite + 1;
      consecutiveWhite = 0;
    }
  }

  // Reached page top — trim leading whitespace
  if (consecutiveWhite > 0 && figureContentRows >= MIN_FIGURE_CONTENT) {
    return Math.max(0, consecutiveWhite - MARGIN);
  }
  return 0;
}

/**
 * Render PDF page with mupdf and crop to figure region.
 * Works universally regardless of image encoding (image masks, vector graphics, CCITT, etc.)
 *
 * Uses pdfjs text content to detect figure caption positions and pixel analysis
 * to determine precise crop boundaries.
 * Figures in academic papers are typically ABOVE their captions.
 */
async function extractViaPageCrop(pdfBuffer, figureCandidates) {
  let mupdf;
  try {
    mupdf = await import("mupdf");
  } catch {
    console.log("[figure-images] mupdf not available for page crop fallback");
    return [];
  }

  const pdfjsModule = await import(pdfJsModuleUrl);
  const { getDocument } = pdfjsModule;

  let pdfjsDoc;
  try {
    pdfjsDoc = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  } catch {
    return [];
  }

  const RENDER_SCALE = 2.0;
  const results = [];

  // Group figures by page
  const figsByPage = new Map();
  for (const fig of figureCandidates) {
    if (!fig.page || fig.page < 1) continue;
    const list = figsByPage.get(fig.page) || [];
    list.push(fig);
    figsByPage.set(fig.page, list);
  }

  // Open PDF once with mupdf
  const mupdfDoc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");

  for (const [pageNum, figs] of figsByPage) {
    try {
      // --- Get text positions from pdfjs ---
      const pdfPage = await pdfjsDoc.getPage(Math.min(pageNum, pdfjsDoc.numPages));
      const viewport = pdfPage.getViewport({ scale: 1.0 });
      const pageHeightPt = viewport.height;
      const tc = await pdfPage.getTextContent();
      pdfPage.cleanup();

      // Build text lines sorted visually top-to-bottom
      // pdfjs y: bottom-left origin (high y = top of page)
      const rawItems = [];
      for (const item of tc.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const x = item.transform[4];
        const w = item.width ?? 0;
        rawItems.push({ text: item.str, y: item.transform[5], x, xEnd: x + w });
      }
      rawItems.sort((a, b) => b.y - a.y || a.x - b.x); // top-to-bottom, left-to-right

      // Merge items into lines using y-bucket + x-gap detection
      // Items on the same y but with a large x gap are from different columns
      const lines = [];
      for (const item of rawItems) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(item.y - last.y) < 3) {
          const xGap = item.x - last.xEnd;
          if (xGap > 12) {
            // Large x gap → different column, treat as separate line
            lines.push({ text: item.text, y: item.y, x: item.x, xEnd: item.xEnd });
          } else {
            last.text += " " + item.text;
            last.xEnd = Math.max(last.xEnd, item.xEnd);
          }
        } else {
          lines.push({ text: item.text, y: item.y, x: item.x, xEnd: item.xEnd });
        }
      }

      // --- Render the full page once with mupdf ---
      const pageIndex = Math.min(pageNum - 1, mupdfDoc.countPages() - 1);
      const mupdfPage = mupdfDoc.loadPage(pageIndex);
      const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE);
      const pixmap = mupdfPage.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true, true);
      const fullWidth = pixmap.getWidth();
      const fullHeight = pixmap.getHeight();
      const channels = pixmap.getNumberOfComponents(); // 4 for RGBA
      const fullPixels = pixmap.getPixels();

      // --- For each figure, find crop coordinates ---
      for (const fig of figs) {
        try {
          const figNum = fig.figureNo.replace(/\D/g, "");
          const captionRe = new RegExp(`(?:[Ff]ig\\.?|[Ff]igure|FIG\\.?|FIGURE)\\s*${figNum}(?![0-9])`);

          // Find this figure's caption — skip body text references
          let captionY = null;
          let captionX = 0;
          let captionXEnd = 0;
          for (const line of lines) {
            if (!captionRe.test(line.text)) continue;
            if (BODY_REF_BEFORE_RE.test(line.text)) continue;
            if (FIG_THEN_VERB_RE.test(line.text)) continue;
            const refPos = line.text.search(/(?:[Ff]ig\.?|[Ff]igure|FIG\.?|FIGURE)\s*\d/);
            if (refPos > 25) continue;
            const dotRe = new RegExp(`(?:[Ff]ig\\.?|[Ff]igure|FIG\\.?|FIGURE)\\s*${figNum}\\s*[a-z]?\\.\\s`);
            if (dotRe.test(line.text)) {
              const afterDot = line.text.slice(line.text.search(dotRe) + line.text.match(dotRe)[0].length);
              if (BODY_TEXT_VERB_RE.test(afterDot.slice(0, 50))) continue;
            }
            captionY = line.y;
            captionX = line.x;
            captionXEnd = line.xEnd;
            break;
          }
          if (captionY === null) continue;

          const captionPixelY = Math.round((pageHeightPt - captionY) * RENDER_SCALE);
          const pageWidthPt = viewport.width;

          // Bottom boundary: caption + fixed margin (40pt covers 3-4 caption lines)
          const bottomPixel = Math.min(fullHeight, Math.round(captionPixelY + 40 * RENDER_SCALE));

          // --- Determine column vs full-width figure ---
          const captionCenterPt = (captionX + captionXEnd) / 2;
          const isFullWidth = Math.abs(captionCenterPt - pageWidthPt / 2) < pageWidthPt * 0.12;

          let scanLeftPt, scanRightPt;
          if (isFullWidth) {
            scanLeftPt = 0;
            scanRightPt = pageWidthPt;
          } else {
            scanLeftPt = Math.max(0, captionX - 15);
            scanRightPt = Math.min(pageWidthPt, captionXEnd + 15);
          }
          // Ensure minimum 25% width
          if (scanRightPt - scanLeftPt < pageWidthPt * 0.25) {
            const center = (scanLeftPt + scanRightPt) / 2;
            scanLeftPt = Math.max(0, center - pageWidthPt * 0.125);
            scanRightPt = Math.min(pageWidthPt, center + pageWidthPt * 0.125);
          }
          const scanLeftPx = Math.round(scanLeftPt * RENDER_SCALE);
          const scanRightPx = Math.round(scanRightPt * RENDER_SCALE);

          // --- Top boundary: text-gap analysis (primary) ---
          // Find the largest y-gap in text items within the figure's column.
          // Raster/chart figures create a text-free zone; the gap marks the boundary.
          const columnItems = rawItems
            .filter(item => {
              const cx = (item.x + item.xEnd) / 2;
              return cx >= scanLeftPt && cx <= scanRightPt && item.y > captionY;
            })
            .sort((a, b) => b.y - a.y);

          let topPixel = 0;
          const MIN_TEXT_GAP = 25;

          if (columnItems.length >= 1) {
            let maxGap = 0;
            let gapAboveIdx = -1;

            for (let i = 0; i < columnItems.length - 1; i++) {
              const gap = columnItems[i].y - columnItems[i + 1].y;
              if (gap > maxGap) { maxGap = gap; gapAboveIdx = i; }
            }
            // Also check gap between last column item and caption
            const lastItem = columnItems[columnItems.length - 1];
            const gapToCaption = lastItem.y - captionY;
            if (gapToCaption > maxGap) { maxGap = gapToCaption; gapAboveIdx = columnItems.length - 1; }

            if (maxGap >= MIN_TEXT_GAP) {
              // Item above the gap marks where text/table ends → figure starts below
              const aboveGapY = columnItems[gapAboveIdx].y;
              topPixel = Math.round((pageHeightPt - aboveGapY) * RENDER_SCALE + 20);
            }
          }

          // --- Fallback / refinement: pixel-based whitespace scan ---
          // Use pixel scanner when text-gap failed OR when the crop is suspiciously tall
          // (>50% of page = likely includes another figure or unrelated content above)
          const maxReasonableHeight = fullHeight * 0.50;
          if (topPixel <= 0 || (bottomPixel - topPixel) > maxReasonableHeight) {
            // For refinement, narrow the scan column inward to avoid edge artifacts
            const pixScanLeft = scanLeftPx + 10;
            const pixScanRight = scanRightPx - 10;
            const refined = findFigureTopByPixels(
              fullPixels, fullWidth, fullHeight, channels,
              captionPixelY, pixScanLeft, pixScanRight,
            );
            if (refined > topPixel) topPixel = refined;
          }

          // Sanity checks
          if (bottomPixel <= topPixel) continue;
          const finalHeight = bottomPixel - topPixel;
          if (finalHeight < 40) continue;

          // --- Extract cropped pixels (horizontal + vertical) ---
          // For column figures, use scan bounds directly (no extra padding that bleeds into adjacent column)
          const cropLeftPx = isFullWidth ? 0 : scanLeftPx;
          const cropRightPx = isFullWidth ? fullWidth : scanRightPx;
          const cropWidth = cropRightPx - cropLeftPx;

          const croppedPixels = new Uint8Array(cropWidth * finalHeight * channels);
          for (let row = 0; row < finalHeight; row++) {
            const srcRowStart = (topPixel + row) * fullWidth * channels;
            const srcColStart = srcRowStart + cropLeftPx * channels;
            croppedPixels.set(
              fullPixels.subarray(srcColStart, srcColStart + cropWidth * channels),
              row * cropWidth * channels,
            );
          }

          results.push({
            figureNo: fig.figureNo,
            page: pageNum,
            width: cropWidth,
            height: finalHeight,
            rgbaData: croppedPixels,
          });
        } catch (figErr) {
          console.warn(`[figure-images] crop failed for ${fig.figureNo}:`, figErr.message);
        }
      }
    } catch (pageErr) {
      console.warn(`[figure-images] page crop failed for page ${pageNum}:`, pageErr.message);
    }
  }

  await pdfjsDoc.destroy().catch(() => {});
  return results;
}

function normalizeImageToRgba(data, width, height, kind) {
  const pixelCount = width * height;

  if (kind === 3) {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  const rgba = new Uint8Array(pixelCount * 4);

  if (kind === 2) {
    for (let i = 0; i < pixelCount; i++) {
      rgba[i * 4] = data[i * 3];
      rgba[i * 4 + 1] = data[i * 3 + 1];
      rgba[i * 4 + 2] = data[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      rgba[i * 4] = data[i];
      rgba[i * 4 + 1] = data[i];
      rgba[i * 4 + 2] = data[i];
      rgba[i * 4 + 3] = 255;
    }
  }

  return rgba;
}

