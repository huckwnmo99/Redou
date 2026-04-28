/**
 * GROBID API 클라이언트.
 * PDF → TEI XML → 메타데이터 + 참고문헌 구조화.
 */

import { XMLParser } from "fast-xml-parser";

const GROBID_BASE = process.env.REDOU_GROBID_URL || "http://localhost:8070";
const GROBID_TIMEOUT_MS = 120_000; // 2분

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => ["biblStruct", "author", "forename", "surname", "persName", "idno", "div"].includes(name),
});

// ─── Health Check ───────────────────────────────────────────────

/** GROBID 서버 가용성 확인 */
export async function isGrobidAvailable() {
  try {
    const res = await fetch(GROBID_BASE + "/api/isalive", { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── 메타데이터 + 참고문헌 추출 ──────────────────────────────────

/**
 * PDF에서 메타데이터 + 참고문헌 추출.
 * @param {Buffer} pdfBuffer
 * @returns {{ metadata: object, references: Array, teiXml: string, processingTime: number }}
 */
export async function extractMetadataAndReferences(pdfBuffer) {
  const t0 = Date.now();

  const formData = new FormData();
  formData.append("input", new Blob([pdfBuffer], { type: "application/pdf" }), "paper.pdf");
  formData.append("consolidateHeader", "1");
  formData.append("consolidateCitations", "1");

  const res = await fetch(GROBID_BASE + "/api/processFulltextDocument", {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(GROBID_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GROBID API error ${res.status}: ${text}`);
  }

  const teiXml = await res.text();
  const parsed = xmlParser.parse(teiXml);

  const tei = parsed?.TEI || parsed?.["tei:TEI"] || parsed;
  const metadata = parseTeiMetadata(tei);
  const references = parseTeiReferences(tei);

  return { metadata, references, teiXml, processingTime: Date.now() - t0 };
}

// ─── TEI XML 파싱: 메타데이터 ────────────────────────────────────

function parseTeiMetadata(tei) {
  const header = tei?.teiHeader || {};
  const fileDesc = header?.fileDesc || {};
  const titleStmt = fileDesc?.titleStmt || {};
  const sourceDesc = fileDesc?.sourceDesc || {};
  const biblStruct = sourceDesc?.biblStruct?.[0] || sourceDesc?.biblStruct || {};
  const profileDesc = header?.profileDesc || {};

  // Title
  const title = extractText(titleStmt?.title) || "";

  // Authors
  const authors = parseAuthors(biblStruct?.analytic?.author || fileDesc?.titleStmt?.author);

  // DOI
  const doi = extractDoi(biblStruct);

  // Year
  const year = extractYear(biblStruct);

  // Journal + Publisher
  const journal = extractJournal(biblStruct);
  const publisher = extractPublisher(biblStruct);

  // Abstract
  const abstract = extractAbstract(profileDesc);

  // Volume, pages
  const volume = extractText(biblStruct?.monogr?.imprint?.biblScope?.find?.(
    (b) => b?.["@_unit"] === "volume",
  )) || "";
  const pages = extractText(biblStruct?.monogr?.imprint?.biblScope?.find?.(
    (b) => b?.["@_unit"] === "page",
  )) || "";

  return { title, authors, doi, year, journal, publisher, abstract, volume, pages };
}

function parseAuthors(authorNodes) {
  if (!authorNodes) return [];
  const nodes = Array.isArray(authorNodes) ? authorNodes : [authorNodes];

  return nodes.map((a) => {
    const persNames = a?.persName || [];
    const persName = Array.isArray(persNames) ? persNames[0] : persNames;

    const forenames = persName?.forename || [];
    const surnames = persName?.surname || [];

    const fore = Array.isArray(forenames)
      ? forenames.map(extractText).join(" ")
      : extractText(forenames);
    const sur = Array.isArray(surnames)
      ? surnames.map(extractText).join(" ")
      : extractText(surnames);

    const name = [fore, sur].filter(Boolean).join(" ") || extractText(persName);

    // Affiliation
    const affNode = a?.affiliation;
    let affiliation = "";
    if (affNode) {
      const orgNames = affNode?.orgName || [];
      const orgs = Array.isArray(orgNames) ? orgNames : [orgNames];
      affiliation = orgs.map(extractText).filter(Boolean).join(", ");
    }

    return { name: name.trim(), affiliation };
  }).filter((a) => a.name);
}

function extractDoi(biblStruct) {
  const idnos = biblStruct?.analytic?.idno || biblStruct?.monogr?.idno || [];
  const arr = Array.isArray(idnos) ? idnos : [idnos];
  for (const idno of arr) {
    if (idno?.["@_type"] === "DOI") return extractText(idno);
  }
  return "";
}

function extractYear(biblStruct) {
  const date = biblStruct?.monogr?.imprint?.date;
  if (!date) return null;
  const when = date?.["@_when"] || extractText(date);
  if (when) {
    const match = String(when).match(/(\d{4})/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

function extractJournal(biblStruct) {
  const title = biblStruct?.monogr?.title;
  if (!title) return "";
  if (Array.isArray(title)) {
    // @_level="j" = 정식 저널명, "m" 또는 기타 = 약칭
    const journalLevel = title.find((t) => t?.["@_level"] === "j");
    if (journalLevel) return extractText(journalLevel) || "";
    // level 구분 없으면 첫 번째 non-empty 사용
    return extractText(title[0]) || "";
  }
  return extractText(title) || "";
}

function extractPublisher(biblStruct) {
  const publisher = biblStruct?.monogr?.imprint?.publisher;
  if (!publisher) return "";
  return extractText(publisher) || "";
}

function extractAbstract(profileDesc) {
  const abs = profileDesc?.abstract;
  if (!abs) return "";
  // abstract는 <p> 태그 안에 있거나 직접 텍스트
  const divs = abs?.div || abs?.p || abs;
  if (Array.isArray(divs)) {
    return divs.map((d) => extractText(d?.p || d)).filter(Boolean).join("\n\n");
  }
  return extractText(divs?.p || divs) || "";
}

// ─── TEI XML 파싱: 참고문헌 ──────────────────────────────────────

function parseTeiReferences(tei) {
  const body = tei?.text || {};
  const back = body?.back || {};
  const divArr = Array.isArray(back?.div) ? back.div : (back?.div ? [back.div] : []);
  const listBibl = divArr.find(d => d?.listBibl)?.listBibl || back?.listBibl || {};
  let biblStructs = listBibl?.biblStruct || [];
  if (!Array.isArray(biblStructs)) biblStructs = [biblStructs];

  const references = [];

  for (let i = 0; i < biblStructs.length; i++) {
    const bib = biblStructs[i];
    if (!bib) continue;

    const analytic = bib?.analytic || {};
    const monogr = bib?.monogr || {};

    // Title
    const refTitle = extractText(analytic?.title || monogr?.title) || "";

    // Authors
    const refAuthors = parseAuthors(analytic?.author || monogr?.author);

    // DOI
    const refDoi = extractDoi(bib);

    // Year
    const refYear = extractYear(bib);

    // Journal
    const refJournal = extractJournal(bib);

    // Volume, pages
    const imprint = monogr?.imprint || {};
    const biblScopes = imprint?.biblScope || [];
    const scopeArr = Array.isArray(biblScopes) ? biblScopes : [biblScopes];

    const refVolume = extractText(scopeArr.find((b) => b?.["@_unit"] === "volume")) || "";
    const refPages = extractText(scopeArr.find((b) => b?.["@_unit"] === "page")) || "";

    // Raw text (note 안에 있을 수 있음)
    const rawText = bib?.note ? extractText(bib.note) : "";

    // XML ID → 참조 순서
    const xmlId = bib?.["@_xml:id"] || "";
    const orderMatch = xmlId.match(/b(\d+)/);
    const refOrder = orderMatch ? parseInt(orderMatch[1], 10) + 1 : i + 1;

    references.push({
      order: refOrder,
      title: refTitle,
      authors: refAuthors,
      year: refYear,
      journal: refJournal,
      doi: refDoi,
      volume: refVolume,
      pages: refPages,
      rawText,
    });
  }

  return references.sort((a, b) => a.order - b.order);
}

// ─── DOI 매칭 (인용 네트워크) ────────────────────────────────────

/**
 * 참고문헌의 DOI를 DB 내 기존 논문과 매칭하여 linked_paper_id 추가.
 * @param {Array} references
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @returns {Array} references with linked_paper_id
 */
export async function linkReferencesToExistingPapers(references, supabase) {
  const doisToCheck = references.filter((r) => r.doi).map((r) => r.doi);
  if (doisToCheck.length === 0) return references;

  const { data: papers } = await supabase
    .from("papers")
    .select("id, doi")
    .in("doi", doisToCheck);

  if (!papers || papers.length === 0) return references;

  const doiMap = new Map(papers.map((p) => [p.doi, p.id]));

  return references.map((ref) => ({
    ...ref,
    linked_paper_id: ref.doi ? doiMap.get(ref.doi) || null : null,
  }));
}

// ─── 유틸리티 ────────────────────────────────────────────────────

/** XML 노드에서 텍스트 추출 (재귀) */
function extractText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number") return String(node);
  if (node["#text"] != null) return String(node["#text"]).trim();
  if (Array.isArray(node)) return node.map(extractText).filter(Boolean).join(" ");
  // 자식 노드 재귀 탐색
  const texts = [];
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_")) continue; // attributes skip
    texts.push(extractText(node[key]));
  }
  return texts.filter(Boolean).join(" ");
}
