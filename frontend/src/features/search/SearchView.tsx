import { Clock, FileSearch, FileText, Highlighter, Images, Search, StickyNote, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useRef, useMemo } from "react";
import { localeText } from "@/lib/locale";
import { LatexText, containsLatex } from "@/components/LatexText";
import {
  useAllChunks,
  useAllFigures,
  useAllNotes,
  useAllPapers,
  useFolders,
  useHighlightPresets,
  useSearchHighlightEmbeddings,
  useSemanticChunkSearch,
  useSemanticFigureSearch,
  useSemanticPaperSearch,
} from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import {
  applySearchScope,
  buildSearchGroups,
  buildUnifiedResults,
  semanticResultsToChunks,
} from "./searchModel";
import type { MatchEvidence, UnifiedPaperResult } from "./searchModel";

function buildPageAnchor(paperId: string, pageNumber: number) {
  return {
    paperId,
    pageNumber,
    pageLabel: String(pageNumber),
    anchorId: `paper:${paperId}:page:${pageNumber}`,
  };
}

function formatAuthors(authors: { name: string }[], max = 3) {
  if (authors.length === 0) return "";
  if (authors.length <= max) return authors.map((a) => a.name).join(", ");
  return `${authors[0].name} 외 ${authors.length - 1}명`;
}

const sourceLabels: Record<MatchEvidence["source"], { en: string; ko: string; icon: typeof FileText }> = {
  title: { en: "Title", ko: "제목", icon: FileText },
  content: { en: "Content", ko: "본문", icon: FileSearch },
  highlight: { en: "Highlight", ko: "하이라이트", icon: Highlighter },
  note: { en: "Note", ko: "노트", icon: StickyNote },
  figure: { en: "Figure", ko: "Figure", icon: Images },
};

