import {
  ArrowUpDown,
  Bookmark,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  FileText,
  Pin,
  Plus,
  Quote,
  Search,
  SearchX,
  StickyNote,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import { localeText, type AppLocale } from "@/lib/locale";
import {
  useAllNotes,
  useAllPapers,
  useCreateNote,
  useUpdateNote,
} from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { NoteKind, Paper, ResearchNote } from "@/types/paper";
import { formatNoteDate, noteKindMeta } from "./notePresentation";

interface NoteDraft {
  title: string;
  content: string;
  kind: NoteKind;
  anchorLabel: string;
  pinned: boolean;
}

type NoteSortKey = "updated" | "created" | "title" | "kind";

const LIST_WIDTH_STORAGE_KEY = "redou.notes.listWidth";
const LIST_WIDTH_MIN = 280;
const LIST_WIDTH_MAX = 560;
const LIST_WIDTH_DEFAULT = 360;

/** Ordered kind keys — single source of truth for chips/sort (kit NOTE_KINDS discarded). */
const NOTE_KIND_KEYS = Object.keys(noteKindMeta) as NoteKind[];

const monoNumeric: CSSProperties = { fontVariantNumeric: "tabular-nums" };

function buildDraft(note?: ResearchNote): NoteDraft {
  return {
    title: note?.title ?? "",
    content: note?.content ?? "",
    kind: note?.kind ?? "summary",
    anchorLabel: note?.anchorLabel ?? "",
    pinned: note?.pinned ?? false,
  };
}

function isDraftDirty(note: ResearchNote | undefined, draft: NoteDraft) {
  if (!note) {
    return false;
  }

  return (
    note.title !== draft.title ||
    note.content !== draft.content ||
    note.kind !== draft.kind ||
    (note.anchorLabel ?? "") !== draft.anchorLabel ||
    (note.pinned ?? false) !== draft.pinned
  );
}

/** Plain word/char counters for the editor footer (kit `wordCount`, made real). */
function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Title/content substring match for the new note search box. */
function matchesSearch(note: ResearchNote, query: string) {
  if (!query) {
    return true;
  }
  return (
    note.title.toLowerCase().includes(query) ||
    note.content.toLowerCase().includes(query)
  );
}

function lazyListWidth(): number {
  if (typeof window === "undefined") {
    return LIST_WIDTH_DEFAULT;
  }
  try {
    const saved = Number(window.localStorage.getItem(LIST_WIDTH_STORAGE_KEY));
    if (saved >= LIST_WIDTH_MIN && saved <= LIST_WIDTH_MAX) {
      return saved;
    }
  } catch {
    // Ignore storage access failures and fall back to the default width.
  }
  return LIST_WIDTH_DEFAULT;
}

export function NotesView() {
  const {
    locale,
    selectedPaperId,
    selectedNoteId,
    setSelectedNoteId,
    setSelectedPaperId,
    openPaperDetail,
    setReaderTargetAnchor,
  } = useUIStore();
  const t = useCallback(
    (en: string, ko: string) => localeText(locale, en, ko),
    [locale],
  );
  const { data: notes = [] } = useAllNotes();
  const { data: papers = [] } = useAllPapers();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const [draft, setDraft] = useState<NoteDraft>(buildDraft());

  // New local-only view state (no side effects, derived display only).
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<NoteSortKey>("updated");
  const [kindFilter, setKindFilter] = useState<NoteKind | "all">("all");

  // List ↔ editor drag-resize (local UI, persisted to localStorage).
  const [listWidth, setListWidth] = useState<number>(lazyListWidth);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const paperMap = useMemo(
    () => new Map(papers.map((paper) => [paper.id, paper])),
    [papers],
  );
  const papersWithNotes = useMemo(
    () => papers.filter((paper) => paper.noteCount > 0 || paper.id === selectedPaperId),
    [papers, selectedPaperId],
  );

  // Paper filter stays on the global selectedPaperId (reader/source-jump parity).
  const paperScopedNotes = useMemo(
    () => (selectedPaperId ? notes.filter((note) => note.paperId === selectedPaperId) : notes),
    [notes, selectedPaperId],
  );

  // Kind counts derived from the paper-scoped set so chips reflect the active paper filter.
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: paperScopedNotes.length };
    for (const note of paperScopedNotes) {
      counts[note.kind] = (counts[note.kind] ?? 0) + 1;
    }
    return counts;
  }, [paperScopedNotes]);

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return paperScopedNotes.filter(
      (note) =>
        (kindFilter === "all" || note.kind === kindFilter) &&
        matchesSearch(note, query),
    );
  }, [paperScopedNotes, kindFilter, search]);

  const sortedNotes = useMemo(() => {
    const list = [...filteredNotes];
    list.sort((a, b) => {
      // Pinned notes always float to the top, then the selected sort key.
      const pinDelta = Number(b.pinned ?? false) - Number(a.pinned ?? false);
      if (pinDelta !== 0) {
        return pinDelta;
      }
      switch (sort) {
        case "created":
          return b.createdAt.localeCompare(a.createdAt);
        case "title":
          return a.title.localeCompare(b.title);
        case "kind":
          return a.kind.localeCompare(b.kind);
        case "updated":
        default:
          return b.updatedAt.localeCompare(a.updatedAt);
      }
    });
    return list;
  }, [filteredNotes, sort]);

  const activeNote = useMemo(
    () => sortedNotes.find((note) => note.id === selectedNoteId) ?? sortedNotes[0],
    [sortedNotes, selectedNoteId],
  );

  useEffect(() => {
    if (sortedNotes.length === 0) {
      if (selectedNoteId !== null) {
        setSelectedNoteId(null);
      }
      return;
    }

    if (!activeNote || activeNote.id !== selectedNoteId) {
      setSelectedNoteId(sortedNotes[0].id);
    }
  }, [activeNote, sortedNotes, selectedNoteId, setSelectedNoteId]);

  useEffect(() => {
    setDraft(buildDraft(activeNote));
  }, [activeNote]);

  // Ensure drag listeners never leak if the view unmounts mid-drag.
  useEffect(() => () => dragCleanupRef.current?.(), []);

  async function handleCreateNote() {
    const targetPaperId = selectedPaperId ?? papersWithNotes[0]?.id ?? papers[0]?.id;

    if (!targetPaperId) {
      return;
    }

    const note = await createNote.mutateAsync({
      paperId: targetPaperId,
      kind: "summary",
    });

    setSelectedPaperId(targetPaperId);
    setSelectedNoteId(note.id);
  }

  async function handleSave() {
    if (!activeNote) {
      return;
    }

    await updateNote.mutateAsync({
      id: activeNote.id,
      title: draft.title,
      content: draft.content,
      kind: draft.kind,
      anchorLabel: linkedSelectionNote ? undefined : draft.anchorLabel,
      pinned: draft.pinned,
    });
  }

  function openPaperNotes(paperId: string) {
    setSelectedPaperId(paperId);
    setReaderTargetAnchor(null);
    openPaperDetail("notes");
  }

  function openNoteSource(note: ResearchNote) {
    if (!note.linkedAnchor) {
      return;
    }

    setSelectedPaperId(note.paperId);
    setReaderTargetAnchor({ ...note.linkedAnchor });
    openPaperDetail("pdf");
  }

  const startDrag = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    let startW = LIST_WIDTH_DEFAULT;
    setListWidth((current) => {
      startW = current;
      return current;
    });

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: globalThis.MouseEvent) => {
      const next = Math.min(
        LIST_WIDTH_MAX,
        Math.max(LIST_WIDTH_MIN, startW + (ev.clientX - startX)),
      );
      setListWidth(next);
    };
    const onUp = () => {
      cleanup();
      setListWidth((width) => {
        try {
          window.localStorage.setItem(LIST_WIDTH_STORAGE_KEY, String(width));
        } catch {
          // Ignore storage write failures (private mode, quota, etc.).
        }
        return width;
      });
    };
    const cleanup = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current = cleanup;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const dirty = isDraftDirty(activeNote, draft);
  const activeLinkedAnchor = activeNote?.linkedAnchor;
  const activeQuote = activeNote?.anchorQuote?.trim();
  const linkedSelectionNote = Boolean(activeNote?.highlightId || activeLinkedAnchor);

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        background: "var(--color-bg-surface)",
        overflow: "hidden",
      }}
    >
      <NoteList
        width={listWidth}
        notes={sortedNotes}
        totalCount={notes.length}
        activeId={activeNote?.id}
        setActiveId={setSelectedNoteId}
        paperMap={paperMap}
        papersWithNotes={papersWithNotes}
        search={search}
        setSearch={setSearch}
        kindFilter={kindFilter}
        setKindFilter={setKindFilter}
        kindCounts={kindCounts}
        selectedPaperId={selectedPaperId}
        setSelectedPaperId={setSelectedPaperId}
        sort={sort}
        setSort={setSort}
        onNew={handleCreateNote}
        creating={createNote.isPending}
        canCreate={papers.length > 0}
        locale={locale}
        t={t}
      />

      <ResizeHandle onMouseDown={startDrag} />

      {activeNote ? (
        <NoteEditor
          note={activeNote}
          paper={paperMap.get(activeNote.paperId)}
          draft={draft}
          setDraft={setDraft}
          dirty={dirty}
          saving={updateNote.isPending}
          onSave={handleSave}
          linkedSelectionNote={linkedSelectionNote}
          hasLinkedAnchor={Boolean(activeLinkedAnchor)}
          activeQuote={activeQuote}
          openNoteSource={() => openNoteSource(activeNote)}
          openPaperNotes={() => openPaperNotes(activeNote.paperId)}
          t={t}
        />
      ) : (
        <EmptyEditor t={t} />
      )}
    </div>
  );
}

