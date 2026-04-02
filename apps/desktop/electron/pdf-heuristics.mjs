import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
const DEFAULT_OCR_PAGE_LIMIT = Math.max(1, Number(process.env.REDOU_OCR_PAGE_LIMIT ?? 18));
const DEFAULT_OCR_LANGUAGE = process.env.REDOU_TESSERACT_LANG ?? "eng";

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

function decodePdfLiteralString(token) {
  return token
    .slice(1, -1)
    .replace(/\\([()\\])/g, "$1")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\f/g, " ")
    .replace(/\\b/g, " ")
    .replace(/\\\d{1,3}/g, " ");
}

function looksReadableText(value) {
  if (value.length < 40) {
    return false;
  }

  const letters = (value.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 18) {
    return false;
  }

  const operatorTokens = [" obj", " endobj", " stream", " endstream", " BT ", " ET "];
  return !operatorTokens.some((token) => value.includes(token));
}

function uniqueSegments(segments) {
  const seen = new Set();
  const output = [];

  for (const segment of segments) {
    const normalized = normalizeWhitespace(segment);
    if (!looksReadableText(normalized)) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);

    if (output.length >= 240) {
      break;
    }
  }

  return output;
}

function extractLiteralSegments(rawPdfText) {
  const matches = rawPdfText.match(/\((?:\\.|[^\\()]){20,420}\)/g) ?? [];
  return matches.map(decodePdfLiteralString);
}

