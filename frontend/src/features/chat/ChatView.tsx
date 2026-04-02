import { useCallback } from "react";
import { useChatMessages, useSendChatMessage, useAbortChat, useChatStreamBridge } from "@/lib/chatQueries";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore } from "@/stores/uiStore";
import { localeText } from "@/lib/locale";
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
    pipelineStage,
    pipelineMessage,
  } = useChatStore();

  const { data: messages = [] } = useChatMessages(activeConversationId);
  const sendMessage = useSendChatMessage();
  const abortChat = useAbortChat();

  // Wire up streaming event bridge
  useChatStreamBridge();

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
          padding: "12px 20px",
          borderBottom: "1px solid var(--color-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
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

      {/* Message list */}
      <ChatMessageList
        messages={messages}
        streamingContent={streamingContent}
        isStreaming={isStreaming}
        pipelineStage={pipelineStage}
        pipelineMessage={pipelineMessage}
        onNavigateToPaper={handleNavigateToPaper}
      />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onAbort={handleAbort}
        isStreaming={isStreaming}
      />
    </div>
  );
}
