import { localeText } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";
import type { Paper } from "@/types/paper";

import { cardStyle } from "./paperDetailStyles";
import { formatAuthors, formatProcessingLabel } from "./paperDetailUtils";

export function PaperMetadataTab({ paper, folderName }: { paper: Paper; folderName?: string }) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  return (
    <div style={cardStyle}>
      {[
        [t("Title", "제목"), paper.title],
        [t("Authors", "저자"), formatAuthors(paper)],
        [t("Venue", "학술지"), paper.venue],
        [t("Year", "연도"), String(paper.year)],
        [t("DOI", "DOI"), paper.doi || "—"],
        [t("Category", "카테고리"), folderName ?? t("Uncategorized", "미분류")],
        [t("Added", "추가일"), paper.addedAt],
        [t("Read status", "읽기 상태"), paper.status],
        [t("Pipeline", "파이프라인"), formatProcessingLabel(paper.processingStatus, locale)],
      ].map(([label, value]) => (
        <div
          key={label}
          style={{
            display: "grid",
            gridTemplateColumns: "140px minmax(0, 1fr)",
            gap: 14,
            padding: "11px 0",
            borderBottom: "1px solid var(--color-border-subtle)",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{label}</span>
          {label === "DOI" && paper.doi ? (
            <span
              onClick={() => window.redouDesktop?.openExternal(`https://doi.org/${paper.doi}`)}
              style={{ fontSize: 13, color: "var(--color-accent)", lineHeight: 1.6, cursor: "pointer" }}
            >
              {paper.doi}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{value}</span>
          )}
        </div>
      ))}
    </div>
  );
}
