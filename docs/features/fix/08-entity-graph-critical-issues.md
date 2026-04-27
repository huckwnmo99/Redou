# Fix: 엔티티 그래프 Critical 이슈 2건 수정

> 유형: fix | 작성일: 2026-04-23 | 수정 완료: 2026-04-23 | 문서 정합성 보강: 2026-04-27

## 문제

`/review` 스킬이 엔티티 그래프 기능(`snug-orbiting-wren`)에 대해 BLOCK 판정을 내렸다. Critical 등급 이슈 2건이 확인되었으며, 둘 다 "그래프 기능이 실질적으로 작동하지 않는" 수준의 결함이다.

### Critical 1: `evidence_chunk_id`가 항상 `null` → 그래프 순회 0건

**증상**: QA 파이프라인에서 `runGraphEnhancedRag`가 항상 `graphChunkCount=0`을 리턴. 그래프 기능이 실질적으로 꺼져 있는 상태.

**근거 체인**:

1. `apps/desktop/electron/entity-extractor.mjs:506` — `persistEntities`가 관계 INSERT 시 `evidence_chunk_id: null`로 하드코딩.
   ```js
   relationRows.push({
     source_entity_id: srcId,
     target_entity_id: tgtId,
     relation_type: relType,
     direction,
     source_paper_id: paperId,
     evidence_chunk_id: null, // best-effort에서 생략 (persist 단계에서 chunk 매칭 어렵)
     ...
   });
   ```
2. `supabase/migrations/20260423010000_add_entity_graph.sql:259` — `graph_traverse_1hop` RPC가 `WHERE n.chunk_id IS NOT NULL`로 필터링.
3. 결과: DB의 모든 `entity_relations` 행이 `evidence_chunk_id IS NULL`이므로 RPC는 항상 빈 결과를 리턴.
4. `apps/desktop/electron/graph-search.mjs:252` — `graphChunkIds`가 항상 `[]`로 설정.
5. `graph-search.mjs:107-113` — `rrfFusionTriple`이 `graphChunks.length === 0`을 감지해 `wGraph=0`으로 회귀 → QA 플로우 전체에서 그래프 기여도 0.

**왜 기존 코드는 null로 두었나?** persist 시점에는 관계가 어느 청크에서 추출됐는지 알 수 없다는 판단이었음. 그러나 동일 파일에 이미 해결 수단이 존재:
- 엔티티 INSERT 시 `chunkIndexMap.lookup()`을 써서 `entity.chunk_id`를 best-effort로 채우고 있음 (line 436-440).
- 관계 스키마에도 `source_hint` 필드가 존재 (line 84) — LLM이 "이 관계를 지지하는 문장/구절"을 한 줄로 주도록 프롬프트에서 요구 가능.
- 설사 `source_hint`가 없어도, 양쪽 엔티티 중 먼저 발견된 `entity.chunk_id`를 상속받는 것만으로도 RPC 입장에서는 유효한 단서.

### Critical 2: 3-way RRF에 같은 `baseRanked`가 vector/bm25 두 슬롯에 중복 전달

**증상**: `rrfFusionTriple`의 vector/bm25 가중치 재분배가 의미를 잃고, 가중치 설계 의도(mode별로 벡터/키워드 기여 조정)가 사실상 무효화됨.

**근거**:

`apps/desktop/electron/graph-search.mjs:269-274`
```js
const baseRanked = baseRag.chunks || [];
const fused = rrfFusionTriple(
  baseRanked, // vector 랭킹 자리 (이미 RRF된 베이스)
  baseRanked, // bm25 자리도 동일 베이스 사용 — 효과는 graph만 섞이는 형태
  graphChunks,
  mode
);
```

**왜 구조적으로 회복 불가한가?** `runMultiQueryRag`(`main.mjs:3071-3184`)는 내부에서:
1. 벡터/BM25 병렬 검색을 수행
2. `rrfFusion`으로 벡터+BM25 RRF 병합 (line 3166)
3. `rerankChunksIfAvailable`로 **이미 reranker까지 통과시킨 결과**를 리턴 (line 3179)

즉 `baseRag.chunks`는 **"이미 융합+재랭크된 단일 랭킹 리스트"**이며, 벡터 랭킹과 BM25 랭킹을 따로 꺼낼 수 있는 API가 없다. 현재 호출은 같은 리스트를 벡터/BM25 양쪽에 넣는 형태라, `wVector + wBM25 + wGraph` 계산은 사실상 `(wVector+wBM25)·base_rank_score + wGraph·graph_rank_score`의 2-way RRF와 동치가 됨. 주석(line 276)에도 이 사실을 자백하고 있다.