/* ───────────────────────────────────
   Drag-to-resize divider
   ─────────────────────────────────── */
function ResizeHandle({ onMouseDown }: { onMouseDown: (event: ReactMouseEvent) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "relative",
        width: 6,
        flexShrink: 0,
        marginLeft: -3,
        marginRight: -3,
        zIndex: 5,
        cursor: "col-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: 1,
          height: "100%",
          background: hover ? "var(--color-accent)" : "var(--color-border-subtle)",
          transition: "background var(--transition-fast)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 4,
          height: 30,
          borderRadius: 999,
          background: hover ? "var(--color-accent)" : "transparent",
          transition: "background var(--transition-fast)",
        }}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────
   List + integrated filter strip
   ────────────────────────────────────────────── */
interface NoteListProps {
  width: number;
  notes: ResearchNote[];
  totalCount: number;
  activeId?: string;
  setActiveId: (id: string) => void;
  paperMap: Map<string, Paper>;
  papersWithNotes: Paper[];
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  kindFilter: NoteKind | "all";
  setKindFilter: Dispatch<SetStateAction<NoteKind | "all">>;
  kindCounts: Record<string, number>;
  selectedPaperId: string | null;
  setSelectedPaperId: (id: string | null) => void;
  sort: NoteSortKey;
  setSort: Dispatch<SetStateAction<NoteSortKey>>;
  onNew: () => void;
  creating: boolean;
  canCreate: boolean;
  locale: AppLocale;
  t: (en: string, ko: string) => string;
}

