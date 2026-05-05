# Supplementary File Import and Source Attribution Plan

Date: 2026-05-04
Status: Planned
Owner: Codex

## Product Goal

Allow a user to attach supplementary material to an existing paper, process it through the same local extraction/RAG pipeline, and make LLM answers clearly show when evidence came from supplementary data.

The body citation should continue to use the paper reference number, for example `[3]`. The sources section should add a supplementary label when the cited evidence came from a supplementary file:

```text
[3] Example Paper Title (Kim, 2024) - Supplementary: Supplementary Methods.docx, p.2
```

If the same paper answer uses both the main PDF and supplementary files, the source line should keep one paper reference and list both evidence locations:

```text
[3] Example Paper Title (Kim, 2024) - Main PDF p.4; Supplementary: Table S1.pdf, p.6
```

## Non Goals

- Do not merge supplementary PDFs into the main PDF.
- Do not overwrite main-paper extraction output when a supplementary file is processed.
- Do not make Office conversion the first implementation dependency.
- Do not add broad file-type support before PDF supplementary ingestion is stable.
- Do not change the existing paper-level citation number semantics in answer bodies.

## Current Code Constraints

- `paper_files.file_kind` already includes `supplementary_pdf`.
- `figures.source_file_id` already exists.
- `paper_sections` and `paper_chunks` do not currently have `source_file_id`.
- `processing_jobs` has `source_path`, but no `source_file_id` or structured payload.
- `job_type` does not currently include a supplementary-specific processing job.
- `persistV2Results()` currently deletes `paper_chunks`, `figures`, and `paper_sections` by `paper_id`. This is the main blocker because supplementary processing could wipe main-PDF extraction results.
- `formatSourceAttribution()` currently receives paper metadata only, so it cannot label a cited source as main PDF vs supplementary.
- `assembleRagContext()` currently labels retrieved content mostly by paper reference number, not by source file.

## Implementation Order

### Goal 1: Add Source Ownership to Extracted Records

Purpose: make every extracted section/chunk/table/figure traceable to the source file that produced it.

Changes:

- Add `source_file_id uuid references paper_files(id) on delete set null` to `paper_sections`.
- Add `source_file_id uuid references paper_files(id) on delete set null` to `paper_chunks`.
- Add indexes for `(paper_id, source_file_id, section_order)` and `(paper_id, source_file_id, chunk_order)`.
- Backfill existing sections/chunks to the primary `paper_files.id` where possible.
- Keep `figures.source_file_id` as the existing figure/table/equation source field.

Validation:

- Existing papers still load.
- Existing chunks still participate in search/RAG.
- Backfilled rows point to each paper's primary file.

### Goal 2: Make Extraction Persistence Source Scoped

Purpose: allow main PDF and supplementary files to be reprocessed independently.

Changes:

- Update `persistV2Results()` to delete old sections/chunks/figures only for the current `source_file_id`.
- Insert `source_file_id` into `paper_sections` and `paper_chunks`.
- Keep `figures.source_file_id` insertion.
- For primary main-PDF jobs, keep current metadata and summary refresh behavior.
- For supplementary jobs, do not overwrite paper title, abstract, authors, DOI, publication year, or current system summary.
- Make `figure_chunk_links` source-aware by linking figures only to chunks from the same processed file.

Validation:

- Reprocessing the main PDF replaces only main-PDF extraction rows.
- Processing a supplementary PDF adds new rows without deleting main-PDF rows.
- Table/figure links point to chunks from the same source file.

### Goal 3: Add Supplementary PDF Import

Purpose: support the first stable version without document conversion risk.

Changes:

- Add an Electron IPC action to import a supplementary PDF for an existing paper.
- Copy the PDF into the Redou library under a supplementary-specific folder.
- Insert a `paper_files` row:
  - `file_kind = 'supplementary_pdf'`
  - `is_primary = false`
  - `paper_id = selected paper`
- Add `processing_jobs.source_file_id`.
- Add `process_supplementary` to `job_type`, or add an equivalent source-aware job type.
- Queue supplementary processing using the copied PDF path and `source_file_id`.

Validation:

- Main paper remains readable.
- Supplementary PDF appears under the target paper.
- Supplementary extraction produces chunks/tables/figures with the supplementary file id.

### Goal 4: Include Supplementary Evidence in RAG and Source Labels

Purpose: make QA/table answers use supplementary data and label it clearly.

Changes:

- Ensure chunk and figure retrieval returns `source_file_id`.
- Load source file metadata for retrieved chunks/figures:
  - `paper_files.file_kind`
  - `paper_files.original_filename`
  - `paper_files.stored_filename`
- Update `assembleRagContext()` labels:

```text
[Chunk 4, [3], Supplementary: Supplementary Methods.docx, p.2]
...
[Table S1, [3], Supplementary: Table S1.pdf, p.6]
```

- Update the Q&A prompt rule:
  - body citations remain `[3]`
  - source list should mark supplementary evidence after the paper title
