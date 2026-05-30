import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/types/chat";
import type { ChatPipelineStage } from "@/types/desktop";
import { useChatTable, useActiveLlmModel } from "@/lib/chatQueries";
import { ChatTableReport, ChatTableReferences } from "./ChatTableReport";
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
  return (
    <>
      <ChatTableReport table={table} />
      <ChatTableReferences table={table} onNavigateToPaper={onNavigateToPaper} />
    </>
  );
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

/** Assistant identity header: R gradient avatar + "Redou Orchestrator" + real active model chip */
function AssistantHeader({ modelName }: { modelName?: string | null }) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "var(--radius-sm)",
          background: "linear-gradient(135deg, #2563eb 0%, #0f766e 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        R
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-primary)" }}>
        {t("Redou Orchestrator", "Redou 오케스트레이터")}
      </span>
      {modelName ? (
        <span
          style={{
            fontSize: 10,
            color: "var(--color-text-muted)",
            background: "var(--color-bg-panel)",
            padding: "1px 6px",
            borderRadius: "var(--radius-xs)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {modelName}
        </span>
      ) : null}
    </div>
  );
}

/** Error identity header (kept distinct from the assistant header tone) */
function ErrorHeader() {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "var(--radius-sm)",
          background: "rgba(220, 38, 38, 0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-danger)",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        !
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-danger)" }}>
        {t("Error", "오류")}
      </span>
    </div>
  );
}

function UserMessage({ content, pending }: { content: string; pending?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        className="chat-user-bubble"
        style={{
          maxWidth: "70%",
          padding: "10px 14px",
          background: "var(--color-accent)",
          color: "#fff",
          borderRadius: "var(--radius-lg)",
          fontSize: 13.5,
          lineHeight: 1.6,
          cursor: "text",
          opacity: pending ? 0.75 : 1,
        }}
      >
        {content}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  modelName,
  onNavigateToPaper,
}: {
  message: ChatMessage;
  modelName?: string | null;
  onNavigateToPaper?: (paperId: string) => void;
}) {
  const isUser = message.role === "user";
  const isError = message.message_type === "error";
  const tableId = message.metadata?.table_id;

  if (isUser) {
    return <UserMessage content={message.content} />;
  }

  return (
    <div style={{ maxWidth: "85%" }}>
      {isError ? <ErrorHeader /> : <AssistantHeader modelName={modelName} />}
      {message.message_type === "table_report" && tableId ? (
        <TableReportLoader tableId={tableId} onNavigateToPaper={onNavigateToPaper} />
      ) : message.message_type === "table_report" && !tableId ? (
        <InlineTableReport content={message.content} />
      ) : (
        <div
          className="chat-markdown"
          style={{
            fontSize: 13.5,
            lineHeight: 1.7,
            color: isError ? "var(--color-danger)" : "var(--color-text-primary)",
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function StreamingBubble({ content, modelName }: { content: string; modelName?: string | null }) {
  return (
    <div style={{ maxWidth: "85%" }}>
      <AssistantHeader modelName={modelName} />
      <div
        className="chat-markdown"
        style={{
          fontSize: 13.5,
          lineHeight: 1.7,
          color: "var(--color-text-primary)",
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || "..."}</ReactMarkdown>
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
  const { data: activeModel } = useActiveLlmModel();
  const modelName = activeModel?.model ?? null;

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
        padding: "20px 0",
      }}
    >
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "0 20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            modelName={modelName}
            onNavigateToPaper={onNavigateToPaper}
          />
        ))}
        {pendingUserMessage && <UserMessage content={pendingUserMessage} pending />}
        {isStreaming && pipelineStage && !streamingContent && (
          <ChatPipelineStatus stage={pipelineStage} message={pipelineMessage} />
        )}
        {isStreaming && !pipelineStage && !streamingContent && (
          <StreamingBubble content="..." modelName={modelName} />
        )}
        {isStreaming && streamingContent && (
          <StreamingBubble content={streamingContent} modelName={modelName} />
        )}
      </div>
    </div>
  );
}
