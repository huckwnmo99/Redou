# RPC 함수 (PostgreSQL Functions)
> 하네스 버전: v1.3 | 최종 갱신: 2026-04-22

## 개요
Supabase RPC로 호출하는 PostgreSQL 함수. 벡터 검색 4종 + 엔티티 1종, BM25 검색 2종, 그래프 순회 2종, 통계 1종, 즐겨찾기 토글 1종. 모두 `LANGUAGE plpgsql STABLE`.

## 함수 목록

### 1. match_chunks (벡터 검색)
| 항목 | 값 |
|------|------|
| 정의 | `20260327010000_upgrade_embeddings_vl_2048.sql:38` |
| 입력 | `query_embedding vector(2048)`, `match_threshold float=0.35`, `match_count int=20`, `filter_paper_ids uuid[]`, `boost_section_names text[]`, `section_boost float=0.08` |
| 반환 | `chunk_id, paper_id, section_id, section_name, chunk_order, page, text, token_count, similarity` |
| 로직 | cosine similarity (`1 - (embedding <=> query)`) + 섹션 이름 부스트. `filter_paper_ids`로 논문 필터링. |
| 호출처 | main.mjs runMultiQueryRag, 프론트엔드 검색 |

### 2. match_chunks_bm25 (BM25 검색)
| 항목 | 값 |
|------|------|
| 정의 | `20260410020000_fix_bm25_or_tsquery.sql` (원본: `20260408010000_add_bm25_search.sql`) |
| 입력 | `query_text text`, `match_count int=60`, `filter_paper_ids uuid[]` |
| 반환 | `chunk_id, paper_id, section_id, section_name, chunk_order, page, text, token_count, bm25_rank` |
| 로직 | `build_or_tsquery(query_text)` → 단어별 영어 stemming 후 OR 결합 → `paper_chunks.fts @@ tsq`, `ts_rank_cd` 순위. |
| 호출처 | main.mjs runMultiQueryRag |

### 3. match_papers (논문 벡터 검색)
| 항목 | 값 |
|------|------|
| 정의 | `20260327010000_upgrade_embeddings_vl_2048.sql:136` |
| 입력 | `query_embedding vector(2048)`, `match_threshold float=0.35`, `match_count int=20`, `filter_paper_ids uuid[]` |
| 반환 | `paper_id, title, authors, publication_year, abstract, journal_name, doi, similarity` |
| 로직 | papers.embedding cosine similarity. trashed_at IS NULL 필터. |
| 호출처 | 프론트엔드 검색 |

### 4. match_figures (Figure 벡터 검색)
| 항목 | 값 |
|------|------|
| 정의 | `20260327010000_upgrade_embeddings_vl_2048.sql:179` |
| 입력 | `query_embedding vector(2048)`, `match_threshold float=0.3`, `match_count int=20`, `filter_item_types text[]=['figure','table','equation']`, `filter_paper_ids uuid[]` |
| 반환 | `figure_id, paper_id, figure_no, caption, item_type, summary_text, page, similarity` |
| 로직 | figures.embedding cosine similarity. item_type 필터. |
| 호출처 | main.mjs runMultiQueryRag, 프론트엔드 검색 |

### 5. match_figures_bm25 (Figure BM25 검색)
| 항목 | 값 |
|------|------|
| 정의 | `20260410020000_fix_bm25_or_tsquery.sql` (원본: `20260409010000_add_figures_bm25_search.sql`) |
| 입력 | `query_text text`, `match_count int=30`, `filter_item_types text[]=['table']`, `filter_paper_ids uuid[]` |
| 반환 | `figure_id, paper_id, figure_no, caption, item_type, summary_text, page, bm25_rank` |
| 로직 | `build_or_tsquery(query_text)` → 단어별 영어 stemming 후 OR 결합 → `figures.fts @@ tsq`, plain_text + caption 기반. |
| 호출처 | main.mjs runMultiQueryRag (table 모드만) |

### 6. match_highlight_embeddings (하이라이트 벡터 검색)
| 항목 | 값 |
|------|------|
| 정의 | `20260327010000_upgrade_embeddings_vl_2048.sql:96` |
| 입력 | `query_embedding vector(2048)`, `filter_preset_ids uuid[]`, `filter_paper_ids uuid[]`, `match_threshold float=0.35`, `match_count int=20` |
| 반환 | `id, highlight_id, preset_id, paper_id, text_content, note_text, similarity` |
| 호출처 | 프론트엔드 검색 |

