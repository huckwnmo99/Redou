import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { persistEntities } from "../electron/entity-extractor.mjs";

function createPersistSupabase() {
  const state = {
    entities: [],
    relations: [],
  };

  return {
    state,
    supabase: {
      from(table) {
        return {
          delete() {
            return {
              eq() {
                if (table === "entities") state.entities = [];
                if (table === "entity_relations") state.relations = [];
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(rows) {
            const inputRows = Array.isArray(rows) ? rows : [rows];
            if (table === "entities") {
              const inserted = inputRows.map((row, index) => ({
                id: `entity-${state.entities.length + index + 1}`,
                ...row,
              }));
              state.entities.push(...inserted);
              return {
                select() {
                  return Promise.resolve({ data: inserted, error: null });
                },
              };
            }

            if (table === "entity_relations") {
              const inserted = inputRows.map((row, index) => ({
                id: `relation-${state.relations.length + index + 1}`,
                ...row,
              }));
              state.relations.push(...inserted);
              return Promise.resolve({ data: inserted, error: null });
            }

            throw new Error(`unexpected insert table ${table}`);
          },
        };
      },
    },
  };
}

describe("entity extraction persistence", () => {
  it("persists relations returned with canonical source and target fields", async () => {
    const { state, supabase } = createPersistSupabase();
    const chunkIndex = new Map([
      [0, "chunk-1"],
      ["0", "chunk-1"],
    ]);

    const result = await persistEntities(
      "paper-1",
      chunkIndex,
      {
        entities: [
          {
            raw_name: "Amine adsorbent",
            canonical_name: "amine adsorbent",
            entity_type: "substance",
            confidence: "high",
            chunk_order: 0,
          },
          {
            raw_name: "CO2 capacity",
            canonical_name: "co2 capacity",
            entity_type: "metric",
            confidence: "high",
            chunk_order: 0,
          },
        ],
        relations: [
          {
            source_canonical: "amine adsorbent",
            target_canonical: "co2 capacity",
            relation_type: "affects",
            direction: "positive",
            confidence: "high",
            confidence_tag: "EXTRACTED",
            chunk_order: 0,
          },
        ],
      },
      supabase,
      async () => [0.1, 0.2],
    );

    assert.equal(result.entityCount, 2);
    assert.equal(result.relationCount, 1);
    assert.equal(state.relations[0]?.source_entity_id, "entity-1");
    assert.equal(state.relations[0]?.target_entity_id, "entity-2");
    assert.equal(state.relations[0]?.evidence_chunk_id, "chunk-1");
  });
});
