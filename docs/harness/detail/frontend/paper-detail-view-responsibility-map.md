# PaperDetailView Responsibility Map

Status: Stage 2B pre-split map
Date: 2026-05-20
Scope: `frontend/src/features/paper/PaperDetailView.tsx`

## Purpose

This map restarts Plan 12 Stage 2B before runtime UI edits.

`PaperDetailView.tsx` is currently a 1,980-line frontend monolith. It already contains internal leaf components, but they are co-located with the detail shell, reader orchestration, PDF sidebar mutations, extracted item rendering, PDF.js thumbnail helpers, KaTeX helpers, shared styles, and formatting utilities.

Stage 2B should be behavior-preserving. It should split the file into local paper-detail modules without changing tab behavior, reader behavior, supplementary PDF attachment, highlight/note creation, or extracted item rendering.

## Baseline

Measured on 2026-05-20:

| Metric | Value | Method |
|--------|-------|--------|
| `PaperDetailView.tsx` full line count | 1,980 | `(Get-Content frontend\src\features\paper\PaperDetailView.tsx).Count` |
| Current tab count | 8 | `overview`, `pdf`, `notes`, `figures`, `tables`, `equations`, `references`, `metadata` |
| Backend files in scope | 0 | Stage 2B is frontend-only |

## Current Responsibilities

| Current area | Current owner in file | Main dependencies | Notes |
|--------------|-----------------------|-------------------|-------|
| Detail shell and header | `PaperDetailView` | `usePaperById`, `useFolders`, `useUIStore` | Should remain the coordinator. |
| Tab definitions and tab switcher | `tabDefs`, `PaperDetailView` | `PaperDetailTab`, locale | Can remain in coordinator or move to a local constants file. |
| Overview tab | `OverviewTab` | `useSectionsByPaper`, `useFiguresByPaper`, `useUIStore` | Mostly presentational with page jump behavior. |
| PDF reader tab | `PdfTab` | desktop hooks, primary/supplementary file hooks, highlight/note hooks, `PdfReaderWorkspace`, UI store | Highest-risk area. Split last. |
| Reader sidebar sections | nested inside `PdfTab` plus `SidebarSection`, `PresetForm` | notes/highlights/presets/supplementary files, desktop actions | Strong candidate for local sidebar/panel components after `PdfTab` moves. |
| Notes tab | `NotesTab` | `useNotesByPaper`, `openNotesWorkspace`, `notePresentation` | Simple leaf component. |
| Figure image thumbnail | `FigureDetailImage` | desktop path resolution | Local figure-preview helper. |
| PDF crop thumbnails | `FigureDetailThumbnail`, `TableCropThumbnail`, `useFigureTabPdfDoc` | PDF.js, primary file path, desktop runtime | Keep together with extracted item tab initially. |
| Table/equation rendering | `tableDataToHtml`, `LatexBlock`, `OcrTableHtml` | KaTeX | Keep with extracted item tab initially. |
| Figures/tables/equations tabs | `FiguresTab` with `filterType` | `useFiguresByPaper`, `useUIStore`, PDF preview helpers | One shared extracted-items tab is safer than three duplicate components. |
| References tab | `ReferencesTab` | `useReferencesByPaper` | Presentational and safe to move early. |
| Metadata tab | `MetadataTab` | `Paper`, DOI external open | Presentational and safest to move first. |
| Shared utilities | formatters, fallback anchor, styles | locale, paper types | Move only when it reduces import churn. |

## Target Module Map

Preferred first target structure:

```text
frontend/src/features/paper/
  PaperDetailView.tsx
  paperDetail/
    paperDetailConstants.ts
    paperDetailUtils.ts
    paperDetailStyles.ts
    PaperOverviewTab.tsx
    PaperNotesTab.tsx
    PaperReferencesTab.tsx
    PaperMetadataTab.tsx
    PaperExtractedItemsTab.tsx
    PaperPdfTab.tsx
    PaperReaderSidebar.tsx
    PaperSupplementaryFilesPanel.tsx
```

Notes:

