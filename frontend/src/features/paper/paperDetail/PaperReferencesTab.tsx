import { Link2 } from "lucide-react";

import { localeText } from "@/lib/locale";
import { useReferencesByPaper } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper } from "@/types/paper";

import { cardStyle, eyebrowStyle } from "./paperDetailStyles";

export function PaperReferencesTab({ paper }: { paper: Paper }) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: references = [], isLoading } = useReferencesByPaper(paper.id);

  if (isLoading) {
    return (
      <div style={cardStyle}>
        <div style={eyebrowStyle}>{t("References", "참고문헌")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{t("Loading references...", "참고문헌 불러오는 중...")}</p>
      </div>
    );
  }

  if (references.length === 0) {
    return (
      <div style={cardStyle}>
        <div style={eyebrowStyle}>{t("References", "참고문헌")}</div>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          {t("No references extracted yet.", "아직 참고문헌이 추출되지 않았습니다.")}
        </p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={eyebrowStyle}>
        {t("References", "참고문헌")} ({references.length})
      </div>
      <div style={{ display: "grid", gap: 2 }}>
        {references.map((ref) => {
          const authorStr = ref.refAuthors.map((a) => a.name).join(", ");
          return (
            <div
              key={ref.id}
              style={{
                padding: "10px 0",
                borderBottom: "1px solid var(--color-border-subtle)",
                display: "grid",
                gridTemplateColumns: "32px minmax(0, 1fr)",
                gap: 8,
                alignItems: "start",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600, paddingTop: 2 }}>
                [{ref.refOrder}]
              </span>
              <div>
                <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6, marginBottom: 2 }}>
                  {ref.refTitle || ref.refRawText || t("Untitled reference", "제목 없는 참고문헌")}
                </p>
                {authorStr ? <p style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{authorStr}</p> : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {ref.refJournal ? <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontStyle: "italic" }}>{ref.refJournal}</span> : null}
                  {ref.refYear ? <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{ref.refYear}</span> : null}
                  {ref.refVolume ? <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>Vol. {ref.refVolume}</span> : null}
                  {ref.refPages ? <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>pp. {ref.refPages}</span> : null}
                  {ref.refDoi ? (
                    <a
                      href={`https://doi.org/${ref.refDoi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "var(--color-accent)", textDecoration: "none" }}
                    >
                      DOI
                    </a>
                  ) : null}
                  {ref.linkedPaperId ? (
                    <span style={{ fontSize: 11, color: "var(--color-success)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <Link2 size={10} /> {t("In Library", "라이브러리에 있음")}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
