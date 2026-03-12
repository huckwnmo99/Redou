import { BookOpen, ExternalLink, FileText, Plus, Save, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
    selectedPaperId,
    selectedNoteId,
    setSelectedNoteId,
    setSelectedPaperId,
    openPaperDetail,
    setReaderTargetAnchor,
  } = useUIStore();
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
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>Notes Workspace</h2>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
            Review notes by paper, keep one editable draft open, and jump back to the exact PDF page when a saved reader selection exists.
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
          New note
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
          All papers ({notes.length})
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
                Note Queue
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {filteredNotes.length} notes visible{selectedPaperId ? " in the selected paper" : " across the library"}
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
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{paper?.title ?? "Unknown paper"}</div>
                    <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                      {paper?.venue || "Venue pending"}
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
                    Open paper
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
                      {paperMap.get(activeNote.paperId)?.title ?? "Unknown paper"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
                    Editor
                  </div>
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    Last updated {formatNoteDate(activeNote.updatedAt)}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: dirty ? "var(--color-accent)" : "var(--color-text-muted)", fontWeight: 700 }}>
                  {dirty ? "Unsaved changes" : "Saved"}
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
                        Linked Reader Selection
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text-primary)" }}>
                        {activeNote.anchorLabel ?? "Linked source page"}
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
                        Open source page
                      </button>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
                    {activeQuote
                      ? `Saved from the reader selection: "${activeQuote}"`
                      : "This note is linked to a saved reader selection and will reopen the source page in the PDF workspace."}
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>Title</span>
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
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>Kind</span>
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
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>Anchor</span>
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
                    {draft.pinned ? "Pinned" : "Pin note"}
                  </button>
                </div>

                {linkedSelectionNote ? (
                  <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", lineHeight: 1.7 }}>
                    Linked reader notes keep their source page anchor from the saved highlight. Use the PDF reader if you want to capture a different selection.
                  </div>
                ) : null}

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" }}>Content</span>
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
                    Open paper detail
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
                  Save changes
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
              <div style={{ fontSize: 13 }}>Select a note to edit it here.</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