function extractFallbackSegments(rawPdfText) {
  const matches = rawPdfText.match(/[A-Za-z][A-Za-z0-9 ,;:'"“”‘’()[\]{}\-_/]{40,320}/g) ?? [];
  return matches;
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

function looksLikeBodyText(text) {
  const normalized = normalizeWhitespace(text);
  if (normalized.length < 80) {
    return false;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount >= 12 && /[a-z]/.test(normalized) && /[.?!,;]/.test(normalized);
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

const KNOWN_SECTION_NAMES = new Set(SECTION_PATTERNS.map((p) => p.name));

function finalizeSection(section, order) {
  const rawText = normalizeWhitespace(section.lines.map((line) => line.text).join("\n\n"));
  if (rawText.length < 80 && section.name !== "Abstract") {
    return null;
  }

  let confidence = 0.7;
  if (section.name === "Imported text") {
    confidence = 0.42;
  } else if (!KNOWN_SECTION_NAMES.has(section.name)) {
    // Generic numbered heading — slightly lower confidence
    confidence = 0.6;
  }

  return {
    sectionName: section.name,
    sectionOrder: order,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    rawText,
    parserConfidence: confidence,
    lines: section.lines,
  };
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

function summarizeLayoutMode(pages) {
  const counts = new Map();

  for (const page of pages) {
    const key = page.layoutMode ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const best = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return best?.[0] ?? "unknown";
}

function assessTextExtraction(pages, pageCount = pages.length) {
  const effectivePageCount = Math.max(1, pageCount || pages.length || 0);
  const totalTextLength = pages.reduce((sum, page) => sum + page.text.length, 0);
  const totalLines = pages.reduce((sum, page) => sum + page.lines.length, 0);
  const emptyPages = Math.max(0, effectivePageCount - pages.length);
  const sparsePages = pages.filter((page) => page.text.length < 120 || page.lines.length < 4).length + emptyPages;
  const avgCharsPerPage = totalTextLength / effectivePageCount;
  const avgLinesPerPage = totalLines / effectivePageCount;

  let scannedLikelihood = (sparsePages / effectivePageCount) * 0.65;
  if (avgCharsPerPage < 140) {
    scannedLikelihood += 0.22;
  } else if (avgCharsPerPage < 260) {
    scannedLikelihood += 0.12;
  }

  if (avgLinesPerPage < 4) {
    scannedLikelihood += 0.14;
  } else if (avgLinesPerPage < 8) {
    scannedLikelihood += 0.08;
  }

  return {
    totalTextLength,
    avgCharsPerPage: roundMetric(avgCharsPerPage),
    avgLinesPerPage: roundMetric(avgLinesPerPage),
    scannedLikelihood: roundMetric(Math.min(0.98, scannedLikelihood), 3),
    needsOcr: totalTextLength === 0 || scannedLikelihood >= 0.58 || avgCharsPerPage < 160,
  };
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

function buildAbstractPreview(text) {
  const normalized = normalizeWhitespace(text)
    .replace(/\bKeywords?:[\s\S]*$/i, "")
    .replace(/\b\d+(?:\.\d+)*\s*Introduction\b[\s\S]*$/i, "")
    .replace(/\bIntroduction\b[\s\S]*$/i, "")
    .trim();

  if (!normalized) {
    return "";
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const preview = normalizeWhitespace((sentences.slice(0, 4).join(" ") || normalized).slice(0, 900));
  return preview;
}

function buildSectionsFromPageLines(pages) {
  const sections = [];
  const preambleLines = [];
  let current = null;
  let reachedReferences = false;

  outer: for (const page of pages) {
    for (const line of page.lines) {
      const text = normalizeWhitespace(line.text);
      if (!text) {
        continue;
      }

      const detectedHeading = detectHeading(text);
      if (detectedHeading) {
        if (detectedHeading.name === "References") {
          reachedReferences = true;
          break outer;
        }

        if (current) {
          sections.push(current);
        }

        current = {
          name: detectedHeading.name,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          lines: detectedHeading.body ? [{ pageNumber: page.pageNumber, text: detectedHeading.body }] : [],
        };
        continue;
      }

      if (!current) {
        if (!isLikelyMetadataLine(text) && looksLikeBodyText(text)) {
          preambleLines.push({ pageNumber: page.pageNumber, text });
        }
        continue;
      }

      current.pageEnd = page.pageNumber;
      current.lines.push({ pageNumber: page.pageNumber, text });
    }
  }

  if (current) {
    sections.push(current);
  }

  let normalizedSections = sections
    .map((section, index) => finalizeSection(section, index + 1))
    .filter(Boolean)
    .slice(0, reachedReferences ? 20 : 25);

  if (normalizedSections.some((section) => section.sectionName !== "Imported text")) {
    normalizedSections = normalizedSections.filter((section) => section.sectionName !== "Imported text");
  }

  if (normalizedSections.length > 0) {
    return normalizedSections;
  }

  const fallbackText = normalizeWhitespace(preambleLines.map((line) => line.text).join("\n\n")).slice(0, 2800);
  if (!fallbackText) {
    return [];
  }

  return [
    {
      sectionName: "Imported text",
      sectionOrder: 1,
      pageStart: preambleLines[0]?.pageNumber ?? 1,
      pageEnd: preambleLines.at(-1)?.pageNumber ?? preambleLines[0]?.pageNumber ?? 1,
      rawText: fallbackText,
      parserConfidence: 0.34,
      lines: preambleLines,
    },
  ];
}

function splitSectionIntoChunks(section) {
  const chunks = [];
  const linesByPage = new Map();

  for (const line of section.lines ?? []) {
    const existing = linesByPage.get(line.pageNumber);
    if (existing) {
      existing.push(line.text);
    } else {
      linesByPage.set(line.pageNumber, [line.text]);
    }
  }

  let chunkOrder = 1;
  let cursor = 0;

  for (const [pageNumber, pageLines] of linesByPage.entries()) {
    const pageText = normalizeWhitespace(pageLines.join(" "));
    if (!pageText) {
      continue;
    }

    const maxChunkLength = 780;
    const minChunkLength = 280;
    let pageCursor = 0;

    while (pageCursor < pageText.length) {
      let end = Math.min(pageCursor + maxChunkLength, pageText.length);

      if (end < pageText.length) {
        const sentenceBoundary = pageText.lastIndexOf(". ", end);
        const whitespaceBoundary = pageText.lastIndexOf(" ", end);

        if (sentenceBoundary > pageCursor + minChunkLength) {
          end = sentenceBoundary + 1;
        } else if (whitespaceBoundary > pageCursor + minChunkLength) {
          end = whitespaceBoundary;
        }
      }

      const text = normalizeWhitespace(pageText.slice(pageCursor, end));
      if (text.length > 0) {
        chunks.push({
          sectionOrder: section.sectionOrder,
          chunkOrder,
          page: pageNumber,
          text,
          tokenCount: text.split(/\s+/).filter(Boolean).length,
          startCharOffset: cursor,
          endCharOffset: cursor + text.length,
          parserConfidence: Math.max(0.34, section.parserConfidence - 0.08),
        });
        chunkOrder += 1;
        cursor += text.length + 1;
      }

      pageCursor = end;
      while (pageCursor < pageText.length && /\s/.test(pageText[pageCursor])) {
        pageCursor += 1;
      }
    }
  }

  return chunks;
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

// In 2-column PDFs, the next line by y-sort may be from the other column.
// This helper finds the next line that's in the same column (xStart within ±80pt).
// Falls back to page.lines[index + 1] for single-column layouts.
function findSameColumnNextLine(lines, index, currentXStart) {
  const COLUMN_TOLERANCE = 80;
  // Check up to 3 lines ahead to find one in the same column
  for (let offset = 1; offset <= 3 && index + offset < lines.length; offset++) {
    const candidate = lines[index + offset];
    if (!candidate?.text) continue;
    // If no xStart info, fall back to accepting it
    if (currentXStart == null || candidate.xStart == null) return candidate;
    if (Math.abs(candidate.xStart - currentXStart) < COLUMN_TOLERANCE) return candidate;
  }
  // Fallback: return immediate next line
  return lines[index + 1] ?? null;
}

function extractFigureCandidatesFromPages(pages) {
  const figures = [];
  const seen = new Set();
  // No 'i' flag — [a-z]? must only match actual lowercase (sub-figure labels a,b,c)
  // With 'i' flag, [a-z]? would match uppercase caption first letters like "S" in "Schematic"
  const pattern = /\b(?:[Ff]igure|[Ff]ig\.?|FIGURE|FIG\.?)\s*#?\s*(\d+)\s*[a-z]?\s*[:.\-]?\s*(.*)$/;
  for (const page of pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const currentLine = page.lines[index]?.text ?? "";
      const match = currentLine.match(pattern);
      if (!match) {
        continue;
      }

      // Skip body-text references like "in Fig. 1", "shown in Figure 2"
      if (BODY_REF_BEFORE_RE.test(currentLine)) {
        continue;
      }

      // Skip "Figure 3 shows that..." — verb after figure number = body text
      if (FIG_THEN_VERB_RE.test(currentLine)) {
        continue;
      }

      // "Fig. N" or "Figure N" should appear near the start of the line for a caption
      // (captions start with "Fig." — body text has it mid-sentence)
      const figPos = currentLine.search(/(?:[Ff]ig\.?|[Ff]igure|FIG\.?|FIGURE)\s*\d/);
      if (figPos > 25) {
        continue;
      }

      // "Fig. 5. The order of adsorption rate... was..." — period after number
      // then sentence with verb = body text starting with a figure reference,
      // NOT a caption. Real captions: "Fig. 5 Effective diffusion time constants..."
      const figDotSentenceRe = new RegExp(
        `(?:[Ff]ig\\.?|[Ff]igure|FIG\\.?|FIGURE)\\s*${match[1]}\\s*[a-z]?\\.\\s`,
      );
      if (figDotSentenceRe.test(currentLine)) {
        const captionText = match[2] || "";
        // Only check first ~50 chars for verb — body text has verb early
        // ("The order... was"), while real captions have verb in a late subordinate
        // clause ("Adsorption amount of... until the concentration... was")
        if (
          BODY_TEXT_VERB_RE.test(captionText.slice(0, 50))
        ) {
          continue;
        }
      }

      const figureNo = `Figure ${match[1]}`;

      // Deduplicate by figure number only (merge a/b/c into one)
      if (seen.has(figureNo)) {
        continue;
      }

      let caption = normalizeWhitespace(match[2] ?? "");

      // Body text continuation: caption starts with closing bracket/punctuation
      // e.g. "Fig. 2), but the difference..." or "Fig. 1, and the amounts..."
      if (/^[)\],.;:]/.test(caption)) {
        continue;
      }

      // Body text: "(a)), caused by..." or "(b)). Therefore..." — sub-figure ref followed by closing paren
      // Real sub-figure captions: "(a) Description..." or "(a,b) Description..."
      if (/^\([a-z][^)]*\)\s*[)\],.;:]/.test(caption)) {
        continue;
      }

      // Body text: caption starts with lowercase (real captions start uppercase or "(")
      // Allow: "(a) ..." style sub-figure captions
      if (/^[a-z]/.test(caption) && !caption.startsWith("(")) {
        continue;
      }

      if (caption.length < 24) {
        // Column-aware next-line: prefer lines in the same column (similar xStart)
        const curLine = page.lines[index];
        const nextLine = findSameColumnNextLine(page.lines, index, curLine?.xStart);
        if (nextLine?.text) {
          caption = normalizeWhitespace(`${caption} ${nextLine.text}`);
        }
      }

      // Re-check body text filters after next-line merge
      if (/^[)\],.;:]/.test(caption) || (/^[a-z]/.test(caption) && !caption.startsWith("("))) {
        continue;
      }
      if (/^\([a-z][^)]*\)\s*[)\],.;:]/.test(caption)) {
        continue;
      }

      if (caption.length < 20 || isLikelyMetadataLine(caption)) {
        continue;
      }

      seen.add(figureNo);
      figures.push({
        figureNo,
        caption,
        page: page.pageNumber,
        summaryText: caption.length > 180 ? `${caption.slice(0, 177).trimEnd()}...` : caption,
        isKeyFigure: figures.length < 2,
        isPresentationCandidate: /result|overview|architecture|pipeline|comparison|benchmark/i.test(caption),
      });

      if (figures.length >= 12) {
        return figures;
      }
    }
  }

  return figures;
}

