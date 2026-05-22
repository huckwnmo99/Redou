import { FileText, Images } from "lucide-react";

import { ProcessingBadge } from "@/components/ProcessingBadge";
import { Tag } from "@/components/Tag";
import { LatexText, containsLatex } from "@/components/LatexText";
import { localeText } from "@/lib/locale";
import { useFiguresByPaper, useSectionsByPaper } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper } from "@/types/paper";

import { cardStyle, eyebrowStyle, lightButtonStyle } from "./paperDetailStyles";
import { buildFallbackAnchor, buildInsightCards, formatProcessingLabel, summarize } from "./paperDetailUtils";

export function PaperOverviewTab({ paper, folderName }: { paper: Paper; folderName?: string }) {
  const { data: sections = [] } = useSectionsByPaper(paper.id);
  const { data: figures = [] } = useFiguresByPaper(paper.id);
  const { locale, openPaperDetail, setReaderTargetAnchor } = useUIStore();
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const fallbackCards = buildInsightCards(paper);
  const insightCards =
    sections.length > 0
      ? sections.slice(0, 3).map((section) => ({
          id: section.id,
          title: section.name,
          body: summarize(section.rawText, 188),
        }))
      : fallbackCards;
  const extractionReady = sections.length > 0 || figures.length > 0;
  const outline = sections.slice(0, 6);
  const leadFigure = figures[0];

  function jumpToPage(pageNumber?: number) {
    if (!pageNumber) {
      return;
    }

    setReaderTargetAnchor(buildFallbackAnchor(paper.id, pageNumber));
    openPaperDetail("pdf");
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)",
          gap: 14,
        }}
      >
        <section style={cardStyle}>
          <div style={eyebrowStyle}>{t("Paper Card", "논문 카드")}</div>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", lineHeight: 1.75, marginBottom: 14 }}>
            {paper.abstract || t("This imported paper has not been summarized yet.", "아직 초록이 추출되지 않았습니다. 추출이 완료되면 내용이 채워집니다.")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {paper.tags.map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
            {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={eyebrowStyle}>{t("Status", "상태")}</div>
          {[
            [t("Read status", "읽기 상태"), paper.status],
            [t("Pipeline", "파이프라인"), formatProcessingLabel(paper.processingStatus, locale)],
            [t("Category", "카테고리"), folderName ?? t("Uncategorized", "미분류")],
            [t("Sections", "섹션"), t(`${sections.length} extracted`, `${sections.length}개 추출`)],
            [t("Figures", "Figure"), t(`${figures.length} extracted`, `${figures.length}개 추출`)],
            [t("Notes", "노트"), t(`${paper.noteCount} linked`, `${paper.noteCount}개 연결`)],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 0",
                borderBottom: "1px solid var(--color-border-subtle)",
                fontSize: 13,
              }}
            >
              <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
              <span style={{ color: "var(--color-text-primary)", fontWeight: 600, textTransform: "capitalize" }}>{value}</span>
            </div>
          ))}
        </section>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {insightCards.map((card, index) => (
          <section key={"id" in card ? (card.id as string) : `fallback-${index}`} style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{card.title}</div>
            <p style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>{card.body}</p>
          </section>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 0.7fr)",
          gap: 14,
        }}
      >
        <section style={cardStyle}>
          <div style={eyebrowStyle}>{t("Section Outline", "섹션 목차")}</div>
          {extractionReady && outline.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {outline.map((section, index) => (
                <div key={section.id} style={{ padding: 12, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{section.pageStart ? `${section.name} - Page ${section.pageStart}${section.pageEnd && section.pageEnd !== section.pageStart ? `-${section.pageEnd}` : ""}` : section.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>#{index + 1}</div>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: section.pageStart ? 10 : 0 }}>
                    {summarize(section.rawText, 210)}
                  </div>
                  {section.pageStart ? (
                    <button onClick={() => jumpToPage(section.pageStart)} style={lightButtonStyle}>
                      <FileText size={13} />
                      {t("Open section page", "섹션 페이지 열기")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: 14, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)", fontSize: 12.5, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
              {paper.processingStatus === "running"
                ? t("The extraction worker is still assembling the section outline.", "섹션 목차를 추출하고 있습니다.")
                : t("No section outline available yet.", "아직 섹션 목차가 없습니다. PDF를 가져오거나 재추출하면 채워집니다.")}
            </div>
          )}
        </section>

        <section style={cardStyle}>
          <div style={eyebrowStyle}>{t("Figure Signal", "Figure 미리보기")}</div>
          {leadFigure ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ padding: 12, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{leadFigure.figureNo}</div>
                  <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{leadFigure.page ? t(`Page ${leadFigure.page} - ${figures.length} total`, `${leadFigure.page}페이지 · 총 ${figures.length}개`) : t(`${figures.length} total`, `총 ${figures.length}개`)}</div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 10 }}>
                  {containsLatex(leadFigure.caption) ? (
                    <LatexText style={{ fontSize: 12.5 }}>{leadFigure.caption!}</LatexText>
                  ) : (leadFigure.caption ?? t("Caption not extracted yet.", "캡션이 아직 추출되지 않았습니다."))}
                </div>
                {leadFigure.summaryText ? (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.7, marginBottom: leadFigure.page ? 10 : 0 }}>
                    {containsLatex(leadFigure.summaryText) ? (
                      <LatexText style={{ fontSize: 11.5 }}>{leadFigure.summaryText}</LatexText>
                    ) : leadFigure.summaryText}
                  </div>
                ) : null}
                {leadFigure.page ? (
                  <button onClick={() => jumpToPage(leadFigure.page)} style={lightButtonStyle}>
                    <Images size={13} />
                    {t("Open figure page", "Figure 페이지 열기")}
                  </button>
                ) : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {figures.slice(0, 4).map((figure) => (
                  <button
                    key={figure.id}
                    onClick={() => jumpToPage(figure.page)}
                    disabled={!figure.page}
                    style={{
                      ...lightButtonStyle,
                      cursor: figure.page ? "pointer" : "default",
                      opacity: figure.page ? 1 : 0.7,
                    }}
                  >
                    <Images size={12} />
                    {figure.page ? `${figure.figureNo} - p.${figure.page}` : figure.figureNo}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: 14, borderRadius: "var(--radius-md)", background: "var(--color-bg-panel)", fontSize: 12.5, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
              {paper.processingStatus === "running"
                ? "Figure captions will appear here once the worker finishes the first extraction pass."
                : "No figures have been extracted for this paper yet."}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
