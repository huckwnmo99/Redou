// Entity Extractor — Ontology-based entity + relation extraction from paper context
// Produces (entities, entity_relations) for the knowledge graph backing Graph-Enhanced Search.
//
// Design:
// - One LLM call per paper (~80 chunks + summarized OCR HTML), JSON-schema forced output.
// - 1회 자동 재시도 (상위 호출자 처리); 본 모듈은 call 단위 재시도 포함.
// - canonicalize()로 raw_name → canonical_name 정규화 (persist 직전 강제).
// - persistEntities(): DELETE CASCADE + batch INSERT + embedding UPDATE. 멱등.

import { OLLAMA_BASE_URL, ollamaSignal } from "./llm-chat.mjs";

const LLM_CTX = parseInt(process.env.REDOU_LLM_CTX, 10) || 131072;

// v2: persistEntities가 관계 INSERT 시 evidence_chunk_id를 best-effort로 채움
// (source_hint → source entity chunk_id → target entity chunk_id → null 폴백 체인).
// v1에서 전부 null로 저장된 기존 관계는 그래프 순회 RPC (WHERE chunk_id IS NOT NULL)에서
// 필터링되어 graph_traverse_1hop이 항상 0건을 리턴하는 버그가 있었음.
export const CURRENT_ENTITY_EXTRACTION_VERSION = 2;

// ============================================================
// JSON Schemas
// ============================================================

const ENTITY_EXTRACTION_SCHEMA = {
  type: "object",
  required: ["entities", "relations"],
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        required: ["entity_type", "raw_name", "canonical_name", "confidence", "confidence_tag"],
        properties: {
          entity_type: {
            type: "string",
            enum: ["substance", "method", "condition", "metric", "phenomenon", "concept"],
          },
          raw_name: { type: "string" },
          canonical_name: { type: "string" },
          value: { type: ["string", "null"] },
          unit: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          confidence_tag: {
            type: "string",
            enum: ["EXTRACTED", "INFERRED", "AMBIGUOUS"],
          },
          source_hint: { type: ["string", "null"] },
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        required: [
          "source_canonical",
          "target_canonical",
          "relation_type",
          "direction",
          "confidence",
          "confidence_tag",
        ],
        properties: {
          source_canonical: { type: "string" },
          target_canonical: { type: "string" },
          relation_type: {
            type: "string",
            enum: [
              "affects",
              "correlates_with",
              "measures",
              "uses",
              "compared_to",
              "outperforms",
              "produces",
              "same_as",
            ],
          },
          direction: {
            type: "string",
            enum: ["positive", "negative", "neutral", "bidirectional"],
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          confidence_tag: {
            type: "string",
            enum: ["EXTRACTED", "INFERRED", "AMBIGUOUS"],
          },
          source_hint: { type: ["string", "null"] },
        },
      },
    },
  },
};

// 쿼리용 경량 스키마 (짧은 프롬프트 + 속도 우선)
const QUERY_ENTITY_SCHEMA = {
  type: "object",
  required: ["entities"],
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        required: ["canonical_name", "entity_type"],
        properties: {
          canonical_name: { type: "string" },
          entity_type: {
            type: "string",
            enum: ["substance", "method", "condition", "metric", "phenomenon", "concept"],
          },
        },
      },
    },
  },
};

// ============================================================
// System Prompts
// ============================================================

