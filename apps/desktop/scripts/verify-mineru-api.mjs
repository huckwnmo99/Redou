// ============================================================================
// Manual verification — NOT run in CI. Requires a LIVE MinerU container on
// REDOU_MINERU_URL (default http://localhost:8001). No DB, no Ollama, no vLLM.
//
// Re-verifies the MinerU HTTP contract that mineru-client.mjs depends on, so we
// can confirm a freshly-built 3.4 image is compatible BEFORE bumping
// CURRENT_EXTRACTION_VERSION / re-extracting (tool-ab-adoption slice 01, Phase B).
//
//   Check 1  GET /docs           → 200 (health contract, mineru-client.mjs:24)
//   Check 2  GET /openapi.json   → /file_parse exists + all 8 client form
//                                  fields accepted + backend enum admits
//                                  "pipeline" (mineru-client.mjs:44-51,
//                                  main.mjs:944)
//   Check 3  (optional)          → POST /file_parse a real PDF, dump the
//                                  content_list element schema and diff it
//                                  against what parseMineruResult reads
//                                  (mineru-client.mjs:92-279).
//
// This is a READ-ONLY probe: it never mutates the container. Check 3 only runs
// when a PDF path is passed, so on the current 2.7.6 image you can run checks
// 1-2 safely; do NOT rely on this to gate anything until the 3.4 image is up.
//
// Usage (from apps/desktop):
//   node scripts/verify-mineru-api.mjs                # checks 1-2 (contract)
//   node scripts/verify-mineru-api.mjs "<pdf path>"   # + check 3 (live parse)
// Override target: REDOU_MINERU_URL=http://host:port node scripts/verify-mineru-api.mjs
//
// Exit code 0 = all attempted checks passed, 1 = at least one mismatch.
// ============================================================================
import fs from "node:fs/promises";

const MINERU_BASE = process.env.REDOU_MINERU_URL || "http://localhost:8001";

// ---- contract mirrored from mineru-client.mjs (keep in sync) ----
// The 8 form fields parsePdf() sends (mineru-client.mjs:44-51).
const CLIENT_FORM_FIELDS = [
  "files",
  "backend",
  "lang_list",
  "return_md",
  "return_content_list",
  "return_images",
  "formula_enable",
  "table_enable",
];
// backend value main.mjs:944 passes through to parsePdf.
const CLIENT_BACKEND_VALUE = "pipeline";
// content_list element fields parseMineruResult reads/handles (mineru-client.mjs).
// Not every element carries every field; this is the union the parser touches.
const EXPECTED_CONTENT_FIELDS = [
  "type",
  "text_level", // heading marker on text elements
  "text", // text / equation body
  "page_idx", // page number
  "table_body", // table HTML
  "table_caption", // string[]
  "table_footnote", // string[]
  "image_caption", // string[]
  "img_path", // "images/xxx.jpg"
  "bbox", // [x0,y0,x1,y1]
  // MinerU 3.4 fields the parser now handles:
  "chart_caption", // string[] on chart → figure caption
  "content", // chart structured text (caption fallback)
  "list_items", // string[] on list → body text (ref_text excluded)
  "sub_type", // list sub_type; "ref_text" → excluded from body
];
// Element types the 3.4 parser knows about: body/figure/table/equation + list +
// discarded + the ignored boilerplate set. Anything else is genuinely new.
const EXPECTED_CONTENT_TYPES = [
  "text",
  "table",
  "equation",
  "image",
  "chart", // 3.4 → figures
  "list", // 3.4 → body (ref_text excluded)
  "header", // 3.4 → ignored boilerplate
  "footer", // 3.4 → ignored boilerplate
  "page_number", // 3.4 → ignored boilerplate
  "page_footnote", // 3.4 → ignored boilerplate
  "discarded",
];

let failures = 0;
const note = (ok, label, detail = "") => {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures += 1;
  console.log(`  [${mark}] ${label}${detail ? " — " + detail : ""}`);
};

// ---- Check 1: health ----
async function checkDocs() {
  console.log(`\nCheck 1 — GET ${MINERU_BASE}/docs (health)`);
  try {
    const res = await fetch(MINERU_BASE + "/docs", { signal: AbortSignal.timeout(8000) });
    note(res.ok, `status ${res.status}`, res.ok ? "" : "expected 200");
  } catch (err) {
    note(false, "request failed", err.message);
  }
}

// ---- Check 2: openapi contract ----
// Collect every "name" property found under the /file_parse POST requestBody
// schema, regardless of nesting (multipart params surface as schema properties).
function collectFormFieldNames(spec) {
  const post = spec?.paths?.["/file_parse"]?.post;
  if (!post) return null;
  const names = new Set();
  // requestBody.content[*].schema(.properties | $ref → components) — walk generically.
  const visit = (node, seen = new Set()) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node.properties && typeof node.properties === "object") {
      for (const key of Object.keys(node.properties)) names.add(key);
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") visit(v, seen);
    }
  };
  // Resolve top-level $ref into components if present.
  const bodyContent = post.requestBody?.content ?? {};
  for (const media of Object.values(bodyContent)) {
    let schema = media?.schema;
    if (schema?.$ref) {
      const refName = schema.$ref.split("/").pop();
      schema = spec.components?.schemas?.[refName] ?? schema;
    }
    visit(schema);
  }
  return names;
}

// Find a "backend" enum anywhere in the resolved schemas (best-effort).
function findBackendEnum(spec) {
  const found = [];
  const visit = (node, keyHint, seen = new Set()) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node.enum) && /backend/i.test(keyHint || "")) {
      found.push(...node.enum);
    }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object") visit(v, k === "properties" ? keyHint : k, seen);
    }
  };
  visit(spec, "");
  return found.length ? [...new Set(found)] : null;
}