**설계 의도와의 괴리**: 계획서 `snug-orbiting-wren`은 "mode별로 vector/bm25/graph 가중치를 다르게" 걸어 예컨대 table 모드에서는 BM25 비중을 높이겠다는 의도였음. 그러나 baseRag가 이미 mode별 가중치를 반영해 RRF를 끝낸 상태이므로, 그 위에 vector/bm25를 다시 분리하는 것은 의미 없는 중복.

**선택지 비교** (planner 판단):

| 옵션 | 내용 | 장점 | 단점 |
|------|------|------|------|
| (A) 분해 | `runMultiQueryRag`를 리팩토링해 `{vectorChunks, bm25Chunks, figures}`를 내보내고 graph-search에서 3-way RRF+reranker를 자체 수행 | 원 설계 의도 보존 | 수정 범위가 main.mjs 여러 곳으로 번짐(rag-pipeline 전반), reranker 두 번 돌리거나 흐름 재설계 필요 |
| (B) 축소 | 명시적 2-way RRF로 바꿈: `base ⊕ graph`. 내부 구조 주석 업데이트. | 최소 수정. baseRag의 mode별 가중치는 이미 적용되어 있으니 그래프 가중치만 깔끔히 얹으면 됨 | 원래 의도한 "그래프에 mode별 전용 가중치" 포기 (대신 단일 `wGraph`로 통일) |

**본 계획서는 (B) 채택**. 근거:
- 현재 코드가 실질적으로 (B)를 이미 수행 중. 단지 API가 3-way인 척할 뿐 동작이 2-way.
- (A)는 reranker 재실행/순서 재배치 등 회귀 위험이 커서 소규모 수정 범위를 벗어남.
- 필요 시 후속 이터레이션에서 (A)로 확장 가능 — 본 수정은 그 경로를 막지 않음.

---

## 수정 방안

### 수정 #1: `persistEntities`가 `evidence_chunk_id`를 best-effort로 채우도록 변경

**파일**: `apps/desktop/electron/entity-extractor.mjs`

**변경 지점 1**: 관계 처리 루프에서 `chunkIndexMap`을 재사용해 `evidence_chunk_id`를 탐색. 폴백 순서:
1. `r.source_hint` (관계 자체에 붙은 LLM 힌트)를 `chunkIndexMap.lookup()`으로 매칭
2. 실패 시 source 엔티티의 `chunk_id` (이미 `insertedEntities`에 담겨 있음)
3. 실패 시 target 엔티티의 `chunk_id`
4. 모두 실패 시 `null` (현재 동작과 동일)

**Before (line 479-512)**:
```js
  // --- 5. 관계 INSERT (맵에 없는 canonical은 silently skip) ---
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
    if (srcId === tgtId) continue;
    const relType = r.relation_type;
    const direction = ...;

    const dedupKey = `${srcId}||${tgtId}||${relType}||${paperId}`;
    if (seenRelKey.has(dedupKey)) continue;
    seenRelKey.add(dedupKey);

    relationRows.push({
      source_entity_id: srcId,
      target_entity_id: tgtId,
      relation_type: relType,
      direction,
      source_paper_id: paperId,
      evidence_chunk_id: null, // best-effort에서 생략
      ...
    });
  }
```

**After**:
```js
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
    if (srcId === tgtId) continue;
    const relType = r.relation_type;
    const direction = ...;

    const dedupKey = `${srcId}||${tgtId}||${relType}||${paperId}`;
    if (seenRelKey.has(dedupKey)) continue;
    seenRelKey.add(dedupKey);

    // evidence_chunk_id best-effort 폴백 체인:
    //   1) relation.source_hint를 chunkIndex로 조회
    //   2) source 엔티티의 chunk_id
    //   3) target 엔티티의 chunk_id
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
      confidence: ...,
      confidence_tag: ...,
    });
  }
```

**변경 지점 2 (선택적 안전망)**: `supabase/migrations/20260423010000_add_entity_graph.sql:259`의 `WHERE n.chunk_id IS NOT NULL` 필터 유지 정책.

* **그대로 유지**. 이유:
  - 본 수정으로 대부분의 관계가 chunk_id를 갖게 됨.
  - 여전히 `null`인 관계는 "어느 청크에서 언급됐는지 모르는 약한 근거" → 컨텍스트 합류 부적격으로 간주하는 것이 안전.
  - `paper_id` 폴백을 해버리면 paper 전체가 딸려와 컨텍스트 오염/LLM 토큰 폭증 위험.
