import { throwIfChatAborted } from "./chat/abort-guards.mjs";
import { OLLAMA_BASE_URL, ollamaSignal } from "./llm-chat.mjs";

export const CURRENT_ENTITY_EXTRACTION_VERSION = 2;

const ENTITY_TYPE_ALIASES = new Map([
  ["substance", "substance"],
  ["material", "substance"],
  ["compound", "substance"],
  ["chemical", "substance"],
  ["method", "method"],
  ["technique", "method"],
  ["process", "method"],
  ["condition", "condition"],
  ["parameter", "condition"],
  ["metric", "metric"],
  ["measurement", "metric"],
  ["outcome", "metric"],
  ["phenomenon", "phenomenon"],
  ["effect", "phenomenon"],
  ["concept", "concept"],
]);

const RELATION_TYPE_ALIASES = new Map([
  ["affects", "affects"],
  ["correlates_with", "correlates_with"],
  ["correlates", "correlates_with"],
  ["measures", "measures"],
  ["uses", "uses"],
  ["compared_to", "compared_to"],
  ["compares_to", "compared_to"],
  ["outperforms", "outperforms"],
  ["produces", "produces"],
  ["same_as", "same_as"],
]);

const DIRECTIONS = new Set(["positive", "negative", "neutral", "bidirectional"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const CONFIDENCE_TAGS = new Set(["EXTRACTED", "INFERRED", "AMBIGUOUS"]);

const ENTITY_EXTRACTION_SCHEMA = {
  type: "object",
  required: ["entities", "relations"],
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        required: ["raw_name", "canonical_name", "entity_type", "confidence"],
        properties: {
          id: { type: "string" },
          raw_name: { type: "string" },
          canonical_name: { type: "string" },
          entity_type: {
            type: "string",
            enum: ["substance", "method", "condition", "metric", "phenomenon", "concept"],
          },
          value: { type: ["string", "null"] },
          unit: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          confidence_tag: { type: "string", enum: ["EXTRACTED", "INFERRED", "AMBIGUOUS"] },
          source_hint: { type: ["string", "null"] },
          chunk_order: { type: ["number", "null"] },
          chunk_id: { type: ["string", "null"] },
        },
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        required: ["source_canonical", "target_canonical", "relation_type", "direction", "confidence"],
        properties: {
          source_canonical: { type: "string" },
          target_canonical: { type: "string" },
          relation_type: {
            type: "string",
            enum: ["affects", "correlates_with", "measures", "uses", "compared_to", "outperforms", "produces", "same_as"],
          },
          direction: { type: "string", enum: ["positive", "negative", "neutral", "bidirectional"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          confidence_tag: { type: "string", enum: ["EXTRACTED", "INFERRED", "AMBIGUOUS"] },
          chunk_order: { type: ["number", "null"] },
          chunk_id: { type: ["string", "null"] },
        },
      },
    },
  },
};

const QUERY_ENTITY_SCHEMA = {
  type: "object",
  required: ["entities"],
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "confidence"],
        properties: {
          name: { type: "string" },
          canonical_name: { type: ["string", "null"] },
          type: {
            type: "string",
            enum: ["substance", "method", "condition", "metric", "phenomenon", "concept"],
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
};

function compact(value, maxLength = 8000) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function canonicalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}.%+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEntityType(type) {
  return ENTITY_TYPE_ALIASES.get(canonicalize(type)) ?? "concept";
}

function normalizeRelationType(type) {
  return RELATION_TYPE_ALIASES.get(canonicalize(type)) ?? "correlates_with";
}

function normalizeConfidence(value) {
  const normalized = canonicalize(value);
  return CONFIDENCE.has(normalized) ? normalized : "medium";
}

function normalizeConfidenceTag(value) {
  const normalized = String(value ?? "").toUpperCase();
  return CONFIDENCE_TAGS.has(normalized) ? normalized : "EXTRACTED";
}

function parseJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function pickFirstCompact(values, maxLength = 240) {
  for (const value of values) {
    const picked = compact(value, maxLength);
    if (picked) return picked;
  }
  return "";
}

function normalizeExtraction(raw) {
  const entities = Array.isArray(raw?.entities) ? raw.entities : [];
  const relations = Array.isArray(raw?.relations) ? raw.relations : [];

  return {
    entities: entities
      .map((entity, index) => {
        const rawName = compact(entity.raw_name ?? entity.name ?? entity.canonical_name, 240);
        const canonicalName = canonicalize(entity.canonical_name ?? rawName);
        if (!rawName || !canonicalName) return null;

        return {
          localId: compact(entity.id ?? entity.local_id ?? `entity-${index}`, 120),
          raw_name: rawName,
          canonical_name: canonicalName,
          entity_type: normalizeEntityType(entity.entity_type ?? entity.type),
          value: compact(entity.value, 120) || null,
          unit: compact(entity.unit, 80) || null,
          confidence: normalizeConfidence(entity.confidence),
          confidence_tag: normalizeConfidenceTag(entity.confidence_tag),
          source_hint: compact(entity.source_hint ?? entity.evidence, 320) || null,
          chunk_order: Number.isFinite(Number(entity.chunk_order)) ? Number(entity.chunk_order) : null,
          chunk_id: typeof entity.chunk_id === "string" ? entity.chunk_id : null,
        };
      })
      .filter(Boolean),
    relations: relations
      .map((relation) => ({
        source: pickFirstCompact([
          relation.source,
          relation.source_canonical,
          relation.sourceCanonical,
          relation.source_id,
          relation.source_name,
          relation.source_entity,
          relation.sourceEntity,
          relation.source_raw_name,
        ]),
        target: pickFirstCompact([
          relation.target,
          relation.target_canonical,
          relation.targetCanonical,
          relation.target_id,
          relation.target_name,
          relation.target_entity,
          relation.targetEntity,
          relation.target_raw_name,
        ]),
        relation_type: normalizeRelationType(relation.relation_type ?? relation.type),
        direction: DIRECTIONS.has(canonicalize(relation.direction)) ? canonicalize(relation.direction) : "neutral",
        confidence: normalizeConfidence(relation.confidence),
        confidence_tag: normalizeConfidenceTag(relation.confidence_tag),
        chunk_order: Number.isFinite(Number(relation.chunk_order)) ? Number(relation.chunk_order) : null,
        chunk_id: typeof relation.chunk_id === "string" ? relation.chunk_id : null,
      }))
      .filter((relation) => relation.source && relation.target),
  };
}

async function callOllamaJson(messages, modelName, abortSignal, timeoutMs = 180_000, format = null) {
  throwIfChatAborted(abortSignal);
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      stream: false,
      ...(format ? { format } : {}),
      options: { temperature: 0, num_ctx: 32768 },
      messages,
    }),
    signal: ollamaSignal(abortSignal, timeoutMs),
  });
  throwIfChatAborted(abortSignal);

  if (!res.ok) {
    throw new Error(`Ollama responded with ${res.status}`);
  }

  const json = await res.json();
  const parsed = parseJsonObject(json?.message?.content ?? json?.response ?? "");
  if (!parsed) {
    throw new Error("Entity extraction response was not valid JSON.");
  }
  return parsed;
}