function NoteList({
  width,
  notes,
  totalCount,
  activeId,
  setActiveId,
  paperMap,
  papersWithNotes,
  search,
  setSearch,
  kindFilter,
  setKindFilter,
  kindCounts,
  selectedPaperId,
  setSelectedPaperId,
  sort,
  setSort,
  onNew,
  creating,
  canCreate,
  locale,
  t,
}: NoteListProps) {
  const truncate = (value: string, max = 28) =>
    value.length > max ? `${value.slice(0, max)}…` : value;

  const paperOptions = [
    { value: "all", label: t("All papers", "전체 논문") },
    ...papersWithNotes.map((paper) => ({
      value: paper.id,
      label: truncate(paper.title),
    })),
  ];

  const sortOptions: { value: NoteSortKey; label: string }[] = [
    { value: "updated", label: t("Last modified", "최종 수정") },
    { value: "created", label: t("Created", "생성일") },
    { value: "title", label: t("Title", "제목") },
    { value: "kind", label: t("Kind", "종류") },
  ];

  return (
    <section
      style={{
        width,
        flexShrink: 0,
        background: "var(--color-bg-panel)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      <header style={{ padding: "14px 14px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {t("Notes", "노트")}
          </h2>
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              background: "var(--color-bg-elevated)",
              padding: "1px 7px",
              borderRadius: "var(--radius-xs)",
              ...monoNumeric,
            }}
          >
            {totalCount}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onNew}
            disabled={creating || !canCreate}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "0 10px",
              height: 28,
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: canCreate ? "var(--color-accent)" : "var(--color-border-subtle)",
              color: canCreate ? "#fff" : "var(--color-text-muted)",
              fontSize: 12,
              fontWeight: 500,
              cursor: creating ? "progress" : canCreate ? "pointer" : "not-allowed",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <Plus size={12} />
            {t("New", "새 노트")}
          </button>
        </div>

        {/* Search */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
            height: 30,
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            marginBottom: 8,
          }}
        >
          <Search size={12} color="var(--color-text-muted)" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Search notes…", "노트 검색…")}
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--color-text-primary)",
              fontSize: 12.5,
            }}
          />
          {search ? (
            <button
              onClick={() => setSearch("")}
              aria-label={t("Clear search", "검색 지우기")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                flexShrink: 0,
                display: "inline-flex",
              }}
            >
              <X size={11} />
            </button>
          ) : null}
        </div>

        {/* Kind chips — real 6 kinds from noteKindMeta */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
          <KindChip
            active={kindFilter === "all"}
            onClick={() => setKindFilter("all")}
            color="var(--color-text-muted)"
            label={t("All", "전체")}
            count={kindCounts.all ?? 0}
          />
          {NOTE_KIND_KEYS.map((kind) => (
            <KindChip
              key={kind}
              active={kindFilter === kind}
              onClick={() => setKindFilter(kind)}
              color={noteKindMeta[kind].accent}
              label={noteKindMeta[kind].label}
              count={kindCounts[kind] ?? 0}
            />
          ))}
        </div>

        {/* Paper (global selectedPaperId) + sort selects */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <CompactSelect
            value={selectedPaperId ?? "all"}
            onChange={(value) => setSelectedPaperId(value === "all" ? null : value)}
            options={paperOptions}
            icon={FileText}
            locale={locale}
          />
          <CompactSelect
            value={sort}
            onChange={(value) => setSort(value as NoteSortKey)}
            options={sortOptions}
            icon={ArrowUpDown}
            locale={locale}
          />
        </div>
      </header>

      {/* List */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          borderTop: "1px solid var(--color-border-subtle)",
        }}
      >
        {notes.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px 24px",
              color: "var(--color-text-muted)",
              gap: 8,
              textAlign: "center",
            }}
          >
            <SearchX size={24} color="var(--color-text-muted)" style={{ opacity: 0.4 }} />
            <div style={{ fontSize: 12.5 }}>{t("No matching notes.", "매칭되는 노트가 없습니다.")}</div>
          </div>
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              paper={paperMap.get(note.paperId)}
              active={activeId === note.id}
              onClick={() => setActiveId(note.id)}
              t={t}
            />
          ))
        )}
      </div>
    </section>
  );
}