* 다만, 운영 관찰 결과 필드가 너무 희소하다면 후속 마이그레이션에서 `paper_id` 기반 상위 N개 chunk 폴백을 별도 RPC로 추가하는 것을 검토. 본 계획서 범위 밖.

**새 마이그레이션 필요 여부**: 없음 (RPC 정의 변경 안 함).

**기존 데이터 처리**: 과거에 이미 추출된 관계는 `evidence_chunk_id`가 전부 `null` 상태로 남아 있음. 수동 재추출 트리거 필요:
- Settings UI의 "엔티티 백필" 버튼으로 기존 논문 재처리 가능 (이미 구현됨, `feature-status.md`의 "온톨로지 엔티티 추출" 항목).
- 혹은 `CURRENT_ENTITY_EXTRACTION_VERSION`을 2로 범프하여 자동 재처리 트리거.

**권장**: `CURRENT_ENTITY_EXTRACTION_VERSION`을 `1 → 2`로 범프 (`entity-extractor.mjs:14`). 이유: 기존 DB 데이터가 이 수정의 효과를 전혀 못 받으므로 자동 재처리가 이상적. 대량 논문 환경이 아닌 한 재추출 비용 < 그래프 기능 복구 가치.

> **자동 트리거 범위**: 버전 범프로 인한 자동 재추출은 신규/재임베딩 잡이 끝날 때만 동작. 이미 임베딩이 끝난 기존 논문은 Settings의 수동 백필 버튼으로만 재처리됨.

### 수정 #2: `rrfFusionTriple` → 명시적 2-way `rrfFusionWithGraph`로 축소

**파일**: `apps/desktop/electron/graph-search.mjs`

**접근**: 함수를 완전히 대체하기보다 **시그니처 유지 + 내부 동작 명시화** + **주석 업데이트**로 최소 변경. `rrfFusionTriple`을 남겨두되 사실상 2-way로 재구현. 대안으로 `rrfFusionWithGraph`라는 2-인자 함수를 새로 export하고 호출부를 바꾸는 방법도 검토했으나, 테스트/import 영향을 줄이기 위해 **이름만 유지, 내부만 수정**.

**Before (line 97-150)**: (3-way RRF, vector/bm25/graph 세 슬롯)

**After (교체)**:

```js
// ============================================================
// 2-way RRF (base ⊕ graph)
// ============================================================
//
// 역사적 주석:
//   초기 설계는 vector+bm25+graph 3-way였으나 runMultiQueryRag가 이미
//   내부에서 vector+bm25 RRF+reranker를 완료해 단일 랭킹을 리턴하므로,
//   외부에서 "벡터/BM25를 분리해 다시 가중"할 수 없다. 따라서 여기서는
//   base(이미 RRF+reranked)와 graph의 명시적 2-way RRF만 수행한다.

/**
 * base 랭킹(이미 vector+bm25 RRF+reranker 통과)과 graph 랭킹을 RRF로 병합.
 * mode="qa":    wBase=0.75, wGraph=0.25
 * mode="table": wBase=0.70, wGraph=0.30   (table은 그래프 희소 → 그래프 슬쩍 더 가중)
 * graphChunks empty → wGraph 0, wBase 1 (완전 패스스루).
 *
 * 기존 rrfFusionTriple(vector, bm25, graph)을 대체한다. export 이름은 하위 호환을
 * 위해 유지(2인자는 baseChunks/graphChunks만 사용, bm25 슬롯은 무시 + 경고).
 */
export function rrfFusionWithGraph(baseChunks, graphChunks, mode = "qa", k = 60) {
  let wBase = mode === "qa" ? 0.75 : 0.70;
  let wGraph = mode === "qa" ? 0.25 : 0.30;
  if (!graphChunks || graphChunks.length === 0) {
    wBase = 1;
    wGraph = 0;
  }
  const MISSING_RANK = 1000;

  const baseRankMap = new Map();
  baseChunks.forEach((c, idx) => baseRankMap.set(c.chunk_id, idx));
  const graphRankMap = new Map();
  (graphChunks || []).forEach((c, idx) => graphRankMap.set(c.chunk_id, idx));

  const chunkObjMap = new Map();
  for (const c of baseChunks) chunkObjMap.set(c.chunk_id, c);
  for (const c of graphChunks || []) {
    if (!chunkObjMap.has(c.chunk_id)) chunkObjMap.set(c.chunk_id, c);
  }

  const scored = [];
  for (const [chunkId, chunk] of chunkObjMap) {
    const bRank = baseRankMap.has(chunkId) ? baseRankMap.get(chunkId) : MISSING_RANK;
    const gRank = graphRankMap.has(chunkId) ? graphRankMap.get(chunkId) : MISSING_RANK;
    const rrfScore = wBase * (1 / (k + bRank)) + wGraph * (1 / (k + gRank));
    scored.push({ ...chunk, _rrfScore: rrfScore });
  }
  scored.sort((a, b) => b._rrfScore - a._rrfScore);
  return scored.slice(0, 40);
}

// Deprecated alias — 기존 import 경로 유지용. 첫 인자만 base로 사용, 둘째 인자는 무시.
export function rrfFusionTriple(baseOrVector, _bm25Ignored, graphChunks, mode = "qa", k = 60) {
  return rrfFusionWithGraph(baseOrVector, graphChunks, mode, k);
}
```