export async function assemblePaperContextForEntities(paperId, supabase) {
  const { data: paper, error: paperError } = await supabase
    .from("papers")
    .select("id, title, abstract, publication_year")
    .eq("id", paperId)
    .maybeSingle();
  if (paperError) throw new Error(paperError.message);
  if (!paper) throw new Error(`Paper not found: ${paperId}`);

  const { data: sections, error: sectionError } = await supabase
    .from("paper_sections")
    .select("id, section_name")
    .eq("paper_id", paperId);
  if (sectionError) throw new Error(sectionError.message);
  const sectionMap = new Map((sections ?? []).map((section) => [section.id, section.section_name]));

  const { data: chunks, error: chunkError } = await supabase
    .from("paper_chunks")
    .select("id, chunk_order, section_id, page, text")
    .eq("paper_id", paperId)
    .order("chunk_order", { ascending: true });
  if (chunkError) throw new Error(chunkError.message);

  const { data: figures, error: figureError } = await supabase
    .from("figures")
    .select("id, item_type, figure_no, caption, summary_text, plain_text, page")
    .eq("paper_id", paperId)
    .order("created_at", { ascending: true });
  if (figureError) throw new Error(figureError.message);

  return {
    paper,
    chunks: (chunks ?? []).slice(0, 90).map((chunk) => ({
      chunk_id: chunk.id,
      chunk_order: chunk.chunk_order,
      section: sectionMap.get(chunk.section_id) ?? null,
      page: chunk.page ?? null,
      text: compact(chunk.text, 1600),
    })),
    figures: (figures ?? []).slice(0, 40).map((figure) => ({
      item_type: figure.item_type,
      figure_no: figure.figure_no,
      page: figure.page ?? null,
      text: compact(figure.plain_text || figure.summary_text || figure.caption, 900),
    })),
  };
}

