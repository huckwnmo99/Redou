import type { ProcessingJobStatus } from "@/types/paper";

const processingConfig: Record<ProcessingJobStatus, { label: string; color: string; bg: string }> = {
  queued: { label: "Import queued", color: "#2563eb", bg: "rgba(37,99,235,0.12)" },
  running: { label: "Processing", color: "#d97706", bg: "rgba(217,119,6,0.12)" },
  succeeded: { label: "Ready", color: "#0f766e", bg: "rgba(15,118,110,0.12)" },
  failed: { label: "Needs attention", color: "#dc2626", bg: "rgba(220,38,38,0.12)" },
};

interface ProcessingBadgeProps {
  status: ProcessingJobStatus;
}

export function ProcessingBadge({ status }: ProcessingBadgeProps) {
  const cfg = processingConfig[status];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 7px",
        borderRadius: "var(--radius-xs)",
        background: cfg.bg,
        color: cfg.color,
        fontSize: 10,
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
