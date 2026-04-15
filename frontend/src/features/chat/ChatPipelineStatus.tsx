import { Search, BrainCircuit, Table2, ShieldCheck, Check, Code, FileSearch, MessageCircleQuestion } from "lucide-react";
import type { ChatPipelineStage } from "@/types/desktop";

/** Pipeline stages shown in the full stepper (after orchestrator decides to generate a table) */
const TABLE_STAGES: { key: ChatPipelineStage; icon: typeof Search; label: string }[] = [
  { key: "searching", icon: Search, label: "논문 데이터 검색 중..." },
  { key: "parsing", icon: Code, label: "OCR 테이블 파싱 중..." },
  { key: "extracting", icon: FileSearch, label: "논문별 데이터 추출 중..." },
  { key: "assembling", icon: Table2, label: "테이블 생성 중..." },
  { key: "verifying", icon: ShieldCheck, label: "데이터 검증 중..." },
];

/** Pipeline stages for Q&A mode (simplified) */
const QA_STAGES: { key: ChatPipelineStage; icon: typeof Search; label: string }[] = [
  { key: "searching", icon: Search, label: "관련 논문 검색 중..." },
  { key: "answering", icon: MessageCircleQuestion, label: "답변 생성 중..." },
];

function tableStageIndex(stage: ChatPipelineStage): number {
  return TABLE_STAGES.findIndex((s) => s.key === stage);
}

function qaStageIndex(stage: ChatPipelineStage): number {
  return QA_STAGES.findIndex((s) => s.key === stage);
}

interface Props {
  stage: ChatPipelineStage;
  message?: string;
}

export function ChatPipelineStatus({ stage, message }: Props) {
  // "orchestrating" = compact thinking indicator (no full stepper)
  if (stage === "orchestrating") {
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
          <BrainCircuit size={22} color="var(--color-success)" />
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderRadius: "var(--radius-lg, 14px)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            fontSize: 14.5,
            color: "var(--color-text-secondary)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--color-accent)",
              animation: "pulse-dot 1.4s ease-in-out infinite",
            }}
          />
          {message || "요청 분석 중..."}
          <style>{`
            @keyframes pulse-dot {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.4; transform: scale(0.7); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  // "answering" = Q&A mode compact indicator (streaming in progress)
  if (stage === "answering") {
    return (
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "var(--radius-md)",
            background: "rgba(37, 99, 235, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <MessageCircleQuestion size={22} color="var(--color-accent)" />
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderRadius: "var(--radius-lg, 14px)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            fontSize: 14.5,
            color: "var(--color-text-secondary)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--color-accent)",
              animation: "pulse-dot 1.4s ease-in-out infinite",
            }}
          />
          {message || "답변 생성 중..."}
          <style>{`
            @keyframes pulse-dot {
              0%, 100% { opacity: 1; transform: scale(1); }
              50% { opacity: 0.4; transform: scale(0.7); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  // Determine if we're in Q&A mode based on stage
  const isQaMode = qaStageIndex(stage) >= 0 && tableStageIndex(stage) < 0;
  const stages = isQaMode ? QA_STAGES : TABLE_STAGES;
  const stageIndexFn = isQaMode ? qaStageIndex : tableStageIndex;

  // "searching" onwards = full stepper for table generation pipeline (or Q&A stepper)
  const activeIdx = stageIndexFn(stage);

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      {/* Bot avatar */}
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
        <BrainCircuit size={22} color="var(--color-success)" />
      </div>

      {/* Stepper */}
      <div
        style={{
          maxWidth: "85%",
          padding: "20px 24px",
          borderRadius: "var(--radius-lg, 14px)",
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

          return (
            <div key={s.key} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              {/* Icon + connector line */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: 30,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
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
                    animation: isActive ? "pulse-dot 1.4s ease-in-out infinite" : "none",
                    transition: "background 0.3s ease, border 0.3s ease",
                  }}
                >
                  {isDone ? (
                    <Check size={16} color="#fff" strokeWidth={3} />
                  ) : (
                    <Icon
                      size={15}
                      color={
                        isActive ? "#fff" : "var(--color-text-muted)"
                      }
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  )}
                </div>
                {/* Connector line */}
                {!isLast && (
                  <div
                    style={{
                      width: 2,
                      height: 20,
                      background: isDone
                        ? "var(--color-success)"
                        : "var(--color-border-subtle)",
                      transition: "background 0.3s ease",
                    }}
                  />
                )}
              </div>

              {/* Label */}
              <div
                style={{
                  paddingTop: 5,
                  paddingBottom: isLast ? 0 : 20,
                  fontSize: 14.5,
                  lineHeight: 1.5,
                  color: isDone
                    ? "var(--color-success)"
                    : isActive
                      ? "var(--color-text-primary)"
                      : "var(--color-text-muted)",
                  fontWeight: isActive ? 600 : 400,
                  transition: "color 0.3s ease",
                }}
              >
                {isActive && message ? message : s.label}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.92); }
        }
      `}</style>
    </div>
  );
}
