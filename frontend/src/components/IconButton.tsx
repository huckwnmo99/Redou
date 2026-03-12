import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ active, size = "md", style, ...props }, ref) => {
    const dim = size === "sm" ? 26 : 30;
    return (
      <button
        ref={ref}
        {...props}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: dim,
          height: dim,
          borderRadius: "var(--radius-sm)",
          border: "none",
          cursor: "pointer",
          background: active ? "var(--color-accent-subtle)" : "transparent",
          color: active ? "var(--color-accent)" : "var(--color-text-muted)",
          transition: "background var(--transition-fast), color var(--transition-fast)",
          flexShrink: 0,
          ...style,
        }}
        onMouseEnter={(e) => {
          if (!active) {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--color-bg-hover)";
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--color-text-secondary)";
          }
          props.onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          if (!active) {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.color =
              "var(--color-text-muted)";
          }
          props.onMouseLeave?.(e);
        }}
      />
    );
  }
);

IconButton.displayName = "IconButton";