### 7. toggle_paper_star
| 항목 | 값 |
|------|------|
| 정의 | `20260321020000_add_toggle_star_rpc.sql:2` |
| 입력 | `paper_id uuid` |
| 로직 | papers.is_important 토글 |
| 호출처 | 프론트엔드 |

### 8. match_entities (엔티티 벡터 검색)
| 항목 | 값 |
|------|------|
| 정의 | `20260423010000_add_entity_graph.sql` |
| 입력 | `query_embedding vector(2048)`, `match_threshold float=0.35`, `match_count int=20`, `filter_paper_ids uuid[]`, `filter_types text[]` |
| 반환 | `entity_id, paper_id, chunk_id, entity_type, canonical_name, value, unit, confidence, confidence_tag, similarity` |
| 로직 | entities.embedding cosine similarity. entity_type으로 필터 가능 (substance/method/condition/metric/phenomenon/concept). |
| 호출처 | graph-search.mjs `matchQueryEntitiesToGraph` (exact 매칭 실패 시 시맨틱 fallback, threshold 0.50) |

### 9. resolve_same_as (동의어 재귀 확장)
| 항목 | 값 |
|------|------|
| 정의 | `20260423010000_add_entity_graph.sql` |
| 입력 | `seed_entity_ids uuid[]` |
| 반환 | `uuid[]` (union된 entity id 집합) |
| 로직 | `WITH RECURSIVE`로 `same_as` 관계를 양방향 traverse → 모든 동의어 엔티티 id union. |
| 호출처 | graph-search.mjs `runGraphEnhancedRag` (seed 확장 단계) |

### 10. graph_traverse_1hop (1-hop 이웃 순회)
| 항목 | 값 |
|------|------|
| 정의 | `20260423010000_add_entity_graph.sql` |
| 입력 | `seed_entity_ids uuid[]`, `max_results int=50` |
| 반환 | `chunk_id, paper_id, neighbor_entity_id, neighbor_canonical_name, relation_type, direction, hop` |
| 로직 | `entity_relations`에서 source/target 양방향 순회 (same_as 제외) → `evidence_chunk_id` 수집. 필터 없음 (전체 그래프). |
| 호출처 | graph-search.mjs `runGraphEnhancedRag` (chunk ids 수집 단계) |

### 11. god_nodes (중심 엔티티)
| 항목 | 값 |
|------|------|
| 정의 | `20260423010000_add_entity_graph.sql` |
| 입력 | `min_paper_count int=3`, `max_results int=20` |
| 반환 | `entity_id, canonical_name, entity_type, paper_count, relation_count` |
| 로직 | 여러 논문에 등장한 엔티티를 paper_count, relation_count 내림차순으로 top-N. |
| 호출처 | (미사용; 향후 엔티티 대시보드용) |

## BM25 설정
- `paper_chunks.fts`: `to_tsvector('english', coalesce(text, ''))` GENERATED STORED
- `figures.fts`: `to_tsvector('english', coalesce(plain_text, '') || ' ' || coalesce(caption, ''))` GENERATED STORED
- 인덱스: GIN (`idx_paper_chunks_fts`, `idx_figures_fts`)
- 쿼리: `build_or_tsquery(text)` → 단어별 영어 stemming 후 OR(`|`) 결합. `ts_rank_cd`가 매칭 단어 수에 비례하여 점수 부여.
- Helper 함수: `build_or_tsquery(input_text text)` — `ts_debug('english', ...)` 로 lexeme 추출 → DISTINCT → OR 결합 → `to_tsquery('english', ...)`
- 변경 이력: 원래 `websearch_to_tsquery` (AND 연산) 사용 → 5+ 단어 쿼리에서 0건 반환 이슈 → OR 기반으로 변경 (`20260410020000_fix_bm25_or_tsquery.sql`)

## 의존성
- 사용: pgvector (cosine distance `<=>`), tsvector/GIN
- 사용됨: main.mjs (RAG 파이프라인), 프론트엔드 (supabasePaperRepository)
