import { useCallback, useEffect } from "react";
import { Table2, MessageCircleQuestion } from "lucide-react";
import { useChatMessages, useChatConversations, useSendChatMessage, useAbortChat, useChatStreamBridge } from "@/lib/chatQueries";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore } from "@/stores/uiStore";
import { localeText } from "@/lib/locale";
import type { ConversationType } from "@/types/chat";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";

export function ChatView() {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  const {
    activeConversationId,
    streamingContent,
    isStreaming,
    scopeFolderId,
    scopeAll,
    conversationType,
    pipelineStage,
    pipelineMessage,
    pendingUserMessage,
    setConversationType,
  } = useChatStore();

  const { data: conversations = [] } = useChatConversations();
  const { data: messages = [] } = useChatMessages(activeConversationId);
  const sendMessage = useSendChatMessage();
  const abortChat = useAbortChat();

  // Wire up streaming event bridge
  useChatStreamBridge();

  // When selecting an existing conversation, sync the conversationType from DB
  useEffect(() => {
    if (activeConversationId) {
      const conv = conversations.find((c) => c.id === activeConversationId);
      if (conv?.conversation_type) {
        setConversationType(conv.conversation_type);
      }
    }
  }, [activeConversationId, conversations, setConversationType]);

  // Mode toggle is only allowed when no conversation is active (new chat)
  const canToggleMode = !activeConversationId;

  const handleToggleMode = useCallback(
    (mode: ConversationType) => {
      if (canToggleMode) {
        setConversationType(mode);
      }
    },
    [canToggleMode, setConversationType],
  );

  const handleSend = useCallback(
    (text: string) => {
      sendMessage.mutate({
        conversationId: activeConversationId ?? undefined,
        message: text,
        scopeFolderId,
        scopeAll,
      });
    },
    [activeConversationId, scopeFolderId, scopeAll, sendMessage],
  );

  const handleAbort = useCallback(() => {
    if (activeConversationId) {
      abortChat.mutate(activeConversationId);
    }
  }, [activeConversationId, abortChat]);

  const handleNavigateToPaper = useCallback(
    (paperId: string) => {
      const { setActiveNav, setSelectedPaperId, openPaperDetail } = useUIStore.getState();
      setSelectedPaperId(paperId);
      setActiveNav("library");
      openPaperDetail("overview");
    },
    [],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 20px 10px",
          borderBottom: "1px solid var(--color-border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--color-text-primary)",
            }}
          >
            {t("Research Data Chat", "연구 데이터 채팅")}
          </span>

          {activeConversationId && (
            <span
              style={{
                fontSize: 11.5,
                color: "var(--color-text-muted)",
                background: "var(--color-bg-panel)",
                padding: "2px 8px",
                borderRadius: "var(--radius-xs)",
              }}
            >
              {scopeAll
                ? t("All papers", "전체 논문")
                : t("Folder scope", "폴더 범위")}
            </span>
          )}
        </div>

        {/* Mode toggle — below title for better visibility */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "var(--color-bg-panel)",
            borderRadius: "var(--radius-md, 10px)",
            padding: 3,
            gap: 2,
            alignSelf: "flex-start",
            opacity: canToggleMode ? 1 : 0.6,
          }}
        >
          <button
            onClick={() => handleToggleMode("table")}
            disabled={!canToggleMode}
            title={canToggleMode
              ? t("Table Generation mode", "테이블 생성 모드")
              : t("Mode is locked for existing conversations", "기존 대화에서는 모드 변경 불가")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              border: "none",
              borderRadius: "var(--radius-sm, 6px)",
              cursor: canToggleMode ? "pointer" : "default",
              fontSize: 13,
              fontWeight: conversationType === "table" ? 600 : 400,
              background: conversationType === "table" ? "var(--color-bg-elevated)" : "transparent",
              color: conversationType === "table" ? "var(--color-accent)" : "var(--color-text-muted)",
              boxShadow: conversationType === "table" ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
              transition: "all var(--transition-fast, 150ms)",
            }}
          >
            <Table2 size={14} />
            {t("Table", "테이블")}
          </button>
          <button
            onClick={() => handleToggleMode("qa")}
            disabled={!canToggleMode}
            title={canToggleMode
              ? t("Q&A mode", "Q&A 모드")
              : t("Mode is locked for existing conversations", "기존 대화에서는 모드 변경 불가")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              border: "none",
              borderRadius: "var(--radius-sm, 6px)",
              cursor: canToggleMode ? "pointer" : "default",
              fontSize: 13,
              fontWeight: conversationType === "qa" ? 600 : 400,
              background: conversationType === "qa" ? "var(--color-bg-elevated)" : "transparent",
              color: conversationType === "qa" ? "var(--color-accent)" : "var(--color-text-muted)",
              boxShadow: conversationType === "qa" ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
              transition: "all var(--transition-fast, 150ms)",
            }}
          >
            <MessageCircleQuestion size={14} />
            {t("Q&A", "Q&A")}
          </button>
        </div>
      </div>

      {/* Message list */}
      <ChatMessageList
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        pipelineStage={pipelineStage}
        pipelineMessage={pipelineMessage}
        pendingUserMessage={pendingUserMessage}
        onNavigateToPaper={handleNavigateToPaper}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onAbort={handleAbort}
        isStreaming={isStreaming}
        conversationType={conversationType}
      />
    </div>
  );
}
