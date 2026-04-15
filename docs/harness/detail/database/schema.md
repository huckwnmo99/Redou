# 데이터베이스 스키마
> 하네스 버전: v1.0 | 최종 갱신: 2026-04-10

## 개요
로컬 Supabase(PostgreSQL + pgvector, port 55321)에 20개 마이그레이션으로 구성된 스키마. 핵심 테이블 24개, RPC 함수 8개.

## 마이그레이션 히스토리 (20개)
| # | 파일 | 설명 |
|---|------|------|
| 1 | `20260309050635_initial_schema.sql` | 초기 19개 테이블 + enum |
| 2 | `20260311010000_add_embedding_search.sql` | match_chunks RPC |
| 3 | `20260312010000_add_figure_item_type.sql` | figures.item_type 추가 |
| 4 | `20260312020000_add_extraction_version.sql` | papers.extraction_version |
| 5 | `20260321010000_fix_trashed_by_fk.sql` | FK 수정 |
| 6 | `20260321020000_add_toggle_star_rpc.sql` | toggle_paper_star RPC |
| 7 | `20260321030000_add_performance_indexes.sql` | 성능 인덱스 |
| 8 | `20260321040000_enable_rls_all_tables.sql` | RLS 전체 활성화 |
| 9 | `20260321050000_add_highlight_embeddings.sql` | highlight_embeddings 테이블 |
| 10 | `20260324010000_add_authors_column.sql` | papers.authors JSONB |
| 11 | `20260325010000_pipeline_v2_schema.sql` | V2 스키마 (paper_references 등) |
| 12 | `20260325020000_match_chunks_section_boost.sql` | 섹션 부스트 검색 |
| 13 | `20260326010000_upgrade_embeddings_1024.sql` | 1024-dim 업그레이드 |
| 14 | `20260327010000_upgrade_embeddings_vl_2048.sql` | 2048-dim 업그레이드 (현재) |
| 15 | `20260328010000_add_chat_tables.sql` | 채팅 테이블 3개 |
| 16 | `20260406010000_add_conversation_type.sql` | conversation_type 컬럼 |
| 17 | `20260407010000_add_llm_model_preference.sql` | llm_model 컬럼 |
| 18 | `20260408010000_add_bm25_search.sql` | paper_chunks BM25 (fts, GIN) |
| 19 | `20260409010000_add_figures_bm25_search.sql` | figures BM25 (fts, GIN) |
| 20 | `20260410012147_add_chat_generated_tables_metadata.sql` | SRAG metadata JSONB |

## 핵심 테이블

### 논문 관련
| 테이블 | PK | 주요 컬럼 | 비고 |
|--------|------|-----------|------|
| `app_users` | uuid | display_name, email, role | 사용자 |
| `papers` | uuid | title, normalized_title, authors(jsonb), publication_year, doi, abstract, reading_status, extraction_version, embedding(vector 2048) | 논문 메타 |
| `paper_files` | uuid | paper_id(FK), file_kind, stored_path, checksum_sha256, file_size_bytes | PDF 파일 |
| `paper_sections` | uuid | paper_id(FK), section_name, section_order, page_start/end, raw_text | 섹션 |
| `paper_chunks` | uuid | paper_id(FK), section_id(FK), chunk_order, page, text, token_count, fts(tsvector) | 청크 |
| `chunk_embeddings` | chunk_id(FK) | embedding(vector 2048), embedding_model, embedding_dim | 청크 임베딩 |
| `paper_summaries` | uuid | paper_id(FK), one_line_summary, objective, method_summary, main_results, limitations | 자동 요약 |
| `paper_references` | uuid | paper_id(FK), title, authors, year, doi, matched_paper_id | 참고문헌 |

### Figure/Table/Equation
| 테이블 | PK | 주요 컬럼 | 비고 |
|--------|------|-----------|------|
| `figures` | uuid | paper_id(FK), figure_no, caption, item_type, image_path, summary_text, plain_text, embedding(vector 2048), fts(tsvector) | item_type: figure/table/equation |
| `figure_chunk_links` | (figure_id, chunk_id) | link_type | Figure-Chunk 연결 |

### 분류/태그
| 테이블 | PK | 주요 컬럼 | 비고 |
|--------|------|-----------|------|
| `folders` | uuid | owner_user_id(FK), parent_folder_id(FK), name, sort_order | 트리 구조 |
| `paper_folders` | (paper_id, folder_id) | assigned_by_user_id | N:M |
| `tags` | uuid | name, slug, tag_type | 태그 |
| `paper_tags` | (paper_id, tag_id) | assigned_by_user_id | N:M |

### 하이라이트/노트
| 테이블 | PK | 주요 컬럼 | 비고 |
|--------|------|-----------|------|
| `highlight_presets` | uuid | name, color_hex, is_system_default | 색상 프리셋 |
| `highlights` | uuid | paper_id(FK), preset_id(FK), page, selected_text, start_anchor(jsonb), end_anchor(jsonb) | PDF 하이라이트 |
| `highlight_embeddings` | uuid | highlight_id(FK), embedding(vector 2048) | 하이라이트 임베딩 |
| `notes` | uuid | paper_id(FK), note_scope, note_type, title, note_text, is_pinned | 연구 노트 |

### 채팅
| 테이블 | PK | 주요 컬럼 | 비고 |
|--------|------|-----------|------|
| `chat_conversations` | uuid | owner_user_id, title, phase, scope_folder_id, scope_all, conversation_type | table/qa |
| `chat_messages` | uuid | conversation_id(FK), role, content, message_type, metadata(jsonb) | user/assistant |
| `chat_generated_tables` | uuid | message_id(FK), conversation_id(FK), table_title, headers(jsonb), rows(jsonb), source_refs(jsonb), verification(jsonb), metadata(jsonb) | SRAG 메타 포함 |

### 시스템
| 테이블 | PK | 주요 컬럼 | 비고 |
|--------|------|-----------|------|
| `processing_jobs` | uuid | paper_id(FK), job_type, status, source_path, error_message | 작업 큐 |
| `backup_snapshots` | uuid | backup_path, backup_kind, status | 백업 |
| `user_workspace_preferences` | user_id(FK) | layout_*, llm_model | 사용자 설정 |

## Enum 타입
| 이름 | 값 |
|------|------|
| `reading_status` | unread, reading, read, archived |
| `file_kind` | main_pdf, supplementary_pdf, figure_asset |
| `note_scope` | paper, section, chunk, figure, highlight |
| `note_type` | summary_note, relevance_note, presentation_note, result_note, followup_note, figure_note, question_note, custom |
| `job_type` | import_pdf, run_ocr, extract_metadata, parse_sections, extract_figures, generate_embeddings, generate_summary, create_backup |
| `job_status` | queued, running, succeeded, failed |
| `backup_status` | created, failed, imported |

## 주요 인덱스
- `idx_paper_chunks_fts` (GIN, BM25 검색용)
- `idx_figures_fts` (GIN, BM25 검색용)
- `idx_papers_norm_title` (중복 감지용)
- `idx_papers_doi` (DOI 검색)
- vector(2048) 인덱스 없음 (HNSW 2000 제한, exact search 사용)

## 의존성
- Extensions: pgcrypto, vector
- 사용됨: Electron main process (service_role), 프론트엔드 (anon key + RLS)
