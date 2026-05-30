import {
  BrainCircuit,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Globe2,
  HardDriveDownload,
  Info,
  LaptopMinimal,
  LogOut,
  RefreshCw,
  UserRound,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { useAuthSession, useSignOut } from "@/lib/auth";
import { localeText } from "@/lib/locale";
import {
  useCreateDesktopBackup,
  useDesktopPdfSelection,
  useDesktopRuntime,
  useRevealInExplorer,
} from "@/lib/desktop";
import { useUIStore } from "@/stores/uiStore";
import {
  useActiveEntityModel,
  useActiveLlmModel,
  useEntityBackfillStatus,
  useEntityGraphEnabled,
  useLlmModels,
  useSetEntityGraphEnabled,
  useSetEntityModel,
  useSetLlmModel,
  useStartEntityBackfill,
} from "@/lib/chatQueries";
import type { AppLocale } from "@/lib/locale";
import type { LucideIcon } from "lucide-react";

type Translator = (english: string, korean: string) => string;

function getErrorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/* ------------------------------------------------------------------ */
/*  Local style helpers (kit `.eyebrow` / `.scroll-y` → inline)        */
/* ------------------------------------------------------------------ */

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--color-text-muted)",
};

/* ------------------------------------------------------------------ */
/*  Reusable section primitives (kit → TS)                             */
/* ------------------------------------------------------------------ */

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2 }}>{title}</h1>
      {subtitle ? (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 6, lineHeight: 1.65, maxWidth: 600 }}>
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}

function Row({
  label,
  description,
  control,
  danger,
}: {
  label: string;
  description?: ReactNode;
  control: ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        columnGap: 24,
        alignItems: "center",
        padding: "16px 0",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: danger ? "var(--color-danger)" : "var(--color-text-primary)",
          }}
        >
          {label}
        </span>
        {description ? (
          <span style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6 }}>{description}</span>
        ) : null}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

function RowGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      {title ? <div style={{ ...eyebrowStyle, marginBottom: 6 }}>{title}</div> : null}
      <div>{children}</div>
    </section>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

function Select({
  value,
  onChange,
  options,
  disabled,
  width = 260,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  width?: number;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      style={{
        width,
        height: 32,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border-subtle)",
        background: "var(--color-bg-elevated)",
        padding: "0 12px",
        fontSize: 12.5,
        color: "var(--color-text-primary)",
        outline: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "var(--font-sans)",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SegmentedControl({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--color-bg-panel)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-sm)",
        padding: 2,
        gap: 2,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            disabled={disabled}
            style={{
              padding: "5px 12px",
              border: "none",
              borderRadius: "var(--radius-xs)",
              background: active ? "var(--color-bg-elevated)" : "transparent",
              color: active ? "var(--color-accent)" : "var(--color-text-muted)",
              fontSize: 12,
              fontWeight: active ? 600 : 500,
              cursor: disabled ? "not-allowed" : "pointer",
              boxShadow: active ? "0 1px 3px rgba(15,23,42,0.08)" : "none",
              whiteSpace: "nowrap",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  icon: IconComponent,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 32,
    padding: "0 14px",
    borderRadius: "var(--radius-sm)",
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background var(--transition-fast)",
    whiteSpace: "nowrap",
  };

  if (variant === "primary") {
    baseStyle.background = "var(--color-accent)";
    baseStyle.color = "#fff";
    baseStyle.border = "none";
  } else if (variant === "danger") {
    baseStyle.background = "transparent";
    baseStyle.color = "var(--color-danger)";
    baseStyle.border = "1px solid rgba(220, 38, 38, 0.3)";
  } else {
    baseStyle.background = "var(--color-bg-elevated)";
    baseStyle.color = "var(--color-text-secondary)";
    baseStyle.border = "1px solid var(--color-border-subtle)";
  }
  if (disabled) baseStyle.opacity = 0.5;

  return (
    <button onClick={onClick} disabled={disabled} style={baseStyle}>
      {IconComponent ? <IconComponent size={13} /> : null}
      {children}
    </button>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--color-text-primary)",
        color: "#fff",
        padding: "10px 16px",
        borderRadius: "var(--radius-md)",
        fontSize: 12.5,
        fontWeight: 500,
        boxShadow: "var(--shadow-md)",
        zIndex: 100,
        maxWidth: "min(560px, calc(100vw - 48px))",
        textAlign: "center",
        wordBreak: "break-word",
      }}
    >
      {text}
    </div>
  );
}

