# Desktop App

`apps/desktop` is the Electron shell for Redou.

## What Lives Here

- Electron main process
- preload bridge
- IPC channels for database, files, windows, and backups
- background processing worker for import/extraction
- the older mock renderer under `apps/desktop/src`

## Current Renderer Strategy

The latest renderer baseline lives in `../../frontend`.

- development default: Electron first tries `http://127.0.0.1:4173`
- runtime fallback: if that dev server is unavailable, Electron falls back to `../../frontend/dist/index.html`
- packaged fallback: packaged builds still prefer built files when present
- legacy fallback: the old desktop renderer should only matter if the new renderer path is unavailable

## Recommended Run Steps

### 1. Start local Supabase

```powershell
supabase start
supabase status
```

### 2. Build the frontend renderer

```powershell
cd ..\..\frontend
npm install
npm run build
```

### 3. Install desktop dependencies

```powershell
cd ..\apps\desktop
npm install
```

### 4. Launch Electron

```powershell
npm run start:electron
```

This is the most reliable path right now because it does not depend on a live Vite dev server.

## Optional Live Renderer Mode

If you want Electron to target the live frontend dev server:

Terminal A:

```powershell
cd frontend
npm run dev -- --host 127.0.0.1 --port 4173
```

Terminal B:

```powershell
cd apps\desktop
npm run start:electron
```

If the dev server is down, the Electron shell now logs a fallback and loads `frontend/dist` instead.

## Runtime Notes

- launch output is written to `apps/desktop/.electron-runtime.log` when started with redirected output
- the desktop shell now has a local `pdfjs-dist` install and the extraction helper prefers that path first
- import, extraction, and reader flows still need a full in-window walkthrough after launch

## Current Gaps

- the legacy renderer under `apps/desktop/src` has not been removed or fully replaced
- `frontend` is not fully wired to `window.redouDesktop`
- runtime walkthrough coverage for `Add Paper -> import -> extraction -> reader` is still pending
