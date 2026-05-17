import { supabase } from "../supabase";
import {
  normalizeSelectionAnchor,
  rowToHighlight,
  rowToHighlightPreset,
} from "./mappers";
import type {
  HighlightPresetListRow,
  HighlightRow,
} from "./mappers";
import type {
  HighlightPreset,
  PaperTextSelectionAnchor,
  ResearchHighlight,
} from "@/types/paper";

export type CurrentUserId = () => Promise<string>;

const highlightSelect =
  "id, paper_id, preset_id, page, selected_text, start_anchor, end_anchor, created_at, updated_at, preset:highlight_presets(name, color_hex)";

const presetSelect =
  "id, name, color_hex, description, sort_order, is_system_default, is_active";

export async function getDefaultHighlightPresetId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("highlight_presets")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(error?.message ?? "No active highlight preset is available for this workspace.");
  }

  return data.id as string;
}

export async function getHighlightById(
  highlightId: string,
  userId?: string,
): Promise<ResearchHighlight | undefined> {
  let query = supabase
    .from("highlights")
    .select(highlightSelect)
    .eq("id", highlightId)
    .limit(1);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return undefined;
  }

  return rowToHighlight(data as HighlightRow);
}

async function findExistingHighlight(
  paperId: string,
  userId: string,
  selection: PaperTextSelectionAnchor,
): Promise<HighlightRow | undefined> {
  const { data, error } = await supabase
    .from("highlights")
    .select(highlightSelect)
    .eq("paper_id", paperId)
    .eq("user_id", userId)
    .eq("page", selection.pageNumber)
    .eq("selected_text", selection.quote)
    .contains("start_anchor", { anchorId: selection.anchorId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? undefined) as HighlightRow | undefined;
}

export async function getOrCreateSelectionHighlight(input: {
  paperId: string;
  userId: string;
  selectionAnchor: PaperTextSelectionAnchor;
  presetId?: string;
}): Promise<ResearchHighlight> {
  const normalizedSelection = normalizeSelectionAnchor(input.selectionAnchor);
  const existing = await findExistingHighlight(input.paperId, input.userId, normalizedSelection);
  if (existing) {
    return rowToHighlight(existing);
  }

  const presetId = input.presetId ?? (await getDefaultHighlightPresetId(input.userId));

  const { data, error } = await supabase
    .from("highlights")
    .insert({
      paper_id: input.paperId,
      user_id: input.userId,
      preset_id: presetId,
      page: normalizedSelection.pageNumber,
      selected_text: normalizedSelection.quote,
      start_anchor: normalizedSelection,
      end_anchor: normalizedSelection,
    })
    .select(highlightSelect)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to save the highlight selection.");
  }

  return rowToHighlight(data as HighlightRow);
}

export async function fetchHighlightPresets(currentUserId: CurrentUserId): Promise<HighlightPreset[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("highlight_presets")
    .select(presetSelect)
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => rowToHighlightPreset(row as HighlightPresetListRow));
}

export async function createHighlightPresetRecord(
  input: { name: string; colorHex: string; description?: string },
  currentUserId: CurrentUserId,
): Promise<HighlightPreset> {
  const userId = await currentUserId();
  const { count } = await supabase
    .from("highlight_presets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const { data, error } = await supabase
    .from("highlight_presets")
    .insert({
      user_id: userId,
      name: input.name.trim(),
      color_hex: input.colorHex,
      description: input.description?.trim() || null,
      sort_order: (count ?? 0) + 1,
      is_system_default: false,
      is_active: true,
    })
    .select(presetSelect)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create highlight preset.");
  }

  return rowToHighlightPreset(data as HighlightPresetListRow);
}

export async function deleteHighlightPresetRecord(
  id: string,
  currentUserId: CurrentUserId,
): Promise<string> {
  const userId = await currentUserId();
  const { count, error: countError } = await supabase
    .from("highlights")
    .select("id", { count: "exact", head: true })
    .eq("preset_id", id)
    .eq("user_id", userId);
  if (countError) {
    throw new Error(countError.message);
  }
  if ((count ?? 0) > 0) {
    throw new Error("This preset is used by existing highlights. Reassign or delete those highlights before deleting the preset.");
  }

  const { error } = await supabase
    .from("highlight_presets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    throw new Error(error.message);
  }

  return id;
}

export async function fetchHighlightsByPaper(paperId: string): Promise<ResearchHighlight[]> {
  const { data, error } = await supabase
    .from("highlights")
    .select(highlightSelect)
    .eq("paper_id", paperId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => rowToHighlight(row as HighlightRow));
}

export async function createHighlightRecord(
  input: {
    paperId: string;
    selectionAnchor: PaperTextSelectionAnchor;
    presetId?: string;
  },
  currentUserId: CurrentUserId,
): Promise<ResearchHighlight> {
  const userId = await currentUserId();
  return getOrCreateSelectionHighlight({
    paperId: input.paperId,
    userId,
    selectionAnchor: input.selectionAnchor,
    presetId: input.presetId,
  });
}

export async function updateHighlightPresetRecord(
  input: {
    id: string;
    paperId: string;
    presetId: string;
  },
  currentUserId: CurrentUserId,
): Promise<ResearchHighlight> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("highlights")
    .update({
      preset_id: input.presetId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("user_id", userId)
    .select(highlightSelect)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to update the highlight preset.");
  }

  return rowToHighlight(data as HighlightRow);
}

export async function deleteHighlightRecord(
  input: {
    id: string;
    paperId: string;
  },
  currentUserId: CurrentUserId,
): Promise<{ id: string; paperId: string }> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from("highlights")
    .delete()
    .eq("id", input.id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return { id: input.id, paperId: input.paperId };
}
