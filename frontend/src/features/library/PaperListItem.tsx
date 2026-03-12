import { Quote, Star, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { ProcessingBadge } from "@/components/ProcessingBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tag } from "@/components/Tag";
import { useDeletePaper, useTogglePaperStar } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper } from "@/types/paper";
import { writePaperDragData } from "./drag";

function formatAuthors(authors: Paper["authors"]) {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length === 1) return authors[0].name;
  if (authors.length === 2) return `${authors[0].name} & ${authors[1].name}`;
  return `${authors[0].name} et al.`;
}

function formatCitations(count: number) {
  if (count >= 1000) return `${(count / 1000).toFixed(0)}k`;
  return String(count);
}

interface PaperListItemProps {
  paper: Paper;
}

export function PaperListItem({ paper }: PaperListItemProps) {
  const { selectedPaperId, setSelectedPaperId, openPaperDetail, closePaperDetail } = useUIStore();
  const toggleStar = useTogglePaperStar();
  const deletePaper = useDeletePaper();
  const confirm = useConfirmDialog((s) => s.show);
  const isSelected = selectedPaperId === paper.id;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Select ${paper.title}`}
      draggable
      onDragStart={(event) => {
        writePaperDragData(event.dataTransfer, paper.id);
        setSelectedPaperId(paper.id);
      }}
      onClick={() => setSelectedPaperId(isSelected ? null : paper.id)}
      onDoubleClick={() => {
        setSelectedPaperId(paper.id);
        openPaperDetail();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          setSelectedPaperId(paper.id);
          openPaperDetail();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: "var(--radius-sm)",
        background: isSelected ? "var(--color-accent-subtle)" : "transparent",
        border: `1px solid ${isSelected ? "var(--color-accent)" : "transparent"}`,
        cursor: "grab",
      }}
    >
      <button
        aria-label={paper.starred ? "Remove from starred" : "Add to starred"}
        onClick={(event) => {
          event.stopPropagation();
          toggleStar.mutate(paper.id);
        }}
        disabled={toggleStar.isPending}
        style={{
          background: "transparent",
          border: "none",
          cursor: toggleStar.isPending ? "progress" : "pointer",
          color: paper.starred ? "var(--color-warning)" : "var(--color-border)",
          flexShrink: 0,
          padding: 0,
        }}
      >
        <Star size={13} fill={paper.starred ? "var(--color-warning)" : "none"} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {paper.title}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
          {formatAuthors(paper.authors)} ? {paper.venue} {paper.year}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {paper.tags.slice(0, 2).map((tag) => (
          <Tag key={tag} label={tag} />
        ))}
      </div>

      {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}

      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--color-text-muted)", fontSize: 11, minWidth: 48, flexShrink: 0 }}>
        <Quote size={10} />
        {formatCitations(paper.citationCount)}
      </div>

      <div style={{ flexShrink: 0 }}>
        <StatusBadge status={paper.status} />
      </div>

      <button
        onClick={(event) => {
          event.stopPropagation();
          setSelectedPaperId(paper.id);
          openPaperDetail();
        }}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--color-accent)",
          fontSize: 11.5,
          fontWeight: 700,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Open
      </button>

      <button
        aria-label="Delete paper"
        onClick={async (event) => {
          event.stopPropagation();
          const ok = await confirm({
            title: "논문 삭제",
            message: `"${paper.title}"\n\n관련된 하이라이트, 노트, Figure가 모두 삭제됩니다.`,
            confirmLabel: "삭제",
            danger: true,
          });
          if (!ok) return;
          if (selectedPaperId === paper.id) {
            closePaperDetail();
            setSelectedPaperId(null);
          }
          deletePaper.mutate(paper.id);
        }}
        disabled={deletePaper.isPending}
        style={{
          background: "transparent",
          border: "none",
          cursor: deletePaper.isPending ? "progress" : "pointer",
          padding: 2,
          flexShrink: 0,
          color: "var(--color-text-muted)",
          opacity: 0.5,
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "var(--color-error, #ef4444)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.color = "var(--color-text-muted)"; }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
