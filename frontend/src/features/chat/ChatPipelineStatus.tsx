import { Search, BrainCircuit, Table2, ShieldCheck, Check, Code, FileSearch, MessageCircleQuestion, Sparkles, Network } from "lucide-react";
import type { ChatPipelineStage } from "@/types/desktop";
import { localeText } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";

type StageLabel = (t: (en: string, ko: string) => string) => string;

/** Pipeline stages shown in the full stepper (after orchestrator decides to generate a table) */
const TABLE_STAGES: { key: ChatPipelineStage; icon: typeof Search; label: StageLabel }[] = [
  { key: "searching", icon: Search, label: (t) => t("Searching paper data...", "논문 데이터 검색 중...") },
  { key: "parsing", icon: Code, label: (t) => t("Parsing OCR tables...", "OCR 테이블 파싱 중...") },
  { key: "extracting", icon: FileSearch, label: (t) => t("Extracting data per paper...", "논문별 데이터 추출 중...") },
  { key: "researching", icon: Sparkles, label: (t) => t("Re-searching for NULL values...", "NULL 값 재검색 중...") },
  { key: "assembling", icon: Table2, label: (t) => t("Building table...", "테이블 생성 중...") },
  { key: "verifying", icon: ShieldCheck, label: (t) => t("Verifying data...", "데이터 검증 중...") },
];

/** Pipeline stages for Q&A mode (simplified) */
const QA_STAGES: { key: ChatPipelineStage; icon: typeof Search; label: StageLabel }[] = [
  { key: "graphing", icon: Network, label: (t) => t("Expanding entity graph context...", "엔티티 그래프 컨텍스트 확장 중...") },
  { key: "searching", icon: Search, label: (t) => t("Searching related papers...", "관련 논문 검색 중...") },
  { key: "answering", icon: MessageCircleQuestion, label: (t) => t("Generating answer...", "답변 생성 중...") },
];

function tableStageIndex(stage: ChatPipelineStage): number {
  return TABLE_STAGES.findIndex((s) => s.key === stage);
}

const QA_STAGE_ORDER: Partial<Record<ChatPipelineStage, number>> = {
  searching: 0,
  graphing: 1,
  answering: 2,
};

function qaStageIndex(stage: ChatPipelineStage): number {
  return QA_STAGE_ORDER[stage] ?? -1;
}

interface Props {
  stage: ChatPipelineStage;
  message?: string;
}

/** Compact pulsing indicator used for single-step stages (orchestrating / answering) */
function CompactIndicator({
  icon,
  iconColor,
  iconBg,
  text,
}: {
  icon: React.ReactNode;
  iconColor: string;
  iconBg: string;
  text: string;
}) {
  return (
    <div style={{ maxWidth: "85%", display: "flex", gap: 10, alignItems: "center" }}>
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: "var(--radius-sm)",
          background: iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: iconColor,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border-subtle)",
          fontSize: 12.5,
          color: "var(--color-text-secondary)",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--color-accent)",
            animation: "chat-pulse-dot 1.4s ease-in-out infinite",
          }}
        />
        {text}
        <style>{`
          @keyframes chat-pulse-dot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.7); }
          }
        `}</style>
      </div>
    </div>
  );
}

export function ChatPipelineStatus({ stage, message }: Props) {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  // "orchestrating" = compact thinking indicator (no full stepper)
  if (stage === "orchestrating") {
    return (
      <CompactIndicator
        icon={<BrainCircuit size={14} />}
        iconColor="var(--color-success)"
        iconBg="rgba(15, 118, 110, 0.12)"
        text={message || t("Analyzing request...", "요청 분석 중...")}
      />
    );
  }

  // "answering" = Q&A mode compact indicator (streaming in progress)
  if (stage === "answering") {
    return (
      <CompactIndicator
        icon={<MessageCircleQuestion size={14} />}
        iconColor="var(--color-accent)"
        iconBg="var(--color-accent-subtle)"
        text={message || t("Generating answer...", "답변 생성 중...")}
      />
    );
  }

  // Determine if we're in Q&A mode based on stage
  const isQaMode = qaStageIndex(stage) >= 0 && tableStageIndex(stage) < 0;
  const stages = isQaMode
    ? [...QA_STAGES].sort((a, b) => qaStageIndex(a.key) - qaStageIndex(b.key))
    : TABLE_STAGES;
  const stageIndexFn = isQaMode ? qaStageIndex : tableStageIndex;

  // "searching" onwards = full stepper for table generation pipeline (or Q&A stepper)
  const activeIdx = stageIndexFn(stage);

  return (
    <div style={{ maxWidth: "85%", display: "flex", gap: 8, alignItems: "flex-start" }}>
      {/* Orchestrator avatar (matches assistant header tone) */}
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
          flexShrink: 0,
        }}
      >
        <BrainCircuit size={13} />
      </div>

      {/* Stepper */}
      <div
        style={{
          flex: 1,
          padding: "16px 18px",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {stages.map((s, idx) => {
          const isDone = idx < activeIdx;
          const isActive = idx === activeIdx;
          const isPending = idx > activeIdx;
          const Icon = s.icon;
          const isLast = idx === stages.length - 1;
          const stageLabel = s.label(t);

          return (
            <div key={s.key} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {/* Icon + connector line */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: 26,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isDone
                      ? "var(--color-success)"
                      : isActive
                        ? "var(--color-accent)"
                        : "var(--color-bg-panel)",
                    border: isPending ? "1.5px solid var(--color-border)" : "none",
                    animation: isActive ? "chat-step-pulse 1.4s ease-in-out infinite" : "none",
                    transition: "background var(--transition-fast), border var(--transition-fast)",
                  }}
                >
                  {isDone ? (
                    <Check size={14} color="#fff" strokeWidth={3} />
                  ) : (
                    <Icon
                      size={13}
                      color={isActive ? "#fff" : "var(--color-text-muted)"}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  )}
                </div>
                {/* Connector line */}
                {!isLast && (
                  <div
                    style={{
                      width: 2,
                      height: 18,
                      background: isDone
                        ? "var(--color-success)"
                        : "var(--color-border-subtle)",
                      transition: "background var(--transition-fast)",
                    }}
                  />
                )}
              </div>

              {/* Label */}
              <div
                style={{
                  paddingTop: 4,
                  paddingBottom: isLast ? 0 : 18,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: isDone
                    ? "var(--color-success)"
                    : isActive
                      ? "var(--color-text-primary)"
                      : "var(--color-text-muted)",
                  fontWeight: isActive ? 600 : 400,
                  transition: "color var(--transition-fast)",
                }}
              >
                {isActive && message ? message : stageLabel}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes chat-step-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.92); }
        }
      `}</style>
    </div>
  );
}
