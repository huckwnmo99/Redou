# Frontend

`frontend` is now the current renderer baseline for Redou.
It is no longer just a temporary UI sandbox. The Electron shell uses this renderer first in development and falls back to its built output when needed.

## What This Folder Owns Now

- app shell
- auth gate
- library and nested folders
- paper detail workspace
- PDF.js reader workspace
- notes, figures, search, and settings
- Supabase-backed frontend data adapters
- desktop bridge calls through `window.redouDesktop`

## Recommended Commands

### Install dependencies

```powershell
cd frontend
npm install
```

### Build the renderer

```powershell
npm run build
```

### Optional live dev server

```powershell
npm run dev -- --host 127.0.0.1 --port 4173
```

Electron will try this dev server first. If it is unavailable, the desktop shell can now fall back to `frontend/dist/index.html`.

## First Boot

- No demo account or sample papers are seeded by default anymore.
- The auth screen supports email-based account creation and a Google sign-in entry point.
- Google OAuth still needs provider credentials/config in local Supabase before that path will complete successfully.

## Current Role in the Project

The practical flow is now:

1. build or serve `frontend`
2. launch `apps/desktop`
3. use the Electron shell as the real application runtime

## Current Gaps

- detached-panel flows are still incomplete
- search is still client-side, not vector-backed retrieval
- OCR/layout-aware extraction is still pending
- the old `apps/desktop/src` renderer has not been retired yet
