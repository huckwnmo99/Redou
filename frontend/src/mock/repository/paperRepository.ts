import type { Folder, Paper, ResearchNote } from "@/types/paper";
import { mockFolders } from "@/mock/folders";
import { mockNotes } from "@/mock/notes";
import { mockPapers } from "@/mock/papers";

const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

let papersState: Paper[] = structuredClone(mockPapers);
let foldersState: Folder[] = structuredClone(mockFolders);
let notesState: ResearchNote[] = structuredClone(mockNotes);
let folderCounter = 100;
let noteCounter = 100;

function clonePaper(paper: Paper) {
  return structuredClone(paper);
}

function clonePapers(papers: Paper[]) {
  return structuredClone(papers);
}

function cloneFolders(folders: Folder[]) {
  return structuredClone(folders);
}

function cloneNote(note: ResearchNote) {
  return structuredClone(note);
}

function cloneNotes(notes: ResearchNote[]) {
  return structuredClone(notes);
}

function collectDescendantIds(folderId: string, folders: Folder[]): string[] {
  const ids = [folderId];

  for (const folder of folders) {
    if (folder.parentId === folderId) {
      ids.push(...collectDescendantIds(folder.id, folders));
    }
  }

  return ids;
}

function withComputedNoteCounts(papers: Paper[], notes: ResearchNote[]) {
  const countMap = new Map<string, number>();

  for (const note of notes) {
    countMap.set(note.paperId, (countMap.get(note.paperId) ?? 0) + 1);
  }

  return papers.map((paper) => ({
    ...paper,
    noteCount: countMap.get(paper.id) ?? 0,
  }));
}

function withComputedFolderCounts(folders: Folder[], papers: Paper[]) {
  return folders.map((folder) => {
    const scopedIds = collectDescendantIds(folder.id, folders);
    const paperCount = papers.filter((paper) => paper.folderId && scopedIds.includes(paper.folderId)).length;

    return {
      ...folder,
      paperCount,
      children: undefined,
    };
  });
}

function getComputedPapers() {
  return withComputedNoteCounts(papersState, notesState);
}

function getSortedNotes(notes: ResearchNote[]) {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const paperRepository = {
  async getAllPapers(): Promise<Paper[]> {
    await delay();
    return clonePapers(getComputedPapers());
  },

  async getPaperById(id: string): Promise<Paper | undefined> {
    await delay();
    const paper = getComputedPapers().find((item) => item.id === id);
    return paper ? clonePaper(paper) : undefined;
  },

  async getPapersByFolder(folderId: string): Promise<Paper[]> {
    await delay();
    const allowedFolderIds = new Set(collectDescendantIds(folderId, foldersState));
    return clonePapers(getComputedPapers().filter((paper) => paper.folderId && allowedFolderIds.has(paper.folderId)));
  },

  async getStarredPapers(): Promise<Paper[]> {
    await delay();
    return clonePapers(getComputedPapers().filter((paper) => paper.starred));
  },

  async getRecentPapers(limit = 8): Promise<Paper[]> {
    await delay();
    return clonePapers(
      [...getComputedPapers()].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, limit)
    );
  },

  async searchPapers(query: string): Promise<Paper[]> {
    await delay();
    const normalized = query.trim().toLowerCase();
    const computedPapers = getComputedPapers();

    if (!normalized) {
      return clonePapers(computedPapers);
    }

    return clonePapers(
      computedPapers.filter(
        (paper) =>
          paper.title.toLowerCase().includes(normalized) ||
          paper.venue.toLowerCase().includes(normalized) ||
          paper.authors.some((author) => author.name.toLowerCase().includes(normalized)) ||
          paper.tags.some((tag) => tag.toLowerCase().includes(normalized)) ||
          paper.abstract.toLowerCase().includes(normalized)
      )
    );
  },

  async togglePaperStar(id: string): Promise<Paper> {
    await delay(80);
    const paper = papersState.find((item) => item.id === id);

    if (!paper) {
      throw new Error(`Paper not found: ${id}`);
    }

    paper.starred = !paper.starred;
    return clonePaper(getComputedPapers().find((item) => item.id === id)!);
  },

  async getAllFolders(): Promise<Folder[]> {
    await delay();
    return cloneFolders(withComputedFolderCounts(foldersState, getComputedPapers()));
  },

  async createFolder(name: string, parentId: string | null): Promise<Folder> {
    await delay(80);
    const normalized = name.trim();

    if (!normalized) {
      throw new Error("Folder name is required.");
    }

    const id = `f${folderCounter++}`;
    const folder: Folder = {
      id,
      name: normalized,
      parentId: parentId ?? undefined,
      paperCount: 0,
    };

    foldersState = [...foldersState, folder];
    return cloneFolders(withComputedFolderCounts(foldersState, getComputedPapers())).find((item) => item.id === id)!;
  },

  async getAllNotes(): Promise<ResearchNote[]> {
    await delay();
    return cloneNotes(getSortedNotes(notesState));
  },

  async getNotesByPaper(paperId: string): Promise<ResearchNote[]> {
    await delay();
    return cloneNotes(getSortedNotes(notesState.filter((note) => note.paperId === paperId)));
  },

  async getNoteById(id: string): Promise<ResearchNote | undefined> {
    await delay();
    const note = notesState.find((item) => item.id === id);
    return note ? cloneNote(note) : undefined;
  },

  async createNote(input: {
    paperId: string;
    title?: string;
    content?: string;
    kind?: ResearchNote["kind"];
    anchorLabel?: string;
  }): Promise<ResearchNote> {
    await delay(90);

    const paper = papersState.find((item) => item.id === input.paperId);
    if (!paper) {
      throw new Error(`Paper not found for note creation: ${input.paperId}`);
    }

    const now = new Date().toISOString();
    const note: ResearchNote = {
      id: `n${noteCounter++}`,
      paperId: input.paperId,
      title: input.title?.trim() || `New note for ${paper.title}`,
      content: input.content?.trim() || "Capture the key takeaway, open question, or next action from this paper.",
      kind: input.kind ?? "summary",
      anchorLabel: input.anchorLabel?.trim() || "Manual note",
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };

    notesState = [note, ...notesState];
    return cloneNote(note);
  },

  async updateNote(
    id: string,
    updates: Partial<Pick<ResearchNote, "title" | "content" | "kind" | "anchorLabel" | "pinned">>
  ): Promise<ResearchNote> {
    await delay(90);
    const note = notesState.find((item) => item.id === id);

    if (!note) {
      throw new Error(`Note not found: ${id}`);
    }

    note.title = updates.title?.trim() || note.title;
    note.content = updates.content?.trim() || note.content;
    note.kind = updates.kind ?? note.kind;
    note.anchorLabel = updates.anchorLabel?.trim() || note.anchorLabel;
    note.pinned = updates.pinned ?? note.pinned;
    note.updatedAt = new Date().toISOString();

    return cloneNote(note);
  },
};
