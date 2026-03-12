import { useEffect, useRef } from "react";
import { create } from "zustand";

interface ConfirmDialogState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: ((confirmed: boolean) => void) | null;
}

interface ConfirmDialogStore extends ConfirmDialogState {
  show: (options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  close: (result: boolean) => void;
}

export const useConfirmDialog = create<ConfirmDialogStore>((set, get) => ({
  open: false,
  title: "",
  message: "",
  confirmLabel: "삭제",
  cancelLabel: "취소",
  danger: false,
  resolve: null,

  show: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? "삭제",
        cancelLabel: options.cancelLabel ?? "취소",
        danger: options.danger ?? false,
        resolve,
      });
    }),

  close: (result) => {
    const { resolve } = get();
    resolve?.(result);
    set({ open: false, resolve: null });
  },
}));

export function ConfirmDialog() {
  const { open, title, message, confirmLabel, cancelLabel, danger, close } =
    useConfirmDialog();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Focus cancel (safe default) on open
    confirmRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => {
        if (e.target === backdropRef.current) close(false);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.35)",
        backdropFilter: "blur(2px)",
        animation: "confirmFadeIn 0.12s ease-out",
      }}
    >
      <style>{`
        @keyframes confirmFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes confirmSlideIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div
        style={{
          background: "var(--color-bg-elevated, #fff)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)",
          width: 380,
          maxWidth: "90vw",
          padding: "24px 24px 20px",
          animation: "confirmSlideIn 0.15s ease-out",
        }}
      >
        <h3
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "var(--color-text-primary)",
            marginBottom: 8,
          }}
        >
          {title}
        </h3>

        <p
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--color-text-secondary)",
            marginBottom: 20,
            whiteSpace: "pre-line",
          }}
        >
          {message}
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={() => close(false)}
            style={{
              height: 34,
              padding: "0 16px",
              borderRadius: 7,
              border: "1px solid var(--color-border-subtle)",
              background: "var(--color-bg-surface, #f5f5f5)",
              color: "var(--color-text-secondary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={() => close(true)}
            style={{
              height: 34,
              padding: "0 16px",
              borderRadius: 7,
              border: "none",
              background: danger ? "#ef4444" : "var(--color-accent, #3b82f6)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
