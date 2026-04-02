# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Redou is a research paper reading & management desktop app. Electron hosts a React frontend that talks to a local Supabase instance (Docker). Papers are imported as PDFs, automatically processed (text extraction, figure/table/equation detection, embeddings), and presented with a built-in PDF reader, note-taking, and semantic search.

## Commands

### Frontend (from `frontend/`)
```bash
npm run dev          # Vite dev server (HMR)
npm run build        # tsc -b && vite build
npm run lint         # eslint
npm run test         # vitest
npm run test:ui      # vitest --ui
```

### Desktop / Electron (from `apps/desktop/`)
```bash
npm run start:electron   # electron electron/main.mjs
npm run dev              # vite (renderer dev server)
npm run build            # tsc --noEmit && vite build
```

### Supabase
```bash
# DB access (local Docker)
docker exec supabase_db_Supabase_Redou psql -U postgres
# Migrations live in supabase/migrations/
```

### Syntax-check Electron modules (no ESM import issues)
```bash
node --check apps/desktop/electron/main.mjs
node --check apps/desktop/electron/pdf-heuristics.mjs
node --check apps/desktop/electron/ocr-extraction.mjs
```

## Architecture

### Monorepo layout
```
frontend/          → React + Vite + TailwindCSS v4 + TanStack Query + Zustand
apps/desktop/      → Electron 35 main process (ESM .mjs files)
apps/ocr-server/   → OCR microservice
supabase/          → Local Supabase config, migrations, seed
```

### Electron main process (`apps/desktop/electron/`)
- **main.mjs** — App lifecycle, IPC handlers, PDF import pipeline orchestration, extraction versioning (`CURRENT_EXTRACTION_VERSION`). Coordinates heuristic extraction → OCR enrichment → embedding generation.
- **pdf-heuristics.mjs** — Pure-JS PDF analysis: figure/table/equation detection via pdfjs operator lists, caption parsing, page cropping, section heading extraction. Two strategies: `extractViaPageCrop` (primary) and `extractViaJpegScan` (fallback for embedded JPEGs).
- **ocr-extraction.mjs** — GLM-OCR (Ollama port 11434) for tables→HTML and equations→LaTeX; UniMERNet (port 8010) for equation LaTeX from cropped images. Results merge complementarily: UniMERNet primary for equations, GLM-OCR as fallback.
- **embedding-worker.mjs** — all-MiniLM-L6-v2 (384-dim) via @xenova/transformers for chunk and highlight embeddings.
- **preload.mjs** — Context bridge exposing IPC channels to renderer.

### Frontend (`frontend/src/`)
- **features/** — Domain modules: `paper/` (PdfReaderWorkspace, PaperDetailView), `search/` (SearchView, SearchSidebar, searchModel), `figures/` (FiguresView), `notes/`, `import/`, `processing/`, `settings/`.
- **stores/uiStore.ts** — Zustand store for UI state (selected paper, inspector, search filters, reader anchors).
- **lib/queries.ts** — TanStack Query hooks wrapping Supabase calls.
- **lib/supabasePaperRepository.ts** — Data access layer.
- **components/** — Shared UI: IconButton, Tag, StatusBadge, ProcessingBadge, ConfirmDialog (async Promise-based via Zustand), LatexText (KaTeX rendering).
- **styles/tokens.css** — CSS custom properties design tokens, `.ocr-table` styles.

### PDF Reader
- pdfjs-dist 5.5 with polyfills for Chromium 134 (Electron 35).
- Continuous scroll with lazy IntersectionObserver page rendering.
- z-index layering: canvas(0) → highlight(1) → text(2) → memo icons(3).
- Ctrl+mousewheel / Ctrl+/- zoom.

### Processing Pipeline
1. PDF import → pdfjs text extraction → section heading detection
2. Figure/table/equation heuristic detection (pdf-heuristics.mjs)
3. OCR enrichment: GLM-OCR (tables HTML, equations LaTeX) + UniMERNet (equation LaTeX from crops)
4. Embedding generation (chunks + highlights) → pgvector semantic search

### Database
- Local Supabase with pgvector extension.
- Key tables: `papers`, `chunks`, `figures` (stores figures/tables/equations with `item_type`), `highlights`, `highlight_embeddings`, `notes`, `folders`.
- `match_highlight_embeddings` RPC for semantic search.

## Conventions

- Electron modules are ESM (`.mjs`, `"type": "module"`). Use `import`/`export`, not `require`.
- Frontend uses path alias `@/` → `frontend/src/`.
- All IPC channels defined in `electron/types/ipc-channels.mjs`.
- Extraction version (`CURRENT_EXTRACTION_VERSION` in main.mjs) must be bumped when changing extraction logic to trigger automatic re-processing of existing papers.
- User language: Korean. Respond in Korean.
