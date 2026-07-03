// ============================================================================
// Manual tool — NOT run in CI. Pure pdfjs, no services, no DB, no side effects.
//
// Extracts the text of given pages from a PDF, reconstructing lines by y-position
// so table rows read back in order. Used to hand-verify eval ground-truth values
// (apps/desktop/tests/fixtures/evals/adsorption-groundtruth-v0.json) against the
// original paper Tables 3/4.
//
// Usage (from apps/desktop):
//   node scripts/pdf-page-text.mjs "<pdf path>" <page> [<page> ...]
// Tip: on Windows Git Bash the extracted text can contain NUL bytes; pipe through
//   `tr -d '\000'` before grepping.
// ============================================================================
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs/promises";

const [file, ...pageArgs] = process.argv.slice(2);
if (!file || pageArgs.length === 0) {
  console.error('Usage: node scripts/pdf-page-text.mjs "<pdf path>" <page> [<page> ...]');
  process.exit(1);
}
const pages = pageArgs.map(Number);
const data = new Uint8Array(await fs.readFile(file));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
console.log(`# ${file} (${doc.numPages} pages)`);
for (const p of pages) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  // group items by rounded y to reconstruct lines
  const byLine = new Map();
  for (const it of tc.items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]);
    if (!byLine.has(y)) byLine.set(y, []);
    byLine.get(y).push({ x: it.transform[4], s: it.str });
  }
  const lines = [...byLine.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" "));
  console.log(`\n===== PAGE ${p} =====`);
  console.log(lines.join("\n"));
}
