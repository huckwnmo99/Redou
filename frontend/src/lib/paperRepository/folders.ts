import { supabase } from "../supabase";
import { toSlug } from "./mappers";
import type { Folder } from "@/types/paper";

export type CurrentUserId = () => Promise<string>;

export async function attachPaperToFolder(
  paperId: string,
  folderId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from("paper_folders").insert({
    paper_id: paperId,
    folder_id: folderId,
    assigned_by_user_id: userId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function movePaperToFolderAssignment(
  paperId: string,
  folderId: string,
  userId: string,
): Promise<void> {
  const { data: existingLinks, error: existingError } = await supabase
    .from("paper_folders")
    .select("folder_id")
    .eq("paper_id", paperId);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const assignedFolderIds = new Set((existingLinks ?? []).map((link) => link.folder_id).filter(Boolean));

  if (!assignedFolderIds.has(folderId)) {
    await attachPaperToFolder(paperId, folderId, userId);
  }

  const { error: cleanupError } = await supabase
    .from("paper_folders")
    .delete()
    .eq("paper_id", paperId)
    .neq("folder_id", folderId);

  if (cleanupError) {
    throw new Error(cleanupError.message);
  }
}

export async function fetchFolders(): Promise<Folder[]> {
  const [folderRes, linkRes] = await Promise.all([
    supabase.from("folders").select("id, name, parent_folder_id, sort_order").order("sort_order"),
    supabase.from("paper_folders").select("paper_id, folder_id"),
  ]);

  if (folderRes.error) {
    throw new Error(folderRes.error.message);
  }
  if (linkRes.error) {
    throw new Error(linkRes.error.message);
  }

  const folders = folderRes.data ?? [];
  const links = linkRes.data ?? [];

  return folders.map((folder) => {
    const paperCount = new Set(links.filter((link) => link.folder_id === folder.id).map((link) => link.paper_id)).size;

    return {
      id: folder.id,
      name: folder.name,
      parentId: folder.parent_folder_id ?? undefined,
      paperCount,
    };
  });
}

export async function fetchPaperIdsByFolder(folderId: string): Promise<string[]> {
  const { data: links } = await supabase.from("paper_folders").select("paper_id").eq("folder_id", folderId);
  return [...new Set((links ?? []).map((link) => link.paper_id))];
}

export async function createFolderRecord(
  name: string,
  parentId: string | null,
  currentUserId: CurrentUserId,
): Promise<Folder> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Folder name is required.");
  }

  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("folders")
    .insert({
      owner_user_id: userId,
      name: trimmed,
      slug: toSlug(trimmed),
      parent_folder_id: parentId,
    })
    .select("id, name, parent_folder_id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to create the folder.");
  }

  return {
    id: data.id,
    name: data.name,
    parentId: data.parent_folder_id ?? undefined,
    paperCount: 0,
  };
}
