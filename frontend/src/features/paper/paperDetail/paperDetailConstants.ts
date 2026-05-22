import type { PaperDetailTab } from "@/types/paper";

export const tabDefs: { id: PaperDetailTab; en: string; ko: string }[] = [
  { id: "overview", en: "Overview", ko: "개요" },
  { id: "pdf", en: "PDF", ko: "PDF" },
  { id: "notes", en: "Notes", ko: "노트" },
  { id: "figures", en: "Figures", ko: "Figure" },
  { id: "tables", en: "Tables", ko: "Table" },
  { id: "equations", en: "Equations", ko: "수식" },
  { id: "references", en: "References", ko: "참고문헌" },
  { id: "metadata", en: "Metadata", ko: "메타데이터" },
];
