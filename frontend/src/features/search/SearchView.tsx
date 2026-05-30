import {
  ArrowRight,
  Clock,
  FileSearch,
  FileText,
  Highlighter,
  Images,
  Search,
  SearchX,
  Sparkles,
  StickyNote,
  X,
} from "lucide-react";
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
import type { SearchResultKind } from "@/types/paper";

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

/**
 * Per-source visual metadata. `icon`/`en`/`ko` were already present; `color`
 * is ported from the kit's SOURCE_META so the source rail/chip icons get a
 * subtle accent per evidence type (purely cosmetic — no logic depends on it).
 */
const sourceLabels: Record<MatchEvidence["source"], { en: string; ko: string; icon: typeof FileText; color: string }> = {
  title: { en: "Title", ko: "제목", icon: FileText, color: "var(--color-accent)" },
  content: { en: "Content", ko: "본문", icon: FileSearch, color: "var(--color-text-secondary)" },
  highlight: { en: "Highlight", ko: "하이라이트", icon: Highlighter, color: "#f59e0b" },
  note: { en: "Note", ko: "노트", icon: StickyNote, color: "#a855f7" },
  figure: { en: "Figure", ko: "Figure", icon: Images, color: "#22d3a0" },
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

/** Category chips → which evidence source icon/color represents the chip. */
const chipSourceMeta: Partial<Record<SearchResultKind, MatchEvidence["source"]>> = {
  title: "title",
  content: "content",
  highlights: "highlight",
  notes: "note",
  figures: "figure",
  equations: "figure",
};

/**
 * Highlights occurrences of the live query tokens inside a plain snippet by
 * wrapping them in <mark>. Replaces the kit's hard-coded `**bold**` parsing —
 * here the marks come from the *actual* search query. LaTeX snippets skip this
 * (handled by LatexText) so KaTeX rendering is never corrupted.
 */
function highlightSnippet(snippet: string, query: string) {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return snippet;

  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tokenSet = new Set(tokens);
  // Capturing group → split keeps the delimiters; matched tokens land on the
  // odd indices but we additionally membership-check (case-insensitive) to be safe.
  const parts = snippet.split(new RegExp(`(${escaped.join("|")})`, "gi"));

  return parts.map((part, i) =>
    part && tokenSet.has(part.toLowerCase()) ? (
      <mark
        key={i}
        style={{
          background: "rgba(245,158,11,0.32)",
          padding: "1px 3px",
          borderRadius: 2,
          color: "inherit",
          fontWeight: 600,
        }}
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

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

  // Per-category paper counts for the chip badges (display-only, derived from the
  // same search inputs — does NOT re-run buildUnifiedResults per scope, and does
  // not affect search/sorting). Count = distinct papers with matching evidence.
  const chipCounts = useMemo(() => {
    if (!searchQuery.trim()) {
      return { all: 0, title: 0, content: 0, highlights: 0, notes: 0, figures: 0, equations: 0 } as Record<SearchResultKind, number>;
    }
    const titleIds = new Set<string>();
    for (const p of groups.papers) titleIds.add(p.id);
    for (const sp of semanticPaperResults ?? []) titleIds.add(sp.paperId);

    const contentIds = new Set<string>();
    for (const c of groups.chunks) contentIds.add(c.paperId);
    for (const c of semanticChunks) contentIds.add(c.paperId);

    const highlightIds = new Set<string>();
    for (const hl of highlightResults ?? []) highlightIds.add(hl.paperId);

    const noteIds = new Set<string>();
    for (const n of groups.notes) noteIds.add(n.paperId);

    const figureIds = new Set<string>();
    const equationIds = new Set<string>();
    for (const f of groups.figures) {
      if (f.itemType === "figure") figureIds.add(f.paperId);
      else equationIds.add(f.paperId);
    }
    for (const f of semanticFigureResults ?? []) {
      if (f.itemType === "figure") figureIds.add(f.paperId);
      else equationIds.add(f.paperId);
    }

    const allIds = new Set<string>();
    for (const set of [titleIds, contentIds, highlightIds, noteIds, figureIds, equationIds]) {
      for (const id of set) allIds.add(id);
    }

    return {
      all: allIds.size,
      title: titleIds.size,
      content: contentIds.size,
      highlights: highlightIds.size,
      notes: noteIds.size,
      figures: figureIds.size,
      equations: equationIds.size,
    } as Record<SearchResultKind, number>;
  }, [searchQuery, groups, semanticPaperResults, semanticChunks, highlightResults, semanticFigureResults]);

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

  // Domain-neutral example prompts (kit's chemistry-specific examples were not
  // adopted). Clicking sets the live search query.
  const tryPrompts = [
    t("attention mechanism", "어텐션 메커니즘"),
    t("retrieval augmented generation", "검색 증강 생성"),
    t("evaluation benchmark", "평가 벤치마크"),
    t("ablation study", "어블레이션 연구"),
  ];

  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--color-bg-surface)" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px 80px" }}>

        {/* ── Hero search bar ── */}
        <div style={{ ...eyebrowStyle, marginBottom: 10 }}>{t("Search", "검색")}</div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 18px",
          height: 54,
          borderRadius: "var(--radius-lg)",
          background: "var(--color-bg-elevated)",
          border: `1.5px solid ${hasQuery ? "var(--color-accent)" : "var(--color-border)"}`,
          boxShadow: hasQuery ? "0 0 0 4px var(--color-accent-subtle)" : "var(--shadow-sm)",
          transition: "border-color 150ms, box-shadow 150ms",
        }}>
          <Search size={18} style={{ color: hasQuery ? "var(--color-accent)" : "var(--color-text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && searchQuery) {
                e.preventDefault();
                setSearchQuery("");
              }
            }}
            placeholder={t("Search papers, content, notes, highlights…", "논문, 본문, 노트, 하이라이트 검색…")}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--color-text-primary)",
              fontSize: 17,
              fontWeight: 400,
              letterSpacing: "-0.005em",
            }}
          />
          {hasQuery ? (
            <>
              <span style={{ fontSize: 11.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                {t(`${unifiedResults.length} results`, `${unifiedResults.length}건`)}
              </span>
              <button
                aria-label={t("Clear search", "검색 지우기")}
                onClick={() => { setSearchQuery(""); inputRef.current?.focus(); }}
                style={{
                  width: 26,
                  height: 26,
                  background: "var(--color-bg-hover)",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  color: "var(--color-text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <kbd
              onClick={() => inputRef.current?.focus()}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "3px 7px",
                background: "var(--color-bg-panel)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-xs)",
                color: "var(--color-text-muted)",
                fontVariantNumeric: "tabular-nums",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ⌘ K
            </kbd>
          )}
        </div>

        {/* ── Search mode: honest "Hybrid" info chip (not a fake toggle) ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, marginBottom: hasQuery ? 18 : 28 }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid var(--color-accent)",
            background: "var(--color-accent-subtle)",
            color: "var(--color-accent)",
            fontSize: 11.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}>
            <Sparkles size={11} />
            {t("Hybrid", "하이브리드")}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
            {t("Semantic + keyword search run together", "의미 검색과 키워드 검색을 동시에 실행")}
          </span>
        </div>

        {/* ── Scope filter chips (icon + count, count=0 disabled) ── */}
        {hasQuery ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 22 }}>
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
              const count = chipCounts[chip.id] ?? 0;
              const disabled = count === 0 && chip.id !== "all";
              const sourceKey = chipSourceMeta[chip.id];
              const ChipIcon = sourceKey ? sourceLabels[sourceKey].icon : null;
              const iconColor = active ? "var(--color-accent)" : sourceKey ? sourceLabels[sourceKey].color : "var(--color-text-muted)";
              return (
                <button
                  key={chip.id}
                  onClick={() => setSearchResultKind(chip.id)}
                  disabled={disabled}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 11px",
                    borderRadius: 999,
                    fontSize: 11.5,
                    fontWeight: active ? 600 : 500,
                    border: active ? "1.5px solid var(--color-accent)" : "1px solid var(--color-border-subtle)",
                    background: active ? "var(--color-accent-subtle)" : "var(--color-bg-elevated)",
                    color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                    cursor: disabled ? "default" : "pointer",
                    transition: "all 120ms",
                    opacity: disabled ? 0.45 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {ChipIcon ? <ChipIcon size={11} style={{ color: iconColor }} /> : null}
                  {t(chip.en, chip.ko)}
                  <span style={{
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 10.5,
                    color: active ? "var(--color-accent)" : "var(--color-text-muted)",
                    opacity: 0.8,
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* ── Empty state: Try chips + recent papers ── */}
        {!hasQuery ? (
          <div style={{ display: "grid", gap: 30 }}>
            {/* Try prompt chips */}
            <section>
              <div style={{ ...eyebrowStyle, marginBottom: 10 }}>{t("Try", "이렇게 검색해보세요")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tryPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => { setSearchQuery(prompt); inputRef.current?.focus(); }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid var(--color-border-subtle)",
                      background: "var(--color-bg-elevated)",
                      color: "var(--color-text-secondary)",
                      fontSize: 12,
                      cursor: "pointer",
                      transition: "all var(--transition-fast)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <Sparkles size={11} style={{ color: "var(--color-accent)" }} />
                    {prompt}
                  </button>
                ))}
              </div>
            </section>

            {/* Recent papers (real data) */}
            {recentPapers.length > 0 ? (
              <section>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Clock size={13} style={{ color: "var(--color-text-muted)" }} />
                  <span style={eyebrowStyle}>{t("Recent papers", "최근 논문")}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {recentPapers.map((paper) => (
                    <button
                      key={paper.id}
                      onClick={() => openPaper(paper.id, "overview")}
                      style={recentCardStyle}
                    >
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: "var(--radius-sm)",
                        background: "var(--color-accent-subtle)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--color-accent)",
                        flexShrink: 0,
                      }}>
                        <FileText size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "var(--color-text-primary)",
                          lineHeight: 1.4,
                          marginBottom: 3,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}>
                          {paper.title}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                          {[formatAuthors(paper.authors, 2), paper.venue, paper.year].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {/* ── No results ── */}
        {hasQuery && unifiedResults.length === 0 ? (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            minHeight: 200,
            borderRadius: "var(--radius-lg)",
            border: "1px dashed var(--color-border)",
            color: "var(--color-text-muted)",
            padding: 20,
          }}>
            <SearchX size={28} style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              <strong style={{ color: "var(--color-text-primary)" }}>“{searchQuery.trim()}”</strong>
              {t(" — no results.", " 에 대한 결과가 없습니다.")}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", textAlign: "center", lineHeight: 1.65, maxWidth: 340 }}>
              {t(
                "Try a different category filter, or add more papers to your library.",
                "다른 카테고리 필터를 시도하거나, 라이브러리에 논문을 더 추가해보세요.",
              )}
            </div>
          </div>
        ) : null}

        {/* ── Search results (paper-centric cards) ── */}
        {hasQuery && unifiedResults.length > 0 ? (
          <div style={{ display: "grid", gap: 6 }}>
            {unifiedResults.map((result) => (
              <PaperResultCard
                key={result.paperId}
                result={result}
                locale={locale}
                query={searchQuery}
                onClick={() => handleCardClick(result)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Paper result card (kit 3-column: source rail / body / score+open) ── */

function PaperResultCard({
  result,
  locale,
  query,
  onClick,
}: {
  result: UnifiedPaperResult;
  locale: "en" | "ko";
  query: string;
  onClick: () => void;
}) {
  const { paper, score, evidence } = result;
  const bestSimilarity = score > 0.01 ? Math.round(score * 100) : null;
  const strong = bestSimilarity != null && bestSimilarity > 70;
  const ok = bestSimilarity != null && bestSimilarity > 50 && bestSimilarity <= 70;

  const snippetEvidence =
    evidence.find((e) => e.source === "content" && e.snippet) ??
    evidence.find((e) => e.source === "highlight" && e.snippet) ??
    evidence.find((e) => e.source === "note" && e.snippet) ??
    evidence.find((e) => e.source === "figure" && e.snippet);

  // Representative source for the left rail: the snippet's source, else the
  // first evidence's source (preserves the paper-centric aggregate — the full
  // set of matched sources is still shown as badges below).
  const railSource = snippetEvidence?.source ?? evidence[0]?.source ?? "title";
  const railMeta = sourceLabels[railSource];
  const RailIcon = railMeta.icon;
  const railPage = snippetEvidence?.page ?? evidence.find((e) => e.page)?.page;

  const sourceCounts = new Map<MatchEvidence["source"], number>();
  for (const e of evidence) {
    sourceCounts.set(e.source, (sourceCounts.get(e.source) ?? 0) + 1);
  }

  const snippetIsLatex = snippetEvidence?.snippet ? containsLatex(snippetEvidence.snippet) : false;

  return (
    <button style={cardStyle} onClick={onClick}>
      {/* Left source rail */}
      <div style={{ width: 32, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          background: `color-mix(in oklab, ${railMeta.color} 12%, transparent)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: railMeta.color,
        }}>
          <RailIcon size={14} />
        </div>
        {railPage ? (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            p.{railPage}
          </span>
        ) : null}
      </div>

      {/* Main body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-text-primary)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            flex: 1,
            minWidth: 0,
          }}>
            {paper.title}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--color-text-muted)", flexShrink: 0 }}>
            {[paper.venue, paper.year].filter(Boolean).join(" · ")}
          </span>
        </div>

        {snippetEvidence?.snippet ? (
          <div style={{
            fontSize: 12.5,
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
            {snippetIsLatex ? (
              <LatexText style={{ fontSize: 12.5 }}>{snippetEvidence.snippet}</LatexText>
            ) : (
              highlightSnippet(snippetEvidence.snippet, query)
            )}
          </div>
        ) : null}

        {/* Source badges (multi-source aggregate — preserved from paper-centric model) */}
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
                  background: "var(--color-bg-panel)",
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
      </div>

      {/* Right: match% + Open */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", gap: 4 }}>
        {bestSimilarity != null && bestSimilarity > 30 ? (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 999,
            background: strong ? "rgba(15,118,110,0.12)" : ok ? "var(--color-accent-subtle)" : "var(--color-bg-panel)",
            color: strong ? "var(--color-success)" : ok ? "var(--color-accent)" : "var(--color-text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}>
            {bestSimilarity}%
          </span>
        ) : (
          <span />
        )}
        <span style={{ fontSize: 10.5, color: "var(--color-text-muted)", display: "inline-flex", alignItems: "center", gap: 3 }}>
          {localeText(locale, "Open", "열기")} <ArrowRight size={10} />
        </span>
      </div>
    </button>
  );
}

/* ── Styles ── */

const cardStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  width: "100%",
  padding: "12px 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-elevated)",
  textAlign: "left",
  cursor: "pointer",
};

const recentCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  width: "100%",
  padding: "12px 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-elevated)",
  textAlign: "left",
  cursor: "pointer",
};