- Extend `formatSourceAttribution()` to accept source evidence metadata, not just paper metadata.
- Aggregate source labels per cited paper.

Target source output:

```text
---
Sources:
[3] Example Paper Title (Kim, 2024) - Supplementary: Supplementary Methods.docx, p.2
```

Validation:

- If only main PDF evidence is used, source output stays normal.
- If supplementary evidence is used, source output includes `Supplementary: ...`.
- If both main and supplementary evidence are used for the same paper, one `[N]` source line lists both.

### Goal 5: Add Paper Detail UI for Supplementary Files

Purpose: make supplementary files visible and controllable from the paper workspace.

Changes:

- Add a supplementary section or tab in `PaperDetailView`.
- Show attached supplementary files, processing status, file size, and original filename.
- Add an `Add Supplementary` action.
- Allow opening the supplementary PDF in the reader or system viewer.
- Keep the existing main PDF tab behavior unchanged for the first pass.

Validation:

- User can attach a supplementary PDF from an existing paper.
- User can distinguish main PDF from supplementary files.
- Supplementary processing status is visible.

### Goal 6: Add DOC/DOCX to PDF Conversion

Purpose: support the user's intended workflow of dropping document files that are converted to PDF before extraction.

Changes:

- Add a controlled Electron-side conversion step for `.docx` and optionally `.doc`.
- Prefer LibreOffice headless on Windows:

```text
soffice --headless --convert-to pdf --outdir <target-dir> <source-file>
```

- Detect converter availability and return a clear error when it is missing.
- Store the converted PDF as the `paper_files` supplementary entry.
- Preserve original filename in metadata and source labels.
- Consider adding conversion metadata to `paper_files`, for example:
  - `converted_from_filename`
  - `conversion_status`
  - `conversion_tool`
  - `conversion_error`

Validation:

- DOCX converts to PDF and then follows the same supplementary PDF pipeline.
- Failed conversion does not create a half-processed supplementary file.
- The source label uses the original user-facing filename where possible.

### Goal 7: Optional Later Support for Spreadsheets and Slide Decks

Purpose: avoid pretending all document types behave like papers.

Notes:

- `.xlsx` and `.csv` may be better parsed directly for tables instead of PDF conversion.
- `.pptx` can be converted to PDF, but slide order and captions may not map cleanly to paper evidence.
- These formats should come after DOCX and supplementary PDF support are stable.

## Small-Slice Development Plan

1. Migration only: add source fields and backfill. Done in `20260504010000_add_supplementary_source_tracking.sql`.
2. Persistence only: make `persistV2Results()` source scoped. Done in the first prerequisite slice.
3. Supplementary PDF attach: add paper-detail attach flow, source file list, and job status without changing the reader to open supplementary PDFs.
4. Retrieval labels: add source metadata to RAG RPCs, context labels, final QA source attribution, table references, and CSV export.
5. Conversion only: add DOCX/DOC to PDF conversion via Electron after supplementary PDF attach is stable.
6. Validation pass: run syntax/build checks and one manual Electron flow per slice.

## Next Execution Plan

This section reflects the 2026-05-04 parallel subagent planning pass.

### Slice A: Supplementary PDF Attach

Purpose: let the user attach a supplementary PDF to an existing paper and queue it through the already source-scoped extraction pipeline.

Keep out of scope:

- Do not render/highlight supplementary PDFs in `PdfReaderWorkspace` yet.
- Do not add DOCX conversion yet.
- Do not change RAG source labels yet.
- Do not add a new `job_type`; keep using `import_pdf` with `processing_jobs.source_file_id`.

Minimal flow:

1. User opens a paper detail view.
2. PDF tab shows the primary source PDF plus a `Supplementary PDFs` list.
3. User clicks `Attach supplementary PDF`.
4. Frontend opens the existing desktop file picker in single-select PDF mode.
5. Electron copies the selected PDF with the existing library import path.
6. Repository inserts `paper_files`:
   - `file_kind = 'supplementary_pdf'`
   - `is_primary = false`
7. Repository inserts `processing_jobs`:
   - `job_type = 'import_pdf'`
   - `source_file_id = new paper_files.id`
   - `source_path = copied PDF path`
8. Worker processes the file by `source_file_id` and leaves the main PDF rows intact.

Files likely touched:

- `frontend/src/types/desktop.ts`
- `apps/desktop/electron/preload.mjs`
- `apps/desktop/electron/main.mjs`
- `frontend/src/types/paper.ts`
- `frontend/src/lib/desktop.ts`
- `frontend/src/lib/supabasePaperRepository.ts`
- `frontend/src/lib/queries.ts`
- `frontend/src/features/paper/PaperDetailView.tsx`

Important detail:

- Main PDF reader readiness must be tied to the primary source's import job, not the latest paper-level import job. Otherwise, a supplementary job can make the main reader look unavailable while the primary PDF is already ready.