const ENTITY_EXTRACTION_SYSTEM_PROMPT = `당신은 과학 논문의 **지식 그래프 엔티티 추출기**입니다.
주어진 한 편의 논문 컨텍스트에서 엔티티와 관계를 JSON으로 추출하세요.

=== 엔티티 타입 (entity_type) ===
- substance    : 화학 물질, 재료, 촉매, 흡착제, 분자 등 (예: "zeolite 13x", "co2", "pt/al2o3")
- method       : 실험 기법, 분석 방법, 모델 (예: "langmuir isotherm", "dft", "xrd", "pseudo-second-order")
- condition    : 실험 조건 (온도, 압력, pH 등 수치 가능)
  * raw_name="298 K" → canonical_name="temperature", value="298", unit="K"
  * raw_name="1 bar" → canonical_name="pressure", value="1", unit="bar"
- metric       : 성능/결과 지표 (예: "adsorption capacity", "selectivity", "conversion", "tof")
  * 수치가 있으면 value/unit 채움. canonical_name은 파라미터 이름만.
- phenomenon   : 현상/거동 (예: "adsorption", "diffusion", "catalysis", "reaction")
- concept      : 추상 개념 (예: "kinetic model", "equilibrium", "selectivity")

=== canonical_name 규칙 (매우 중요) ===
1. 반드시 **소문자 영문 + 숫자 + 공백 + 하이픈**만 사용. 특수문자 금지.
2. 공백은 1개로 압축.
3. 단위를 이름에 포함하지 마세요. 단위는 unit 필드로 분리.
4. 약자와 풀네임이 섞여 있으면 **논문에서 가장 흔한 형태**로 통일.
   - 예: "CO₂", "CO2", "carbon dioxide" → 모두 canonical_name="co2"로 통일.
5. 같은 개념은 **같은 canonical_name** 사용 (그래프 빌딩의 핵심).

=== 값/단위 분리 (condition, metric) ===
- "298 K" → canonical_name="temperature", value="298", unit="K"
- "5.2 mmol/g" → canonical_name="adsorption capacity", value="5.2", unit="mmol/g"
- 수치가 없으면 value=null, unit=null

=== confidence_tag ===
- EXTRACTED  : 본문에 명시적으로 있는 엔티티
- INFERRED   : 맥락에서 합리적으로 추론된 엔티티 (직접 언급 X, 암시됨)
- AMBIGUOUS  : 해석이 모호한 엔티티 (여러 의미 가능)

=== 관계 (relations) ===
각 relation은 source_canonical → target_canonical, 두 canonical_name 모두 entities 목록에 있어야 함.

- affects           : A가 B에 영향 (direction: positive/negative/neutral)
  * "temperature affects adsorption capacity" → direction 필수
- correlates_with   : A와 B 상관 (direction: positive/negative)
- measures          : A(방법/지표)가 B(현상/물성)를 측정 (direction: neutral)
- uses              : A가 B를 사용 (논문 방법 A uses 물질 B) (direction: neutral)
- compared_to       : A와 B를 비교 (direction: neutral or bidirectional)
- outperforms       : A가 B보다 우수 (direction: positive)
- produces          : A가 B를 생성 (direction: neutral)
- same_as           : A와 B는 동의어 (direction: bidirectional) — 이 관계는 그래프 쿼리 시 union됨.
  * 약자 ↔ 풀네임, 동의어, 동일 물질의 다른 표기 등에만 사용.

=== 필수 규칙 ===
1. **환각 절대 금지.** 본문에 없는 엔티티/관계는 만들지 마세요.
2. **최대 60 엔티티 / 40 관계 / 논문**. 더 있으면 핵심만 선택.
3. 엔티티 중복 없음 (같은 canonical_name + value + unit은 한 번만).
4. 관계의 source_canonical, target_canonical는 반드시 entities 배열에 있는 canonical_name.
5. 출력은 **JSON만** (설명/주석 금지).
6. source_hint는 선택 (예: "Abstract", "Table 2", "Section 3.1").`;

const QUERY_ENTITY_SYSTEM_PROMPT = `사용자의 검색 쿼리에서 과학 엔티티 이름만 추출하세요.

entity_type:
- substance/method/condition/metric/phenomenon/concept

canonical_name 규칙:
- 소문자 영문+숫자+공백만. 단위/특수문자 금지.
- 같은 개념 통일 ("CO₂"/"CO2"/"carbon dioxide" → "co2").

엔티티가 없으면 빈 배열 []. JSON만 출력하세요. value/unit/relation 없음.`;

// ============================================================
// Utilities
// ============================================================

/**
 * Canonical name 정규화 — persist 직전 강제 적용.
 * LLM이 규칙 어긴 raw output을 강제로 안전화.
 */