**호출부 변경 (`graph-search.mjs:268-277`)**:

```js
// Before
const baseRanked = baseRag.chunks || [];
const fused = rrfFusionTriple(
  baseRanked,
  baseRanked,
  graphChunks,
  mode
);
// 주의: baseRanked가 vector/bm25 양쪽에 동일 랭크로 들어가므로 ...

// After
const baseRanked = baseRag.chunks || [];
const fused = rrfFusionWithGraph(baseRanked, graphChunks, mode);
```

이렇게 하면:
- 외부 import 경로가 `rrfFusionTriple`을 여전히 쓰고 있어도 동작은 동일(하위호환).
- 내부 논리는 솔직하게 2-way.

**중요**: `extractQueryEntities`, `matchQueryEntitiesToGraph`, `fetchGraphChunks`, `runGraphEnhancedRag` 본체는 변경 없음.

---

## 영향 범위

### 수정 파일

| 파일 | 변경 요약 |
|------|-----------|
| `apps/desktop/electron/entity-extractor.mjs` | `persistEntities`에서 `evidence_chunk_id` 폴백 체인 추가 (line ~479-512). `CURRENT_ENTITY_EXTRACTION_VERSION` 1→2 (line 14). |
| `apps/desktop/electron/graph-search.mjs` | `rrfFusionTriple` 본체 2-way로 재구현, `rrfFusionWithGraph` 신규 export, `runGraphEnhancedRag` 호출부 교체 (line ~97-150, 268-277). |

### 수정 파일 수: **2개** (마이그레이션 없음) — 소규모 수정 범위.

### 하네스 갱신

| 파일 | 변경 |
|------|------|
| `docs/harness/main/feature-status.md` | "Graph-Enhanced Search (3-way RRF)" 항목의 설명을 "2-way RRF (base ⊕ graph)"로 정정 |
| `docs/harness/detail/electron/rag-pipeline.md` | (있을 경우) graph 섹션의 RRF 설명 동기화 |

### 사이드 이펙트 & 회귀 위험

1. **기존 `entity_relations.evidence_chunk_id`가 전부 `null`인 상태**는 이 수정으로 개선되지 않음 (재추출 필요). `CURRENT_ENTITY_EXTRACTION_VERSION` 범프가 자동 백필을 트리거하므로, 대량 추출 잡이 한 번 실행됨 — 사용자 체감 지연 가능. backfill 로직이 이미 IDLE_TIME/큐 기반이면 무해하나 확인 필요.
2. **QA 파이프라인**: 이 수정은 QA 모드에만 그래프가 적용되므로, table 모드/SRAG 파이프라인에는 영향 없음. table 모드에서 `runGraphEnhancedRag`를 호출하는 지점은 `main.mjs:3757`에서 확인했으나, 해당 호출은 실제로는 `runMultiQueryRag`이며(graph-search 호출 아님), SRAG 경로는 무영향. QA만 그래프를 타므로 영향 국소화됨.
3. **reranker 순서**: 현재 `rerankChunksIfAvailable`은 `runMultiQueryRag` 내부에서만 호출됨. graph-search의 `fused` 결과는 rerank되지 않은 채 `handleQaPipeline`에 리턴됨. 이는 수정 전에도 동일한 동작이므로 이번 수정으로 변하지 않음. (향후 Critical로 재식별될 경우 별도 fix 필요.)
4. **hybrid search regression**: `rrfFusion` (main.mjs:2976)은 그대로 유지. 벡터+BM25 기존 융합은 아무 영향 없음.
5. **테스트**: `rrfFusionTriple` export 이름은 alias로 유지되므로, 만약 vitest 등에서 해당 함수를 import해 테스트하는 경우 첫/셋째 인자만 의미 있음에 유의. 두 번째 인자를 검증하는 테스트가 있으면 수정 필요.

