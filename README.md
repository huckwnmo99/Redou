# Redou

Redou is a Windows-first research workspace for collecting, reading, annotating, and recalling academic papers.

## Current Project Layout

- `frontend`
  - current renderer baseline
  - contains the latest UI, auth gate, PDF reader workspace, notes, search, figures, and paper detail flows
- `apps/desktop`
  - Electron shell, preload, IPC handlers, background worker, backup/file/database bridges
  - still contains the legacy mock renderer source under `apps/desktop/src`
- `supabase`
  - local Supabase config, schema migration, and seed setup
- `docs`
  - planning, frontend architecture, and database design docs
- `prototypes`
  - design references and HTML prototypes

## Most Reliable Run Path

This is the current recommended way to run the project from this workspace.

1. Start local Supabase.

```powershell
supabase start
supabase status
```

2. Build the current renderer baseline.

```powershell
cd frontend
npm install
npm run build
```

3. Install the desktop shell dependencies.

```powershell
cd ..\apps\desktop
npm install
```

4. Launch the Electron app.

```powershell
npm run start:electron
```

When the dev renderer at `http://127.0.0.1:4173` is unavailable, Electron now falls back to `frontend/dist/index.html` automatically.

## Optional Dev Renderer Path

If you want Electron to load the live Vite renderer instead of the built `dist` output:

```powershell
cd frontend
npm run dev -- --host 127.0.0.1 --port 4173
```

Then, in another terminal:

```powershell
cd apps\desktop
npm run start:electron
```

Note: in this environment, Vite dev/preview can still be unreliable because `esbuild` may hit `spawn EPERM`. The built-renderer path above is the safer default.

## First Boot

- The project no longer seeds a demo account or sample paper library by default.
- Create the first local account from the auth screen, or use the Google sign-in entry after configuring the Google provider in local Supabase.
- If you changed from an older sample-filled setup, run `supabase db reset` to clear the previous demo data and apply the clean seed.

## Verified Status

- `frontend` build passes.
- local Supabase is running.
- `apps/desktop` build passes.
- Electron launches a live `Redou` window from this workspace.
- the desktop worker can resolve a local `pdfjs-dist` install from `apps/desktop/node_modules`.

## Current Practical Next Step

Walk through the in-window `Add Paper -> import -> extraction -> reader` flow and then continue improving OCR/layout-aware extraction.
