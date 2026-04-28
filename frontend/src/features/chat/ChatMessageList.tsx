import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Bot, AlertTriangle } from "lucide-react";
import type { ChatMessage } from "@/types/chat";
import type { ChatPipelineStage } from "@/types/desktop";
import { useChatTable } from "@/lib/chatQueries";
import { ChatTableReport } from "./ChatTableReport";
import { ChatPipelineStatus } from "./ChatPipelineStatus";
import { localeText } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";

interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  pipelineStage: ChatPipelineStage | null;
  pipelineMessage: string;
  pendingUserMessage?: string | null;
  onNavigateToPaper?: (paperId: string) => void;
}

function TableReportLoader({
  tableId,
  onNavigateToPaper,
}: {
  tableId: string;
  onNavigateToPaper?: (paperId: string) => void;
}) {
  const { data: table } = useChatTable(tableId);
  if (!table) return null;
  return <ChatTableReport table={table} onNavigateToPaper={onNavigateToPaper} />;
}

function InlineTableReport({ content }: { content: string }) {
  try {
    const json = JSON.parse(content);
    const headers: string[] = json.headers ?? [];
    const rows: string[][] = json.rows ?? [];
    return (
      <div style={{ overflowX: "auto" }}>
        {json.title && (
          <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>{json.title}</div>
        )}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              {headers.map((h: string, i: number) => (
                <th key={i} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, borderBottom: "2px solid var(--color-border)", background: "var(--color-bg-panel)", fontSize: 11.5 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: string[], ri: number) => (
              <tr key={ri}>
                {row.map((cell: string, ci: number) => (
                  <td key={ci} style={{ padding: "5px 8px", borderBottom: "1px solid var(--color-border-subtle)" }}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } catch {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
  }
}

function MessageBubble({
  message,
  onNavigateToPaper,
}: {
  message: ChatMessage;
  onNavigateToPaper?: (paperId: string) => void;
}) {
  const isUser = message.role === "user";
  const isError = message.message_type === "error";
  const tableId = message.metadata?.table_id;

  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        flexDirection: isUser ? "row-reverse" : "row",
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: "var(--radius-md)",
          background: isUser
            ? "var(--color-accent-subtle)"
            : isError
              ? "rgba(220, 38, 38, 0.1)"
              : "rgba(15, 118, 110, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isUser ? (
          <User size={22} color="var(--color-accent)" />
        ) : isError ? (
          <AlertTriangle size={22} color="var(--color-danger)" />
        ) : (
          <Bot size={22} color="var(--color-success)" />
        )}
      </div>

      {/* Content */}
      <div
        className={isUser ? "chat-user-bubble" : undefined}
        style={{
          maxWidth: "85%",
          padding: "16px 22px",
          borderRadius: "var(--radius-lg, 14px)",
          background: isUser
            ? "var(--color-accent)"
            : isError
              ? "rgba(254, 242, 242, 0.9)"
              : "var(--color-bg-elevated)",
          color: isUser ? "#fff" : "var(--color-text-primary)",
          fontSize: 15,
          lineHeight: 1.7,
          border: isUser ? "none" : "1px solid var(--color-border-subtle)",
          cursor: isUser ? "text" : undefined,
        }}
      >
        {message.message_type === "table_report" && tableId ? (
          <TableReportLoader tableId={tableId} onNavigateToPaper={onNavigateToPaper} />
        ) : message.message_type === "table_report" && !tableId ? (
          <InlineTableReport content={message.content} />
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingBubble({ content }: { content: string }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: "var(--radius-md)",
          background: "rgba(15, 118, 110, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Bot size={22} color="var(--color-success)" />
      </div>
      <div
        style={{
          maxWidth: "85%",
          padding: "16px 22px",
          borderRadius: "var(--radius-lg, 14px)",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border-subtle)",
          fontSize: 15,
          lineHeight: 1.7,
          color: "var(--color-text-primary)",
        }}
      >
        <div className="chat-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || "..."}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export function ChatMessageList({
  messages,
  streamingContent,
  isStreaming,
  pipelineStage,
  pipelineMessage,
  pendingUserMessage,
  onNavigateToPaper,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingContent, pendingUserMessage]);

  if (messages.length === 0 && !isStreaming && !pendingUserMessage) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-muted)",
          fontSize: 15,
        }}
      >
        {t(
          "Start a conversation to generate comparison tables from your papers.",
          "대화를 시작하여 논문 데이터에서 비교 테이블을 생성하세요.",
        )}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onNavigateToPaper={onNavigateToPaper} />
      ))}
      {pendingUserMessage && (
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexDirection: "row-reverse" }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "var(--radius-md)",
              background: "var(--color-accent-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <User size={22} color="var(--color-accent)" />
          </div>
          <div
            className="chat-user-bubble"
            style={{
              maxWidth: "85%",
              padding: "16px 22px",
              borderRadius: "var(--radius-lg, 14px)",
              background: "var(--color-accent)",
              color: "#fff",
              fontSize: 15,
              lineHeight: 1.7,
              cursor: "text",
              opacity: 0.75,
            }}
          >
            {pendingUserMessage}
          </div>
        </div>
      )}
      {isStreaming && pipelineStage && !streamingContent && (
        <ChatPipelineStatus stage={pipelineStage} message={pipelineMessage} />
      )}
      {isStreaming && !pipelineStage && !streamingContent && (
        <StreamingBubble content="..." />
      )}
      {isStreaming && streamingContent && <StreamingBubble content={streamingContent} />}
    </div>
  );
}
