export function extractKeyTerms(text) {
  const terms = new Set();
  const source = String(text || "");
  const alphaNum = source.match(/[a-zA-Z]+\d+[a-zA-Z]*/gi) || [];
  alphaNum.forEach((term) => terms.add(term.toLowerCase()));
  const numAlpha = source.match(/\d+[a-zA-Z]+/gi) || [];
  numAlpha.forEach((term) => terms.add(term.toLowerCase()));
  const engWords = source.match(/[a-zA-Z]{4,}/gi) || [];
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "been",
    "have", "has", "had", "will", "would", "could", "should", "about", "which", "their",
    "data", "table", "paper", "make", "please", "want", "need", "also", "than", "them",
    "into", "some", "each", "other", "more", "most", "only", "very", "both", "such",
  ]);
  engWords.forEach((term) => {
    const lower = term.toLowerCase();
    if (!stopWords.has(lower)) terms.add(lower);
  });
  return [...terms];
}

export function sanitizeColumnNames(columns) {
  if (!Array.isArray(columns)) return columns;
  const replacements = [
    [/\u00B2/g, "2"],
    [/\u00B3/g, "3"],
    [/\u207B\u00B9/g, "-1"],
    [/\u207B/g, "-"],
    [/\u2070/g, "0"],
    [/\u00B9/g, "1"],
    [/\u2074/g, "4"],
    [/\u2075/g, "5"],
    [/\u2076/g, "6"],
    [/\u2077/g, "7"],
    [/\u2078/g, "8"],
    [/\u2079/g, "9"],
    [/\u2080/g, "0"],
    [/\u2081/g, "1"],
    [/\u2082/g, "2"],
    [/\u2083/g, "3"],
    [/\u2084/g, "4"],
    [/\u00B0/g, "deg"],
    [/\u00B1/g, "+-"],
    [/\u00D7/g, "x"],
    [/\u00B7/g, "."],
    [/\u03B1/g, "alpha"],
    [/\u03B2/g, "beta"],
    [/\u03B3/g, "gamma"],
    [/\u03B4/g, "delta"],
    [/\u0394/g, "Delta"],
    [/\u03BC/g, "mu"],
    [/\u03C0/g, "pi"],
  ];
  return columns.map((column) => {
    let value = String(column);
    for (const [regex, replacement] of replacements) value = value.replace(regex, replacement);
    return value;
  });
}

export function normalizeColumnKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\s_\-\(\)\[\]{}.,;:/\\]+/g, "")
    .trim();
}
