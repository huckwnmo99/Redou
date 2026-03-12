import { FileSearch, FileText, Highlighter, Images, Search, StickyNote } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { localeText } from "@/lib/locale";
import { useAllChunks, useAllFigures, useAllNotes, useAllPapers, useFolders, useHighlightPresets, useSearchHighlightEmbeddings, useSemanticChunkSearch } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { HighlightSearchResult } from "@/types/paper";
import { applySearchScope, buildSearchGroups, getVisibleSearchKinds, semanticResultsToChunks } from "./searchModel";

function buildPageAnchor(paperId: string, pageNumber: number) {
  return {
    paperId,
    pageNumber,
    pageLabel: String(pageNumber),
    anchorId: `paper:${paperId}:page:${pageNumber}`,
  };
}

export function SearchView() {
  const {
    activeFolderId,
    locale,
    searchQuery,
    searchResultKind,
    searchPresetFilter,
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
  const t = (english: string, korean: string) => localeText(locale, english, korean);

  const searchGuides = [
    {
      title: t("Search titles and abstracts", "제목과 초록 검색"),
      description: t("Use paper names, author cues, or venue keywords.", "논문 제목, 저자 힌트, 학술지 키워드로 찾아보세요."),
    },
    {
      title: t("Search extracted text", "추출된 텍스트 검색"),
      description: t("Method terms, result phrases, or section language also work.", "방법 용어, 결과 문장, 섹션 표현으로도 찾을 수 있습니다."),
    },
    {
      title: t("Search saved notes", "저장된 노트 검색"),
      description: t("Your own note wording is often the fastest way back to a paper.", "내가 적은 노트 문구가 논문으로 가장 빨리 돌아가는 길일 때가 많습니다."),
    },
  ];

  const scopedPapers = useMemo(() => applySearchScope(allPapers, folders, activeFolderId), [allPapers, folders, activeFolderId]);
  const scopedPaperIds = useMemo(() => new Set(scopedPapers.map((paper) => paper.id)), [scopedPapers]);
  const scopedNotes = useMemo(() => allNotes.filter((note) => scopedPaperIds.has(note.paperId)), [allNotes, scopedPaperIds]);
  const scopedChunks = useMemo(() => allChunks.filter((chunk) => scopedPaperIds.has(chunk.paperId)), [allChunks, scopedPaperIds]);
  const scopedFigures = useMemo(() => allFigures.filter((figure) => scopedPaperIds.has(figure.paperId)), [allFigures, scopedPaperIds]);
  const scopedPaperIdArray = useMemo(() => Array.from(scopedPaperIds), [scopedPaperIds]);
  const { data: semanticResults, isFetching: semanticLoading } = useSemanticChunkSearch(
    searchQuery,
    activeFolderId ? scopedPaperIdArray : undefined,
  );
  const { data: presets = [] } = useHighlightPresets();
  const { data: highlightResults, isFetching: highlightLoading } = useSearchHighlightEmbeddings(
    searchQuery,
    searchPresetFilter ?? undefined,
    activeFolderId ? scopedPaperIdArray : undefined,
  );
  const presetById = useMemo(() => new Map(presets.map((p) => [p.id, p])), [presets]);
  const paperById = useMemo(() => new Map(scopedPapers.map((p) => [p.id, p])), [scopedPapers]);
  const displayedHighlights: HighlightSearchResult[] = highlightResults ?? [];

  const groups = useMemo(
    () =>
      buildSearchGroups({
        papers: scopedPapers,
        chunks: scopedChunks,
        notes: scopedNotes,
        figures: scopedFigures,
        query: searchQuery,
      }),
    [scopedPapers, scopedChunks, scopedNotes, scopedFigures, searchQuery],
  );

  const useSemanticChunks = Boolean(semanticResults && semanticResults.length > 0);
  const semanticChunks = useMemo(
    () => (semanticResults ? semanticResultsToChunks(semanticResults, scopedPapers) : []),
    [semanticResults, scopedPapers],
  );
  const displayedChunks = useSemanticChunks ? semanticChunks : groups.chunks;

  const visibleKinds = getVisibleSearchKinds(searchResultKind);
  const totalVisibleResults = visibleKinds.reduce(
    (count, kind) =>
      count + (kind === "chunks" ? displayedChunks.length : kind === "highlights" ? displayedHighlights.length : groups[kind].length),
    0,
  );

  function openPaper(paperId: string, tab: "overview" | "pdf" | "notes" | "figures" = "overview") {
    setActiveNav("library");
    setSelectedPaperId(paperId);
    openPaperDetail(tab);
  }

  function openChunk(paperId: string, page?: number) {
    if (page) {
      setReaderTargetAnchor(buildPageAnchor(paperId, page));
      openPaper(paperId, "pdf");
      return;
    }

    openPaper(paperId, "overview");
  }

  function openNote(paperId: string, _noteId: string) {
    setSelectedPaperId(paperId);
    openPaperDetail("notes");
  }

  function openFigure(paperId: string, page?: number) {
    if (page) {
      setReaderTargetAnchor(buildPageAnchor(paperId, page));
      openPaper(paperId, "pdf");
      return;
    }

    openPaper(paperId, "figures");
  }

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "18px 20px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>{t("Search Workspace", "검색 워크스페이스")}</h2>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
            {t(
              "Search real papers, extracted chunks, notes, and figure captions while respecting the current folder scope.",
              "현재 폴더 범위를 유지한 채 실제 논문, 추출된 청크, 노트, Figure 캡션을 검색합니다.",
            )}
          </p>
        </div>
        <div style={{ padding: "8px 12px", borderRadius: "999px", background: "var(--color-bg-elevated)", border: "1px solid var(--color-border-subtle)", color: "var(--color-text-secondary)", fontSize: 12, fontWeight: 600 }}>
          {searchQuery.trim() ? t(`${totalVisibleResults} visible results`, `보이는 결과 ${totalVisibleResults}개`) : t("Ready to search", "검색 준비 완료")}
        </div>
      </div>

      {!searchQuery.trim() ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 20 }}>
          {searchGuides.map((guide) => (
            <div
              key={guide.title}
              style={{
                padding: 16,
                borderRadius: "var(--radius-lg)",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border-subtle)",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>{t("Search guide", "검색 가이드")}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 6 }}>{guide.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{guide.description}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 14 }}>
        {visibleKinds.includes("papers") ? (
          <section style={sectionStyle}>
            <SectionTitle icon={<FileText size={14} />} title={t("Papers", "논문")} count={groups.papers.length} />
            {groups.papers.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {groups.papers.map((paper) => (
                  <button key={paper.id} onClick={() => openPaper(paper.id, "overview")} style={resultCardStyle}>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6 }}>
                      {paper.venue} • {paper.year}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{paper.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{paper.abstract}</div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptySearchState message={t("No paper matches for the current scope.", "현재 범위에서 일치하는 논문이 없습니다.")} />
            )}
          </section>
        ) : null}

        {visibleKinds.includes("chunks") ? (
          <section style={sectionStyle}>
            <SectionTitle
              icon={<FileSearch size={14} />}
              title={useSemanticChunks ? t("Semantic Results", "시맨틱 결과") : t("Chunks", "청크")}
              count={displayedChunks.length}
              badge={semanticLoading ? t("Searching...", "검색 중...") : useSemanticChunks ? t("AI", "AI") : undefined}
            />
            {displayedChunks.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {displayedChunks.map((chunk) => (
                  <button key={chunk.id} onClick={() => openChunk(chunk.paperId, chunk.page)} style={resultCardStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>{chunk.label}</div>
                      {chunk.similarity != null ? (
                        <div style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "999px",
                          background: chunk.similarity > 0.7 ? "rgba(15,118,110,0.12)" : chunk.similarity > 0.5 ? "rgba(37,99,235,0.1)" : "rgba(0,0,0,0.05)",
                          color: chunk.similarity > 0.7 ? "#0f766e" : chunk.similarity > 0.5 ? "#2563eb" : "var(--color-text-muted)",
                        }}>
                          {Math.round(chunk.similarity * 100)}%
                        </div>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{chunk.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{chunk.snippet}</div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptySearchState message={t("No extracted chunk matches for the current search.", "현재 검색어와 일치하는 추출 청크가 없습니다.")} />
            )}
          </section>
        ) : null}

        {visibleKinds.includes("highlights") ? (
          <section style={sectionStyle}>
            <SectionTitle
              icon={<Highlighter size={14} />}
              title={t("Highlights", "하이라이트")}
              count={displayedHighlights.length}
              badge={highlightLoading ? t("Searching...", "검색 중...") : displayedHighlights.length > 0 ? t("AI", "AI") : undefined}
            />
            {displayedHighlights.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {displayedHighlights.map((hl) => {
                  const preset = presetById.get(hl.presetId);
                  const paper = paperById.get(hl.paperId);
                  return (
                    <button key={hl.id} onClick={() => openPaper(hl.paperId, "pdf")} style={resultCardStyle}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {preset ? (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
                              background: `${preset.colorHex}18`, color: preset.colorHex,
                              border: `1px solid ${preset.colorHex}40`,
                            }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: preset.colorHex }} />
                              {preset.name}
                            </span>
                          ) : null}
                          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                            {paper?.title ?? "Untitled"}
                          </span>
                        </div>
                        <div style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                          background: hl.similarity > 0.7 ? "rgba(15,118,110,0.12)" : hl.similarity > 0.5 ? "rgba(37,99,235,0.1)" : "rgba(0,0,0,0.05)",
                          color: hl.similarity > 0.7 ? "#0f766e" : hl.similarity > 0.5 ? "#2563eb" : "var(--color-text-muted)",
                        }}>
                          {Math.round(hl.similarity * 100)}%
                        </div>
                      </div>
                      <div style={{
                        fontSize: 13, lineHeight: 1.7, marginBottom: hl.noteText ? 6 : 0,
                        borderLeft: preset ? `3px solid ${preset.colorHex}` : "3px solid var(--color-border)",
                        paddingLeft: 10, color: "var(--color-text-primary)",
                      }}>
                        {hl.textContent}
                      </div>
                      {hl.noteText ? (
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.6, fontStyle: "italic", paddingLeft: 13 }}>
                          {hl.noteText}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptySearchState message={t("No highlight matches for the current search.", "현재 검색어와 일치하는 하이라이트가 없습니다.")} />
            )}
          </section>
        ) : null}

        {visibleKinds.includes("notes") ? (
          <section style={sectionStyle}>
            <SectionTitle icon={<StickyNote size={14} />} title={t("Notes", "노트")} count={groups.notes.length} />
            {groups.notes.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {groups.notes.map((note) => (
                  <button key={note.id} onClick={() => openNote(note.paperId, note.noteId)} style={resultCardStyle}>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6 }}>{note.countLabel}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{note.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{note.body}</div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptySearchState message={t("No note matches for the current search.", "현재 검색어와 일치하는 노트가 없습니다.")} />
            )}
          </section>
        ) : null}

        {visibleKinds.includes("figures") ? (
          <section style={sectionStyle}>
            <SectionTitle icon={<Images size={14} />} title={t("Figures", "Figure")} count={groups.figures.length} />
            {groups.figures.length > 0 ? (
              <div style={{ display: "grid", gap: 10 }}>
                {groups.figures.map((figure) => (
                  <button key={figure.id} onClick={() => openFigure(figure.paperId, figure.page)} style={resultCardStyle}>
                    <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", gap: 12, alignItems: "center" }}>
                      <div style={{ height: 84, borderRadius: "var(--radius-md)", background: "linear-gradient(135deg, rgba(37,99,235,0.12), rgba(15,118,110,0.14))", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Images size={24} style={{ color: "var(--color-accent)", opacity: 0.7 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 6 }}>{figure.countLabel}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{figure.title}</div>
                        <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{figure.body}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptySearchState message={t("No figure caption matches for the current search.", "현재 검색어와 일치하는 Figure 캡션이 없습니다.")} />
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

const sectionStyle: CSSProperties = {
  padding: 16,
  borderRadius: "var(--radius-lg)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
  boxShadow: "var(--shadow-sm)",
};

const resultCardStyle: CSSProperties = {
  padding: 14,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-surface)",
  textAlign: "left",
  cursor: "pointer",
};

function SectionTitle({ icon, title, count, badge }: { icon: ReactNode; title: string; count: number; badge?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
        {icon}
        {title}
        {badge ? (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: "999px", background: "rgba(37,99,235,0.1)", color: "#2563eb" }}>
            {badge}
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 12, color: "var(--color-text-muted)", fontWeight: 600 }}>{count}</div>
    </div>
  );
}

function EmptySearchState({ message }: { message: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 140, borderRadius: "var(--radius-lg)", border: "1px dashed var(--color-border)", background: "rgba(255,255,255,0.45)", color: "var(--color-text-muted)" }}>
      <Search size={24} style={{ opacity: 0.35 }} />
      <span style={{ fontSize: 13 }}>{message}</span>
    </div>
  );
}


