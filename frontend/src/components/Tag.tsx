interface TagProps {
  label: string;
}

export function Tag({ label }: TagProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 7px",
        borderRadius: "var(--radius-xs)",
        background: "var(--color-tag-bg)",
        color: "var(--color-text-muted)",
        fontSize: "10px",
        fontWeight: 500,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      {label}
    </span>
  );
}
