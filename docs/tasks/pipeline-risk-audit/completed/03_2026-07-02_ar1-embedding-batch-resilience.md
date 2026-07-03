# Fix A-R1: 청크 임베딩 배치 부분 실패 격리

> 유형: fix | 작성일: 2026-07-02 | 상태: 구현 완료(2026-07-03) | 출처: pipeline-risk-audit A-R1 (P0)

## 문제
청크 임베딩이 배치(8개) 단위 `Promise.all`이라, 청크 1개만 vLLM 오류가 나도 논문 전체 임베딩 job이 실패하고 이미 성공한 배치도 폐기된다 → 멀쩡한 논문이 검색/채팅에 안 잡힘. 같은 파일의 그림 경로(`main.mjs:1439` for + try/catch)는 개별 보호돼 있으니 그 패턴을 따른다.

## 원인 (코드)
- `embedding-worker.mjs:98` — `await Promise.all(promises)`: 배치 내 1개 reject → 전체 reject → `processEmbeddingJob` throw → job failed.
- `main.mjs:1346-1351` — `rows`가 `embeddings[i]`를 무조건 매핑: 실패 청크가 있으면 `JSON.stringify(undefined)`로 깨진 값이 upsert될 위험.

## 수정 방안

### 1. `embedding-worker.mjs` `generateEmbeddings` (82-106)
- `Promise.all` → `Promise.allSettled`.
- fulfilled: `results[i+j] = emb; completed++` (기존 동작).
- rejected: `results[i+j]`는 미할당(undefined 유지) + `console.warn`으로 실패 인덱스·사유 로깅.
- 반환 길이는 여전히 `texts.length`, 실패 슬롯은 undefined.

### 2. `main.mjs` 호출부 (1346~1363)
- `rows` 생성 시 `embeddings[i]`가 undefined/null인 청크는 **제외**(filter) — 성공분만 매핑.
- 실패 청크 수 로깅: `[Embedding] N/M chunks failed embedding, skipped`.
- **부분 실패 정책**: 성공 청크 ≥ 1이면 job=succeeded(부분 성공 허용, 그림 경로와 일관). 성공 청크 = 0(전부 실패)이면 throw로 job=failed → 재큐로 재시도.

## 영향 범위
- 수정 2파일: `embedding-worker.mjs`, `main.mjs`. DB/IPC/컴포넌트 무변경. `CURRENT_EXTRACTION_VERSION` 무관(임베딩 스키마 불변).
- 사이드이펙트: 부분 실패 논문이 "일부 청크만 임베딩된" 상태로 succeeded 될 수 있음(검색 recall 부분 저하 가능) — 전체 실패보다 우월. 재추출/재큐 시 미임베딩 청크가 다시 시도되는지는 아래 [가정] 참조.

## 검증
- `node --check apps/desktop/electron/embedding-worker.mjs` + `main.mjs`.
- 단위 테스트(권장): `generateEmbeddings`에 일부 실패하는 fake 주입 → 성공분만 results에 차고 실패 슬롯 undefined, 함수가 throw 안 함. (테스트 위해 `callVllmSingle` 주입점이 없으면 최소 순수 로직만 검증하거나 스킵 사유 기록)
- 회귀: `node --test tests/*.test.mjs` 통과.

## 가정
- [가정] `chunksToEmbed`(main.mjs, generateEmbeddings 호출 이전)가 "embedding 아직 없는 청크"만 선별한다. 그렇다면 부분 실패 후 재추출/재큐 시 실패했던 청크가 다시 시도된다. → **fixer가 chunksToEmbed 정의를 확인해 이 가정을 검증하고, 아니면 수정 방안에 반영**.

### [가정] 검증 결과 (2026-07-03, fixer) — ✅ 성립
`main.mjs:1272-1280` 확인: `chunk_embeddings`에서 현재 `MODEL_NAME`으로 임베딩된 청크 id를 `existingSet`으로 모은 뒤 `chunksToEmbed = chunks.filter(c => !existingSet.has(c.id))`로 **미임베딩 청크만** 선별한다. 따라서 부분 실패로 성공분만 upsert된 뒤 job이 재큐되면(성공 0일 때) 실패했던 청크만 다시 시도되고, 이미 성공한 청크는 재임베딩되지 않는다. 낭비/중복 없음 → 부분 성공 정책이 안전.

## 구현 결과 (2026-07-03, fixer)
- **embedding-worker.mjs `generateEmbeddings`**(84~118 부근): 배치 `Promise.all` → `Promise.allSettled`. fulfilled → `results[i+j]=value; completed++`, rejected → 슬롯 undefined 유지 + `console.warn`. 반환 길이 `texts.length` 유지. JSDoc에 실패 슬롯 undefined 명시.
- **main.mjs 호출부**(rows 생성부): `chunksToEmbed`를 embedding과 zip → `embedding != null` filter → 성공분만 row 매핑. `failedCount = chunksToEmbed.length - rows.length` 로깅. `rows.length===0`이면 throw(job=failed→재큐), ≥1이면 진행. JOB_COMPLETED의 `embeddedCount`를 `chunksToEmbed.length`→`rows.length`(실제 성공)로 정정.
- **테스트**: `tests/embedding-worker.test.mjs` 신설(3케이스, `globalThis.fetch` stub으로 실제 `generateEmbeddings` 검증).
- **검증**: `node --check` 2파일 통과. `node --test tests/*.test.mjs` 65건/14스위트 전부 통과(회귀 없음).