/** Disabled "준비 중" chip for kit mock controls we deliberately do not wire up. */
function ComingSoonPill({ t }: { t: Translator }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: "var(--radius-xs)",
        background: "var(--color-bg-panel)",
        border: "1px solid var(--color-border-subtle)",
        color: "var(--color-text-muted)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {t("Coming soon", "준비 중")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function modelOptionsFrom(
  models: { name: string; size: number }[],
): SelectOption[] {
  return models.map((model) => ({
    value: model.name,
    label: `${model.name}   (${(model.size / 1e9).toFixed(1)} GB)`,
  }));
}

/* ------------------------------------------------------------------ */
/*  Account section                                                   */
/* ------------------------------------------------------------------ */

function AccountSection({ t }: { t: Translator }) {
  const { data: session } = useAuthSession();
  const signOut = useSignOut();

  if (!session) {
    return (
      <>
        <SectionHeader
          title={t("Account", "계정")}
          subtitle={t(
            "The account signed in to this workspace and its authentication state.",
            "이 워크스페이스에 로그인된 계정과 인증 상태.",
          )}
        />
        <div
          style={{
            padding: "18px 20px",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
            color: "var(--color-text-muted)",
            lineHeight: 1.6,
          }}
        >
          {t("You are not signed in.", "로그인되어 있지 않습니다.")}
        </div>
      </>
    );
  }

  const initial = session.user.name.trim().charAt(0) || "?";

  return (
    <>
      <SectionHeader
        title={t("Account", "계정")}
        subtitle={t(
          "The account signed in to this workspace and its authentication state.",
          "이 워크스페이스에 로그인된 계정과 인증 상태.",
        )}
      />

      {/* Identity strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "16px 18px",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-md)",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #2563eb 0%, #0f766e 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 22,
            fontWeight: 700,
            flexShrink: 0,
            textTransform: "uppercase",
          }}
        >
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {session.user.name}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--color-text-muted)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {session.user.email} · {session.user.workspaceName} · {session.user.planLabel}
          </div>
        </div>
        <Button
          icon={LogOut}
          variant="secondary"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          {t("Sign out", "로그아웃")}
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Workspace section                                                 */
/* ------------------------------------------------------------------ */

function WorkspaceSection({
  locale,
  onLocaleChange,
  t,
}: {
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  t: Translator;
}) {
  return (
    <>
      <SectionHeader
        title={t("Workspace", "워크스페이스")}
        subtitle={t(
          "Shell display language and workspace-wide behavior.",
          "셸 표시 언어와 워크스페이스 전반 동작.",
        )}
      />

      <RowGroup title={t("Appearance", "표시")}>
        <Row
          label={t("Display language", "표시 언어")}
          description={t(
            "Switch the shell between English and Korean. Some deeper product surfaces may still stay in English for now.",
            "셸 언어를 영어/한국어 사이에서 전환. 일부 깊은 화면은 영어로 유지될 수 있음.",
          )}
          control={
            <SegmentedControl
              value={locale}
              onChange={(value) => onLocaleChange(value === "ko" ? "ko" : "en")}
              options={[
                { value: "en", label: "English" },
                { value: "ko", label: "한국어" },
              ]}
            />
          }
        />
        <Row
          label={t("Theme", "테마")}
          description={t("Redou currently ships a light theme only.", "Redou는 현재 라이트 테마 전용입니다.")}
          control={<ComingSoonPill t={t} />}
        />
      </RowGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Models section (LLM + Entity graph — regression-critical)          */
/* ------------------------------------------------------------------ */

function ModelsSection({ desktopReady, flash, t }: { desktopReady: boolean; flash: (message: string) => void; t: Translator }) {
  const { data: llmModels = [], isLoading: modelsLoading, isError: modelsError, refetch: refetchModels } = useLlmModels();
  const { data: activeModel } = useActiveLlmModel();
  const setLlmModel = useSetLlmModel();
  const { data: activeEntityModel } = useActiveEntityModel();
  const setEntityModel = useSetEntityModel();
  const { data: entityStatus, refetch: refetchEntityStatus } = useEntityBackfillStatus();
  const startEntityBackfill = useStartEntityBackfill();
  const { data: entityGraphEnabled = false } = useEntityGraphEnabled();
  const setEntityGraphEnabled = useSetEntityGraphEnabled();

  const modelOptions = modelOptionsFrom(llmModels);
  const hasModels = llmModels.length > 0;

  const sourceLabel = activeModel
    ? activeModel.source === "user"
      ? t("User selection", "사용자 선택")
      : activeModel.source === "env"
        ? t("Environment variable", "환경변수")
        : t("Default", "기본값")
    : null;

  async function handleEntityBackfill() {
    try {
      const result = await startEntityBackfill.mutateAsync();
      const queued = result?.queued ?? 0;
      flash(
        queued > 0
          ? t(`Entity extraction queued for ${queued} papers.`, `${queued}개 논문의 엔티티 추출을 시작합니다.`)
          : t("Entity graph is already up to date or queued.", "엔티티 그래프가 이미 최신 상태이거나 대기열에 있습니다."),
      );
      await refetchEntityStatus();
    } catch (caught) {
      flash(getErrorMessage(caught, t("Failed to queue entity extraction.", "엔티티 추출 대기열 추가에 실패했습니다.")));
    }
  }

  const progressPct =
    entityStatus && entityStatus.totalPapers > 0
      ? Math.min(100, Math.round((entityStatus.processedPapers / entityStatus.totalPapers) * 100))
      : 0;

  // Entity model select — preserve the "inherit" (use chat model) semantics.
  const entitySelectValue = activeEntityModel
    ? activeEntityModel.source === "llm"
      ? "inherit"
      : activeEntityModel.model
    : "inherit";
  const entityOptions: SelectOption[] = [
    { value: "inherit", label: t("Inherits chat model", "채팅 모델 사용") },
    ...modelOptions,
  ];

  return (
    <>
      <SectionHeader
        title={t("Models", "모델")}
        subtitle={t(
          "Ollama models used for chat, table generation, and entity extraction. Guardian and OCR use separate channels.",
          "채팅·테이블 생성·엔티티 추출에 사용하는 Ollama 모델. Guardian과 OCR 모델은 별도 채널을 씁니다.",
        )}
      />

      {/* Status strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          background: modelsError ? "rgba(220, 38, 38, 0.08)" : "rgba(15, 118, 110, 0.08)",
          border: `1px solid ${modelsError ? "rgba(220, 38, 38, 0.22)" : "rgba(15, 118, 110, 0.22)"}`,
          borderRadius: "var(--radius-sm)",
          marginBottom: 22,
          fontSize: 12.5,
          flexWrap: "wrap",
        }}
      >
        {modelsError ? (
          <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>
            {t("Failed to connect to Ollama. Make sure it is running.", "Ollama 연결에 실패했습니다. 실행 중인지 확인하세요.")}
          </span>
        ) : (
          <>
            <CheckCircle2 size={14} style={{ color: "var(--color-success)" }} />
            <span style={{ color: "var(--color-success)", fontWeight: 600 }}>{t("Ollama connected", "Ollama 연결됨")}</span>
            <span style={{ color: "var(--color-text-muted)" }}>
              localhost:11434 · {modelsLoading ? t("loading…", "로딩 중…") : t(`${llmModels.length} models available`, `모델 ${llmModels.length}개 사용 가능`)}
            </span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => refetchModels()}
          disabled={modelsLoading}
          style={{
            background: "transparent",
            border: "none",
            cursor: modelsLoading ? "progress" : "pointer",
            color: "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11.5,
            fontWeight: 500,
          }}
        >
          <RefreshCw size={12} />
          {t("Refresh", "새로고침")}
        </button>
      </div>

      <RowGroup title={t("Chat & table generation", "채팅·테이블 생성")}>
        <Row
          label={t("Active model", "사용 모델")}
          description={
            <>
              {t(
                "The Ollama model used for chat, table generation, and Q&A.",
                "채팅·테이블 생성·Q&A에 사용할 Ollama 모델.",
              )}
              {sourceLabel ? ` · ${t("Source:", "소스:")} ${sourceLabel}` : ""}
            </>
          }
          control={
            <Select
              value={activeModel?.model ?? ""}
              onChange={(value) => {
                if (value) {
                  setLlmModel.mutate(value);
                  flash(t(`LLM model changed to ${value}`, `LLM 모델을 ${value}(으)로 변경했습니다.`));
                }
              }}
              options={
                modelsLoading
                  ? [{ value: "", label: t("Loading models…", "모델 로딩 중…") }]
                  : !hasModels
                    ? [{ value: "", label: t("No models available", "사용 가능한 모델 없음") }]
                    : modelOptions
              }
              disabled={modelsLoading || !hasModels}
            />
          }
        />
        <Row
          label={t("Streaming", "스트리밍")}
          description={t(
            "Responses always stream token by token.",
            "응답은 항상 토큰 단위로 스트리밍됩니다.",
          )}
          control={<ComingSoonPill t={t} />}
        />
        <Row
          label={t("Guardian verification", "Guardian 검증")}
          description={t(
            "Granite Guardian samples generated cells against their sources in the background.",
            "Granite Guardian이 생성된 셀을 백그라운드에서 근거와 대조해 샘플 검증합니다.",
          )}
          control={<ComingSoonPill t={t} />}
        />
      </RowGroup>

      <RowGroup title={t("Knowledge graph", "지식 그래프")}>
        <Row
          label={t("Enable entity graph (opt-in)", "엔티티 그래프 사용 (선택)")}
          description={t(
            "Off by default. Adds ~100s per import and an extra LLM call per question. The toggle controls automatic extraction and graph-based Q&A only — manual backfill below works regardless.",
            "기본 꺼짐. 켜면 import당 약 100초, 질문당 LLM 호출이 추가됩니다. 토글은 자동 추출과 그래프 기반 Q&A만 제어하며, 아래 수동 백필은 토글과 무관하게 동작합니다.",
          )}
          control={
            <SegmentedControl
              value={entityGraphEnabled ? "on" : "off"}
              onChange={(value) => {
                const next = value === "on";
                setEntityGraphEnabled.mutate(next);
                flash(
                  next
                    ? t("Entity graph enabled", "엔티티 그래프를 켰습니다.")
                    : t("Entity graph disabled", "엔티티 그래프를 껐습니다."),
                );
              }}
              options={[
                { value: "off", label: t("Off", "끔") },
                { value: "on", label: t("On", "켬") },
              ]}
            />
          }
        />
        <Row
          label={t("Entity extraction model", "엔티티 추출 모델")}
          description={t(
            "Extracts entities and relations such as materials, methods, conditions, and metrics.",
            "물질·방법·조건·지표 등 엔티티와 관계 추출.",
          )}
          control={
            <Select
              value={entitySelectValue}
              onChange={(value) => {
                if (value) {
                  setEntityModel.mutate(value);
                  flash(
                    value === "inherit"
                      ? t("Entity model set to inherit the chat model.", "엔티티 모델을 채팅 모델 사용으로 설정했습니다.")
                      : t(`Entity model changed to ${value}`, `엔티티 모델을 ${value}(으)로 변경했습니다.`),
                  );
                }
              }}
              options={modelsLoading ? [{ value: "inherit", label: t("Loading models…", "모델 로딩 중…") }] : entityOptions}
              disabled={modelsLoading}
            />
          }
        />
        <Row
          label={t("Backfill all papers", "전체 논문 백필")}
          description={
            entityStatus
              ? t(
                  `Progress ${entityStatus.processedPapers} / ${entityStatus.totalPapers} (version ${entityStatus.version}) · ${entityStatus.queuedJobs} queued, ${entityStatus.runningJobs} running, ${entityStatus.failedJobs} failed`,
                  `진행 ${entityStatus.processedPapers} / ${entityStatus.totalPapers} (버전 ${entityStatus.version}) · 대기 ${entityStatus.queuedJobs}, 실행 ${entityStatus.runningJobs}, 실패 ${entityStatus.failedJobs}`,
                )
              : t("Status unavailable.", "상태를 확인할 수 없습니다.")
          }
          control={
            <Button
              icon={RefreshCw}
              onClick={handleEntityBackfill}
              disabled={!desktopReady || startEntityBackfill.isPending}
            >
              {startEntityBackfill.isPending ? t("Queueing…", "대기열 추가 중…") : t("Re-extract", "재추출")}
            </Button>
          }
        />
        <div style={{ paddingBottom: 16 }}>
          <div
            style={{
              height: 4,
              background: "var(--color-bg-panel)",
              borderRadius: 99,
              overflow: "hidden",
              marginTop: -8,
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                background: "var(--color-accent)",
                transition: "width var(--transition-base)",
              }}
            />
          </div>
        </div>
      </RowGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Desktop section                                                   */
/* ------------------------------------------------------------------ */

function DesktopSection({
  desktopReady,
  desktopLoading,
  flash,
  t,
}: {
  desktopReady: boolean;
  desktopLoading: boolean;
  flash: (message: string) => void;
  t: Translator;
}) {
  const { data: desktop } = useDesktopRuntime();
  const selectPdfFiles = useDesktopPdfSelection();
  const createBackup = useCreateDesktopBackup();
  const revealInExplorer = useRevealInExplorer();
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [latestBackupPath, setLatestBackupPath] = useState<string | null>(null);
  const [requeuePending, setRequeuePending] = useState(false);

  async function handleSelectPdfFiles() {
    try {
      const files = await selectPdfFiles.mutateAsync();
      setSelectedFiles(files);
      flash(
        files.length > 0
          ? t(`${files.length} PDF files selected from the desktop dialog.`, `데스크톱 대화상자에서 PDF ${files.length}개를 선택했습니다.`)
          : t("No PDF files selected.", "선택된 PDF가 없습니다."),
      );
    } catch (caught) {
      flash(getErrorMessage(caught, t("Unable to open the PDF selection dialog.", "PDF 선택 대화상자를 열 수 없습니다.")));
    }
  }

  async function handleCreateBackup() {
    try {
      const backup = await createBackup.mutateAsync();
      setLatestBackupPath(backup.backupPath);
      flash(t(`Workspace backup created at ${backup.backupPath}`, `워크스페이스 백업을 생성했습니다: ${backup.backupPath}`));
    } catch (caught) {
      flash(getErrorMessage(caught, t("Unable to create the workspace backup.", "워크스페이스 백업을 만들 수 없습니다.")));
    }
  }

  async function handleReveal(path: string | null, fallback: string) {
    if (!path) {
      flash(fallback);
      return;
    }
    try {
      await revealInExplorer.mutateAsync(path);
      flash(t(`Opened ${path}`, `탐색기에서 열었습니다: ${path}`));
    } catch (caught) {
      flash(getErrorMessage(caught, t("Unable to reveal the requested path.", "요청한 경로를 탐색기에서 열 수 없습니다.")));
    }
  }

  async function handleRequeueAll() {
    const api = window.redouDesktop;
    if (!api) return;
    setRequeuePending(true);
    try {
      const result = await api.pipeline.requeueAll();
      if (result.success) {
        const count = result.data?.queued ?? 0;
        flash(
          count > 0
            ? t(`Re-extraction queued for ${count} papers.`, `${count}개 논문의 재추출을 시작합니다.`)
            : t("All papers are already up to date or queued.", "모든 논문이 이미 최신 상태이거나 대기열에 있습니다."),
        );
      } else {
        flash(result.error ?? t("Failed to queue re-extraction.", "재추출 대기열 추가에 실패했습니다."));
      }
    } catch (caught) {
      flash(getErrorMessage(caught, t("Failed to queue re-extraction.", "재추출 대기열 추가에 실패했습니다.")));
    } finally {
      setRequeuePending(false);
    }
  }

  const runtimeValue = desktopLoading
    ? t("Checking…", "확인 중…")
    : desktopReady
      ? `Electron${desktop?.version ? ` ${desktop.version}` : ""}`
      : t("Browser preview", "브라우저 미리보기");

  const kvCells: { label: string; value: string; success?: boolean }[] = [
    { label: t("Runtime", "런타임"), value: runtimeValue, success: desktopReady },
    { label: t("Platform", "플랫폼"), value: desktop?.platform ?? t("Checking…", "확인 중…") },
    {
      label: t("Library", "라이브러리"),
      value: desktop?.libraryPath ?? t("Available in Electron", "Electron에서 표시됨"),
    },
    {
      label: t("Status", "상태"),
      value: desktopReady ? t("Connected", "연결됨") : t("Browser preview", "브라우저 미리보기"),
      success: desktopReady,
    },
  ];

  return (
    <>
      <SectionHeader
        title={t("Desktop", "데스크톱")}
        subtitle={t(
          "File-system and backup actions that only work when the Electron shell is connected.",
          "Electron 셸이 연결됐을 때만 동작하는 파일 시스템·백업 기능.",
        )}
      />

      {/* Runtime card */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-md)",
          marginBottom: 24,
          overflow: "hidden",
        }}
      >
        {kvCells.map((kv, index) => (
          <div
            key={kv.label}
            style={{
              padding: "14px 16px",
              borderRight: index % 2 === 0 ? "1px solid var(--color-border-subtle)" : "none",
              borderBottom: index < 2 ? "1px solid var(--color-border-subtle)" : "none",
              minWidth: 0,
            }}
          >
            <div style={{ ...eyebrowStyle, marginBottom: 4 }}>{kv.label}</div>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: kv.success ? "var(--color-success)" : "var(--color-text-primary)",
                wordBreak: "break-all",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {kv.success ? <CheckCircle2 size={12} style={{ color: "var(--color-success)", flexShrink: 0 }} /> : null}
              {kv.value}
            </div>
          </div>
        ))}
      </div>

      <RowGroup title={t("File actions", "파일 작업")}>
        <Row
          label={t("Select PDFs", "PDF 선택")}
          description={t("Pick multiple PDFs from the desktop dialog to import.", "데스크톱 대화상자에서 PDF 여러 개를 선택해 임포트.")}
          control={
            <Button icon={FolderOpen} onClick={handleSelectPdfFiles} disabled={!desktopReady || selectPdfFiles.isPending}>
              {selectPdfFiles.isPending ? t("Opening…", "여는 중…") : t("Select", "선택")}
            </Button>
          }
        />
        <Row
          label={t("Reveal library", "라이브러리 열기")}
          description={t("Open the library folder in your file explorer.", "라이브러리 폴더를 탐색기에서 열기.")}
          control={
            <Button
              icon={ExternalLink}
              onClick={() => handleReveal(desktop?.libraryPath ?? null, t("No library path available yet.", "아직 라이브러리 경로가 없습니다."))}
              disabled={!desktopReady || !desktop?.libraryPath || revealInExplorer.isPending}
            >
              {t("Reveal", "열기")}
            </Button>
          }
        />
        {selectedFiles.length > 0 ? (
          <div style={{ padding: "12px 0", display: "grid", gap: 8 }}>
            <div style={eyebrowStyle}>{t("Selected PDFs", "선택한 PDF")}</div>
            {selectedFiles.slice(0, 5).map((filePath) => (
              <div
                key={filePath}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  minWidth: 0,
                }}
              >
                <FolderOpen size={13} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filePath}</span>
              </div>
            ))}
            {selectedFiles.length > 5 ? (
              <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                {t(`+ ${selectedFiles.length - 5} more files selected`, `+ ${selectedFiles.length - 5}개 파일이 더 선택됨`)}
              </div>
            ) : null}
          </div>
        ) : null}
      </RowGroup>

      <RowGroup title={t("Backup", "백업")}>
        <Row
          label={t("Create workspace backup", "워크스페이스 백업 생성")}
          description={t("Bundle every paper, note, highlight, and embedding into a .zip archive.", "모든 논문·노트·하이라이트·임베딩을 .zip으로 묶어 저장.")}
          control={
            <Button icon={HardDriveDownload} variant="primary" onClick={handleCreateBackup} disabled={!desktopReady || createBackup.isPending}>
              {createBackup.isPending ? t("Backing up…", "백업 중…") : t("Backup now", "지금 백업")}
            </Button>
          }
        />
        <Row
          label={t("Latest backup", "최근 백업")}
          description={
            latestBackupPath ? (
              <span style={{ wordBreak: "break-all" }}>{latestBackupPath}</span>
            ) : (
              t("Create a backup first to reveal it in your explorer.", "탐색기에서 열려면 먼저 백업을 만드세요.")
            )
          }
          control={
            <Button
              icon={ExternalLink}
              onClick={() => handleReveal(latestBackupPath, t("Create a backup first to reveal it in Explorer.", "탐색기에서 열려면 먼저 백업을 만드세요."))}
              disabled={!desktopReady || !latestBackupPath || revealInExplorer.isPending}
            >
              {t("Reveal", "열기")}
            </Button>
          }
        />
      </RowGroup>

      <RowGroup title={t("Pipeline", "파이프라인")}>
        <Row
          label={t("Re-extract all papers", "전체 논문 재추출")}
          description={t("Reprocess the whole library when the extraction version has been bumped.", "추출 버전이 올라갔을 때 라이브러리 전체를 다시 처리.")}
          control={
            <Button icon={RefreshCw} onClick={handleRequeueAll} disabled={!desktopReady || requeuePending}>
              {requeuePending ? t("Queueing…", "대기열 추가 중…") : t("Re-extract", "재추출")}
            </Button>
          }
        />
      </RowGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  About section                                                     */
/* ------------------------------------------------------------------ */

function AboutSection({ t }: { t: Translator }) {
  const { data: desktop } = useDesktopRuntime();

  return (
    <>
      <SectionHeader title={t("About", "정보")} subtitle={t("Version, stack, and runtime build details.", "버전·스택·런타임 빌드 정보.")} />

      <RowGroup title={t("Build", "빌드")}>
        <Row
          label={t("Desktop version", "데스크톱 버전")}
          control={<code style={monoStyle}>{desktop?.version ?? t("Unavailable", "사용 불가")}</code>}
        />
        <Row
          label={t("Runtime", "런타임")}
          control={<code style={monoStyle}>{desktop?.available ? "Electron" : t("Browser preview", "브라우저 미리보기")}</code>}
        />
        <Row
          label={t("Frontend stack", "프론트엔드 스택")}
          description="Vite 6 · TailwindCSS v4 · TanStack Query · Zustand"
          control={<span />}
        />
      </RowGroup>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Section rail                                                      */
/* ------------------------------------------------------------------ */

type SectionId = "account" | "workspace" | "models" | "desktop" | "about";

const SECTIONS: { id: SectionId; icon: LucideIcon; title: [string, string]; subtitle: [string, string] }[] = [
  { id: "account", icon: UserRound, title: ["Account", "계정"], subtitle: ["Account", "계정"] },
  { id: "workspace", icon: Globe2, title: ["Workspace", "워크스페이스"], subtitle: ["Workspace", "워크스페이스"] },
  { id: "models", icon: BrainCircuit, title: ["Models", "모델"], subtitle: ["Models", "모델"] },
  { id: "desktop", icon: LaptopMinimal, title: ["Desktop", "데스크톱"], subtitle: ["Desktop", "데스크톱"] },
  { id: "about", icon: Info, title: ["About", "정보"], subtitle: ["About", "정보"] },
];

/* ------------------------------------------------------------------ */
/*  Main view — two-pane settings                                     */
/* ------------------------------------------------------------------ */

export function SettingsView() {
  const { locale, setLocale } = useUIStore();
  const { data: desktop, isLoading: desktopLoading } = useDesktopRuntime();
  const t = (english: string, korean: string) => localeText(locale, english, korean);

  const [section, setSection] = useState<SectionId>("account");
  const [feedback, setFeedback] = useState<string | null>(null);

  const desktopReady = desktop?.available ?? false;

  function flash(message: string) {
    setFeedback(message);
    window.setTimeout(() => setFeedback((current) => (current === message ? null : current)), 2500);
  }

  function handleLocaleChange(nextLocale: AppLocale) {
    setLocale(nextLocale);
    flash(localeText(nextLocale, "Display language changed to English.", "표시 언어를 한국어로 변경했습니다."));
  }

  return (
    <div style={{ height: "100%", display: "flex", background: "var(--color-bg-surface)", overflow: "hidden" }}>
      {/* Section rail */}
      <aside
        style={{
          width: 224,
          flexShrink: 0,
          background: "var(--color-bg-panel)",
          borderRight: "1px solid var(--color-border-subtle)",
          padding: "18px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <div style={{ ...eyebrowStyle, padding: "0 10px 10px" }}>{t("Settings", "설정")}</div>
        {SECTIONS.map((item) => {
          const active = section === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                width: "100%",
                borderRadius: "var(--radius-sm)",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                background: active ? "var(--color-accent-subtle)" : "transparent",
                color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                transition: "background var(--transition-fast), color var(--transition-fast)",
              }}
            >
              <Icon size={15} style={{ color: active ? "var(--color-accent)" : "var(--color-text-muted)", flexShrink: 0 }} />
              <span>{t(item.title[0], item.title[1])}</span>
            </button>
          );
        })}
      </aside>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 32px 60px" }}>
          {section === "account" ? <AccountSection t={t} /> : null}
          {section === "workspace" ? (
            <WorkspaceSection locale={locale} onLocaleChange={handleLocaleChange} t={t} />
          ) : null}
          {section === "models" ? <ModelsSection desktopReady={desktopReady} flash={flash} t={t} /> : null}
          {section === "desktop" ? (
            <DesktopSection desktopReady={desktopReady} desktopLoading={desktopLoading} flash={flash} t={t} />
          ) : null}
          {section === "about" ? <AboutSection t={t} /> : null}
        </div>
      </div>

      {feedback ? <Toast text={feedback} /> : null}
    </div>
  );
}
