import { ChevronRight, Clock, Folder, FolderOpen, Plus, Star, BookOpen } from "lucide-react";
import type { Dispatch, DragEvent, FormEvent, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { useCreateFolder, useFolders, useMovePaperToFolder } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { Folder as FolderItem } from "@/types/paper";
import { readPaperDragData } from "./drag";

interface FolderNode extends FolderItem {
  children: FolderNode[];
}

function buildFolderTree(folders: FolderItem[], parentId: string | null = null): FolderNode[] {
  return folders
    .filter((folder) => (folder.parentId ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((folder) => ({
      ...folder,
      children: buildFolderTree(folders, folder.id),
    }));
}

function CreateFolderForm({
  parentId,
  depth,
  onCancel,
  onCreated,
}: {
  parentId: string | null;
  depth: number;
  onCancel: () => void;
  onCreated: (folderId: string) => void;
}) {
  const [name, setName] = useState("");
  const createFolder = useCreateFolder();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!name.trim()) {
      return;
    }

    const created = await createFolder.mutateAsync({ name, parentId });
    setName("");
    onCreated(created.id);
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "grid",
        gap: 8,
        marginTop: 6,
        marginLeft: depth * 14,
        padding: 10,
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={parentId ? "New subfolder name" : "New top-level folder name"}
        style={{
          height: 32,
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-surface)",
          padding: "0 10px",
          color: "var(--color-text-primary)",
          fontSize: 12.5,
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={createFolder.isPending}
          style={{
            height: 30,
            padding: "0 10px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--color-accent)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: createFolder.isPending ? "progress" : "pointer",
          }}
        >
          {createFolder.isPending ? "Creating..." : "Create"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            height: 30,
            padding: "0 10px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border-subtle)",
            background: "var(--color-bg-surface)",
            color: "var(--color-text-secondary)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function FolderBranch({
  folder,
  depth,
  activeFolderId,
  expandedIds,
  setExpandedIds,
  draftParentId,
  setDraftParentId,
  onCreated,
  dragOverFolderId,
  setDragOverFolderId,
  onDropPaper,
  isDropPending,
}: {
  folder: FolderNode;
  depth: number;
  activeFolderId: string | null;
  expandedIds: Record<string, boolean>;
  setExpandedIds: Dispatch<SetStateAction<Record<string, boolean>>>;
  draftParentId: string | null | undefined;
  setDraftParentId: (parentId: string | null | undefined) => void;
  onCreated: (folderId: string, parentId: string | null) => void;
  dragOverFolderId: string | null;
  setDragOverFolderId: Dispatch<SetStateAction<string | null>>;
  onDropPaper: (paperId: string, folderId: string) => Promise<void>;
  isDropPending: boolean;
}) {
  const { setActiveFolderId } = useUIStore();
  const hasChildren = folder.children.length > 0;
  const isOpen = expandedIds[folder.id] ?? true;
  const isActive = activeFolderId === folder.id;
  const isDropTarget = dragOverFolderId === folder.id;

  async function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const paperId = readPaperDragData(event.dataTransfer);
    setDragOverFolderId((current) => (current === folder.id ? null : current));

    if (!paperId || isDropPending) {
      return;
    }

    await onDropPaper(paperId, folder.id);
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    const paperId = readPaperDragData(event.dataTransfer);
    if (!paperId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (dragOverFolderId !== folder.id) {
      setDragOverFolderId(folder.id);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget && nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setDragOverFolderId((current) => (current === folder.id ? null : current));
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginLeft: depth * 14,
        }}
      >
        <button
          aria-label={hasChildren ? (isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`) : `No child folders for ${folder.name}`}
          onClick={() => {
            if (!hasChildren) {
              return;
            }

            setExpandedIds((state) => ({
              ...state,
              [folder.id]: !isOpen,
            }));
          }}
          style={{
            width: 18,
            height: 18,
            border: "none",
            background: "transparent",
            color: hasChildren ? "var(--color-text-muted)" : "transparent",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: hasChildren ? "pointer" : "default",
            flexShrink: 0,
          }}
        >
          {hasChildren ? (
            <ChevronRight
              size={11}
              style={{
                transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform var(--transition-fast)",
              }}
            />
          ) : null}
        </button>

        <button
          onClick={() => setActiveFolderId(folder.id)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(event) => {
            void handleDrop(event);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            minWidth: 0,
            padding: "6px 8px",
            borderRadius: "var(--radius-sm)",
            border: `1px dashed ${isDropTarget ? "var(--color-accent)" : "transparent"}`,
            background: isDropTarget ? "var(--color-accent-subtle)" : isActive ? "var(--color-accent-subtle)" : "transparent",
            color: isDropTarget || isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
            textAlign: "left",
            cursor: isDropPending ? "progress" : "pointer",
            transition: "background var(--transition-fast), border-color var(--transition-fast)",
          }}
        >
          {isActive || isOpen || isDropTarget ? (
            <FolderOpen size={13} style={{ flexShrink: 0, color: isDropTarget || isActive ? "var(--color-accent)" : "var(--color-text-muted)" }} />
          ) : (
            <Folder size={13} style={{ flexShrink: 0, color: "var(--color-text-muted)" }} />
          )}
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>
            {folder.name}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
            {folder.paperCount}
          </span>
        </button>

        <button
          aria-label={`Create subfolder under ${folder.name}`}
          onClick={() => setDraftParentId(draftParentId === folder.id ? undefined : folder.id)}
          style={{
            width: 22,
            height: 22,
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: draftParentId === folder.id ? "var(--color-accent-subtle)" : "transparent",
            color: draftParentId === folder.id ? "var(--color-accent)" : "var(--color-text-muted)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Plus size={12} />
        </button>
      </div>

      {draftParentId === folder.id ? (
        <CreateFolderForm
          parentId={folder.id}
          depth={depth + 2}
          onCancel={() => setDraftParentId(undefined)}
          onCreated={(folderId) => onCreated(folderId, folder.id)}
        />
      ) : null}

      {hasChildren && isOpen ? (
        <div style={{ display: "grid", gap: 4 }}>
          {folder.children.map((child) => (
            <FolderBranch
              key={child.id}
              folder={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              expandedIds={expandedIds}
              setExpandedIds={setExpandedIds}
              draftParentId={draftParentId}
              setDraftParentId={setDraftParentId}
              onCreated={onCreated}
              dragOverFolderId={dragOverFolderId}
              setDragOverFolderId={setDragOverFolderId}
              onDropPaper={onDropPaper}
              isDropPending={isDropPending}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CategoryTree() {
  const { data: folders = [] } = useFolders();
  const { activeFolderId, setActiveFolderId } = useUIStore();
  const movePaperToFolder = useMovePaperToFolder();
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [draftParentId, setDraftParentId] = useState<string | null | undefined>(undefined);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  const topItems = [
    { id: null, label: "All Papers", icon: BookOpen },
    { id: "starred", label: "Starred", icon: Star },
    { id: "recent", label: "Recent", icon: Clock },
  ];

  function handleCreated(folderId: string, parentId: string | null) {
    setDraftParentId(undefined);
    setActiveFolderId(folderId);

    if (parentId) {
      setExpandedIds((state) => ({
        ...state,
        [parentId]: true,
      }));
    }
  }

  async function handleDropPaper(paperId: string, folderId: string) {
    try {
      await movePaperToFolder.mutateAsync({ paperId, folderId });
      setActiveFolderId(folderId);
      setExpandedIds((state) => ({
        ...state,
        [folderId]: true,
      }));
    } finally {
      setDragOverFolderId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {topItems.map(({ id, label, icon: Icon }) => {
        const isActive = activeFolderId === id;
        return (
          <button
            key={label}
            onClick={() => setActiveFolderId(id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              border: "none",
              cursor: "pointer",
              background: isActive ? "var(--color-accent-subtle)" : "transparent",
              color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
              fontSize: 12.5,
              fontWeight: isActive ? 600 : 400,
              textAlign: "left",
              width: "100%",
            }}
          >
            <Icon size={14} style={{ flexShrink: 0, color: isActive ? "var(--color-accent)" : "var(--color-text-muted)" }} />
            {label}
          </button>
        );
      })}

      <div style={{ marginTop: 8 }}>
        <button
          onClick={() => setFoldersOpen((value) => !value)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "6px 10px",
            border: "none",
            background: "transparent",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            fontSize: 11.5,
            textTransform: "uppercase",
            letterSpacing: 0.08,
          }}
        >
          <ChevronRight
            size={12}
            style={{
              transform: foldersOpen ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform var(--transition-fast)",
            }}
          />
          Folders
          <div style={{ flex: 1 }} />
          <button
            aria-label="Create top-level folder"
            onClick={(event) => {
              event.stopPropagation();
              setDraftParentId(draftParentId === null ? undefined : null);
            }}
            style={{
              width: 20,
              height: 20,
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: draftParentId === null ? "var(--color-accent-subtle)" : "transparent",
              color: draftParentId === null ? "var(--color-accent)" : "var(--color-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Plus size={11} />
          </button>
        </button>

        {draftParentId === null ? (
          <CreateFolderForm parentId={null} depth={0} onCancel={() => setDraftParentId(undefined)} onCreated={(folderId) => handleCreated(folderId, null)} />
        ) : null}

        {foldersOpen ? (
          <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
            {tree.map((folder) => (
              <FolderBranch
                key={folder.id}
                folder={folder}
                depth={0}
                activeFolderId={activeFolderId}
                expandedIds={expandedIds}
                setExpandedIds={setExpandedIds}
                draftParentId={draftParentId}
                setDraftParentId={setDraftParentId}
                onCreated={handleCreated}
                dragOverFolderId={dragOverFolderId}
                setDragOverFolderId={setDragOverFolderId}
                onDropPaper={handleDropPaper}
                isDropPending={movePaperToFolder.isPending}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
