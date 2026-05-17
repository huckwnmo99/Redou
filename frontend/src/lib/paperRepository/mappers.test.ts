import { describe, expect, it } from "vitest";

import {
  KIND_TO_DB,
  normalizeTitle,
  normalizeSelectionAnchor,
  rowToChunk,
  rowToFigure,
  rowToHighlight,
  rowToHighlightPreset,
  rowToNote,
  rowToPaper,
  rowToSection,
  rowToSupplementaryFile,
  toSlug,
} from "./mappers";
import type {
  ChunkRow,
  FigureRow,
  HighlightPresetListRow,
  HighlightRow,
  NoteRow,
  PaperRow,
  ProcessingSignal,
  SectionRow,
  SupplementaryFileRow,
} from "./mappers";

describe("paper repository mappers", () => {
  it("maps paper rows with direct folder, counts, and processing status", () => {
    const row: PaperRow = {
      id: "paper-1",
      title: "Structured Paper",
      publication_year: 2026,
      journal_name: "Redou Journal",
      doi: "10.1234/redou",
      authors: [{ name: "Kim", affiliation: "Lab" }],
      abstract: "abstract",
      reading_status: "reading",
      is_important: true,
      created_at: "2026-05-11T00:00:00.000Z",
      paper_tags: [{ tags: { name: "rag" } }],
      paper_folders: [{ folder_id: "folder-1" }],
    };
    const processingMap = new Map<string, ProcessingSignal>([
      ["paper-1", { status: "running", updatedAt: "2026-05-11T01:00:00.000Z" }],
    ]);

    expect(rowToPaper(row, new Map([["paper-1", 2]]), new Map([["paper-1", 3]]), processingMap)).toMatchObject({
      id: "paper-1",
      title: "Structured Paper",
      authors: [{ name: "Kim", affiliation: "Lab" }],
      year: 2026,
      venue: "Redou Journal",
      tags: ["rag"],
      status: "reading",
      starred: true,
      figureCount: 3,
      noteCount: 2,
      folderId: "folder-1",
      processingStatus: "running",
      processingUpdatedAt: "2026-05-11T01:00:00.000Z",
    });
  });

  it("maps supplementary file processing state without changing the primary facade shape", () => {
    const row: SupplementaryFileRow = {
      id: "source-1",
      paper_id: "paper-1",
      stored_path: "C:/library/source-1.pdf",
      stored_filename: "source-1.pdf",
      original_filename: "supp.pdf",
      file_size_bytes: 1024,
      is_primary: false,
      created_at: "2026-05-11T00:00:00.000Z",
    };

    expect(rowToSupplementaryFile(row, { status: "queued", updatedAt: "2026-05-11T01:00:00.000Z" })).toEqual({
      id: "source-1",
      paperId: "paper-1",
      storedPath: "C:/library/source-1.pdf",
      storedFilename: "source-1.pdf",
      originalFilename: "supp.pdf",
      fileSize: 1024,
      isPrimary: false,
      createdAt: "2026-05-11T00:00:00.000Z",
      processingStatus: "queued",
      processingUpdatedAt: "2026-05-11T01:00:00.000Z",
    });
  });

  it("normalizes selection anchors and maps note highlight anchors", () => {
    const normalized = normalizeSelectionAnchor({
      paperId: "paper-1",
      pageNumber: 7,
      pageLabel: " ",
      anchorId: " ",
      quote: "  important result  ",
      capturedAt: "2026-05-11T00:00:00.000Z",
      rects: [{ x: 1.123456, y: 2.123456, width: 3.123456, height: 4.123456 }],
    });

    expect(normalized).toMatchObject({
      pageLabel: "7",
      anchorId: "paper:paper-1:page:7",
      quote: "important result",
      rects: [{ x: 1.1235, y: 2.1235, width: 3.1235, height: 4.1235 }],
    });

    const row: NoteRow = {
      id: "note-1",
      paper_id: "paper-1",
      title: null,
      note_text: "Why it matters",
      note_type: KIND_TO_DB.memo,
      created_at: "2026-05-11T00:00:00.000Z",
      updated_at: "2026-05-11T01:00:00.000Z",
      selected_text: null,
      is_pinned: true,
      page: null,
      highlight_id: "highlight-1",
      highlight: {
        id: "highlight-1",
        page: 7,
        selected_text: "important result",
        start_anchor: normalized,
      },
    };

    expect(rowToNote(row)).toMatchObject({
      id: "note-1",
      paperId: "paper-1",
      title: "",
      content: "Why it matters",
      kind: "memo",
      anchorLabel: "Page 7",
      pinned: true,
      pageNumber: 7,
      highlightId: "highlight-1",
      anchorQuote: "important result",
    });
  });

  it("normalizes paper titles and folder slugs", () => {
    expect(normalizeTitle("  Neural   Table   Extraction  ")).toBe("neural table extraction");
    expect(toSlug("  Redou: Agentic RAG / Tables!  ")).toBe("redou-agentic-rag-tables");
  });

  it("maps highlight rows with preset metadata and stored anchors", () => {
    const row: HighlightRow = {
      id: "highlight-1",
      paper_id: "paper-1",
      preset_id: "preset-1",
      page: 3,
      selected_text: "linked evidence",
      start_anchor: {
        pageNumber: 3,
        pageLabel: "iii",
        quote: "linked evidence",
        capturedAt: "2026-05-11T00:00:00.000Z",
      },
      end_anchor: null,
      created_at: "2026-05-11T00:00:00.000Z",
      updated_at: "2026-05-11T01:00:00.000Z",
      preset: [{ name: "Finding", color_hex: "#facc15" }],
    };

    expect(rowToHighlight(row)).toMatchObject({
      id: "highlight-1",
      paperId: "paper-1",
      presetId: "preset-1",
      presetName: "Finding",
      colorHex: "#facc15",
      pageNumber: 3,
      selectedText: "linked evidence",
      startAnchor: {
        paperId: "paper-1",
        pageNumber: 3,
        pageLabel: "iii",
        anchorId: "paper:paper-1:page:3",
        quote: "linked evidence",
      },
      endAnchor: {
        pageNumber: 3,
        quote: "linked evidence",
      },
    });
  });

  it("maps highlight preset rows", () => {
    const row: HighlightPresetListRow = {
      id: "preset-1",
      name: "Finding",
      color_hex: "#facc15",
      description: null,
      sort_order: 2,
      is_system_default: false,
      is_active: true,
    };

    expect(rowToHighlightPreset(row)).toEqual({
      id: "preset-1",
      name: "Finding",
      colorHex: "#facc15",
      description: undefined,
      sortOrder: 2,
      isSystemDefault: false,
      isActive: true,
    });
  });

  it("maps section, chunk, and figure extraction rows", () => {
    const section: SectionRow = {
      id: "section-1",
      paper_id: "paper-1",
      section_name: "Results",
      section_order: 2,
      page_start: 4,
      page_end: null,
      raw_text: "result text",
      parser_confidence: 0.91,
    };
    const chunk: ChunkRow = {
      id: "chunk-1",
      paper_id: "paper-1",
      section_id: "section-1",
      chunk_order: 3,
      page: 5,
      text: "chunk text",
      token_count: 42,
      start_char_offset: 10,
      end_char_offset: 100,
      parser_confidence: null,
    };
    const figure: FigureRow = {
      id: "figure-1",
      paper_id: "paper-1",
      figure_no: "Table 1",
      caption: "Main result",
      page: 6,
      image_path: null,
      summary_text: "summary",
      is_key_figure: true,
      is_presentation_candidate: false,
      item_type: "table",
    };

    expect(rowToSection(section)).toMatchObject({
      id: "section-1",
      paperId: "paper-1",
      name: "Results",
      pageStart: 4,
      pageEnd: undefined,
      parserConfidence: 0.91,
    });
    expect(rowToChunk(chunk)).toMatchObject({
      id: "chunk-1",
      paperId: "paper-1",
      sectionId: "section-1",
      order: 3,
      tokenCount: 42,
      parserConfidence: undefined,
    });
    expect(rowToFigure(figure)).toMatchObject({
      id: "figure-1",
      paperId: "paper-1",
      figureNo: "Table 1",
      itemType: "table",
      isKeyFigure: true,
    });
  });
});