function KindChip({
  active,
  onClick,
  color,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  color: string;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 9px",
        borderRadius: 999,
        border: active ? `1px solid ${color}` : "1px solid var(--color-border-subtle)",
        background: active
          ? `color-mix(in oklab, ${color} 12%, transparent)`
          : "var(--color-bg-elevated)",
        color: active ? color : "var(--color-text-secondary)",
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        flexShrink: 0,
        whiteSpace: "nowrap",
        transition: "all var(--transition-fast)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      {label}
      <span style={{ fontSize: 10, opacity: 0.75, ...monoNumeric }}>{count}</span>
    </button>
  );
}

function CompactSelect({
  value,
  onChange,
  options,
  icon: Icon,
  locale,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  icon: typeof FileText;
  locale: AppLocale;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 8px",
        height: 28,
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-sm)",
        flex: 1,
        minWidth: 0,
      }}
    >
      <Icon size={11} color="var(--color-text-muted)" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={localeText(locale, "Filter", "필터")}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--color-text-secondary)",
          fontSize: 11.5,
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
          appearance: "none",
          paddingRight: 12,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238a96a9' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right center",
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NoteCard({
  note,
  paper,
  active,
  onClick,
  t,
}: {
  note: ResearchNote;
  paper?: Paper;
  active: boolean;
  onClick: () => void;
  t: (en: string, ko: string) => string;
}) {
  const meta = noteKindMeta[note.kind];
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        gap: 10,
        width: "100%",
        padding: "12px 14px",
        background: active ? "var(--color-bg-elevated)" : "transparent",
        borderLeft: `3px solid ${active ? meta.accent : "transparent"}`,
        borderRight: "none",
        borderTop: "none",
        borderBottom: "1px solid var(--color-border-subtle)",
        cursor: "pointer",
        textAlign: "left",
        position: "relative",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.03em",
              color: meta.accent,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 2, background: meta.accent }} />
            {meta.label}
          </span>
          {note.pinned ? (
            <Pin size={10} color="var(--color-warning)" style={{ transform: "rotate(35deg)" }} />
          ) : null}
          <div style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 10,
              color: "var(--color-text-muted)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {formatNoteDate(note.updatedAt)}
          </span>
        </div>

        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            lineHeight: 1.35,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {note.title || t("Untitled", "제목 없음")}
        </div>

        {note.content ? (
          <div
            style={{
              fontSize: 11.5,
              color: "var(--color-text-secondary)",
              lineHeight: 1.55,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {note.content}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10.5,
            color: "var(--color-text-muted)",
            marginTop: 2,
            minWidth: 0,
          }}
        >
          <FileText size={10} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
          <span
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: 1,
              minWidth: 0,
            }}
          >
            {paper?.title ?? t("Unknown paper", "제목 미상")}
          </span>
          {note.pageNumber ? (
            <span style={{ flexShrink: 0, ...monoNumeric }}>p.{note.pageNumber}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* ──────────────────────────────────────────────
   Right pane — editor (controlled draft preserved)
   ────────────────────────────────────────────── */
interface NoteEditorProps {
  note: ResearchNote;
  paper?: Paper;
  draft: NoteDraft;
  setDraft: Dispatch<SetStateAction<NoteDraft>>;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  linkedSelectionNote: boolean;
  hasLinkedAnchor: boolean;
  activeQuote?: string;
  openNoteSource: () => void;
  openPaperNotes: () => void;
  t: (en: string, ko: string) => string;
}

function NoteEditor({
  note,
  paper,
  draft,
  setDraft,
  dirty,
  saving,
  onSave,
  linkedSelectionNote,
  hasLinkedAnchor,
  activeQuote,
  openNoteSource,
  openPaperNotes,
  t,
}: NoteEditorProps) {
  const meta = noteKindMeta[draft.kind];

  return (
    <section
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--color-bg-elevated)",
        minWidth: 0,
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "16px 28px 12px",
          borderBottom: "1px solid var(--color-border-subtle)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <NoteKindSelect
            value={draft.kind}
            onChange={(kind) => setDraft((current) => ({ ...current, kind }))}
            meta={meta}
          />
          <div style={{ flex: 1 }} />
          <SaveStatus dirty={dirty} t={t} />
          <IconButtonNotes
            icon={Pin}
            active={draft.pinned}
            title={draft.pinned ? t("Unpin", "고정 해제") : t("Pin", "고정")}
            onClick={() => setDraft((current) => ({ ...current, pinned: !current.pinned }))}
          />
        </div>

        <input
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder={t("Untitled", "제목 없음")}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
            padding: "4px 0",
          }}
        />

        {/* Meta strip */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 8,
            fontSize: 11.5,
            color: "var(--color-text-muted)",
          }}
        >
          <MetaChip
            icon={FileText}
            label={paper?.title ?? t("Unknown paper", "제목 미상")}
            onClick={openPaperNotes}
            link
          />
          {note.pageNumber ? <MetaChip icon={Bookmark} label={`p.${note.pageNumber}`} accent /> : null}
          <MetaChip icon={Clock} label={t(`Updated ${formatNoteDate(note.updatedAt)}`, `수정 ${formatNoteDate(note.updatedAt)}`)} />
        </div>
      </header>

      {/* Linked-source banner */}
      {linkedSelectionNote ? (
        <div
          style={{
            padding: "10px 28px",
            background: "var(--color-bg-surface)",
            borderBottom: "1px solid var(--color-border-subtle)",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: 12.5,
            color: "var(--color-text-secondary)",
            lineHeight: 1.65,
            flexShrink: 0,
          }}
        >
          <Quote size={13} color="var(--color-text-muted)" style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1, fontStyle: activeQuote ? "italic" : "normal" }}>
            {activeQuote
              ? `"${activeQuote}"`
              : t("Linked to a saved reader selection.", "리더 선택에 연결되어 있습니다.")}
          </div>
          {hasLinkedAnchor ? (
            <button
              onClick={openNoteSource}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                height: 24,
                borderRadius: "var(--radius-xs)",
                border: "1px solid var(--color-border-subtle)",
                background: "var(--color-bg-elevated)",
                color: "var(--color-text-secondary)",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              <ExternalLink size={10} />
              {t("Go to source", "소스로 이동")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 28px 40px" }}>
        {/* Anchor label — preserved (locked when the note is linked) */}
        {!linkedSelectionNote ? (
          <input
            value={draft.anchorLabel}
            onChange={(event) => setDraft((current) => ({ ...current, anchorLabel: event.target.value }))}
            placeholder={t("Anchor label (optional)", "앵커 라벨 (선택)")}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              borderBottom: "1px dashed var(--color-border-subtle)",
              outline: "none",
              color: "var(--color-text-secondary)",
              fontSize: 12.5,
              padding: "0 0 8px",
              marginBottom: 14,
            }}
          />
        ) : null}

        <textarea
          value={draft.content}
          onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
          placeholder={t("Start writing here…", "여기에 적기 시작하세요…")}
          style={{
            width: "100%",
            minHeight: "calc(100% - 40px)",
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-sans)",
            fontSize: 14.5,
            lineHeight: 1.75,
            letterSpacing: "-0.005em",
          }}
        />
      </div>

      {/* Footer */}
      <footer
        style={{
          padding: "10px 28px",
          borderTop: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-surface)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 11,
          color: "var(--color-text-muted)",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        <span>
          {t(
            `${wordCount(draft.content)} words · ${draft.content.length} chars`,
            `${wordCount(draft.content)} 단어 · ${draft.content.length} 자`,
          )}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 14px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: dirty ? "var(--color-accent)" : "var(--color-border-subtle)",
            color: dirty ? "#fff" : "var(--color-text-muted)",
            cursor: !dirty || saving ? "default" : "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <Check size={13} />
          {saving ? t("Saving…", "저장 중…") : t("Save changes", "변경 저장")}
        </button>
      </footer>
    </section>
  );
}