export function canonicalize(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-/]/g, " ") // 특수문자 → 공백
    .replace(/\s+/g, " ")
    .trim();
}

function safeParseLlmJson(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[entity-extractor] JSON parse failed (${context}):`, String(raw).slice(0, 300));
    throw new Error(`LLM returned invalid JSON (${context}).`);
  }
}

// ============================================================
// Paper context assembly (assemblePerPaperContext 경량화)
// ============================================================

/**
 * 엔티티 추출용 단일-논문 컨텍스트 조립.
 * - 청크 최대 80개, 텍스트 총합 cap 60,000자
 * - OCR summary_text는 HTML 태그 제거 후 최대 15,000자
 * - 본문 중심이므로 파싱 매트릭스는 스킵 (엔티티는 텍스트에서 더 잘 나옴)
 */
export async function assemblePaperContextForEntities(paperId, supabase) {
  const MAX_CHUNKS = 80;
  const CHUNK_BUDGET = 60_000;
  const OCR_BUDGET = 15_000;

  // 1. 청크 수집 (paper_chunks는 매우 큼 — 상위 MAX_CHUNKS만)
  const { data: chunks, error: chunkErr } = await supabase
    .from("paper_chunks")
    .select("id, text, section_id, chunk_order")
    .eq("paper_id", paperId)
    .order("chunk_order", { ascending: true })
    .limit(MAX_CHUNKS);
  if (chunkErr) throw new Error(`[entity-extractor] chunk load: ${chunkErr.message}`);

  // 2. 섹션 이름 맵
  const sectionIds = [...new Set((chunks ?? []).map((c) => c.section_id).filter(Boolean))];
  let sectionMap = new Map();
  if (sectionIds.length > 0) {
    const { data: sections } = await supabase
      .from("paper_sections")
      .select("id, section_name")
      .in("id", sectionIds);
    sectionMap = new Map((sections ?? []).map((s) => [s.id, s.section_name]));
  }

  // 3. OCR 요약 (figures의 summary_text, HTML 제거)
  const { data: figures } = await supabase
    .from("figures")
    .select("figure_no, caption, summary_text, item_type")
    .eq("paper_id", paperId);

  // 청크 텍스트 누적
  let chunksText = "";
  for (const c of chunks ?? []) {
    const sectionName = sectionMap.get(c.section_id) || "";
    const prefix = sectionName ? `[${sectionName}] ` : "";
    const entry = `${prefix}${c.text}\n\n`;
    if (chunksText.length + entry.length > CHUNK_BUDGET) break;
    chunksText += entry;
  }

  // OCR 테이블/수식 텍스트 (HTML 제거)
  let ocrText = "";
  for (const f of figures ?? []) {
    if (!f.summary_text) continue;
    const stripped = String(f.summary_text)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!stripped || stripped.length < 20) continue;
    const tag = f.figure_no ? `[${f.figure_no}]` : "";
    const cap = f.caption ? ` ${String(f.caption).replace(/\$\$/g, "")}` : "";
    const entry = `${tag}${cap}\n${stripped}\n\n`;
    if (ocrText.length + entry.length > OCR_BUDGET) break;
    ocrText += entry;
  }

  let result = "";
  if (chunksText) {
    result += `=== 논문 본문 (청크) ===\n${chunksText}`;
  }
  if (ocrText) {
    result += `=== OCR 테이블/수식 요약 ===\n${ocrText}`;
  }
  return result;
}

// ============================================================
// Extraction — full paper
// ============================================================

/**
 * 논문 전체에서 엔티티+관계 추출.
 * @param {string} paperContext — assemblePaperContextForEntities() output
 * @param {string} paperTitle
 * @param {string} modelName — Ollama 모델명 (llm_model 또는 entity_extraction_model)
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<{entities: Array, relations: Array}>}
 */
export async function extractEntitiesFromPaper(paperContext, paperTitle, modelName, abortSignal) {
  if (!paperContext || paperContext.trim().length === 0) {
    return { entities: [], relations: [] };
  }

  const userMessage = `=== 대상 논문 제목 ===
${paperTitle || "Untitled"}

${paperContext}

위 논문 컨텍스트에서 entities(최대 60개)와 relations(최대 40개)를 추출하세요. JSON만 출력.`;

  const messages = [
    { role: "system", content: ENTITY_EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const callOllama = async () => {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: false,
        format: ENTITY_EXTRACTION_SCHEMA,
        options: { num_ctx: LLM_CTX, temperature: 0.1 },
      }),
      signal: ollamaSignal(abortSignal),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Entity extraction error (${res.status}): ${text}`);
    }

    const json = await res.json();
    return json.message?.content ?? "";
  };

  // Primary attempt + 1 retry on parse failure
  let raw;
  try {
    raw = await callOllama();
    return safeParseLlmJson(raw, "EntityExtractor");
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.warn(`[entity-extractor] Retry for "${String(paperTitle).slice(0, 40)}": ${err.message}`);
    raw = await callOllama();
    return safeParseLlmJson(raw, "EntityExtractor(retry)");
  }
}

