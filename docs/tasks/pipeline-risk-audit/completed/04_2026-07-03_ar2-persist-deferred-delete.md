# Fix A-R2: 재추출 delete→insert 비트랜잭션 → 지연 삭제로 부분상태 방지

> 유형: fix | 작성일: 2026-07-03 | 완료: 2026-07-03 | 출처: pipeline-risk-audit A-R2 (P0) | 방향 ①(순서 재배치, DB 무변경)

## 문제
`persistV2Results`가 함수 진입 즉시 기존 `paper_chunks`/`figures`/`paper_sections`를 delete한 뒤 순차 insert. 중간 insert가 throw하면 기존 데이터는 이미 지워졌고 새 데이터는 미완성 → 논문이 "빈껍데기"로 남음(재큐로만 복구, 그 사이 검색·채팅은 빈 데이터).

## 수정 방안 (방향 ①: old-id 지연 삭제) — 실행 결과
1. **함수 시작에서 3개 delete 제거 + old id만 조회 보관** (`main.mjs:600-608`):
   - `oldSectionIds`/`oldChunkIds`/`oldFigureIds` = `select id from … where paper_id=? and source_file_id=?`.
2. **새 데이터 insert는 기존 순서 그대로 전부 수행.** 새 행은 새 id로 들어가 old 행과 잠시 공존.
3. **모든 insert·링크 생성이 성공한 뒤**(References 블록 다음, extraction_version 범프 직전), 보관한 old id만 삭제 (`main.mjs:827-845`): `delete … .in("id", oldIds)`, 빈 배열이면 스킵.

## 수정 내역 (파일:줄 · 무엇을) — `main.mjs` 1파일만
| 위치 | 변경 |
|------|------|
| `main.mjs:592-608` | 맨 앞 3개 delete 제거 → old id 조회·보관(`oldSectionIds`/`oldChunkIds`/`oldFigureIds`)으로 교체. 의도 주석 추가. |
| `main.mjs:728-770` | tables/equations insert에 `.select("id, page, item_type")` 추가 → 새로 insert된 행만 `insertedFigureItems`에 수집. |
| `main.mjs:772-803` | `figure_chunk_links` 소스를 "DB 재조회(`.in("item_type",…)`)" → "방금 insert한 `insertedFigureItems`"로 교체. 지연 삭제로 old figure가 아직 존재하므로 재조회는 old+new를 섞어 old id로 링크를 만들 위험이 있어 필수. `fig.id`/`fig.page` 접근·링크 로직·동작은 동일. |
| `main.mjs:827-845` | old-id 지연 삭제 블록 신설(chunks→figures→sections, 빈 배열 스킵, 삭제 오류는 throw). |

`CURRENT_EXTRACTION_VERSION`·마이그레이션·IPC·그 외 코드/포맷 무변경.

## fixer 필수 확인 결과
- **(a) 새 insert가 old 행에 의존하지 않는가 — 성립.** `sectionIdByOrder`(`main.mjs:630-632`)는 **새로 insert된 section의 select 반환값**만 담고, chunk insert가 이걸 `section_id`로 사용(`main.mjs:644`) → 새 chunk는 새 section만 참조. old section id는 map에 절대 들어가지 않으므로 old+new section의 `section_order` 중복도 무해. `chunkIdByOrder`(`main.mjs:657-658`)도 새 chunk id만 담아 링크에 사용.
- **(b) `figure_chunk_links`가 새 chunk/figure id로 생성되는가 — 성립(단, 코드 변경 필요했음).** 기존은 insert 후 `figures`를 `.in("item_type",["table","equation"])`로 **재조회**해 링크를 만들었는데, 지연 삭제에서는 old figure가 아직 남아 이 재조회가 old+new를 함께 반환 → old id로 링크가 생겨 곧 삭제될 수 있었다. 그래서 tables/equations insert에 `.select`를 붙여 **새 행만** 링크 대상으로 쓰도록 교체했다.
- **(c) old-id delete 지점 — 모든 insert·링크·references insert 성공 이후, 버전 범프 직전** (`main.mjs:827`). `figure_chunk_links` insert는 원래부터 non-fatal(`console.warn`, throw 안 함)이라 링크 실패가 old 삭제를 막지는 않지만, 그 외 모든 fatal insert(sections/chunks/tables/equations/references) 뒤에 위치.
- **(d) FK 역순 삭제 필요 여부 — 불필요.** 아래 CASCADE로 old 자식(embeddings/links)이 부모(chunks/figures) 삭제 시 자동 정리. 삭제 순서(chunks→figures→sections)는 서로 독립이라 무관.