- Use the nested `paperDetail/` folder to avoid crowding `frontend/src/features/paper/`, which already contains the public `PaperDetailView.tsx` and `PdfReaderWorkspace.tsx`.
- Keep `PdfReaderWorkspace.tsx` unchanged.
- Prefer one `PaperExtractedItemsTab` for figures/tables/equations to preserve the existing `filterType` behavior.
- Keep `PaperPdfTab` and `PaperReaderSidebar` in the same split slice only if props remain readable. If props drilling becomes noisy, pause and write a local context plan before adding a new context.

## Shared State Contract

State that should stay in global UI store:

- `selectedPaperId`
- `paperDetailTab`
- `readerTargetAnchor`
- `openPaperDetail`
- `setPaperDetailTab`
- `setReaderTargetAnchor`
- `openNotesWorkspace`
- `closePaperDetail`

State that should remain local to `PaperPdfTab` during the first split:

- `selectedPresetId`
- `readerActionError`
- `sidebarOpen`
- `showPresetForm`
- transient reader anchor callbacks from `PdfReaderWorkspace`

Derived data that may stay local to each tab:

- `folderName` is computed by the coordinator and passed to header/overview/metadata/pdf.
- `linkedNoteCounts` should remain in `PaperPdfTab` or a local reader-sidebar helper.
- extracted figure/table/equation sorting should stay in the extracted-items tab.

Do not introduce a broad paper-detail context in the first split. Only consider it if `PaperPdfTab`/sidebar props become the dominant risk.

## Suggested Split Order

1. **Shared constants/styles/utilities**
   - Move `tabDefs`, `cardStyle`, `eyebrowStyle`, `lightButtonStyle`, and pure formatters only as needed by the first extracted leaves.
   - Verification: `frontend` build.

2. **Presentational low-risk leaves**
   - Move `PaperMetadataTab`.
   - Move `PaperReferencesTab`.
   - These have minimal local state and no reader side effects.

3. **Simple data leaves**
   - Move `PaperNotesTab`.
   - Move `PaperOverviewTab`.
   - Keep page-jump behavior via existing `useUIStore` calls or explicit callbacks; choose the smaller diff.

4. **Extracted item rendering**
   - Move `FiguresTab` to `PaperExtractedItemsTab`.
   - Move its PDF preview helpers with it:
     - `FigureDetailImage`
     - `FigureDetailThumbnail`
     - `TableCropThumbnail`
     - `useFigureTabPdfDoc`
     - `tableDataToHtml`
     - `LatexBlock`
     - `OcrTableHtml`
   - Keep rendering behavior unchanged.

5. **PDF reader orchestration**
   - Move `PdfTab` to `PaperPdfTab`.
   - Preserve all hooks and handlers first.
   - Do not redesign reader layout.

6. **PDF sidebar panels**
   - After `PaperPdfTab` is stable, extract sidebar UI:
     - `PaperReaderSidebar`
     - preset section/form
     - highlights section
     - notes section
     - source PDF section
     - `PaperSupplementaryFilesPanel`
   - Stop if handler props become hard to review.

## Acceptance Criteria

- `PaperDetailView.tsx` remains the detail coordinator, not a dumping ground for leaf UI.
- Current 8 tabs render the same content.
- `Open Reader` still switches to the PDF tab.
- Overview and extracted item page jumps still set `readerTargetAnchor` and open the PDF tab.
- PDF tab still handles:
  - pipeline waiting state;
  - Electron-only/missing-file fallback;
  - inline `PdfReaderWorkspace`;
  - highlight creation, update, deletion;
  - note and memo creation/update;
  - supplementary PDF attachment;
  - system viewer and Explorer actions.
- No backend files are touched.
- No copy/layout redesign is included.

## Verification

After each mechanical split step:

```powershell
cmd /c npm run build
git diff --check
```

Manual smoke if the Electron app is available:

- Open a paper detail view.
- Switch through all 8 tabs.
- Jump from overview or figures/tables/equations to a PDF page.
- Open the PDF reader.
- Confirm reader fallback state still appears outside Electron or when a primary PDF is missing.
- Save a highlight, create a note, update/delete a highlight, and attach one supplementary PDF if desktop runtime is available.

## Stop Points

Pause before moving code when any of these happen:

- `PaperPdfTab` requires a large prop bag just to feed sidebar sections.
- `PdfReaderWorkspace` props need to change.
- supplementary attach behavior needs repository or Electron IPC changes.
- extracted item rendering invites visual redesign.
- build failures require changing query hooks, store shape, or paper domain types.