function extractTableCandidatesFromPages(pages) {
  const tables = [];
  const seen = new Set();
  // Match "Table N" only when it appears at/near the start of a line (caption),
  // NOT when it's embedded in body text like "...shown in Table 1..."
  // No 'i' flag — [a-z]? must only match actual lowercase (sub-table labels a,b,c)
  const captionPattern = /^(?:\s*(?:\d+\s+)?)?(?:[Tt]able|TABLE)\s*#?\s*(\d+)\s*[a-z]?\s*[:.\-]?\s*(.*)$/;
  const bodyRefPattern = /\b(?:in|see|from|of|shows?|given|listed|presented|shown|described)\s+(?:in\s+)?Table\s+\d/i;
  const stopPattern = /^(?:Table|Figure|Fig\.?|Equation|Eq\.?|References|Bibliography|\d+\.\s+[A-Z])/i;

  for (const page of pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const currentLine = page.lines[index]?.text ?? "";
      const match = currentLine.match(captionPattern);
      if (!match) {
        continue;
      }

      // Skip body text references like "as shown in Table 1" or "Table 1 shows..."
      if (bodyRefPattern.test(currentLine)) {
        continue;
      }

      // "Table N" should appear within the first 20 chars of the line to be a caption
      const tablePos = currentLine.search(/Table\s*\d/i);
      if (tablePos > 20) {
        continue;
      }

      // "Table 4. The small adsorption amounts..." — period after number then sentence
      // with a verb = body text, not a caption. Captions use noun phrases.
      const tableDotSentenceRe = new RegExp(
        `(?:[Tt]able|TABLE)\\s*${match[1]}\\s*[a-z]?\\.\\s`,
      );
      if (tableDotSentenceRe.test(currentLine)) {
        const captionText = match[2] || "";
        // Check verb in first 50 chars
        if (BODY_TEXT_VERB_RE.test(captionText.slice(0, 50))) {
          continue;
        }
        // Sentence starters: "The", "This", "These", "It", "In", "As", "For"
        // Table captions use noun phrases ("Physical properties...", "Parameters of...")
        // not sentence beginnings ("The small adsorption amounts...")
        if (/^(?:The|This|These|Those|It|In|As|For|From|With|However|Moreover|Furthermore|Although|Since)\s/i.test(captionText)) {
          continue;
        }
      }

      const tableNo = `Table ${match[1]}`;

      if (seen.has(tableNo)) {
        continue;
      }

      let caption = normalizeWhitespace(match[2] ?? "");

      // Body text continuation: "Table 1, the results show..." or "Table 2) for comparison"
      if (/^[)\],.;:]/.test(caption)) {
        continue;
      }

      // Body text: caption starts with lowercase (real table captions start uppercase)
      if (/^[a-z]/.test(caption)) {
        continue;
      }

      if (caption.length < 24) {
        // Column-aware next-line: prefer lines in the same column (similar xStart)
        const curLine = page.lines[index];
        const nextLine = findSameColumnNextLine(page.lines, index, curLine?.xStart);
        if (nextLine?.text) {
          caption = normalizeWhitespace(`${caption} ${nextLine.text}`);
        }
      }

      // Re-check body text filters after next-line merge (standalone "Table N" lines
      // have empty initial caption, so pre-merge filter doesn't catch body text from next line)
      if (/^[)\],.;:]/.test(caption) || /^[a-z]/.test(caption)) {
        continue;
      }

      if (caption.length < 10 || isLikelyMetadataLine(caption)) {
        continue;
      }

      // Extract table body text: collect lines after caption until next heading/figure/table
      // or until we encounter body-text prose (long sentences with articles/verbs).
      // Tables in PDFs are typically short structured data; long prose = we've left the table.
      const bodyLines = [];
      const captionConsumed = caption.length < 24 ? 2 : 1;
      let consecutiveProse = 0;
      let totalChars = 0;
      let lastBodyLineIndex = -1;
      for (let bi = index + captionConsumed; bi < page.lines.length; bi += 1) {
        const line = normalizeWhitespace(page.lines[bi]?.text ?? "");
        if (!line) continue;
        if (stopPattern.test(line)) break;
        // Detect body text: line with 8+ words and common prose function words
        const wordCount = line.split(/\s+/).length;
        const isProse = wordCount >= 8 && /[a-z]{3,}/.test(line) && /\b(?:the|is|are|was|were|of|in|for|and|with|that|this|from|by|to|an?)\b/i.test(line);
        if (isProse) {
          consecutiveProse += 1;
          // Two consecutive prose lines means we've left the table body
          if (consecutiveProse >= 2) {
            // Remove the first prose line that was tentatively added
            bodyLines.pop();
            break;
          }
        } else {
          consecutiveProse = 0;
        }
        bodyLines.push(line);
        lastBodyLineIndex = bi;
        totalChars += line.length;
        // Hard limits: tables rarely exceed 30 lines or 2500 chars of raw text
        if (bodyLines.length >= 30 || totalChars >= 2500) break;
      }
      const tableBody = bodyLines.join("\n").trim();

      // Gather coordinate metadata for OCR cropping
      const captionLine = page.lines[index];
      const lastBodyLine = lastBodyLineIndex >= 0 ? page.lines[lastBodyLineIndex] : null;

      seen.add(tableNo);
      tables.push({
        figureNo: tableNo,
        caption,
        page: page.pageNumber,
        summaryText: tableBody || caption,
        isKeyFigure: false,
        isPresentationCandidate: /result|comparison|benchmark|performance|accuracy/i.test(caption),
        itemType: "table",
        _captionY: captionLine?.y ?? null,
        _bodyYEnd: lastBodyLine?.y ?? null,
        _xStart: captionLine?.xStart ?? null,
        _xEnd: captionLine?.xEnd ?? null,
        _pageWidth: page.pageWidth ?? null,
        _splitX: page._splitX ?? null,
      });

      if (tables.length >= 12) {
        return tables;
      }
    }
  }

  return tables;
}

