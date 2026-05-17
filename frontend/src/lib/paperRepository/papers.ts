import { supabase } from "../supabase";
import { normalizeTitle } from "./mappers";
import type { PaperRow } from "./mappers";

export interface PaperRowFilter {
  ids?: string[];
  starred?: boolean;
  search?: string;
}

export interface CreatePaperRecordInput {
  userId: string;
  title: string;
  year?: number;
  venue?: string;
}

const PAPER_SELECT =
  "id, title, publication_year, journal_name, doi, authors, abstract, reading_status, is_important, created_at, paper_tags(tags(name)), paper_folders(folder_id)";

export async function fetchPaperRows(filter?: PaperRowFilter): Promise<PaperRow[]> {
  let query = supabase
    .from("papers")
    .select(PAPER_SELECT)
    .is("trashed_at", null)
    .order("created_at", { ascending: false });

  if (filter?.ids) {
    query = query.in("id", filter.ids);
  }

  if (filter?.starred) {
    query = query.eq("is_important", true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  let papers = (data ?? []) as unknown as PaperRow[];

  if (filter?.search) {
    const normalized = filter.search.toLowerCase();
    papers = papers.filter(
      (paper) =>
        paper.title.toLowerCase().includes(normalized) ||
        (paper.journal_name ?? "").toLowerCase().includes(normalized) ||
        (paper.abstract ?? "").toLowerCase().includes(normalized),
    );
  }

  return papers;
}

export async function createPaperRecord(input: CreatePaperRecordInput): Promise<string> {
  const { data, error } = await supabase
    .from("papers")
    .insert({
      owner_user_id: input.userId,
      title: input.title,
      normalized_title: normalizeTitle(input.title),
      publication_year: input.year ?? null,
      journal_name: input.venue?.trim() || null,
      abstract: "",
      language: "en",
      reading_status: "unread",
      metadata_confidence: 0.1,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create the paper record.");
  }

  if (!data.id) {
    throw new Error("Unable to resolve the created paper id.");
  }

  return data.id;
}

export async function togglePaperStarRecord(id: string): Promise<void> {
  const { error } = await supabase.rpc("toggle_paper_star", {
    paper_id: id,
  });

  if (error) {
    throw new Error(error.message);
  }
}
