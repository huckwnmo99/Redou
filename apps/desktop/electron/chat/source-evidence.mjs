function formatEvidencePage(page) {
  const n = Number(page);
  return Number.isFinite(n) && n > 0 ? `p.${n}` : "";
}

function isSupplementaryEvidence(item) {
  return item?.source_file_kind === "supplementary_pdf";
}

export function formatEvidenceLocation(item) {
  const pageLabel = formatEvidencePage(item?.page);
  if (isSupplementaryEvidence(item)) {
    const filename = item?.source_filename || "supplementary file";
    return `Supplementary: ${filename}${pageLabel ? `, ${pageLabel}` : ""}`;
  }
  return `Main PDF${pageLabel ? ` ${pageLabel}` : ""}`;
}

function dedupeEvidenceLocations(locations) {
  const seen = new Set();
  const result = [];
  for (const location of locations ?? []) {
    const value = String(location ?? "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function buildEvidenceLocationsByPaper(chunks, figures) {
  const byPaper = new Map();
  for (const item of [...(chunks ?? []), ...(figures ?? [])]) {
    if (!item?.paper_id) continue;
    const current = byPaper.get(item.paper_id) ?? { locations: [], hasSupplementaryEvidence: false };
    current.locations.push(formatEvidenceLocation(item));
    current.hasSupplementaryEvidence = current.hasSupplementaryEvidence || isSupplementaryEvidence(item);
    byPaper.set(item.paper_id, current);
  }

  for (const [paperId, value] of byPaper) {
    byPaper.set(paperId, {
      ...value,
      locations: dedupeEvidenceLocations(value.locations),
    });
  }
  return byPaper;
}

function getEvidenceLocationsForPaper(evidenceLocationsByPaper, paperId) {
  if (!paperId || !evidenceLocationsByPaper) return [];
  const value = evidenceLocationsByPaper instanceof Map
    ? evidenceLocationsByPaper.get(paperId)
    : evidenceLocationsByPaper[paperId];
  if (Array.isArray(value)) return dedupeEvidenceLocations(value);
  return dedupeEvidenceLocations(value?.locations ?? []);
}

function getEvidencePaperIdFromRef(ref, paperRefMap) {
  if (ref?.paperId) return ref.paperId;
  const refNo = String(ref?.refNo ?? "");
  if (!refNo) return null;
  for (const [paperId, paperRef] of paperRefMap ?? []) {
    if (String(paperRef.refNo) === refNo) return paperId;
  }
  return null;
}

export function enrichSourceRefsWithEvidence(sourceRefs, evidenceLocationsByPaper, paperRefMap) {
  return (sourceRefs ?? []).map((ref) => {
    const paperId = getEvidencePaperIdFromRef(ref, paperRefMap);
    const evidenceLocations = getEvidenceLocationsForPaper(evidenceLocationsByPaper, paperId);
    if (evidenceLocations.length === 0) return paperId ? { ...ref, paperId } : ref;
    return {
      ...ref,
      paperId: paperId ?? ref.paperId,
      evidenceLocations,
      evidenceSummary: evidenceLocations.join("; "),
      hasSupplementaryEvidence: evidenceLocations.some((location) => location.startsWith("Supplementary:")),
    };
  });
}

export function serializeEvidenceLocations(evidenceLocationsByPaper) {
  return Object.fromEntries(
    [...(evidenceLocationsByPaper ?? new Map()).entries()].map(([paperId, value]) => [paperId, value.locations ?? []]),
  );
}