async function checkOpenApi() {
  console.log(`\nCheck 2 — GET ${MINERU_BASE}/openapi.json (contract)`);
  let spec;
  try {
    const res = await fetch(MINERU_BASE + "/openapi.json", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      note(false, `openapi.json status ${res.status}`);
      return;
    }
    spec = await res.json();
  } catch (err) {
    note(false, "openapi.json request failed", err.message);
    return;
  }

  const paths = Object.keys(spec.paths || {});
  note(paths.includes("/file_parse"), "/file_parse endpoint present", `paths=${JSON.stringify(paths)}`);

  const fieldNames = collectFormFieldNames(spec);
  if (!fieldNames) {
    note(false, "could not read /file_parse POST requestBody schema");
  } else {
    const missing = CLIENT_FORM_FIELDS.filter((f) => !fieldNames.has(f));
    note(missing.length === 0, "all 8 client form fields accepted", missing.length ? `missing: ${missing.join(", ")}` : `(${CLIENT_FORM_FIELDS.length}/8)`);
  }

  const backendEnum = findBackendEnum(spec);
  if (backendEnum === null) {
    // No enum → backend is a free-form string; "pipeline" is then accepted by type.
    note(true, `backend has no enum (free string) — "${CLIENT_BACKEND_VALUE}" accepted by type`);
  } else {
    note(
      backendEnum.includes(CLIENT_BACKEND_VALUE),
      `backend enum admits "${CLIENT_BACKEND_VALUE}"`,
      `enum=${JSON.stringify(backendEnum)}`,
    );
  }
}

// ---- Check 3: live parse schema diff (optional) ----
async function checkLiveParse(pdfPath) {
  console.log(`\nCheck 3 — POST ${MINERU_BASE}/file_parse (live schema diff)`);
  console.log(`  PDF: ${pdfPath}`);
  let buffer;
  try {
    buffer = await fs.readFile(pdfPath);
  } catch (err) {
    note(false, "cannot read PDF", err.message);
    return;
  }

  const form = new FormData();
  form.append("files", new Blob([buffer], { type: "application/pdf" }), "verify.pdf");
  form.append("backend", CLIENT_BACKEND_VALUE);
  form.append("lang_list", "en");
  form.append("return_md", "true");
  form.append("return_content_list", "true");
  form.append("return_images", "true");
  form.append("formula_enable", "true");
  form.append("table_enable", "true");

  let raw;
  try {
    const res = await fetch(MINERU_BASE + "/file_parse", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      note(false, `parse status ${res.status}`, text.slice(0, 200));
      return;
    }
    raw = await res.json();
  } catch (err) {
    note(false, "parse request failed", err.message);
    return;
  }

  const key = Object.keys(raw.results || {})[0];
  if (!key) {
    note(false, "response has no results[]");
    return;
  }
  const result = raw.results[key];
  const contentList = typeof result.content_list === "string"
    ? JSON.parse(result.content_list)
    : result.content_list || [];
  note(Array.isArray(contentList) && contentList.length > 0, "content_list is a non-empty array", `len=${contentList.length}`);
  if (!Array.isArray(contentList) || contentList.length === 0) return;

  // Which expected fields ever appear, and which types are seen.
  const seenFields = new Set();
  const seenTypes = new Set();
  const unknownTypes = new Set();
  for (const el of contentList) {
    if (el && typeof el === "object") {
      for (const f of Object.keys(el)) seenFields.add(f);
      if (el.type != null) {
        seenTypes.add(el.type);
        if (!EXPECTED_CONTENT_TYPES.includes(el.type)) unknownTypes.add(el.type);
      }
    }
  }

  // Per-type presence of the key fields the parser reads for that type.
  const hasType = (t) => contentList.some((e) => e?.type === t);
  const typeHasField = (t, f) => contentList.some((e) => e?.type === t && e[f] !== undefined);

  console.log(`  seen types: ${[...seenTypes].join(", ") || "(none)"}`);
  note(unknownTypes.size === 0, "no unexpected element types", unknownTypes.size ? `unexpected: ${[...unknownTypes].join(", ")}` : "");

  // Fields the parser reads, checked only against types that are actually present.
  const fieldExpectations = [
    ["text", "type"],
    ["text", "text"],
    ["table", "table_body"],
    ["table", "table_caption"],
    ["equation", "text"],
    ["image", "img_path"],
    ["image", "image_caption"],
  ];
  for (const [t, f] of fieldExpectations) {
    if (!hasType(t)) {
      console.log(`  [SKIP] ${t}.${f} — no ${t} elements in this PDF`);
      continue;
    }
    note(typeHasField(t, f), `${t} elements carry "${f}"`);
  }

  // Report any expected field never observed (informational, not a failure).
  const neverSeen = EXPECTED_CONTENT_FIELDS.filter((f) => !seenFields.has(f));
  if (neverSeen.length) {
    console.log(`  [INFO] expected fields never present in this PDF (may be type-specific): ${neverSeen.join(", ")}`);
  }
  // Report new fields the parser does not know about (informational).
  const extra = [...seenFields].filter((f) => !EXPECTED_CONTENT_FIELDS.includes(f) && !["page_idx"].includes(f));
  if (extra.length) {
    console.log(`  [INFO] content_list fields not read by parseMineruResult (new in this image): ${extra.join(", ")}`);
  }
}

// ---- main ----
const pdfArg = process.argv[2];
console.log(`MinerU API verification against ${MINERU_BASE}`);
await checkDocs();
await checkOpenApi();
if (pdfArg) {
  await checkLiveParse(pdfArg);
} else {
  console.log("\nCheck 3 — SKIPPED (no PDF path arg). Pass a PDF to diff content_list schema.");
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