export async function extractEntitiesFromPaper(paperContext, paperTitle, modelName, abortSignal) {
  if (!paperContext?.chunks?.length) {
    return { entities: [], relations: [] };
  }

  const payload = {
    title: paperTitle ?? paperContext.paper?.title ?? "Untitled",
    abstract: compact(paperContext.paper?.abstract, 2000),
    chunks: paperContext.chunks,
    figures: paperContext.figures,
  };

  const raw = await callOllamaJson([
    {
      role: "system",
      content: [
        "Extract a compact research entity graph from the supplied paper context.",
        "Return JSON only with entities[] and relations[].",
        "Allowed entity types: substance, method, condition, metric, phenomenon, concept.",
        "Allowed relation types: affects, correlates_with, measures, uses, compared_to, outperforms, produces, same_as.",
        "Each relation must use source_canonical and target_canonical values that exactly match entity canonical_name values.",
        "Use chunk_order when possible. Mark uncertain values with confidence low or confidence_tag AMBIGUOUS.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(payload),
    },
  ], modelName, abortSignal, 180_000, ENTITY_EXTRACTION_SCHEMA);

  return normalizeExtraction(raw);
}

export async function extractQueryEntities(query, modelName, abortSignal) {
  try {
    const raw = await callOllamaJson([
      {
        role: "system",
        content: [
          "Extract only the explicit research entities from the user query.",
          "Return JSON only: {\"entities\":[{\"name\":\"...\",\"type\":\"substance|method|condition|metric|phenomenon|concept\",\"confidence\":\"high|medium|low\"}]}",
          "Do not invent entities.",
        ].join(" "),
      },
      { role: "user", content: String(query ?? "") },
    ], modelName, abortSignal, 45_000, QUERY_ENTITY_SCHEMA);

    return normalizeExtraction({ entities: raw?.entities ?? [] }).entities.map((entity) => ({
      name: entity.raw_name,
      canonical_name: entity.canonical_name,
      type: entity.entity_type,
      confidence: entity.confidence,
    }));
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.warn("[entity-query] Failed to extract query entities:", err?.message ?? err);
    return [];
  }
}

export async function buildChunkIndexForPaper(paperId, supabase) {
  const { data, error } = await supabase
    .from("paper_chunks")
    .select("id, chunk_order")
    .eq("paper_id", paperId);
  if (error) throw new Error(error.message);

  const index = new Map();
  for (const chunk of data ?? []) {
    index.set(chunk.id, chunk.id);
    index.set(String(chunk.chunk_order), chunk.id);
    index.set(chunk.chunk_order, chunk.id);
  }
  return index;
}

function resolveChunkId(item, chunkIndexMap) {
  if (!item || !chunkIndexMap) return null;
  if (item.chunk_id && chunkIndexMap.has(item.chunk_id)) return chunkIndexMap.get(item.chunk_id);
  if (item.chunk_order !== null && item.chunk_order !== undefined && chunkIndexMap.has(item.chunk_order)) {
    return chunkIndexMap.get(item.chunk_order);
  }
  if (item.chunk_order !== null && item.chunk_order !== undefined && chunkIndexMap.has(String(item.chunk_order))) {
    return chunkIndexMap.get(String(item.chunk_order));
  }
  return null;
}

export async function persistEntities(paperId, chunkIndexMap, extracted, supabase, generateEmbeddingFn) {
  const normalized = normalizeExtraction(extracted);

  await supabase.from("entity_relations").delete().eq("source_paper_id", paperId);
  await supabase.from("entities").delete().eq("paper_id", paperId);

  if (normalized.entities.length === 0) {
    return { entityCount: 0, relationCount: 0 };
  }

  const seen = new Set();
  const entityInputs = [];
  for (const entity of normalized.entities) {
    const dedupeKey = [
      entity.entity_type,
      entity.canonical_name,
      entity.value ?? "",
      entity.unit ?? "",
      resolveChunkId(entity, chunkIndexMap) ?? "",
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    entityInputs.push(entity);
  }

  const entityRows = [];
  for (const entity of entityInputs) {
    let embedding = null;
    if (typeof generateEmbeddingFn === "function") {
      try {
        embedding = await generateEmbeddingFn([
          entity.entity_type,
          entity.canonical_name,
          entity.value,
          entity.unit,
        ].filter(Boolean).join(" "), "document");
      } catch (err) {
        console.warn(`[entity] Embedding failed for ${entity.canonical_name}:`, err?.message ?? err);
      }
    }

    entityRows.push({
      paper_id: paperId,
      chunk_id: resolveChunkId(entity, chunkIndexMap),
      entity_type: entity.entity_type,
      raw_name: entity.raw_name,
      canonical_name: entity.canonical_name,
      value: entity.value,
      unit: entity.unit,
      confidence: entity.confidence,
      confidence_tag: entity.confidence_tag,
      source_hint: entity.source_hint,
      embedding: embedding ? JSON.stringify(embedding) : null,
    });
  }

  const { data: insertedEntities, error: insertError } = await supabase
    .from("entities")
    .insert(entityRows)
    .select("id, raw_name, canonical_name, entity_type");
  if (insertError) throw new Error(insertError.message);

  const lookup = new Map();
  for (let index = 0; index < entityInputs.length; index++) {
    const input = entityInputs[index];
    const inserted = insertedEntities?.[index];
    if (!inserted?.id) continue;
    lookup.set(input.localId, inserted);
    lookup.set(input.raw_name, inserted);
    lookup.set(input.canonical_name, inserted);
  }

  const relationRows = [];
  const relationSeen = new Set();
  for (const relation of normalized.relations) {
    const source = lookup.get(relation.source) ?? lookup.get(canonicalize(relation.source));
    const target = lookup.get(relation.target) ?? lookup.get(canonicalize(relation.target));
    if (!source?.id || !target?.id || source.id === target.id) continue;

    const relationKey = [source.id, target.id, relation.relation_type].join("|");
    if (relationSeen.has(relationKey)) continue;
    relationSeen.add(relationKey);

    relationRows.push({
      source_entity_id: source.id,
      target_entity_id: target.id,
      relation_type: relation.relation_type,
      direction: relation.direction,
      source_paper_id: paperId,
      evidence_chunk_id: resolveChunkId(relation, chunkIndexMap),
      confidence: relation.confidence,
      confidence_tag: relation.confidence_tag,
    });
  }

  if (relationRows.length > 0) {
    const { error: relationError } = await supabase.from("entity_relations").insert(relationRows);
    if (relationError) throw new Error(relationError.message);
  }

  return {
    entityCount: insertedEntities?.length ?? 0,
    relationCount: relationRows.length,
  };
}
