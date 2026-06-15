# Presentation Deck

Status: completed
Type: note
Created: 2026-06-10
Updated: 2026-06-10
Related: ../README.md

## Completed Scope

Created an editable seven-slide PowerPoint deck from the Korean non-technical presentation draft, using `ppt/Agnetic_AI_SHI2.pptx` as a visual reference for the wide format, dark navy palette, blue accents, large typography, and structured explanation rhythm.

Outputs:

- `ppt/read-only-improvement-advisor.pptx`
- `docs/presentation_assets/read-only-improvement-advisor-overview-infographic.png`
- `docs/presentation_assets/read-only-improvement-advisor-ai-infographic.png`
- `docs/presentation_assets/read-only-improvement-advisor-preview/slide-01.png` through `slide-08.png`
- `docs/presentation_assets/scripts/build-read-only-advisor-deck.cjs`
- `docs/presentation_assets/scripts/render-read-only-advisor-overview-infographic.py`
- `docs/presentation_assets/scripts/render-read-only-advisor-previews.py`

The deck covers:

- self-improvement method
- why the read-only approach was chosen
- Snapshot -> Rule Analyzer -> LLM Writer -> LLM Reviewer structure
- six examples across processing, search, extraction, table quality, and library cleanup
- current implementation state and next steps

2026-06-10 update: slide 3 now explains how LLM-to-LLM cooperation can fit into the advisor without making the LLM the first judge. The rule analyzer still creates evidence-backed candidates, then an LLM writer can make them understandable and an LLM reviewer can check overstatement, mismatch, or confusing phrasing.

2026-06-10 update 2: added a full overview infographic as a standalone PNG and inserted it as slide 2 in the PPT deck. The deck is now 8 slides: cover, overview infographic, rationale, cooperation structure, six examples, and next steps.

2026-06-10 update 3: generated an AI infographic-style image for the same overview concept and copied it into presentation assets. This asset is visual-first and keeps labels out of the generated image so Korean labels can be added as editable PPT text when needed.

## Out of Scope

- Runtime UI changes
- DB migrations or event logging
- Automatic improvement actions
- Manual PowerPoint editing

## Verification

- PPTX zip package check: pass
- PPTX slide count: 8
- PPTX Korean text extraction: pass
- PNG preview count: 8
- PNG nonblank inspection: pass
- AI infographic dimensions: 1672x941
- AI infographic nonblank inspection: pass
- `git diff --check`: pass with LF-to-CRLF warnings only
- trailing whitespace scan: pass

## User or Team Impact

The user now has a PPTX deck that follows the existing presentation style more closely than the Markdown-only draft and can be used as a starting point for lecture or demo presentation work.

## Follow-ups

- Open visually in PowerPoint for final human polish if exact template parity is required.
