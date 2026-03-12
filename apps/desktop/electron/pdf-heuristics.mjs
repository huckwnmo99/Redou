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
  { name: "Introduction", patterns: [/^(?:\d+(?:\.\d+)*)?\s*introduction$/i, /^(?:\d+(?:\.\d+)*)?\s*introduction\s*[:.-]?\s+(.+)$/i] },
  { name: "Background", patterns: [/^(?:related work|background)$/i, /^(?:related work|background)\s*[:.-]?\s+(.+)$/i] },
  { name: "Method", patterns: [/^(?:\d+(?:\.\d+)*)?\s*(?:method|methods|methodology|approach|model|materials and methods)$/i, /^(?:\d+(?:\.\d+)*)?\s*(?:method|methods|methodology|approach|model|materials and methods)\s*[:.-]?\s+(.+)$/i] },
  { name: "Experiments", patterns: [/^(?:\d+(?:\.\d+)*)?\s*(?:experiment|experiments|evaluation|experimental setup)$/i, /^(?:\d+(?:\.\d+)*)?\s*(?:experiment|experiments|evaluation|experimental setup)\s*[:.-]?\s+(.+)$/i] },
  { name: "Results", patterns: [/^(?:\d+(?:\.\d+)*)?\s*(?:result|results|results and discussion|findings)$/i, /^(?:\d+(?:\.\d+)*)?\s*(?:result|results|results and discussion|findings)\s*[:.-]?\s+(.+)$/i] },
  { name: "Discussion", patterns: [/^(?:\d+(?:\.\d+)*)?\s*discussion$/i, /^(?:\d+(?:\.\d+)*)?\s*discussion\s*[:.-]?\s+(.+)$/i] },
  { name: "Conclusion", patterns: [/^(?:\d+(?:\.\d+)*)?\s*conclusion(?:s)?$/i, /^(?:\d+(?:\.\d+)*)?\s*conclusion(?:s)?\s*[:.-]?\s+(.+)$/i] },
  { name: "References", patterns: [/^references$/i, /^references\s*[:.-]?\s+(.+)$/i] },
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
  const normalized = normalizeWhitespace(text).replace(/\d+/g, " ").replace(/[*,†‡§]/g, " ").trim();
  if (!normalized || normalized.length > 140) {
    return false;
  }

  if (/@|https?:\/\//i.test(normalized) || /\bdepartment\b|\buniversity\b|\binstitute\b/i.test(normalized)) {
    return false;
  }

  const commaParts = normalized.split(/,| and /i).map((part) => part.trim()).filter(Boolean);
  if (commaParts.length < 2) {
    return false;
  }

  return commaParts.every((part) => /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}$/.test(part));
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

function detectHeading(lineText) {
  const normalized = normalizeWhitespace(lineText);

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

  return null;
}

