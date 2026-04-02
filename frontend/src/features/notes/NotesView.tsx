import { BookOpen, ExternalLink, FileText, Plus, Save, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { localeText } from "@/lib/locale";
import {
  useAllNotes,
  useAllPapers,
  useCreateNote,
  useUpdateNote,
} from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { NoteKind, ResearchNote } from "@/types/paper";
import { formatNoteDate, noteKindMeta } from "./notePresentation";

interface NoteDraft {
  title: string;
  content: string;
  kind: NoteKind;
  anchorLabel: string;
  pinned: boolean;
}

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

function summarize(text: string, maxLength = 112) {
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}...` : text;
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
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: notes = [] } = useAllNotes();
  const { data: papers = [] } = useAllPapers();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const [draft, setDraft] = useState<NoteDraft>(buildDraft());

  const paperMap = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);
  const papersWithNotes = useMemo(
    () => papers.filter((paper) => paper.noteCount > 0 || paper.id === selectedPaperId),
    [papers, selectedPaperId],
  );
  const filteredNotes = useMemo(
    () => (selectedPaperId ? notes.filter((note) => note.paperId === selectedPaperId) : notes),
    [notes, selectedPaperId],
  );
  const activeNote = useMemo(
    () => filteredNotes.find((note) => note.id === selectedNoteId) ?? filteredNotes[0],
    [filteredNotes, selectedNoteId],
  );
  const groupedNotes = useMemo(() => {
    const groups = new Map<string, ResearchNote[]>();

    for (const note of filteredNotes) {
      const current = groups.get(note.paperId) ?? [];
      current.push(note);
      groups.set(note.paperId, current);
    }

    return Array.from(groups.entries()).map(([paperId, paperNotes]) => ({
      paperId,
      paper: paperMap.get(paperId),
      notes: paperNotes,
    }));
  }, [filteredNotes, paperMap]);

  useEffect(() => {
    if (filteredNotes.length === 0) {
      if (selectedNoteId !== null) {
        setSelectedNoteId(null);
      }
      return;
    }

    if (!activeNote || activeNote.id !== selectedNoteId) {
      setSelectedNoteId(filteredNotes[0].id);
    }
  }, [activeNote, filteredNotes, selectedNoteId, setSelectedNoteId]);

  useEffect(() => {
    setDraft(buildDraft(activeNote));
  }, [activeNote]);

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

  const dirty = isDraftDirty(activeNote, draft);
  const activeLinkedAnchor = activeNote?.linkedAnchor;
  const activeQuote = activeNote?.anchorQuote?.trim();
  const linkedSelectionNote = Boolean(activeNote?.highlightId || activeLinkedAnchor);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "18px 20px 26px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>{t("Notes Workspace", "노트 워크스페이스")}</h2>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
            {t("Review notes by paper, edit drafts, and jump back to saved PDF pages.", "논문별 노트를 확인하고 편집하며, 저장된 PDF 페이지로 바로 이동하세요.")}
          </p>
        </div>
        <button
          onClick={handleCreateNote}
          disabled={createNote.isPending || papers.length === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            height: 36,
            padding: "0 14px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--color-accent)",
            color: "#fff",
            cursor: createNote.isPending ? "progress" : "pointer",
            fontSize: 12.5,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          <Plus size={14} />
          {t("New note", "새 노트")}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button
          onClick={() => setSelectedPaperId(null)}
          style={{
            padding: "7px 12px",
            borderRadius: "999px",
            border: `1px solid ${selectedPaperId === null ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
            background: selectedPaperId === null ? "var(--color-accent-subtle)" : "var(--color-bg-elevated)",
            color: selectedPaperId === null ? "var(--color-accent)" : "var(--color-text-secondary)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {t(`All papers (${notes.length})`, `전체 논문 (${notes.length})`)}
        </button>
        {papersWithNotes.map((paper) => (
          <button
            key={paper.id}
            onClick={() => setSelectedPaperId(paper.id)}
            style={{
              padding: "7px 12px",
              borderRadius: "999px",
              border: `1px solid ${selectedPaperId === paper.id ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
              background: selectedPaperId === paper.id ? "var(--color-accent-subtle)" : "var(--color-bg-elevated)",
              color: selectedPaperId === paper.id ? "var(--color-accent)" : "var(--color-text-secondary)",
              fontSize: 12,
              fontWeight: selectedPaperId === paper.id ? 700 : 600,
              cursor: "pointer",
            }}
          >
            {paper.title}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 0.92fr) minmax(420px, 1.08fr)",
          gap: 14,
          minHeight: 560,
        }}
      >
        <section
          style={{
            padding: 16,
            borderRadius: "var(--radius-lg)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            boxShadow: "var(--shadow-sm)",
            display: "grid",
            alignContent: "start",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {t("Note Queue", "노트 목록")}
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {t(
                  `${filteredNotes.length} notes visible${selectedPaperId ? " in the selected paper" : " across the library"}`,
                  `${filteredNotes.length}개 노트${selectedPaperId ? " (선택한 논문)" : " (전체 라이브러리)"}`,
                )}
              </div>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-text-muted)", fontSize: 12, fontWeight: 700 }}>
              <StickyNote size={14} />
              {notes.length}
            </div>
          </div>

          {groupedNotes.length > 0 ? (
            groupedNotes.map(({ paperId, paper, notes: paperNotes }) => (
              <div key={paperId} style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{paper?.title ?? t("Unknown paper", "제목 미상")}</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                      {paper?.venue || t("Venue pending", "학술지 대기중")}
                      {paper?.year ? ` | ${paper.year}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => openPaperNotes(paperId)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      height: 30,
                      padding: "0 10px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border-subtle)",
                      background: "var(--color-bg-surface)",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer",
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    <ExternalLink size={13} />
                    {t("Open paper", "논문 열기")}
                  </button>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {paperNotes.map((note) => {
                    const meta = noteKindMeta[note.kind];
                    const active = activeNote?.id === note.id;

                    return (
                      <button
                        key={note.id}
                        onClick={() => {
                          setSelectedNoteId(note.id);
                        }}
                        style={{
                          padding: 12,
                          borderRadius: "var(--radius-md)",
                          border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
                          background: active ? "rgba(239,246,255,0.88)" : "var(--color-bg-surface)",
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "4px 8px",
                              borderRadius: "999px",
                              background: meta.background,
                              color: meta.accent,
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {meta.label}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{formatNoteDate(note.updatedAt)}</span>
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>{note.title}</div>
                        {note.anchorLabel ? (
                          <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginBottom: 6 }}>{note.anchorLabel}</div>
                        ) : null}
                        <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--color-text-secondary)" }}>
                          {summarize(note.content)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div
              style={{
                minHeight: 220,
                borderRadius: "var(--radius-lg)",
                border: "1px dashed var(--color-border)",
                background: "rgba(255,255,255,0.45)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                color: "var(--color-text-muted)",
                textAlign: "center",
                padding: 24,
              }}
            >
              <BookOpen size={28} style={{ opacity: 0.35 }} />
              <div style={{ fontSize: 13 }}>No notes yet for this scope.</div>
              <div style={{ fontSize: 12 }}>Create a new note to start shaping the notes workspace.</div>
            </div>
          )}
        </section>

        <section
          style={{
            padding: 16,
            borderRadius: "var(--radius-lg)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            boxShadow: "var(--shadow-sm)",
            display: "grid",
            alignContent: activeNote ? "start" : "center",
            gap: 14,
          }}
        >
          {activeNote ? (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 8px",
                        borderRadius: "999px",
                        background: noteKindMeta[draft.kind].background,
                        color: noteKindMeta[draft.kind].accent,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {noteKindMeta[draft.kind].label}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                      {paperMap.get(activeNote.paperId)?.title ?? t("Unknown paper", "제목 미상")}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                    {t("Editor", "편집기")}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {t(`Last updated ${formatNoteDate(activeNote.updatedAt)}`, `최종 수정 ${formatNoteDate(activeNote.updatedAt)}`)}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: dirty ? "var(--color-accent)" : "var(--color-text-muted)", fontWeight: 700 }}>
                  {dirty ? t("Unsaved changes", "저장되지 않은 변경") : t("Saved", "저장됨")}
                </div>
              </div>

              {linkedSelectionNote ? (
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    padding: 14,
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--color-border-subtle)",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(241,245,249,0.9))",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                        {t("Linked Reader Selection", "연결된 리더 선택")}
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text-primary)" }}>
                        {activeNote.anchorLabel ?? t("Linked source page", "연결된 소스 페이지")}
                      </div>
                    </div>
                    {activeLinkedAnchor ? (
                      <button
                        onClick={() => openNoteSource(activeNote)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          height: 34,
                          padding: "0 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--color-border-subtle)",
                          background: "var(--color-bg-surface)",
                          color: "var(--color-text-secondary)",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        <FileText size={13} />
                        {t("Open source page", "소스 페이지 열기")}
                      </button>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                    {activeQuote
                      ? t(`Saved from the reader selection: "${activeQuote}"`, `리더 선택에서 저장: "${activeQuote}"`)
                      : t("This note is linked to a saved reader selection.", "이 노트는 리더 선택에 연결되어 있습니다.")}
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>{t("Title", "제목")}</span>
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    style={{
                      height: 40,
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border-subtle)",
                      background: "var(--color-bg-surface)",
                      padding: "0 12px",
                      fontSize: 13,
                      color: "var(--color-text-primary)",
                      outline: "none",
                    }}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0, 1fr) auto", gap: 10, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>{t("Kind", "유형")}</span>
                    <select
                      value={draft.kind}
                      onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as NoteKind }))}
                      style={{
                        height: 40,
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--color-border-subtle)",
                        background: "var(--color-bg-surface)",
                        padding: "0 12px",
                        fontSize: 13,
                        color: "var(--color-text-primary)",
                        outline: "none",
                      }}
                    >
                      {Object.entries(noteKindMeta).map(([kind, meta]) => (
                        <option key={kind} value={kind}>
                          {meta.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>{t("Anchor", "앵커")}</span>
                    <input
                      value={draft.anchorLabel}
                      disabled={linkedSelectionNote}
                      onChange={(event) => setDraft((current) => ({ ...current, anchorLabel: event.target.value }))}
                      style={{
                        height: 40,
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--color-border-subtle)",
                        background: linkedSelectionNote ? "var(--color-bg-panel)" : "var(--color-bg-surface)",
                        padding: "0 12px",
                        fontSize: 13,
                        color: linkedSelectionNote ? "var(--color-text-muted)" : "var(--color-text-primary)",
                        outline: "none",
                        cursor: linkedSelectionNote ? "not-allowed" : "text",
                      }}
                    />
                  </label>

                  <button
                    onClick={() => setDraft((current) => ({ ...current, pinned: !current.pinned }))}
                    style={{
                      height: 40,
                      padding: "0 12px",
                      borderRadius: "var(--radius-md)",
                      border: `1px solid ${draft.pinned ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
                      background: draft.pinned ? "var(--color-accent-subtle)" : "var(--color-bg-surface)",
                      color: draft.pinned ? "var(--color-accent)" : "var(--color-text-secondary)",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {draft.pinned ? t("Pinned", "고정됨") : t("Pin note", "노트 고정")}
                  </button>
                </div>

                {linkedSelectionNote ? (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
                    {t("Linked notes keep their source page anchor.", "연결된 노트는 하이라이트의 소스 페이지 앵커를 유지합니다.")}
                  </div>
                ) : null}

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>{t("Content", "내용")}</span>
                  <textarea
                    value={draft.content}
                    onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                    style={{
                      minHeight: 280,
                      resize: "vertical",
                      borderRadius: "var(--radius-md)",
                      border: "1px solid var(--color-border-subtle)",
                      background: "var(--color-bg-surface)",
                      padding: 12,
                      fontSize: 13,
                      lineHeight: 1.75,
                      color: "var(--color-text-primary)",
                      outline: "none",
                    }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => openPaperNotes(activeNote.paperId)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      height: 34,
                      padding: "0 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border-subtle)",
                      background: "var(--color-bg-surface)",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    <ExternalLink size={13} />
                    {t("Open paper", "논문 열기")} detail
                  </button>
                  {activeLinkedAnchor ? (
                    <button
                      onClick={() => openNoteSource(activeNote)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        height: 34,
                        padding: "0 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--color-border-subtle)",
                        background: "var(--color-bg-surface)",
                        color: "var(--color-text-secondary)",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      <FileText size={13} />
                      Open source page
                    </button>
                  ) : null}
                </div>
                <button
                  onClick={handleSave}
                  disabled={!dirty || updateNote.isPending}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    height: 36,
                    padding: "0 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    background: !dirty ? "var(--color-border-subtle)" : "var(--color-accent)",
                    color: !dirty ? "var(--color-text-muted)" : "#fff",
                    cursor: !dirty || updateNote.isPending ? "default" : "pointer",
                    fontSize: 12.5,
                    fontWeight: 700,
                  }}
                >
                  <Save size={14} />
                  {t("Save changes", "변경 저장")}
                </button>
              </div>
            </>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                color: "var(--color-text-muted)",
                textAlign: "center",
                padding: 24,
              }}
            >
              <StickyNote size={28} style={{ opacity: 0.35 }} />
              <div style={{ fontSize: 13 }}>{t("Select a note to edit it here.", "노트를 선택하면 여기서 편집할 수 있습니다.")}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