## [가정] 검증 결과 (CASCADE — `supabase/migrations/20260309050635_initial_schema.sql`)
계획서 [가정]: "`figure_chunk_links`·`chunk_embeddings`는 chunks/figures에 FK ON DELETE CASCADE로 매달려 있어, old만 지우면 관련 old 링크/임베딩도 정리된다." → **성립 확인.**
- `chunk_embeddings.chunk_id → paper_chunks(id) ON DELETE CASCADE` (initial_schema.sql:124). old chunk 삭제 시 old chunk 임베딩 자동 삭제.
- `figure_chunk_links.figure_id → figures(id) ON DELETE CASCADE` (initial_schema.sql:176), `figure_chunk_links.chunk_id → paper_chunks(id) ON DELETE CASCADE` (initial_schema.sql:177). old chunk/figure 삭제 시 old 링크 자동 삭제.
- **figure 임베딩은 별도 테이블이 아니라 `figures.embedding` 컬럼**(마이그레이션의 `UPDATE figures SET embedding …`). 따라서 old figure row 삭제 시 그 임베딩도 함께 사라진다(CASCADE 불필요).
- `paper_chunks.section_id → paper_sections(id) ON DELETE SET NULL` (initial_schema.sql:106). **새 chunk는 새 section을 참조**하므로 old section 삭제는 새 chunk에 영향 없음(SET NULL 대상 아님).
- `figures.source_file_id → paper_files(id) ON DELETE SET NULL` — 이번 삭제와 무관(paper_files는 안 건드림).

## 한계 (명시)
부분상태(빈껍데기) 위험 제거. 단 **완전 원자성은 아님** — 모든 insert 성공 후 old delete 3건 도중 사고 시 old+new가 잠깐 중복 잔존(재추출로 정리, 빈껍데기보다 안전). 완전 원자성은 향후 방향 ②(Postgres RPC 트랜잭션)로 승격 가능. 이 slice는 ①만.

## 검증 결과
- `node --check apps/desktop/electron/main.mjs` → **통과** (SYNTAX_OK).
- `node --test apps/desktop/tests/*.test.mjs` → **65/65 pass, 0 fail** (회귀 통과).

### 단위 테스트 미추가 사유
`persistV2Results`는 (1) `main.mjs`에서 **export되지 않고** 내부에서만 호출되며, (2) 모듈 상단 `supabase` 싱글턴에 직접 결합돼 의존성 주입 지점이 없다. 단위 테스트를 붙이려면 함수 추출·export + supabase 클라이언트 주입 리팩터가 필요한데, 이는 "1파일 `persistV2Results` 범위·동작 무변경" 제약을 벗어난다(감사 A-M2가 이 테스트 공백을 별도 항목으로 이미 분리). 따라서 수동 검증 절차로 대체한다.

### 수동 검증 절차 (지연 삭제 정상 동작 확인)
1. 이미 1회 추출 완료된 논문 준비(기존 chunks/figures/sections·임베딩 존재).
2. **부분상태 방지 확인**: `persistV2Results`의 figures insert(`main.mjs:689` 부근) 또는 tables insert(`732`) 직전에 임시로 `throw new Error("inject")`를 주입하고 재추출 → 함수는 throw하지만 **기존 chunks/sections/figures가 그대로 보존**되는지 DB로 확인(예전 코드라면 맨 앞 delete로 이미 사라졌어야 함). 확인 후 주입 제거.
3. **정상 스왑 확인**: 주입 없이 재추출 → 완료 후 해당 `paper_id + source_file_id`의 `paper_chunks`/`figures`/`paper_sections`가 **새 행만 1세트** 남는지(old 미잔존) + `chunk_embeddings`/`figure_chunk_links`에 dangling(사라진 부모 참조) 없는지 확인.
   - psql 예: `select count(*) from paper_chunks where paper_id='…' and source_file_id='…';` 가 새 청크 수와 일치.

## 후속
- `/test`로 재검증 후 `/review`로 PR. (현재 브랜치 `chore/workflow-codex-removal`에 미커밋 — 지시대로 새 브랜치·커밋 안 만듦.)
- 완전 원자성이 필요하면 방향 ②(RPC 트랜잭션) 별도 slice 승격.