function extractEquationCandidatesFromPages(pages) {
  const equations = [];
  const seen = new Set();

  // Pattern 1: "Equation 1", "Eq. 2", "Eq 3:" as explicit labels (display equations only, not body refs)
  const labeledPattern = /\b(?:Equation|Eq\.?)\s*[.(ð]?\s*(\d+)\s*[.)Þ]?\s*[:.\-]?\s*(.*)$/i;
  // Skip body-text references like "in Eq. (4)", "using Eq. (11)", "from Eq. 3"
  const eqBodyRefPattern = /\b(?:in|see|from|using|by|of|into|with|to|and|gives?|yields?|becomes?|shows?|given|described|defined|presented|listed)\s+(?:Eq\.?|Equation)\s/i;
  // Also skip "Eq. (N)" appearing mid-sentence (preceded by lowercase or common words)
  const eqMidSentencePattern = /[a-z,;]\s+(?:Eq\.?|Equation)\s*[.(ð]?\s*\d/i;

  // Pattern 2: line ending with (number) — most common equation numbering in academic papers
  // Some PDFs encode parentheses as ð...Þ (U+00F0, U+00DE) due to font encoding issues
  const trailingNumPattern = /[\(ð]\s*(\d{1,3})\s*[\)Þ]\s*$/;

  // Pattern 3: ð N Þ anywhere in line (safe for mid-line because ð...Þ encoding is display-equation-specific)
  // Handles 2-column PDF merge artifacts where equation number is followed by text from adjacent column
  const midLineEthPattern = /ð\s*(\d{1,3})\s*Þ/g;

  const mathHints = /[=<>≤≥≈∼±×÷∑∫∂∇∞∈∀∃⊂⊃∪∩αβγδεζηθλμνξπρσφψωΔΘΛΣΦΨΩ^_{}|¼½¾]|\b(?:log|exp|sin|cos|tan|max|min|arg|lim|sup|inf)\b/i;

  function addEquation(num, context, pageNumber, lineY, lineIndex, lineXStart, lineXEnd, pageWidth, pageLines, splitX) {
    const numVal = parseInt(num, 10);
    // Equation numbers > 30 are almost certainly reference numbers like [89]
    if (numVal > 30) return;
    const eqNo = `Eq. ${num}`;
    if (seen.has(eqNo)) return;
    seen.add(eqNo);
    const eqText = normalizeWhitespace(context);

    // Scan adjacent lines to find the equation's vertical extent.
    // Multi-line equations (fractions, matrices) extend above/below the detected line.
    let yTop = lineY;
    let yBottom = lineY;
    if (lineY != null && lineIndex != null && pageLines) {
      const eqX = lineXStart ?? 0;
      // Scan upward (max 5 lines)
      for (let j = lineIndex - 1; j >= Math.max(0, lineIndex - 5); j--) {
        const prev = pageLines[j];
        if (!prev || prev.y == null) break;
        if (Math.abs(prev.y - yTop) > 25) break; // gap too large
        if (prev.xStart != null && Math.abs(prev.xStart - eqX) > 60) break; // different column
        const text = prev.text ?? "";
        if (/\b(?:the|is|are|was|were|of|in|for|and|with|that|this)\b/i.test(text) && text.split(/\s+/).length >= 8) break;
        if (mathHints.test(text) || text.trim().length < 50) {
          yTop = prev.y;
        } else break;
      }
      // Scan downward (max 5 lines)
      for (let j = lineIndex + 1; j <= Math.min((pageLines.length ?? 0) - 1, lineIndex + 5); j++) {
        const next = pageLines[j];
        if (!next || next.y == null) break;
        if (Math.abs(next.y - yBottom) > 25) break;
        if (next.xStart != null && Math.abs(next.xStart - eqX) > 60) break;
        const text = next.text ?? "";
        if (/\b(?:the|is|are|was|were|of|in|for|and|with|that|this)\b/i.test(text) && text.split(/\s+/).length >= 8) break;
        if (mathHints.test(text) || text.trim().length < 50) {
          yBottom = next.y;
        } else break;
      }
    }

    equations.push({
      figureNo: eqNo,
      caption: eqText || `Equation ${num}`,
      page: pageNumber,
      summaryText: eqText || null,
      isKeyFigure: false,
      isPresentationCandidate: false,
      itemType: "equation",
      _lineY: lineY ?? null,
      _lineIndex: lineIndex ?? null,
      _xStart: lineXStart ?? null,
      _xEnd: lineXEnd ?? null,
      _pageWidth: pageWidth ?? null,
      _yTop: yTop ?? null,
      _yBottom: yBottom ?? null,
      _splitX: splitX ?? null,
    });
  }

  for (const page of pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const currentLine = page.lines[index]?.text ?? "";
      if (equations.length >= 20) return equations;

      // Try labeled equation first (Equation 1, Eq. 2, Eq. (3))
      // But skip body-text references like "in Eq. (4)" or "using Eq. (11)"
      const labeledMatch = currentLine.match(labeledPattern);
      if (labeledMatch) {
        if (!eqBodyRefPattern.test(currentLine) && !eqMidSentencePattern.test(currentLine)) {
          const num = labeledMatch[1];
          // "Eq. N" should appear near start of line (within first 30 chars) for display equations
          const eqPos = currentLine.search(/(?:Equation|Eq\.?)\s/i);
          if (eqPos <= 30) {
            let description = normalizeWhitespace(labeledMatch[2] ?? "");
            if (description.length < 10 && page.lines[index + 1]?.text) {
              description = normalizeWhitespace(`${description} ${page.lines[index + 1].text}`);
            }
            addEquation(num, description, page.pageNumber, page.lines[index]?.y, index, page.lines[index]?.xStart, page.lines[index]?.xEnd, page.pageWidth, page.lines, page._splitX);
            continue;
          }
        }
      }

      // Try trailing (number) — e.g. "x = a + b (1)" or "L = ∑ yi log(pi) (3)"
      const trailingMatch = currentLine.match(trailingNumPattern);
      if (trailingMatch) {
        const num = trailingMatch[1];
        if (seen.has(`Eq. ${num}`)) continue;

        const beforeNum = currentLine.slice(0, trailingMatch.index).trim();
        const hasOperators = /[=<>¼]/.test(beforeNum);
        const lineLen = beforeNum.length;

        // Skip if it looks like a citation "(1)" in running prose — long paragraph without math
        if (!mathHints.test(beforeNum) && !hasOperators && lineLen > 80) continue;
        // Very short lines like just "(1)" or "ð 4 Þ" — check if surrounded by math-like content
        if (lineLen < 3) {
          const prevLine = page.lines[index - 1]?.text ?? "";
          const prevPrev = page.lines[index - 2]?.text ?? "";
          const hasMathNearby = mathHints.test(prevLine + prevPrev);
          const shortNearby = prevLine.trim().length < 60 && prevLine.trim().length > 3;
          if (!hasMathNearby && !shortNearby) continue;
        }

        addEquation(num, normalizeWhitespace(beforeNum), page.pageNumber, page.lines[index]?.y, index, page.lines[index]?.xStart, page.lines[index]?.xEnd, page.pageWidth, page.lines, page._splitX);
        // Don't continue — mid-line pattern may find additional equation numbers on the same line
      }

      // Try mid-line ð N Þ pattern (for 2-column PDFs where equation number isn't at line end)
      // This only matches ð...Þ encoding (not regular parentheses) to avoid citation false positives
      let ethMatch;
      midLineEthPattern.lastIndex = 0;
      while ((ethMatch = midLineEthPattern.exec(currentLine)) !== null) {
        const num = ethMatch[1];
        if (seen.has(`Eq. ${num}`)) continue;

        const beforeNum = currentLine.slice(0, ethMatch.index).trim();
        const hasOperators = /[=<>¼]/.test(beforeNum);
        const lineLen = beforeNum.length;

        // Same validation as trailing pattern
        if (!mathHints.test(beforeNum) && !hasOperators && lineLen > 80) continue;
        if (lineLen < 3) {
          const prevLine = page.lines[index - 1]?.text ?? "";
          const prevPrev = page.lines[index - 2]?.text ?? "";
          const hasMathNearby = mathHints.test(prevLine + prevPrev);
          const shortNearby = prevLine.trim().length < 60 && prevLine.trim().length > 3;
          if (!hasMathNearby && !shortNearby) continue;
        }

        addEquation(num, normalizeWhitespace(beforeNum), page.pageNumber, page.lines[index]?.y, index, page.lines[index]?.xStart, page.lines[index]?.xEnd, page.pageWidth, page.lines, page._splitX);
      }
    }
  }

  // Post-extraction continuity check:
  // Real equations are numbered sequentially (1,2,3,...). If detected numbers
  // are sparse/random (e.g. 2,10,12 or 46,53,89), they're likely reference numbers.
  if (equations.length >= 2) {
    const nums = equations.map(eq => parseInt(eq.figureNo.replace("Eq. ", ""), 10)).sort((a, b) => a - b);
    const maxNum = nums[nums.length - 1];
    const minNum = nums[0];
    const span = maxNum - minNum + 1;
    // Coverage: what fraction of the [min..max] range is actually filled?
    // Real equations: 1,2,3,4,5 → coverage = 5/5 = 1.0
    // False positives: 2,10,12 → coverage = 3/11 = 0.27
    const coverage = nums.length / span;
    // Also check: does it start near 1? Real equations almost always include Eq. 1
    const startsNear1 = minNum <= 2;
    if (coverage < 0.4 && !startsNear1) {
      // Sparse, non-sequential, doesn't start at 1 → likely all false positives
      return [];
    }
    if (coverage < 0.3) {
      // Even if starts at 1, extremely sparse means false positives
      return [];
    }
  }

  return equations;
}

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