/** Editor kind selector — kit's NoteKindChip visual, real `<select>` behaviour
 *  layered on top (preserves draft.kind editing without a fake dropdown). */
function NoteKindSelect({
  value,
  onChange,
  meta,
}: {
  value: NoteKind;
  onChange: (kind: NoteKind) => void;
  meta: { label: string; accent: string; background: string };
}) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: `color-mix(in oklab, ${meta.accent} 12%, transparent)`,
        color: meta.accent,
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.accent }} />
      {meta.label}
      <ChevronDown size={10} color={meta.accent} />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as NoteKind)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: "pointer",
          appearance: "none",
          border: "none",
        }}
      >
        {NOTE_KIND_KEYS.map((kind) => (
          <option key={kind} value={kind}>
            {noteKindMeta[kind].label}
          </option>
        ))}
      </select>
    </span>
  );
}

function MetaChip({
  icon: Icon,
  label,
  link,
  accent,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  link?: boolean;
  accent?: boolean;
  onClick?: () => void;
}) {
  const interactive = Boolean(link && onClick);
  return (
    <span
      onClick={interactive ? onClick : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: "var(--radius-xs)",
        background: accent ? "var(--color-accent-subtle)" : "var(--color-bg-panel)",
        color: accent ? "var(--color-accent)" : "var(--color-text-muted)",
        fontSize: 11,
        fontWeight: 500,
        cursor: interactive ? "pointer" : "default",
        maxWidth: 280,
        flexShrink: 0,
      }}
    >
      <Icon size={10} color={accent ? "var(--color-accent)" : "var(--color-text-muted)"} />
      <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{label}</span>
      {link ? <ExternalLink size={9} color="var(--color-text-muted)" /> : null}
    </span>
  );
}

