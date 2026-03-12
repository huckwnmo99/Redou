import { useMemo } from "react";
import { ScrollArea } from "radix-ui";
import { FileSearch } from "lucide-react";
import { PaperCard } from "./PaperCard";
import { PaperListItem } from "./PaperListItem";
import { localeText } from "@/lib/locale";
import { useAllPapers, usePapersByFolder, useRecentPapers, useSearchPapers, useStarredPapers } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Paper, SortKey } from "@/types/paper";

function sortPapers(papers: Paper[], key: SortKey): Paper[] {
  return [...papers].sort((a, b) => {
    switch (key) {
      case "year":
        return b.year - a.year;
      case "title":
        return a.title.localeCompare(b.title);
      case "citations":
        return b.citationCount - a.citationCount;
      default:
        return b.addedAt.localeCompare(a.addedAt);
    }
  });
}

function PapersLoader() {
  const { activeFolderId, locale, searchQuery, sortKey, viewMode } = useUIStore();

  const allQuery = useAllPapers();
  const folderQuery = usePapersByFolder(
    activeFolderId && activeFolderId !== "starred" && activeFolderId !== "recent" ? activeFolderId : null
  );
  const starredQuery = useStarredPapers();
  const recentQuery = useRecentPapers();
  const searchQueryResult = useSearchPapers(searchQuery);
  const t = (english: string, korean: string) => localeText(locale, english, korean);

  const { data, isLoading } = useMemo(() => {
    if (searchQuery.trim()) return searchQueryResult;
    if (!activeFolderId) return allQuery;
    if (activeFolderId === "starred") return starredQuery;
    if (activeFolderId === "recent") return recentQuery;
    return folderQuery;
  }, [searchQuery, activeFolderId, allQuery, folderQuery, starredQuery, recentQuery, searchQueryResult]);

  const sorted = useMemo(() => sortPapers(data ?? [], sortKey), [data, sortKey]);

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-muted)", fontSize: 13 }}>
        {t("Loading papers...", "논문을 불러오는 중...")}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12, color: "var(--color-text-muted)" }}>
        <FileSearch size={36} style={{ opacity: 0.3 }} />
        <span style={{ fontSize: 13 }}>{t("No papers found.", "논문을 찾지 못했습니다.")}</span>
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "12px 16px" }}>
        {sorted.map((paper) => (
          <PaperListItem key={paper.id} paper={paper} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, padding: "12px 16px", alignContent: "start" }}>
      {sorted.map((paper) => (
        <PaperCard key={paper.id} paper={paper} />
      ))}
    </div>
  );
}

export function LibraryView() {
  const { searchQuery } = useUIStore();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <SearchSummaryBar query={searchQuery} />

      <ScrollArea.Root style={{ flex: 1, overflow: "hidden" }}>
        <ScrollArea.Viewport style={{ height: "100%", width: "100%" }}>
          <PapersLoader />
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </div>
  );
}

function SearchSummaryBar({ query }: { query: string }) {
  const locale = useUIStore((state) => state.locale);
  const { data: allPapers = [] } = useAllPapers();
  const { data: searched = [] } = useSearchPapers(query);
  const t = (english: string, korean: string) => localeText(locale, english, korean);

  if (!query.trim()) {
    return (
      <div style={{ padding: "6px 16px", fontSize: 11, color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border-subtle)", flexShrink: 0 }}>
        {t(`${allPapers.length} papers`, `${allPapers.length}개 논문`)}
      </div>
    );
  }

  return (
    <div style={{ padding: "6px 16px", fontSize: 11, color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border-subtle)", flexShrink: 0 }}>
      {locale === "ko" ? (
        <>
          <span style={{ color: "var(--color-text-secondary)" }}>&ldquo;{query}&rdquo;</span> 에 대한 결과 {searched.length}개
        </>
      ) : (
        <>
          {searched.length} results for <span style={{ color: "var(--color-text-secondary)" }}>&ldquo;{query}&rdquo;</span>
        </>
      )}
    </div>
  );
}
