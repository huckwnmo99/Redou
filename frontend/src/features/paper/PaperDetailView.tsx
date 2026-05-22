import { ArrowLeft, ExternalLink, FileText, Images, Quote, StickyNote } from "lucide-react";
import { useMemo } from "react";
import { ProcessingBadge } from "@/components/ProcessingBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Tag } from "@/components/Tag";
import { localeText } from "@/lib/locale";
import { useFolders, usePaperById } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import { PaperExtractedItemsTab } from "@/features/paper/paperDetail/PaperExtractedItemsTab";
import { PaperMetadataTab } from "@/features/paper/paperDetail/PaperMetadataTab";
import { PaperNotesTab } from "@/features/paper/paperDetail/PaperNotesTab";
import { PaperOverviewTab } from "@/features/paper/paperDetail/PaperOverviewTab";
import { PaperPdfTab } from "@/features/paper/paperDetail/PaperPdfTab";
import { PaperReferencesTab } from "@/features/paper/paperDetail/PaperReferencesTab";
import { tabDefs } from "@/features/paper/paperDetail/paperDetailConstants";
import { lightButtonStyle } from "@/features/paper/paperDetail/paperDetailStyles";
import { formatAuthors, formatProcessingLabel } from "@/features/paper/paperDetail/paperDetailUtils";

export function PaperDetailView() {
  const { locale, selectedPaperId, paperDetailTab, setPaperDetailTab, closePaperDetail } = useUIStore();
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: paper } = usePaperById(selectedPaperId);
  const { data: folders = [] } = useFolders();

  const folderName = useMemo(
    () => folders.find((folder) => folder.id === paper?.folderId)?.name,
    [folders, paper?.folderId],
  );

  if (!paper) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)" }}>
        {t("Select a paper to open the detail workspace.", "논문을 선택하면 상세 화면이 열립니다.")}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "18px 20px 26px" }}>
      <div style={{ display: "grid", gap: 18 }}>
        <div
          style={{
            padding: 20,
            borderRadius: "var(--radius-xl)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 14 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <StatusBadge status={paper.status} />
                {paper.processingStatus ? <ProcessingBadge status={paper.processingStatus} /> : null}
                {folderName ? <Tag label={folderName} /> : null}
              </div>
              <h2 style={{ fontSize: 24, lineHeight: 1.3, marginBottom: 8 }}>{paper.title}</h2>
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.75 }}>
                {formatAuthors(paper)}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, color: "var(--color-text-muted)", fontSize: 12.5, flexWrap: "wrap" }}>
                <span>{paper.venue || t("Venue pending", "학술지 대기중")}</span>
                <span>|</span>
                <span>{paper.year || t("Year pending", "연도 대기중")}</span>
                <span>|</span>
                <span>{t(`${paper.citationCount.toLocaleString()} citations`, `인용 ${paper.citationCount.toLocaleString()}회`)}</span>
                {paper.doi && (
                  <>
                    <span>|</span>
                    <span
                      onClick={() => window.redouDesktop?.openExternal(`https://doi.org/${paper.doi}`)}
                      style={{ color: "var(--color-accent)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}
                    >
                      <ExternalLink size={11} />
                      DOI
                    </span>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button onClick={closePaperDetail} style={lightButtonStyle}>
                <ArrowLeft size={14} />
                {t("Back to Library", "라이브러리로")}
              </button>
              <button
                onClick={() => setPaperDetailTab("pdf")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 34,
                  padding: "0 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  background: "var(--color-accent)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <FileText size={14} />
                {t("Open Reader", "리더 열기")}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--color-text-muted)", fontSize: 12.5, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Quote size={13} />
              {paper.citationCount.toLocaleString()}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Images size={13} />
              {t(`${paper.figureCount} figures`, `Figure ${paper.figureCount}개`)}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <StickyNote size={13} />
              {t(`${paper.noteCount} notes`, `노트 ${paper.noteCount}개`)}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ExternalLink size={13} />
              {formatProcessingLabel(paper.processingStatus, locale)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tabDefs.map((tab) => {
            const active = tab.id === paperDetailTab;
            return (
              <button
                key={tab.id}
                onClick={() => setPaperDetailTab(tab.id)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "999px",
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
                  background: active ? "var(--color-accent-subtle)" : "var(--color-bg-elevated)",
                  color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                  fontSize: 12.5,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {localeText(locale, tab.en, tab.ko)}
              </button>
            );
          })}
        </div>

        {paperDetailTab === "overview" ? <PaperOverviewTab paper={paper} folderName={folderName} /> : null}
        {paperDetailTab === "pdf" ? <PaperPdfTab paper={paper} folderName={folderName} /> : null}
        {paperDetailTab === "notes" ? <PaperNotesTab paper={paper} /> : null}
        {paperDetailTab === "figures" ? <PaperExtractedItemsTab paper={paper} filterType="figure" /> : null}
        {paperDetailTab === "tables" ? <PaperExtractedItemsTab paper={paper} filterType="table" /> : null}
        {paperDetailTab === "equations" ? <PaperExtractedItemsTab paper={paper} filterType="equation" /> : null}
        {paperDetailTab === "references" ? <PaperReferencesTab paper={paper} /> : null}
        {paperDetailTab === "metadata" ? <PaperMetadataTab paper={paper} folderName={folderName} /> : null}
      </div>
    </div>
  );
}



