import type { CSSProperties } from "react";

export const cardStyle: CSSProperties = {
  padding: 18,
  borderRadius: "var(--radius-lg)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
  boxShadow: "var(--shadow-sm)",
};

export const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--color-text-muted)",
  marginBottom: 8,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export const lightButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 34,
  padding: "0 12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border-subtle)",
  background: "var(--color-bg-surface)",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};