async function maybeRunOptionalOcr(pdfPath, pageCount = DEFAULT_OCR_PAGE_LIMIT) {
  const tesseractCommand = resolveOptionalCommand(process.env.REDOU_TESSERACT_PATH, "tesseract");
  const pdftoppmCommand = resolveOptionalCommand(process.env.REDOU_PDFTOPPM_PATH, "pdftoppm");
  const magickCommand = resolveOptionalCommand(process.env.REDOU_MAGICK_PATH, "magick");

  if (!pdfPath || !tesseractCommand || (!pdftoppmCommand && !magickCommand)) {
    return {
      available: false,
      used: false,
      provider: null,
      pages: [],
      textLength: 0,
      error: null,
    };
  }

  const safePageLimit = Math.max(1, Math.min(pageCount || DEFAULT_OCR_PAGE_LIMIT, DEFAULT_OCR_PAGE_LIMIT));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "redou-ocr-"));

  try {
    let provider = null;
    let rasterError = null;

    if (pdftoppmCommand) {
      try {
        await runProcessCapture(pdftoppmCommand, [
          "-f",
          "1",
          "-l",
          String(safePageLimit),
          "-r",
          "220",
          "-png",
          pdfPath,
          path.join(tempDir, "page"),
        ]);
        provider = "tesseract+pdftoppm";
      } catch (error) {
        rasterError = error;
      }
    }

    if (!provider && magickCommand) {
      try {
        await runProcessCapture(magickCommand, [
          "-density",
          "220",
          `${pdfPath}[0-${safePageLimit - 1}]`,
          "-background",
          "white",
          "-alpha",
          "remove",
          path.join(tempDir, "page-%03d.png"),
        ]);
        provider = "tesseract+magick";
      } catch (error) {
        rasterError = error;
      }
    }

    if (!provider) {
      return {
        available: !isMissingCommandError(rasterError),
        used: false,
        provider: null,
        pages: [],
        textLength: 0,
        error: rasterError instanceof Error ? rasterError.message : String(rasterError ?? "OCR rasterizer unavailable."),
      };
    }

    const imageFiles = (await fs.readdir(tempDir))
      .filter((name) => /\.png$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    const pages = [];

    for (let index = 0; index < imageFiles.length; index += 1) {
      const imagePath = path.join(tempDir, imageFiles[index]);
      const { stdout } = await runProcessCapture(tesseractCommand, [
        imagePath,
        "stdout",
        "-l",
        DEFAULT_OCR_LANGUAGE,
        "--dpi",
        "220",
      ]);
      const normalizedText = normalizeWhitespace(stdout);
      if (normalizedText.length < 20) {
        continue;
      }

      const pageNumber = index + 1;
      const lines = splitTextIntoPseudoLines(pageNumber, normalizedText);
      const pageText = normalizeWhitespace(lines.map((line) => line.text).join("\n")) || normalizedText;
      pages.push({
        pageNumber,
        pageWidth: 700,
        pageHeight: 1000,
        layoutMode: "ocr-text",
        lines,
        text: pageText,
      });
    }

    return {
      available: true,
      used: pages.length > 0,
      provider,
      pages,
      textLength: pages.reduce((sum, page) => sum + page.text.length, 0),
      error: null,
    };
  } catch (error) {
    return {
      available: !isMissingCommandError(error),
      used: false,
      provider: null,
      pages: [],
      textLength: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup only.
    }
  }
}

