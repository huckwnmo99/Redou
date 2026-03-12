import type { NoteKind } from "@/types/paper";

export const noteKindMeta: Record<
  NoteKind,
  { label: string; accent: string; background: string }
> = {
  summary: {
    label: "Summary",
    accent: "#2563eb",
    background: "rgba(37, 99, 235, 0.12)",
  },
  insight: {
    label: "Insight",
    accent: "#0f766e",
    background: "rgba(15, 118, 110, 0.12)",
  },
  question: {
    label: "Question",
    accent: "#b45309",
    background: "rgba(180, 83, 9, 0.12)",
  },
  quote: {
    label: "Quote",
    accent: "#7c3aed",
    background: "rgba(124, 58, 237, 0.12)",
  },
  action: {
    label: "Action",
    accent: "#be123c",
    background: "rgba(190, 18, 60, 0.12)",
  },
  memo: {
    label: "Memo",
    accent: "#64748b",
    background: "rgba(100, 116, 139, 0.12)",
  },
};

export function formatNoteDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