function finalizeSection(section, order) {
  const rawText = normalizeWhitespace(section.lines.map((line) => line.text).join("\n\n"));
  if (rawText.length < 80 && section.name !== "Abstract") {
    return null;
  }

  return {
    sectionName: section.name,
    sectionOrder: order,
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
    rawText,
    parserConfidence: section.name === "Imported text" ? 0.42 : 0.7,
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
  const candidateLines = pageLines.slice(Math.max(0, titleRangeEnd + 1), Math.min(pageLines.length, titleRangeEnd + 6));

  for (const line of candidateLines) {
    if (!isLikelyAuthorLine(line.text)) {
      continue;
    }

    const cleaned = normalizeWhitespace(line.text).replace(/\d+/g, " ").replace(/[*,†‡§]/g, " ").trim();
    const first = cleaned.split(/,| and /i).map((part) => part.trim()).filter(Boolean)[0];
    if (first && /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}$/.test(first)) {
      return first;
    }
  }

  return undefined;
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
    .slice(0, reachedReferences ? 8 : 10);

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

function extractFigureCandidatesFromPages(pages) {
  const figures = [];
  const seen = new Set();
  const pattern = /\b(?:Figure|Fig\.?)\s*#?\s*(\d+)\s*[A-Za-z]?\s*[:.\-]?\s*(.*)$/i;

  for (const page of pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const currentLine = page.lines[index]?.text ?? "";
      const match = currentLine.match(pattern);
      if (!match) {
        continue;
      }

      const figureNo = `Figure ${match[1]}`;

      // Deduplicate by figure number only (merge a/b/c into one)
      if (seen.has(figureNo)) {
        continue;
      }

      let caption = normalizeWhitespace(match[2] ?? "");

      if (caption.length < 24 && page.lines[index + 1]?.text) {
        caption = normalizeWhitespace(`${caption} ${page.lines[index + 1].text}`);
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
  const pattern = /\b(?:Table)\s*#?\s*(\d+)\s*[A-Za-z]?\s*[:.\-]?\s*(.*)$/i;
  const stopPattern = /^(?:Table|Figure|Fig\.?|Equation|Eq\.?|References|Bibliography|\d+\.\s+[A-Z])/i;

  for (const page of pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const currentLine = page.lines[index]?.text ?? "";
      const match = currentLine.match(pattern);
      if (!match) {
        continue;
      }

      const tableNo = `Table ${match[1]}`;

      if (seen.has(tableNo)) {
        continue;
      }

      let caption = normalizeWhitespace(match[2] ?? "");

      if (caption.length < 24 && page.lines[index + 1]?.text) {
        caption = normalizeWhitespace(`${caption} ${page.lines[index + 1].text}`);
      }

      if (caption.length < 10 || isLikelyMetadataLine(caption)) {
        continue;
      }

      // Extract table body text: collect lines after caption until next heading/figure/table
      const bodyLines = [];
      const captionConsumed = caption.length < 24 ? 2 : 1;
      for (let bi = index + captionConsumed; bi < page.lines.length; bi += 1) {
        const line = normalizeWhitespace(page.lines[bi]?.text ?? "");
        if (!line) continue;
        if (stopPattern.test(line)) break;
        bodyLines.push(line);
        if (bodyLines.length >= 40) break;
      }
      const tableBody = bodyLines.join("\n").trim();

      seen.add(tableNo);
      tables.push({
        figureNo: tableNo,
        caption,
        page: page.pageNumber,
        summaryText: tableBody || caption,
        isKeyFigure: false,
        isPresentationCandidate: /result|comparison|benchmark|performance|accuracy/i.test(caption),
        itemType: "table",
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

  // Pattern 1: "Equation 1", "Eq. 2", "Eq 3:" as explicit labels
  const labeledPattern = /\b(?:Equation|Eq\.?)\s*[.(]?\s*(\d+)\s*[.)]?\s*[:.\-]?\s*(.*)$/i;
  // Pattern 2: line ending with (number) — most common equation numbering in academic papers
  const trailingNumPattern = /\((\d{1,3})\)\s*$/;

  for (const page of pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      const currentLine = page.lines[index]?.text ?? "";

      // Try labeled equation first (Equation 1, Eq. 2, Eq. (3))
      const labeledMatch = currentLine.match(labeledPattern);
      if (labeledMatch) {
        const eqNo = `Eq. ${labeledMatch[1]}`;
        if (seen.has(eqNo)) continue;

        let description = normalizeWhitespace(labeledMatch[2] ?? "");
        if (description.length < 10 && page.lines[index + 1]?.text) {
          description = normalizeWhitespace(`${description} ${page.lines[index + 1].text}`);
        }

        seen.add(eqNo);
        equations.push({
          figureNo: eqNo,
          caption: description || `Equation ${labeledMatch[1]}`,
          page: page.pageNumber,
          summaryText: description.length > 180 ? `${description.slice(0, 177).trimEnd()}...` : description || null,
          isKeyFigure: false,
          isPresentationCandidate: false,
          itemType: "equation",
        });

        if (equations.length >= 20) return equations;
        continue;
      }

      // Try trailing (number) — e.g. "x = a + b (1)" or "L = ∑ yi log(pi) (3)"
      const trailingMatch = currentLine.match(trailingNumPattern);
      if (trailingMatch) {
        const num = trailingMatch[1];
        const eqNo = `Eq. ${num}`;
        if (seen.has(eqNo)) continue;

        // Skip if it looks like a citation "(1)" in running prose — check if line is short-ish or has math chars
        const beforeNum = currentLine.slice(0, trailingMatch.index).trim();
        const mathHints = /[=<>≤≥≈∼±×÷∑∫∂∇∞∈∀∃⊂⊃∪∩αβγδεζηθλμνξπρσφψωΔΘΛΣΦΨΩ^_{}|]|\b(?:log|exp|sin|cos|tan|max|min|arg|lim|sup|inf)\b/i;
        const hasOperators = /[=<>]/.test(beforeNum);
        const lineLen = beforeNum.length;

        // Accept if: line has math-like content, or is relatively short (formula, not paragraph)
        if (!mathHints.test(beforeNum) && !hasOperators && lineLen > 80) continue;
        // Skip very short lines (just a number reference in isolation)
        if (lineLen < 3) continue;

        // Gather context: current line before the number
        const eqText = normalizeWhitespace(beforeNum);

        seen.add(eqNo);
        equations.push({
          figureNo: eqNo,
          caption: eqText || `Equation ${num}`,
          page: page.pageNumber,
          summaryText: eqText || null,
          isKeyFigure: false,
          isPresentationCandidate: false,
          itemType: "equation",
        });

        if (equations.length >= 20) return equations;
      }
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
      venue: undefined,
      abstractPreview: normalizeWhitespace(mergedText.slice(0, 320)),
    };
  } catch {
    const rawPdfText = pdfBuffer.toString("latin1");
    return {
      title: cleanDetectedTitle(fallbackTitle) || undefined,
      year: detectPublicationYearFromText(rawPdfText),
      firstAuthor: undefined,
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

  // Try Strategy 1 first (pdfjs decoded images)
  const pdfjsResults = await extractViaOperatorList(pdfBuffer, figureCandidates);
  if (pdfjsResults.length > 0) {
    console.log("[figure-images] pdfjs approach extracted", pdfjsResults.length, "images");
    return pdfjsResults;
  }

  // Fallback: Strategy 2 — scan for raw JPEG streams in PDF binary
  console.log("[figure-images] pdfjs approach yielded 0 images, trying raw JPEG scan");
  const jpegResults = extractViaJpegScan(pdfBuffer, figureCandidates);
  console.log("[figure-images] raw JPEG scan found", jpegResults.length, "images");
  return jpegResults;
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
 * Scan PDF binary for raw JPEG streams (FF D8 FF ... FF D9).
 * Research papers typically embed figures as JPEG.
 * Returns images sorted by size; assigns to figures in order.
 */
function extractViaJpegScan(pdfBuffer, figureCandidates) {
  const buf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
  const jpegs = [];

  for (let i = 0; i < buf.length - 3; i++) {
    // JPEG SOI marker: FF D8 FF
    if (buf[i] !== 0xFF || buf[i + 1] !== 0xD8 || buf[i + 2] !== 0xFF) continue;

    let end = i + 3;
    while (end < buf.length - 1) {
      if (buf[end] === 0xFF && buf[end + 1] === 0xD9) {
        end += 2;
        break;
      }
      end++;
    }

    const size = end - i;
    if (size > 4000) {
      jpegs.push({ data: buf.subarray(i, end), offset: i, size });
    }
    i = end - 1;
  }

  // Sort by size descending — largest JPEGs are most likely the actual figures
  jpegs.sort((a, b) => b.size - a.size);

  // Assign the largest N JPEGs to the N figure candidates (in figure order)
  const results = [];
  const sortedFigures = [...figureCandidates]
    .filter((f) => f.page)
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0));

  for (let fi = 0; fi < sortedFigures.length && fi < jpegs.length; fi++) {
    results.push({
      figureNo: sortedFigures[fi].figureNo,
      page: sortedFigures[fi].page,
      jpegBuffer: jpegs[fi].data,
    });
  }

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