function fallbackExtraction(pdfBuffer, paperTitle) {
  const rawPdfText = pdfBuffer.toString("latin1");
  const literalSegments = extractLiteralSegments(rawPdfText);
  const fallbackSegments = extractFallbackSegments(rawPdfText);
  const segments = uniqueSegments([...literalSegments, ...fallbackSegments]);
  const mergedText = normalizeWhitespace(segments.join("\n\n"));
  const pseudoPages = segments.slice(0, 24).map((segment, index) => ({
    pageNumber: index + 1,
    pageWidth: 700,
    pageHeight: 1000,
    layoutMode: "heuristic-text",
    lines: splitTextIntoPseudoLines(index + 1, normalizeWhitespace(segment)),
    text: normalizeWhitespace(segment),
  }));
  const sections = buildSectionsFromPageLines(pseudoPages);
  const chunks = sections.flatMap((section) => splitSectionIntoChunks(section));
  const figures = extractFigureCandidatesFromPages(pseudoPages);
  const tables = extractTableCandidatesFromPages(pseudoPages);
  const equations = extractEquationCandidatesFromPages(pseudoPages);
  const abstractSection = sections.find((section) => section.sectionName === "Abstract");
  const derivedTitle = cleanDetectedTitle(paperTitle);
  const abstractSource = abstractSection?.rawText ?? sections[0]?.rawText ?? mergedText;

  return {
    paperTitle: derivedTitle || paperTitle,
    derivedTitle: derivedTitle || undefined,
    publicationYear: detectPublicationYearFromText(mergedText),
    firstAuthor: undefined,
    extractedTextLength: mergedText.length,
    abstractText: buildAbstractPreview(abstractSource.slice(0, 1600) ?? ""),
    sections: sections.map(({ lines, ...section }) => section),
    chunks,
    figures,
    tables,
    equations,
    extractionMode: "heuristic-fallback",
    layoutMode: "unknown",
    ocrAvailable: false,
    ocrUsed: false,
    ocrProvider: null,
    scannedLikelihood: mergedText.length < 400 ? 0.72 : 0.32,
  };
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

export async function extractHeuristicPaperData(pdfBuffer, paperTitle = "", options = {}) {
  let ocrResult = {
    available: false,
    used: false,
    provider: null,
    pages: [],
    textLength: 0,
    error: null,
  };

  try {
    const pdfJsResult = await readPdfPagesWithPdfJs(pdfBuffer);
    const coverage = assessTextExtraction(pdfJsResult.pages, pdfJsResult.pageCount);

    if (coverage.needsOcr && options?.pdfPath) {
      ocrResult = await maybeRunOptionalOcr(options.pdfPath, pdfJsResult.pageCount || DEFAULT_OCR_PAGE_LIMIT);
    }

    const useOcrPages =
      ocrResult.used &&
      (pdfJsResult.pages.length === 0 || ocrResult.textLength > Math.max(coverage.totalTextLength * 1.12, 480));
    const workingPages = useOcrPages ? ocrResult.pages : pdfJsResult.pages;

    if (workingPages.length === 0) {
      const fallback = fallbackExtraction(pdfBuffer, paperTitle);
      return {
        ...fallback,
        ocrAvailable: ocrResult.available,
        ocrUsed: false,
        ocrProvider: ocrResult.provider,
        scannedLikelihood: coverage.scannedLikelihood,
      };
    }

    const firstPage = workingPages[0];
    const titleChoice = chooseDerivedTitle({
      metadataTitle: pdfJsResult.metadataTitle,
      pageLines: firstPage?.lines ?? [],
      fallbackTitle: paperTitle,
    });
    const sections = buildSectionsFromPageLines(workingPages);
    const chunks = sections.flatMap((section) => splitSectionIntoChunks(section));
    const figures = extractFigureCandidatesFromPages(workingPages);
    const tables = extractTableCandidatesFromPages(workingPages);
    const equations = extractEquationCandidatesFromPages(workingPages);
    const abstractSection = sections.find((section) => section.sectionName === "Abstract");
    const mergedText = normalizeWhitespace(workingPages.map((page) => page.text).join("\n\n"));
    const abstractSource = abstractSection?.rawText ?? sections[0]?.rawText ?? workingPages[0]?.text ?? mergedText;
    const abstractText = buildAbstractPreview(abstractSource.slice(0, 1600));

    return {
      paperTitle: titleChoice.title || paperTitle,
      derivedTitle: titleChoice.title,
      publicationYear: detectPublicationYearFromText(mergedText),
      firstAuthor: extractFirstAuthor(firstPage?.lines ?? [], titleChoice.titleRangeEnd),
      authors: extractAuthors(firstPage?.lines ?? [], titleChoice.titleRangeEnd),
      extractedTextLength: mergedText.length,
      abstractText: normalizeWhitespace(abstractText),
      sections: sections.map(({ lines, ...section }) => section),
      chunks,
      figures,
      tables,
      equations,
      extractionMode: useOcrPages ? "ocr-backed" : "layout-aware",
      layoutMode: useOcrPages ? "ocr-text" : summarizeLayoutMode(pdfJsResult.pages),
      ocrAvailable: ocrResult.available,
      ocrUsed: useOcrPages,
      ocrProvider: useOcrPages ? ocrResult.provider : null,
      scannedLikelihood: coverage.scannedLikelihood,
    };
  } catch {
    return fallbackExtraction(pdfBuffer, paperTitle);
  }
}