function SaveStatus({ dirty, t }: { dirty: boolean; t: (en: string, ko: string) => string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        color: dirty ? "var(--color-accent)" : "var(--color-text-muted)",
        whiteSpace: "nowrap",
        flexShrink: 0,
        fontWeight: dirty ? 600 : 400,
      }}
    >
      {dirty ? (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-accent)" }} />
      ) : (
        <Check size={11} color="var(--color-success)" />
      )}
      {dirty ? t("Unsaved changes", "저장되지 않은 변경") : t("Saved", "저장됨")}
    </span>
  );
}

function IconButtonNotes({
  icon: Icon,
  active,
  title,
  onClick,
}: {
  icon: typeof Pin;
  active?: boolean;
  title: string;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 28,
        height: 28,
        background: active
          ? "var(--color-accent-subtle)"
          : hover
            ? "var(--color-bg-hover)"
            : "transparent",
        color: active
          ? "var(--color-accent)"
          : hover
            ? "var(--color-text-secondary)"
            : "var(--color-text-muted)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background var(--transition-fast), color var(--transition-fast)",
      }}
    >
      <Icon size={14} />
    </button>
  );
}

function EmptyEditor({ t }: { t: (en: string, ko: string) => string }) {
  return (
    <section
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-muted)",
        gap: 8,
      }}
    >
      <StickyNote size={32} color="var(--color-text-muted)" style={{ opacity: 0.35 }} />
      <div style={{ fontSize: 13 }}>
        {t("Select a note to edit it here.", "노트를 선택하면 여기서 편집할 수 있습니다.")}
      </div>
    </section>
  );
}
