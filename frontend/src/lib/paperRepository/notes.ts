import { supabase } from "../supabase";
import {
  getHighlightById,
  getOrCreateSelectionHighlight,
  type CurrentUserId,
} from "./highlights";
import {
  KIND_TO_DB,
  rowToNote,
} from "./mappers";
import type { NoteRow } from "./mappers";
import type {
  NoteKind,
  PaperTextSelectionAnchor,
  ResearchNote,
} from "@/types/paper";

const noteSelect =
  "id, paper_id, title, note_text, note_type, created_at, updated_at, selected_text, is_pinned, page, highlight_id, highlight:highlights(id, page, selected_text, start_anchor)";

export async function fetchAllNotes(): Promise<ResearchNote[]> {
  const { data, error } = await supabase.from("notes").select(noteSelect).order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => rowToNote(row as NoteRow));
}

export async function fetchNotesByPaper(paperId: string): Promise<ResearchNote[]> {
  const { data, error } = await supabase
    .from("notes")
    .select(noteSelect)
    .eq("paper_id", paperId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => rowToNote(row as NoteRow));
}

export async function fetchNoteById(id: string): Promise<ResearchNote | undefined> {
  const { data, error } = await supabase.from("notes").select(noteSelect).eq("id", id).single();

  if (error || !data) {
    return undefined;
  }

  return rowToNote(data as NoteRow);
}

export async function createNoteRecord(
  input: {
    paperId: string;
    title?: string;
    content?: string;
    kind?: NoteKind;
    anchorLabel?: string;
    selectionAnchor?: PaperTextSelectionAnchor;
    highlightId?: string;
    presetId?: string;
  },
  currentUserId: CurrentUserId,
): Promise<ResearchNote> {
  const userId = await currentUserId();
  const noteType = KIND_TO_DB[input.kind ?? "summary"];

  let noteScope: "paper" | "highlight" = "paper";
  let highlightId: string | null = null;
  let page: number | null = null;
  let selectedText = input.anchorLabel?.trim() || null;
  let notePageLabel: string | undefined;

  if (input.selectionAnchor) {
    const highlight = await getOrCreateSelectionHighlight({
      paperId: input.paperId,
      userId,
      selectionAnchor: input.selectionAnchor,
      presetId: input.presetId,
    });
    noteScope = "highlight";
    highlightId = highlight.id;
    page = input.selectionAnchor.pageNumber;
    selectedText = input.selectionAnchor.quote;
    notePageLabel = input.selectionAnchor.pageLabel;
  } else if (input.highlightId) {
    const highlight = await getHighlightById(input.highlightId, userId);
    if (!highlight) {
      throw new Error("The selected highlight could not be found.");
    }

    noteScope = "highlight";
    highlightId = highlight.id;
    page = highlight.startAnchor?.pageNumber ?? highlight.pageNumber ?? null;
    selectedText = highlight.selectedText;
    notePageLabel = highlight.startAnchor?.pageLabel ?? (highlight.pageNumber ? String(highlight.pageNumber) : undefined);
  }

  const { data, error } = await supabase
    .from("notes")
    .insert({
      paper_id: input.paperId,
      user_id: userId,
      note_scope: noteScope,
      highlight_id: highlightId,
      page,
      note_type: noteType,
      title: input.title?.trim() || (notePageLabel ? `Reader note - Page ${notePageLabel}` : "New note"),
      note_text:
        input.content?.trim() ||
        (selectedText
          ? `Selection: "${selectedText}"\n\nWhy it matters:`
          : "Capture the key takeaway, open question, or next action from this paper."),
      selected_text: selectedText,
      is_pinned: false,
    })
    .select(noteSelect)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create the note.");
  }

  return rowToNote(data as NoteRow);
}

export async function updateNoteRecord(
  id: string,
  updates: Partial<Pick<ResearchNote, "title" | "content" | "kind" | "anchorLabel" | "pinned">>,
): Promise<ResearchNote> {
  const patch: Record<string, unknown> = {};
  if (updates.title !== undefined) patch.title = updates.title.trim();
  if (updates.content !== undefined) patch.note_text = updates.content.trim();
  if (updates.kind !== undefined) patch.note_type = KIND_TO_DB[updates.kind];
  if (updates.anchorLabel !== undefined) patch.selected_text = updates.anchorLabel.trim() || null;
  if (updates.pinned !== undefined) patch.is_pinned = updates.pinned;

  const { data, error } = await supabase
    .from("notes")
    .update(patch)
    .eq("id", id)
    .select(noteSelect)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to update the note.");
  }

  return rowToNote(data as NoteRow);
}