---

## 검증 방법

### 빌드/문법

```bash
node --check apps/desktop/electron/entity-extractor.mjs
node --check apps/desktop/electron/graph-search.mjs
cd apps/desktop && npm run build   # tsc --noEmit + vite build
```

### DB 레벨 검증 (수정 #1)

1. Electron 재시작 → 자동 재추출 트리거 대기 (또는 Settings UI의 수동 백필 버튼 실행).
2. 재추출 완료 후:
   ```sql
   -- evidence_chunk_id가 NULL이 아닌 비율 확인 (기대: 60%+)
   SELECT
     COUNT(*) FILTER (WHERE evidence_chunk_id IS NOT NULL)::float / COUNT(*) AS filled_ratio,
     COUNT(*) AS total_relations
   FROM entity_relations;

   -- 샘플 관계의 evidence_chunk_id 실제 확인
   SELECT id, source_entity_id, target_entity_id, relation_type, evidence_chunk_id
   FROM entity_relations
   WHERE evidence_chunk_id IS NOT NULL
   LIMIT 10;
   ```
3. `graph_traverse_1hop` 직접 호출:
   ```sql
   -- 임의의 entity_id로 1-hop 순회 (0건 반환 안 되어야 함)
   SELECT * FROM graph_traverse_1hop(
     (SELECT ARRAY[id] FROM entities LIMIT 1),
     50
   );
   ```

### 런타임 검증 (수정 #2)

1. QA 콘솔 로그에서 다음 패턴 확인:
   ```
   [graph-search] Seed entities: N       (N > 0)
   [graph-search] After same_as expand: M
   [graph-search] Graph chunks (1-hop): K   (K > 0 이어야 정상)
   [Chat/QA] Graph: seeds=N, expanded=M, graphChunks=K
   ```
2. 질문 예시: "What substance outperforms baseline on metric X?" 같이 그래프가 도움될 쿼리로 수동 테스트.
3. A/B 비교 (선택): graph-search를 우회해 `runMultiQueryRag` 직접 호출 결과와 `runGraphEnhancedRag` 결과의 상위 5 chunk_id를 비교. 그래프 적용 후 상위권에 새 chunk가 등장해야 함.

### 회귀 체크리스트

- [ ] 기존 QA 플로우 그대로 동작 (그래프 0건이어도 base RAG만으로 답변 생성됨)
- [ ] 테이블 생성 파이프라인 (`handleTablePipeline`) 무영향
- [ ] SRAG per-paper extraction 무영향
- [ ] 엔티티 백필 UI 버튼 동작 (수동 재추출)
- [ ] 자동 재추출 트리거 (임베딩 워커 큐) 정상

---

## 작업 순서 (fixer가 참고)

1. `entity-extractor.mjs` 수정: `persistEntities` 내 `entityChunkMap` 추가 + 관계 루프 폴백 체인 + `CURRENT_ENTITY_EXTRACTION_VERSION = 2`.
2. `graph-search.mjs` 수정: `rrfFusionWithGraph` 추가, `rrfFusionTriple` alias로 축소, 호출부 교체, 주석 정리.
3. `node --check` + `npm run build` 통과 확인.
4. `docs/harness/main/feature-status.md`의 "Graph-Enhanced Search" 항목 설명을 "2-way RRF (base ⊕ graph)"로 정정.
5. (운영 환경에서만) 재추출 완료 후 `psql` 쿼리로 `evidence_chunk_id` 채움 비율 검증.

---

## 가정 사항

- **[가정]** `runMultiQueryRag`의 내부 구조를 리팩토링하지 않고 2-way로 축소하는 전략이 원래 설계 의도의 "3-way"보다 낫다고 판단. 이는 (A) 옵션의 복잡도 대비 (B)의 실용성 근거이며, 사용자가 원 설계 의도 보존을 우선한다면 (A)로 재계획 필요.
- **[가정]** `CURRENT_ENTITY_EXTRACTION_VERSION` 범프로 전체 백필을 트리거해도 사용자 체감 지연이 수용 가능한 수준. 대량 논문(100+) 보유 사용자라면 수동 트리거로 대체.
- **[가정]** `graph_traverse_1hop`의 `WHERE n.chunk_id IS NOT NULL` 필터는 유지가 안전. 수정 후에도 희소한 null 관계는 컨텍스트에서 제외하는 정책.