export function SearchView() {
  const {
    activeFolderId,
    locale,
    searchQuery,
    searchResultKind,
    searchPresetFilter,
    setSearchQuery,
    setSearchResultKind,
    setActiveNav,
    setReaderTargetAnchor,
    setSelectedPaperId,
    openPaperDetail,
  } = useUIStore();
  const { data: allPapers = [] } = useAllPapers();
  const { data: allNotes = [] } = useAllNotes();
  const { data: allChunks = [] } = useAllChunks();
  const { data: allFigures = [] } = useAllFigures();
  const { data: folders = [] } = useFolders();
  const { data: presets = [] } = useHighlightPresets();
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const inputRef = useRef<HTMLInputElement>(null);

  const scopedPapers = useMemo(() => applySearchScope(allPapers, folders, activeFolderId), [allPapers, folders, activeFolderId]);
  const scopedPaperIds = useMemo(() => new Set(scopedPapers.map((p) => p.id)), [scopedPapers]);
  const scopedPaperIdArray = useMemo(() => Array.from(scopedPaperIds), [scopedPaperIds]);
  const paperMap = useMemo(() => new Map(scopedPapers.map((p) => [p.id, p])), [scopedPapers]);
  const presetMap = useMemo(() => new Map(presets.map((p) => [p.id, { name: p.name, colorHex: p.colorHex }])), [presets]);

  // Text search groups
  const groups = useMemo(
    () =>
      buildSearchGroups({
        papers: scopedPapers,
        chunks: allChunks.filter((c) => scopedPaperIds.has(c.paperId)),
        notes: allNotes.filter((n) => scopedPaperIds.has(n.paperId)),
        figures: allFigures.filter((f) => scopedPaperIds.has(f.paperId)),
        query: searchQuery,
      }),
    [scopedPapers, allChunks, allNotes, allFigures, scopedPaperIds, searchQuery],
  );

  // Semantic searches
  const filterIds = activeFolderId ? scopedPaperIdArray : undefined;
  const { data: semanticResults } = useSemanticChunkSearch(searchQuery, filterIds);
  const { data: highlightResults } = useSearchHighlightEmbeddings(searchQuery, searchPresetFilter ?? undefined, filterIds);
  const { data: semanticPaperResults } = useSemanticPaperSearch(searchQuery, filterIds);
  const { data: semanticFigureResults } = useSemanticFigureSearch(searchQuery, ["figure", "table", "equation"], filterIds);

  const semanticChunks = useMemo(
    () => (semanticResults ? semanticResultsToChunks(semanticResults, scopedPapers) : []),
    [semanticResults, scopedPapers],
  );

  // Build unified paper results
  const unifiedResults = useMemo(
    () =>
      searchQuery.trim()
        ? buildUnifiedResults({
            paperMap,
            textMatchPaperIds: new Set(groups.papers.map((p) => p.id)),
            semanticPapers: semanticPaperResults ?? [],
            textChunks: groups.chunks,
            semanticChunks,
            highlights: highlightResults ?? [],
            notes: groups.notes,
            textFigures: groups.figures,
            semanticFigures: semanticFigureResults ?? [],
            presetMap,
            scope: searchResultKind,
          })
        : [],
    [searchQuery, searchResultKind, paperMap, groups, semanticPaperResults, semanticChunks, highlightResults, semanticFigureResults, presetMap],
  );

  // Recent papers for empty state
  const recentPapers = useMemo(
    () => [...scopedPapers].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 6),
    [scopedPapers],
  );

  function openPaper(paperId: string, tab: "overview" | "pdf" | "notes" | "figures" = "overview") {
    setActiveNav("library");
    setSelectedPaperId(paperId);
    openPaperDetail(tab);
  }

  function handleCardClick(result: UnifiedPaperResult) {
    const pageEvidence = result.evidence.find((e) => e.page && (e.source === "content" || e.source === "highlight" || e.source === "figure"));
    if (pageEvidence?.page) {
      setReaderTargetAnchor(buildPageAnchor(result.paperId, pageEvidence.page));
      openPaper(result.paperId, "pdf");
      return;
    }
    openPaper(result.paperId, "overview");
  }

  const hasQuery = searchQuery.trim().length > 0;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "24px 20px 26px" }}>

      {/* ── Hero search bar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
        height: 44,
        borderRadius: "var(--radius-lg)",
        background: "var(--color-bg-elevated)",
        border: `1.5px solid ${hasQuery ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
        marginBottom: 20,
        transition: "border-color 0.15s",
      }}>
        <Search size={16} style={{ color: hasQuery ? "var(--color-accent)" : "var(--color-text-muted)", flexShrink: 0 }} />
        <input
          ref={inputRef}
          autoFocus
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("Search papers, content, notes, highlights…", "논문, 본문, 노트, 하이라이트 검색…")}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--color-text-primary)",
            fontSize: 14,
          }}
        />
        {hasQuery ? (
          <>
            <span style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600, flexShrink: 0 }}>
              {t(`${unifiedResults.length} results`, `${unifiedResults.length}건`)}
            </span>
            <button
              aria-label={t("Clear search", "검색 지우기")}
              onClick={() => { setSearchQuery(""); inputRef.current?.focus(); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 2, flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </>
        ) : null}
      </div>

      {/* ── Scope filter chips ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {([
          { id: "all", en: "All", ko: "전체" },
          { id: "title", en: "Title / Abstract", ko: "제목 · 초록" },
          { id: "content", en: "Content", ko: "본문" },
          { id: "highlights", en: "Highlights", ko: "하이라이트" },
          { id: "notes", en: "Notes", ko: "노트" },
          { id: "figures", en: "Figures", ko: "Figure" },
          { id: "equations", en: "Tables / Equations", ko: "테이블 · 수식" },
        ] as const).map((chip) => {
          const active = searchResultKind === chip.id;
          return (
            <button
              key={chip.id}
              onClick={() => setSearchResultKind(chip.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: active ? 600 : 400,
                border: active ? "1.5px solid var(--color-accent)" : "1px solid var(--color-border-subtle)",
                background: active ? "var(--color-accent-subtle)" : "transparent",
                color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                cursor: "pointer",
                transition: "all 0.12s",
              }}
            >
              {t(chip.en, chip.ko)}
            </button>
          );
        })}
      </div>

      {/* ── Empty state: guides + recent papers ── */}
      {!hasQuery ? (
        <>
          {/* Tip cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: 24 }}>
            {[
              { title: t("Titles & abstracts", "제목 · 초록"), desc: t("Paper names, authors, venues", "논문 제목, 저자, 학술지") },
              { title: t("Full text", "본문 텍스트"), desc: t("Methods, results, sections", "방법, 결과, 섹션 내용") },
              { title: t("Notes & highlights", "노트 · 하이라이트"), desc: t("Your own annotations", "내가 적은 메모와 형광펜") },
            ].map((tip) => (
              <div key={tip.title} style={{
                padding: "10px 12px",
                borderRadius: "var(--radius-md)",
                background: "var(--color-bg-surface)",
                border: "1px solid var(--color-border-subtle)",
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 2 }}>{tip.title}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", lineHeight: 1.5 }}>{tip.desc}</div>
              </div>
            ))}
          </div>

          {/* Recent papers */}
          {recentPapers.length > 0 ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--color-text-muted)" }}>
                <Clock size={13} />
                <span style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {t("Recent Papers", "최근 논문")}
                </span>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {recentPapers.map((paper) => (
                  <button
                    key={paper.id}
                    onClick={() => openPaper(paper.id, "overview")}
                    style={recentCardStyle}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {paper.title}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                        {[formatAuthors(paper.authors, 2), paper.venue, paper.year].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", flexShrink: 0 }}>
                      {t("Open", "열기")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ── Search results ── */}
      {hasQuery && unifiedResults.length === 0 ? (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          minHeight: 180,
          borderRadius: "var(--radius-lg)",
          border: "1px dashed var(--color-border)",
          color: "var(--color-text-muted)",
        }}>
          <Search size={24} style={{ opacity: 0.25 }} />
          <span style={{ fontSize: 13 }}>{t("No results found.", "검색 결과가 없습니다.")}</span>
        </div>
      ) : null}

      {hasQuery && unifiedResults.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {unifiedResults.map((result) => (
            <PaperResultCard
              key={result.paperId}
              result={result}
              locale={locale}
              onClick={() => handleCardClick(result)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── Paper result card ── */

function PaperResultCard({
  result,
  locale,
  onClick,
}: {
  result: UnifiedPaperResult;
  locale: "en" | "ko";
  onClick: () => void;
}) {
  const { paper, score, evidence } = result;
  const bestSimilarity = score > 0.01 ? Math.round(score * 100) : null;

  const snippetEvidence =
    evidence.find((e) => e.source === "content" && e.snippet) ??
    evidence.find((e) => e.source === "highlight" && e.snippet) ??
    evidence.find((e) => e.source === "note" && e.snippet) ??
    evidence.find((e) => e.source === "figure" && e.snippet);

  const sourceCounts = new Map<MatchEvidence["source"], number>();
  for (const e of evidence) {
    sourceCounts.set(e.source, (sourceCounts.get(e.source) ?? 0) + 1);
  }

  return (
    <button onClick={onClick} style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
          {[formatAuthors(paper.authors), paper.venue, paper.year].filter(Boolean).join(" · ")}
        </div>
        {bestSimilarity && bestSimilarity > 30 ? (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 999,
            background: bestSimilarity > 70 ? "rgba(15,118,110,0.12)" : bestSimilarity > 50 ? "rgba(37,99,235,0.1)" : "rgba(0,0,0,0.05)",
            color: bestSimilarity > 70 ? "#0f766e" : bestSimilarity > 50 ? "#2563eb" : "var(--color-text-muted)",
            flexShrink: 0,
          }}>
            {bestSimilarity}%
          </span>
        ) : null}
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.4, marginBottom: snippetEvidence ? 6 : 4 }}>
        {paper.title}
      </div>

      {snippetEvidence?.snippet ? (
        <div style={{
          fontSize: 12,
          color: "var(--color-text-secondary)",
          lineHeight: 1.6,
          marginBottom: 6,
          borderLeft: snippetEvidence.source === "highlight" && snippetEvidence.color
            ? `3px solid ${snippetEvidence.color}`
            : "3px solid var(--color-border-subtle)",
          paddingLeft: 10,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}>
          {containsLatex(snippetEvidence.snippet) ? (
            <LatexText style={{ fontSize: 12 }}>{snippetEvidence.snippet}</LatexText>
          ) : (
            snippetEvidence.snippet
          )}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Array.from(sourceCounts.entries()).map(([src, count]) => {
          const meta = sourceLabels[src];
          const Icon = meta.icon;
          const label = localeText(locale, meta.en, meta.ko);
          return (
            <span
              key={src}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10.5,
                padding: "2px 7px",
                borderRadius: 999,
                background: "var(--color-bg-elevated)",
                color: "var(--color-text-muted)",
                fontWeight: 500,
              }}
            >
              <Icon size={10} />
              {label}{count > 1 ? ` ×${count}` : ""}
            </span>
          );
        })}
      </div>
    </button>
  );
}

/* ── Styles ── */

const cardStyle: CSSProperties = {
  display: "block",
  width: "100%",
  padding: "12px 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-surface)",
  textAlign: "left",
  cursor: "pointer",
};

const recentCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "10px 12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-surface)",
  textAlign: "left",
  cursor: "pointer",
};
