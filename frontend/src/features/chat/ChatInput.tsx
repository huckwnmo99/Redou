import { useCallback, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { localeText } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";
import type { ConversationType } from "@/types/chat";

interface ChatInputProps {
  onSend: (message: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  conversationType?: ConversationType;
}

export function ChatInput({ onSend, onAbort, isStreaming, disabled, conversationType = "table" }: ChatInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) return;
        handleSend();
      }
    },
    [handleSend, isStreaming],
  );

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 260) + "px";
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 10,
        padding: "16px 20px",
        borderTop: "1px solid var(--color-border-subtle)",
        background: "var(--color-bg-elevated)",
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={conversationType === "qa"
          ? t("Ask a question about your papers...", "논문에 대해 자유롭게 질문하세요...")
          : t("Describe the comparison table you need...", "필요한 비교 테이블을 설명해주세요...")}
        disabled={disabled || isStreaming}
        rows={1}
        style={{
          flex: 1,
          resize: "none",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-lg, 14px)",
          padding: "14px 18px",
          fontSize: 15,
          lineHeight: 1.6,
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-primary)",
          background: "var(--color-bg-surface)",
          outline: "none",
          minHeight: 56,
          maxHeight: 260,
          overflow: "auto",
        }}
      />
      {isStreaming ? (
        <button
          onClick={onAbort}
          title={t("Stop generation", "생성 중단")}
          style={{
            width: 48,
            height: 48,
            borderRadius: "var(--radius-md)",
            border: "none",
            cursor: "pointer",
            background: "var(--color-danger)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Square size={18} fill="#fff" />
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          title={t("Send message", "메시지 전송")}
          style={{
            width: 48,
            height: 48,
            borderRadius: "var(--radius-md)",
            border: "none",
            cursor: text.trim() && !disabled ? "pointer" : "default",
            background: text.trim() && !disabled ? "var(--color-accent)" : "var(--color-bg-hover)",
            color: text.trim() && !disabled ? "#fff" : "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            opacity: text.trim() && !disabled ? 1 : 0.5,
          }}
        >
          <Send size={18} />
        </button>
      )}
    </div>
  );
}
