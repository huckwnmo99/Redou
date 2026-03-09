export type ViewKey =
  | "library"
  | "categories"
  | "paper"
  | "reader"
  | "search"
  | "settings";

export interface CategorySelection {
  topId: string;
  subId: string;
}

export interface SubCategory {
  id: string;
  name: string;
  note: string;
}

export interface TopCategory {
  id: string;
  name: string;
  color: string;
  note: string;
  subcategories: SubCategory[];
}

export interface PaperCategoryRef {
  topId: string;
  subId: string;
}

export interface PaperRecord {
  id: string;
  title: string;
  journal: string;
  year: number;
  doi: string;
  readState: "unread" | "reading" | "read" | "important" | "revisit";
  summary: string;
  objective: string;
  method: string;
  result: string;
  limitation: string;
  tags: string[];
  noteCount: number;
  highlightCount: number;
  figureCount: number;
  categories: PaperCategoryRef[];
}

export interface AnnotationPreset {
  id: string;
  name: string;
  colorClass: string;
}