// ============================================================
// Extraction — query (짧은 프롬프트, graceful failure)
// ============================================================

/**
 * 사용자 검색 쿼리에서 엔티티 이름만 추출 (경량).
 * 실패 시 빈 배열 반환 (throw 금지 — 그래프 검색이 degradation해도 동작해야 함).
 */
export async function extractQueryEntities(query, modelName, abortSignal) {
  if (!query || !query.trim()) return [];

  const messages = [
    { role: "system", content: QUERY_ENTITY_SYSTEM_PROMPT },
    { role: "user", content: `검색 쿼리: ${query}` },
  ];

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: false,
        format: QUERY_ENTITY_SCHEMA,
        options: { num_ctx: LLM_CTX, temperature: 0.0 },
      }),
      signal: ollamaSignal(abortSignal, 30_000),
    });
    if (!res.ok) {
      console.warn(`[entity-extractor] Query extraction HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    const parsed = safeParseLlmJson(json.message?.content ?? "{}", "QueryEntities");
    const list = Array.isArray(parsed.entities) ? parsed.entities : [];
    // canonicalize strictly
    return list
      .map((e) => ({
        canonical_name: canonicalize(e.canonical_name),
        entity_type: e.entity_type,
      }))
      .filter((e) => e.canonical_name.length > 0);
  } catch (err) {
    console.warn(`[entity-extractor] Query extraction failed (non-fatal):`, err.message);
    return [];
  }
}

// ============================================================
// Persistence (멱등)
// ============================================================

/**
 * paper_id 기준으로 기존 엔티티 전체 삭제 후 재삽입. 관계 및 embedding 포함.
 * @param {string} paperId
 * @param {Map<string, {chunk_id: string}>} chunkIndexMap — canonical fragment → chunk matching hint (best-effort)
 * @param {{entities: Array, relations: Array}} extracted
 * @param {object} supabase — service_role client
 * @param {(text: string, role: "document"|"query") => Promise<number[]>} generateEmbeddingFn
 */
export async function persistEntities(paperId, chunkIndexMap, extracted, supabase, generateEmbeddingFn) {
  if (!paperId) throw new Error("persistEntities: paperId required");

  const rawEntities = Array.isArray(extracted?.entities) ? extracted.entities : [];
  const rawRelations = Array.isArray(extracted?.relations) ? extracted.relations : [];

  // --- 1. DELETE existing (cascade to entity_relations via FK) ---
  const { error: delErr } = await supabase.from("entities").delete().eq("paper_id", paperId);
  if (delErr) throw new Error(`[entity-persist] delete: ${delErr.message}`);

  if (rawEntities.length === 0) {
    console.log(`[entity-persist] ${paperId}: 0 entities (nothing to persist)`);
    return { entitiesInserted: 0, relationsInserted: 0, embeddingsGenerated: 0 };
  }

  // --- 2. canonicalize & dedupe entities (paper_id, canonical_name, value, unit 기준) ---
  const entityDedup = new Map(); // key → prepared row
  for (const raw of rawEntities) {
    if (!raw || !raw.canonical_name || !raw.entity_type) continue;
    const canonical = canonicalize(raw.canonical_name);
    if (!canonical) continue;
    const value = raw.value == null || raw.value === "" ? null : String(raw.value);
    const unit = raw.unit == null || raw.unit === "" ? null : String(raw.unit);
    const key = `${canonical}||${value ?? ""}||${unit ?? ""}`;
    if (entityDedup.has(key)) continue;

    // chunk 매칭: chunkIndexMap에서 raw_name/canonical이 등장하는 첫 청크 (best-effort)
    let chunkId = null;
    if (chunkIndexMap && typeof chunkIndexMap.lookup === "function") {
      chunkId = chunkIndexMap.lookup(canonical) || chunkIndexMap.lookup(String(raw.raw_name || ""));
    }

    entityDedup.set(key, {
      paper_id: paperId,
      chunk_id: chunkId,
      entity_type: raw.entity_type,
      raw_name: String(raw.raw_name || canonical).slice(0, 500),
      canonical_name: canonical,
      value,
      unit,
      confidence: ["high", "medium", "low"].includes(raw.confidence) ? raw.confidence : "medium",
      confidence_tag: ["EXTRACTED", "INFERRED", "AMBIGUOUS"].includes(raw.confidence_tag)
        ? raw.confidence_tag
        : "EXTRACTED",
      source_hint: raw.source_hint ? String(raw.source_hint).slice(0, 200) : null,
    });
  }

  const entityRows = [...entityDedup.values()];

  // --- 3. batch INSERT entities (50개씩), select id back for relation FK ---
  const insertedEntities = [];
  for (let i = 0; i < entityRows.length; i += 50) {
    const batch = entityRows.slice(i, i + 50);
    const { data, error } = await supabase.from("entities").insert(batch).select("id, canonical_name, value, unit, entity_type, raw_name, chunk_id");
    if (error) throw new Error(`[entity-persist] insert entities: ${error.message}`);
    if (data) insertedEntities.push(...data);
  }

  // --- 4. canonical → entity_id map (관계 FK 해석용) ---
  // 동일 canonical에 여러 행 있을 수 있음 (value/unit 다름) — relations는 단순히 canonical 이름만 매칭하므로
  // 첫 번째 삽입 행을 대표로 사용 (환각 관계 방지 위해 value 무시).
  const canonicalToId = new Map();
  for (const e of insertedEntities) {
    if (!canonicalToId.has(e.canonical_name)) {
      canonicalToId.set(e.canonical_name, e.id);
    }
  }

  // --- 5. 관계 INSERT (맵에 없는 canonical은 silently skip) ---
  // entity_id → chunk_id 역인덱스 (evidence 폴백용).
  const entityChunkMap = new Map();
  for (const e of insertedEntities) {
    if (e.chunk_id) entityChunkMap.set(e.id, e.chunk_id);
  }

  const relationRows = [];
  const seenRelKey = new Set();
  for (const r of rawRelations) {
    if (!r) continue;
    const srcCanon = canonicalize(r.source_canonical);
    const tgtCanon = canonicalize(r.target_canonical);
    if (!srcCanon || !tgtCanon) continue;
    const srcId = canonicalToId.get(srcCanon);
    const tgtId = canonicalToId.get(tgtCanon);
    if (!srcId || !tgtId) continue;
    if (srcId === tgtId) continue; // self-loop 제거
    const relType = r.relation_type;
    const direction = ["positive", "negative", "neutral", "bidirectional"].includes(r.direction)
      ? r.direction
      : "neutral";

    const dedupKey = `${srcId}||${tgtId}||${relType}||${paperId}`;
    if (seenRelKey.has(dedupKey)) continue;
    seenRelKey.add(dedupKey);

    // evidence_chunk_id best-effort 폴백 체인:
    //   1) relation.source_hint를 chunkIndex로 조회
    //   2) source 엔티티의 chunk_id
    //   3) target 엔티티의 chunk_id
    //   4) null (graph_traverse_1hop 순회에서 제외됨)
    let evidenceChunkId = null;
    if (chunkIndexMap && typeof chunkIndexMap.lookup === "function" && r.source_hint) {
      evidenceChunkId = chunkIndexMap.lookup(String(r.source_hint));
    }
    if (!evidenceChunkId) evidenceChunkId = entityChunkMap.get(srcId) || null;
    if (!evidenceChunkId) evidenceChunkId = entityChunkMap.get(tgtId) || null;

    relationRows.push({
      source_entity_id: srcId,
      target_entity_id: tgtId,
      relation_type: relType,
      direction,
      source_paper_id: paperId,
      evidence_chunk_id: evidenceChunkId,
      confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium",
      confidence_tag: ["EXTRACTED", "INFERRED", "AMBIGUOUS"].includes(r.confidence_tag)
        ? r.confidence_tag
        : "EXTRACTED",
    });
  }

  let relationsInserted = 0;
  for (let i = 0; i < relationRows.length; i += 50) {
    const batch = relationRows.slice(i, i + 50);
    // UNIQUE 제약 충돌 시 silently skip (upsert onConflict: ignore)
    const { data, error } = await supabase
      .from("entity_relations")
      .upsert(batch, {
        onConflict: "source_entity_id,target_entity_id,relation_type,source_paper_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      console.warn(`[entity-persist] relation upsert partial fail: ${error.message}`);
    } else {
      relationsInserted += (data?.length ?? 0);
    }
  }

  // --- 6. 엔티티 임베딩 생성 + 20개 배치 UPDATE ---
  let embeddingsGenerated = 0;
  const updates = [];
  for (const e of insertedEntities) {
    // embedding 입력 포맷: "[{type}] {canonical} {value} {unit}"
    const parts = [`[${e.entity_type}]`, e.canonical_name];
    if (e.value) parts.push(e.value);
    if (e.unit) parts.push(e.unit);
    const text = parts.join(" ").trim();
    try {
      const emb = await generateEmbeddingFn(text, "document");
      updates.push({ id: e.id, embedding: JSON.stringify(emb) });
      embeddingsGenerated++;
    } catch (embErr) {
      console.warn(`[entity-persist] embedding failed for "${e.canonical_name}":`, embErr.message);
    }
  }

  // Batch UPDATE embedding (supabase update는 단건이므로 20개씩 순회)
  for (let i = 0; i < updates.length; i += 20) {
    const batch = updates.slice(i, i + 20);
    await Promise.all(
      batch.map((u) =>
        supabase
          .from("entities")
          .update({ embedding: u.embedding })
          .eq("id", u.id)
          .then((r) => {
            if (r.error) console.warn(`[entity-persist] update embedding ${u.id}: ${r.error.message}`);
          })
      )
    );
  }

  console.log(
    `[entity-persist] ${paperId}: entities=${entityRows.length}, relations=${relationsInserted}, embeddings=${embeddingsGenerated}`
  );

  return {
    entitiesInserted: entityRows.length,
    relationsInserted,
    embeddingsGenerated,
  };
}

// ============================================================
// Chunk index builder (raw_name / canonical → chunk_id 매칭 힌트)
// ============================================================

/**
 * persistEntities()의 chunkIndexMap용 헬퍼.
 * 각 청크 텍스트를 소문자화해서, 이후 lookup(name)이 등장하는 첫 chunk_id를 리턴하는 객체 반환.
 */
export async function buildChunkIndexForPaper(paperId, supabase) {
  const { data: chunks, error } = await supabase
    .from("paper_chunks")
    .select("id, text")
    .eq("paper_id", paperId)
    .order("chunk_order", { ascending: true });
  if (error) {
    console.warn(`[entity-extractor] buildChunkIndex: ${error.message}`);
    return { lookup: () => null };
  }
  const normalized = (chunks ?? []).map((c) => ({
    id: c.id,
    lowered: String(c.text || "").toLowerCase(),
  }));
  return {
    lookup: (name) => {
      if (!name) return null;
      const needle = String(name).toLowerCase().trim();
      if (needle.length < 2) return null;
      for (const c of normalized) {
        if (c.lowered.includes(needle)) return c.id;
      }
      return null;
    },
  };
}
