import { ExternalLink } from "lucide-react";

import { formatNoteDate, noteKindMeta } from "@/features/notes/notePresentation";
import { localeText } from "@/lib/locale";
import { useNotesByPaper } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper } from "@/types/paper";

import { cardStyle, lightButtonStyle } from "./paperDetailStyles";

export function PaperNotesTab({ paper }: { paper: Paper }) {
  const { data: notes = [] } = useNotesByPaper(paper.id);
  const { locale, openNotesWorkspace } = useUIStore();
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            {t("Notes Workspace", "노트 워크스페이스")}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            {t("Review note summaries here, then jump into the editor.", "노트 요약을 확인하고 편집기로 이동하세요.")}
          </div>
        </div>
        <button onClick={() => openNotesWorkspace(paper.id)} style={lightButtonStyle}>
          <ExternalLink size={13} />
          {t("Open notes workspace", "노트 워크스페이스 열기")}
        </button>
      </div>

      {notes.length > 0 ? (
        notes.map((note) => {
          const meta = noteKindMeta[note.kind];

          return (
            <button
              key={note.id}
              onClick={() => openNotesWorkspace(note.paperId, note.id)}
              style={{
                ...cardStyle,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: "999px", background: meta.background, color: meta.accent, fontSize: 11, fontWeight: 700 }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatNoteDate(note.updatedAt)}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{note.title}</div>
              {note.anchorLabel ? (
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginBottom: 8 }}>{note.anchorLabel}</div>
              ) : null}
              <p style={{ fontSize: 13, lineHeight: 1.75, color: "var(--color-text-secondary)" }}>{note.content}</p>
            </button>
          );
        })
      ) : (
        <div style={{ padding: 28, textAlign: "center", color: "var(--color-text-muted)" }}>
          {t("No notes yet.", "아직 노트가 없습니다.")}
        </div>
      )}
    </div>
  );
}
