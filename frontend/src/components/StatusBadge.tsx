import type { ReadStatus } from "@/types/paper";

const statusConfig: Record<ReadStatus, { label: string; color: string; bg: string }> = {
  unread: { label: "Unread", color: "#4e5672", bg: "rgba(78,86,114,0.15)" },
  reading: { label: "Reading", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  read: { label: "Read", color: "#22d3a0", bg: "rgba(34,211,160,0.12)" },
};

interface StatusBadgeProps {
  status: ReadStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cfg = statusConfig[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "2px 7px",
        borderRadius: "var(--radius-xs)",
        background: cfg.bg,
        color: cfg.color,
        fontSize: "10px",
        fontWeight: 600,
        letterSpacing: "0.03em",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: cfg.color,
          flexShrink: 0,
        }}
      />
      {cfg.label}
    </span>
  );
}