Validation:

- Attach a supplementary PDF from an existing paper.
- Confirm `paper_files.file_kind = 'supplementary_pdf'` and `is_primary = false`.
- Confirm `processing_jobs.source_file_id` equals the supplementary file id.
- Confirm the main PDF reader stays available while supplementary processing is queued/running/failed.
- Confirm supplementary sections/chunks/figures use the supplementary `source_file_id`.
- Confirm main source rows are not deleted.

### Slice B: RAG and Source Attribution Labels

Purpose: keep body citations as paper references like `[3]`, but make final source lines identify supplementary evidence.

Keep out of scope:

- Do not attach new files in this slice.
- Do not add DOCX conversion in this slice.
- Do not attempt exact per-claim provenance beyond retrieved evidence locations.

Minimal DB/RPC work:

- Add a migration such as `20260504020000_add_rag_source_file_metadata.sql`.
- Drop and recreate these RPCs because their `RETURNS TABLE` shape changes:
  - `match_chunks`
  - `match_chunks_bm25`
  - `match_figures`
  - `match_figures_bm25`
- Add return columns:
  - `source_file_id uuid`
  - `source_file_kind text`
  - `source_filename text`
- Join through `paper_files` using `paper_chunks.source_file_id` or `figures.source_file_id`.

Minimal Electron/RAG work:

- Preserve source fields in `runMultiQueryRag()`.
- Add evidence formatting helpers:
  - `formatEvidenceLocation(item)`
  - `buildEvidenceLocationsByPaper(chunks, figures, paperRefMap)`
  - `dedupeEvidenceLocations(locations)`
- Update `assembleRagContext()` and `assemblePerPaperContext()` labels:

```text
[Chunk 4, [3], Supplementary: Table S1.pdf, p.6]
[Table S1, [3], Main PDF p.4]
```

- Update `formatSourceAttribution()` to generate canonical final source lines from evidence metadata.

Target output:

```text
[3] Example Paper (Kim, 2024) - Supplementary: Supplementary Methods.docx, p.2
[3] Example Paper (Kim, 2024) - Main PDF p.4; Supplementary: Table S1.pdf, p.6
```

Table/CSV follow-up inside this slice:

- Enrich `chat_generated_tables.source_refs` with evidence locations.
- Render supplementary labels in `ChatTableReport.tsx`.
- Add an optional evidence column to CSV export references.

Validation:

- RPC smoke checks show the new source metadata columns.
- QA body still uses `[N]`.
- Final Sources includes `Supplementary: <filename>, p.X` when supplementary evidence is retrieved.
- Generated table references display the same evidence labels.
- CSV export preserves evidence labels.

### Slice C: DOCX/DOC to PDF Conversion

Purpose: support document supplementary files by converting them to PDF, then reusing Slice A.

Start only after:

- Supplementary PDF attach is stable.
- Failed attach cleanup is reliable.
- RAG label work preserves `paper_files.original_filename`.

Implementation direction:

- Use LibreOffice headless from Electron only.
- Detection order:
  - `REDOU_SOFFICE_PATH`
  - `soffice.exe` / `soffice` on `PATH`
  - `%ProgramFiles%\LibreOffice\program\soffice.exe`
  - `%ProgramFiles(x86)%\LibreOffice\program\soffice.exe`
- Verify with `soffice --version` using `spawn`, not shell strings.
- Convert in a temporary directory:

```text
soffice --headless --convert-to pdf --outdir <tmp> <source>
```

- Validate output exists, is non-empty, and has a PDF header.
- Store the converted PDF as the `paper_files` supplementary file.
- Preserve the original `.docx` / `.doc` filename in `paper_files.original_filename`.

Keep out of scope:

- Do not store original Office documents permanently yet.
- Do not add new `file_kind` values such as `supplementary_docx`.
- Do not use Microsoft Word automation, print drivers, UI automation, or online converters.
- Do not support `.pptx`, `.xlsx`, `.csv`, `.odt`, or zip bundles in this slice.
- Do not parse DOCX text directly into chunks; extraction still starts from converted PDF.

## Critical Risks

1. Highest: supplementary processing can delete main-PDF extraction rows unless source-scoped persistence lands first.
2. High: final source labels cannot mention supplementary unless RAG results carry source file metadata.
3. Medium: DOCX conversion depends on an installed converter, so the app needs a clear missing-converter path.
4. Medium: table generation may need source labels for figures/tables as well as text chunks.
5. Low: UI can be added after backend support; it should not drive the data model.

## Acceptance Criteria

- A supplementary PDF can be attached to an existing paper.
- Main PDF extraction results survive supplementary processing.
- Supplementary chunks/tables/figures are searchable and available to QA/table RAG.
- LLM body citations still use `[N]`.
- Source lines show `Supplementary: <filename>, p.<page>` when supplementary evidence is used.
- DOCX conversion can be added after the PDF supplementary path is stable.
