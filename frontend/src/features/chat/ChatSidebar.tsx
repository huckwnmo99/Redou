import { useCallback, useState } from "react";
import { MessageSquarePlus, Trash2, Pencil, Check, X, FolderTree, Table2, MessageCircleQuestion } from "lucide-react";
import {
  useChatConversations,
  useDeleteConversation,
  useRenameConversation,
} from "@/lib/chatQueries";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore } from "@/stores/uiStore";
import { localeText } from "@/lib/locale";
import type { ChatConversation } from "@/types/chat";

function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: {
  conversation: ChatConversation;
  isActive: boolean;
  onSelect: () => void;
}) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const deleteConv = useDeleteConversation();
  const renameConv = useRenameConversation();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");

  const handleStartEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditTitle(conversation.title);
      setIsEditing(true);
    },
    [conversation.title],
  );

  const handleSaveEdit = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      renameConv.mutate({ conversationId: conversation.id, title: trimmed });
    }
    setIsEditing(false);
  }, [editTitle, conversation, renameConv]);

  const handleCancelEdit = useCallback(() => setIsEditing(false), []);

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteConv.mutate(conversation.id);
    },
    [conversation.id, deleteConv],
  );

  if (isEditing) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 6px",
        }}
      >
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveEdit();
            if (e.key === "Escape") handleCancelEdit();
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "3px 6px",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-xs)",
            outline: "none",
            background: "var(--color-bg-elevated)",
            color: "var(--color-text-primary)",
          }}
        />
        <button
          onClick={handleSaveEdit}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
        >
          <Check size={12} color="var(--color-success)" />
        </button>
        <button
          onClick={handleCancelEdit}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
        >
          <X size={12} color="var(--color-text-muted)" />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 10px",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
        background: isActive ? "var(--color-accent-subtle)" : "transparent",
        transition: "background var(--transition-fast)",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--color-bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Conversation type badge */}
      <span
        title={conversation.conversation_type === "qa" ? "Q&A" : t("Table", "테이블")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: "var(--radius-xs)",
          background: conversation.conversation_type === "qa"
            ? "rgba(37, 99, 235, 0.1)"
            : "rgba(15, 118, 110, 0.1)",
          flexShrink: 0,
        }}
      >
        {conversation.conversation_type === "qa"
          ? <MessageCircleQuestion size={11} color="var(--color-accent)" />
          : <Table2 size={11} color="var(--color-success)" />}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 12.5,
          color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
          fontWeight: isActive ? 500 : 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {conversation.title}
      </span>
      <button
        onClick={handleStartEdit}
        title={t("Rename", "이름 변경")}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 2,
          opacity: 0.5,
          flexShrink: 0,
        }}
      >
        <Pencil size={11} color="var(--color-text-muted)" />
      </button>
      <button
        onClick={handleDelete}
        title={t("Delete", "삭제")}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 2,
          opacity: 0.5,
          flexShrink: 0,
        }}
      >
        <Trash2 size={11} color="var(--color-danger)" />
      </button>
    </div>
  );
}

export function ChatSidebar() {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: conversations = [] } = useChatConversations();
  const { activeConversationId, setActiveConversationId, scopeFolderId } =
    useChatStore();

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
  }, [setActiveConversationId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
      {/* New chat button */}
      <button
        onClick={handleNewChat}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          width: "100%",
          borderRadius: "var(--radius-sm)",
          border: "1px dashed var(--color-border)",
          cursor: "pointer",
          background: "transparent",
          color: "var(--color-text-secondary)",
          fontSize: 12.5,
        }}
      >
        <MessageSquarePlus size={14} />
        {t("New Chat", "새 대화")}
      </button>

      {/* Scope indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          fontSize: 11,
          color: "var(--color-text-muted)",
        }}
      >
        <FolderTree size={12} />
        {scopeFolderId ? t("Folder scope", "폴더 범위") : t("All papers", "전체 논문")}
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conversation={conv}
            isActive={activeConversationId === conv.id}
            onSelect={() => setActiveConversationId(conv.id)}
          />
        ))}
        {conversations.length === 0 && (
          <div
            style={{
              padding: "20px 10px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--color-text-muted)",
            }}
          >
            {t("No conversations yet", "대화 없음")}
          </div>
        )}
      </div>
    </div>
  );
}
