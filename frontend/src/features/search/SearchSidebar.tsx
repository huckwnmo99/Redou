import { FileSearch, FileText, Highlighter, Images, StickyNote } from "lucide-react";
import { useMemo } from "react";
import { CategoryTree } from "@/features/library/CategoryTree";
import { localeText } from "@/lib/locale";
import { useAllChunks, useAllFigures, useAllNotes, useAllPapers, useFolders, useHighlightPresets, useSearchHighlightEmbeddings } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { SearchResultKind } from "@/types/paper";
import { applySearchScope, buildSearchGroups } from "./searchModel";

export function SearchSidebar() {
  const { activeFolderId, locale, searchQuery, searchResultKind, searchPresetFilter, setSearchResultKind, setSearchPresetFilter } = useUIStore();
  const { data: allPapers = [] } = useAllPapers();
  const { data: allNotes = [] } = useAllNotes();
  const { data: allChunks = [] } = useAllChunks();
  const { data: allFigures = [] } = useAllFigures();
  const { data: folders = [] } = useFolders();
  const { data: presets = [] } = useHighlightPresets();
  const t = (english: string, korean: string) => localeText(locale, english, korean);

  const scopedPapers = useMemo(() => applySearchScope(allPapers, folders, activeFolderId), [allPapers, folders, activeFolderId]);
  const scopedPaperIds = useMemo(() => new Set(scopedPapers.map((paper) => paper.id)), [scopedPapers]);
  const scopedPaperIdArray = useMemo(() => Array.from(scopedPaperIds), [scopedPaperIds]);

  const { data: highlightResults } = useSearchHighlightEmbeddings(
    searchQuery,
    searchPresetFilter ?? undefined,
    activeFolderId ? scopedPaperIdArray : undefined,
  );

  const groups = useMemo(
    () =>
      buildSearchGroups({
        papers: scopedPapers,
        chunks: allChunks.filter((chunk) => scopedPaperIds.has(chunk.paperId)),
        notes: allNotes.filter((note) => scopedPaperIds.has(note.paperId)),
        figures: allFigures.filter((figure) => scopedPaperIds.has(figure.paperId)),
        query: searchQuery,
      }),
    [allChunks, allFigures, allNotes, scopedPaperIds, scopedPapers, searchQuery],
  );

  const highlightCount = highlightResults?.length ?? 0;

  const kindItems: { id: SearchResultKind; label: string; icon: typeof FileSearch }[] = [
    { id: "all", label: t("All Results", "전체 결과"), icon: FileSearch },
    { id: "papers", label: t("Papers", "논문"), icon: FileText },
    { id: "chunks", label: t("Chunks", "청크"), icon: FileSearch },
    { id: "highlights", label: t("Highlights", "하이라이트"), icon: Highlighter },
    { id: "notes", label: t("Notes", "노트"), icon: StickyNote },
    { id: "figures", label: t("Figures", "Figure"), icon: Images },
  ];

  const counts: Record<string, number> = {
    all: groups.papers.length + groups.chunks.length + groups.notes.length + groups.figures.length + highlightCount,
    papers: groups.papers.length,
    chunks: groups.chunks.length,
    highlights: highlightCount,
    notes: groups.notes.length,
    figures: groups.figures.length,
  };

  return (
    <div style={{ display: "grid", gap: 14, paddingBottom: 12 }}>
      <div>
        <div style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
          {t("Search Views", "검색 보기")}
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          {kindItems.map(({ id, label, icon: Icon }) => {
            const active = searchResultKind === id;
            return (
              <button
                key={id}
                onClick={() => setSearchResultKind(id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  background: active ? "var(--color-accent-subtle)" : "transparent",
                  color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <Icon size={13} style={{ color: active ? "var(--color-accent)" : "var(--color-text-muted)" }} />
                <span style={{ flex: 1, fontSize: 12.5 }}>{label}</span>
                <span style={{ fontSize: 10.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>{counts[id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "0 4px" }} />

      <div>
        <div style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
          {t("Category Scope", "카테고리 범위")}
        </div>
        <CategoryTree />
      </div>

      {presets.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "0 4px" }} />
          <div>
            <div style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
              {t("Preset Collections", "프리셋 컬렉션")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
              {presets.map((preset) => {
                const active = searchPresetFilter?.includes(preset.id) ?? false;
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      if (!searchPresetFilter) {
                        setSearchPresetFilter([preset.id]);
                      } else if (active) {
                        const next = searchPresetFilter.filter((id) => id !== preset.id);
                        setSearchPresetFilter(next.length > 0 ? next : null);
                      } else {
                        setSearchPresetFilter([...searchPresetFilter, preset.id]);
                      }
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "3px 10px", borderRadius: 999,
                      border: active ? `1.5px solid ${preset.colorHex}` : "1px solid var(--color-border-subtle)",
                      background: active ? `${preset.colorHex}18` : "transparent",
                      color: active ? preset.colorHex : "var(--color-text-secondary)",
                      fontSize: 11, fontWeight: active ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: preset.colorHex, flexShrink: 0 }} />
                    {preset.name}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
