import { FileText, Quote, Star, StickyNote, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { ProcessingBadge } from "@/components/ProcessingBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tag } from "@/components/Tag";
import { localeText } from "@/lib/locale";
import { useDeletePaper, useTogglePaperStar } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper } from "@/types/paper";
import { writePaperDragData } from "./drag";

interface PaperCardProps {
  paper: Paper;
}

function formatAuthors(authors: Paper["authors"], locale: "en" | "ko") {
  if (authors.length === 0) return localeText(locale, "Unknown authors", "저자 미상");
  if (authors.length === 1) return authors[0].name;
  if (authors.length === 2) return `${authors[0].name} & ${authors[1].name}`;
  return locale === "ko" ? `${authors[0].name} 외` : `${authors[0].name} et al.`;
}

function formatCitations(count: number) {
  if (count >= 1000) return `${(count / 1000).toFixed(0)}k`;
  return String(count);
}

export function PaperCard({ paper }: PaperCardProps) {
  const { locale, selectedPaperId, setSelectedPaperId, openPaperDetail, closePaperDetail } = useUIStore();
  const toggleStar = useTogglePaperStar();
  const deletePaper = useDeletePaper();
  const confirm = useConfirmDialog((s) => s.show);
  const isSelected = selectedPaperId === paper.id;
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  return (
    <div
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
        background: "var(--color-bg-elevated)",
        border: `1px solid ${isSelected ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
        borderRadius: "var(--radius-md)",
        padding: "14px 14px 12px",
        cursor: "grab",
        transition: "border-color var(--transition-fast), box-shadow var(--transition-fast)",
        boxShadow: isSelected ? "0 0 0 1px var(--color-accent)" : "none",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              marginBottom: 4,
            }}
          >
            {paper.title}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--color-text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {formatAuthors(paper.authors, locale)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
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
              padding: 2,
              color: paper.starred ? "var(--color-warning)" : "var(--color-text-muted)",
            }}
          >
            <Star size={14} fill={paper.starred ? "var(--color-warning)" : "none"} />
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
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 500 }}>{paper.venue}</span>
        <span style={{ color: "var(--color-border)", fontSize: 10 }}>·</span>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{paper.year}</span>
        <div style={{ flex: 1 }} />
        {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
        <StatusBadge status={paper.status} />
      </div>

      {paper.tags.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {paper.tags.slice(0, 3).map((tag) => (
            <Tag key={tag} label={tag} />
          ))}
          {paper.tags.length > 3 ? <Tag label={`+${paper.tags.length - 3}`} /> : null}
        </div>
      ) : null}

      {paper.processingStatus ? (
        <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
          {t("Pipeline:", "파이프라인:")} <strong style={{ textTransform: "capitalize" }}>{paper.processingStatus}</strong>
        </div>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 6, borderTop: "1px solid var(--color-border-subtle)" }}>
        <StatItem icon={<Quote size={10} />} value={formatCitations(paper.citationCount)} />
        <StatItem icon={<FileText size={10} />} value={String(paper.figureCount)} />
        <StatItem icon={<StickyNote size={10} />} value={String(paper.noteCount)} />
        <div style={{ flex: 1 }} />
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
          }}
        >
          {t("Open detail", "상세보기")}
        </button>
      </div>
    </div>
  );
}

function StatItem({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        color: "var(--color-text-muted)",
        fontSize: 10.5,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {icon}
      {value}
    </div>
  );
}
