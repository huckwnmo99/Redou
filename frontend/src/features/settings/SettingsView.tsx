import { CheckCircle2, FolderOpen, Globe2, HardDriveDownload, LaptopMinimal, LogOut, RefreshCw, ShieldCheck, BrainCircuit, Network } from "lucide-react";
import { useState } from "react";
import { useAuthSession, useSignOut } from "@/lib/auth";
import {
  localeOptions,
  localeText,
} from "@/lib/locale";
import {
  useCreateDesktopBackup,
  useDesktopPdfSelection,
  useDesktopRuntime,
  useRevealInExplorer,
} from "@/lib/desktop";
import { useUIStore } from "@/stores/uiStore";
import {
  useLlmModels,
  useActiveLlmModel,
  useSetLlmModel,
  useEntityModel,
  useSetEntityModel,
  useEntityBackfillStatus,
  useEntityBackfillMutation,
} from "@/lib/chatQueries";

function getErrorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

export function SettingsView() {
  const { locale, setLocale } = useUIStore();
  const { data: session } = useAuthSession();
  const signOut = useSignOut();
  const { data: desktop, isLoading: desktopLoading } = useDesktopRuntime();
  const selectPdfFiles = useDesktopPdfSelection();
  const createBackup = useCreateDesktopBackup();
  const revealInExplorer = useRevealInExplorer();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [latestBackupPath, setLatestBackupPath] = useState<string | null>(null);
  const [requeuePending, setRequeuePending] = useState(false);
  const { data: llmModels = [], isLoading: modelsLoading, isError: modelsError, refetch: refetchModels } = useLlmModels();
  const { data: activeModel } = useActiveLlmModel();
  const setLlmModel = useSetLlmModel();
  const { data: activeEntityModel } = useEntityModel();
  const setEntityModel = useSetEntityModel();
  const { data: entityBackfillStatus } = useEntityBackfillStatus();
  const entityBackfill = useEntityBackfillMutation();
  const t = (english: string, korean: string) => localeText(locale, english, korean);

  const desktopReady = desktop?.available ?? false;
  const runtimeLabel = desktopLoading
    ? t("Checking desktop bridge...", "데스크톱 브리지를 확인하는 중...")
    : desktopReady
      ? t("Electron shell connected", "Electron 셸 연결됨")
      : t("Browser preview mode", "브라우저 미리보기 모드");

  async function handleSelectPdfFiles() {
    try {
      const files = await selectPdfFiles.mutateAsync();
      setSelectedFiles(files);
      setFeedback(
        files.length > 0
          ? t(`${files.length} PDF files selected from the desktop dialog.`, `데스크톱 대화상자에서 PDF ${files.length}개를 선택했습니다.`)
          : t("No PDF files selected.", "선택된 PDF가 없습니다."),
      );
    } catch (caught) {
      setFeedback(getErrorMessage(caught, t("Unable to open the PDF selection dialog.", "PDF 선택 대화상자를 열 수 없습니다.")));
    }
  }

  async function handleCreateBackup() {
    try {
      const backup = await createBackup.mutateAsync();
      setLatestBackupPath(backup.backupPath);
      setFeedback(t(`Workspace backup created at ${backup.backupPath}`, `워크스페이스 백업을 생성했습니다: ${backup.backupPath}`));
    } catch (caught) {
      setFeedback(getErrorMessage(caught, t("Unable to create the workspace backup.", "워크스페이스 백업을 만들 수 없습니다.")));
    }
  }

  async function handleReveal(path: string | null, fallback: string) {
    if (!path) {
      setFeedback(fallback);
      return;
    }

    try {
      await revealInExplorer.mutateAsync(path);
      setFeedback(t(`Opened ${path}`, `탐색기에서 열었습니다: ${path}`));
    } catch (caught) {
      setFeedback(getErrorMessage(caught, t("Unable to reveal the requested path.", "요청한 경로를 탐색기에서 열 수 없습니다.")));
    }
  }

  async function handleEntityBackfill() {
    try {
      const result = await entityBackfill.mutateAsync();
      const count = result?.queued ?? 0;
      setFeedback(
        count > 0
          ? t(`Entity extraction queued for ${count} papers.`, `${count}개 논문의 엔티티 추출을 시작합니다.`)
          : t("All papers are already up to date or queued for entity extraction.", "모든 논문이 이미 최신 엔티티 추출 상태이거나 대기열에 있습니다."),
      );
    } catch (caught) {
      setFeedback(getErrorMessage(caught, t("Failed to queue entity extraction.", "엔티티 추출 대기열 추가에 실패했습니다.")));
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
        setFeedback(
          count > 0
            ? t(`Re-extraction queued for ${count} papers.`, `${count}개 논문의 재추출을 시작합니다.`)
            : t("All papers are already up to date or queued.", "모든 논문이 이미 최신 상태이거나 대기열에 있습니다."),
        );
      } else {
        setFeedback(result.error ?? t("Failed to queue re-extraction.", "재추출 대기열 추가에 실패했습니다."));
      }
    } catch (caught) {
      setFeedback(getErrorMessage(caught, t("Failed to queue re-extraction.", "재추출 대기열 추가에 실패했습니다.")));
    } finally {
      setRequeuePending(false);
    }
  }

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "18px 20px 26px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 20, marginBottom: 4 }}>{t("Settings", "설정")}</h2>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
            {t(
              "Desktop-only actions like file selection and workspace backups appear here when the app is running inside the real desktop container.",
              "앱이 실제 데스크톱 컨테이너에서 실행될 때 파일 선택이나 워크스페이스 백업 같은 데스크톱 전용 기능이 여기 표시됩니다.",
            )}
          </p>
        </div>
        {session ? (
          <button
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 14px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border-subtle)",
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-secondary)",
              cursor: signOut.isPending ? "progress" : "pointer",
              flexShrink: 0,
            }}
          >
            <LogOut size={14} />
            {t("Sign out", "로그아웃")}
          </button>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 12 }}>
        {session ? (
          <div style={panelCardStyle}>
            <div style={panelHeaderStyle}>
              <ShieldCheck size={14} />
              {t("Account", "계정")}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{session.user.name}</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              {session.user.email}
              <br />
              {session.user.workspaceName} / {session.user.planLabel}
            </div>
          </div>
        ) : null}

        <div style={panelCardStyle}>
          <div style={panelHeaderStyle}>
            <LaptopMinimal size={14} />
            {t("Desktop Runtime", "데스크톱 런타임")}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{runtimeLabel}</div>
          <div style={{ display: "grid", gap: 8, fontSize: 12.5, color: "var(--color-text-secondary)" }}>
            <InfoRow label={t("Runtime", "런타임")} value={desktopReady ? t("Electron", "Electron") : t("Browser preview", "브라우저 미리보기")} />
            <InfoRow label={t("Platform", "플랫폼")} value={desktop?.platform ?? t("Checking...", "확인 중...")} />
            <InfoRow label={t("Version", "버전")} value={desktop?.version ?? t("Unavailable", "사용 불가")} />
            <InfoRow label={t("Library path", "라이브러리 경로")} value={desktop?.libraryPath ?? t("Available when running in Electron", "Electron에서 실행될 때 표시됩니다")} />
          </div>
        </div>

        <div style={panelCardStyle}>
          <div style={panelHeaderStyle}>
            <Globe2 size={14} />
            {t("Display Language", "표시 언어")}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
            {t(
              "Switch the shell between English and Korean. Some deeper product surfaces may still stay in English for now.",
              "셸의 표시 언어를 영어와 한국어 사이에서 바꿉니다. 일부 깊은 화면은 아직 영어로 남아 있을 수 있습니다.",
            )}
          </div>
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {t("Language", "언어")}
            </span>
            <select
              value={locale}
              onChange={(event) => {
                const nextLocale = event.target.value === "ko" ? "ko" : "en";
                setLocale(nextLocale);
                setFeedback(localeText(nextLocale, "Display language changed to English.", "표시 언어를 한국어로 변경했습니다."));
              }}
              style={{
                height: 38,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border-subtle)",
                background: "var(--color-bg-surface)",
                padding: "0 12px",
                fontSize: 13,
                color: "var(--color-text-primary)",
                outline: "none",
              }}
            >
              {localeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* LLM Model Selection Card */}
        <div style={panelCardStyle}>
          <div style={panelHeaderStyle}>
            <BrainCircuit size={14} />
            {t("LLM Model", "LLM 모델")}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
            {t(
              "Select the Ollama model used for chat, table generation, and Q&A. Guardian and OCR models are excluded from this list.",
              "채팅, 테이블 생성, Q&A에 사용할 Ollama 모델을 선택하세요. Guardian 및 OCR 모델은 목록에서 제외됩니다.",
            )}
          </div>
          {modelsError ? (
            <div style={{ fontSize: 12.5, color: "var(--color-error, #ef4444)", marginBottom: 8 }}>
              {t("Failed to connect to Ollama. Make sure it is running.", "Ollama 연결에 실패했습니다. 실행 중인지 확인하세요.")}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <select
              value={activeModel?.model ?? ""}
              onChange={(event) => {
                const val = event.target.value;
                if (val) {
                  setLlmModel.mutate(val);
                  setFeedback(t(`LLM model changed to ${val}`, `LLM 모델을 ${val}(으)로 변경했습니다.`));
                }
              }}
              disabled={modelsLoading || llmModels.length === 0}
              style={{
                flex: 1,
                height: 38,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border-subtle)",
                background: "var(--color-bg-surface)",
                padding: "0 12px",
                fontSize: 13,
                color: "var(--color-text-primary)",
                outline: "none",
              }}
            >
              {modelsLoading ? (
                <option value="">{t("Loading models...", "모델 로딩 중...")}</option>
              ) : llmModels.length === 0 ? (
                <option value="">{t("No models available", "사용 가능한 모델 없음")}</option>
              ) : (
                llmModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}{" "}
                    ({(m.size / 1e9).toFixed(1)} GB)
                  </option>
                ))
              )}
            </select>
            <button
              onClick={() => refetchModels()}
              disabled={modelsLoading}
              title={t("Refresh model list", "모델 목록 새로고침")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 38,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border-subtle)",
                background: "var(--color-bg-elevated)",
                color: "var(--color-text-secondary)",
                cursor: modelsLoading ? "progress" : "pointer",
                flexShrink: 0,
              }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {activeModel ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-muted)" }}>
              <span style={{ fontWeight: 600 }}>
                {t("Source:", "소스:")}
              </span>
              <span>
                {activeModel.source === "user"
                  ? t("User selection", "사용자 선택")
                  : activeModel.source === "env"
                    ? t("Environment variable", "환경변수")
                    : t("Default", "기본값")}
              </span>
            </div>
          ) : null}
        </div>

        {/* Entity Extraction (Knowledge Graph) Card */}
        <div style={panelCardStyle}>
          <div style={panelHeaderStyle}>
            <Network size={14} />
            {t("Entity Extraction", "엔티티 추출")}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginBottom: 12 }}>
            {t(
              "Select the Ollama model used to extract entities (substance/method/condition/metric/phenomenon/concept) and relations from papers for the knowledge graph.",
              "논문에서 엔티티(물질/방법/조건/지표/현상/개념)와 관계를 추출해 지식 그래프를 만드는 데 사용할 Ollama 모델을 선택합니다.",
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <select
              value={activeEntityModel?.model ?? ""}
              onChange={(event) => {
                const val = event.target.value;
                if (val) {
                  setEntityModel.mutate(val);
                  setFeedback(t(`Entity extraction model changed to ${val}`, `엔티티 추출 모델을 ${val}(으)로 변경했습니다.`));
                }
              }}
              disabled={modelsLoading || llmModels.length === 0}
              style={{
                flex: 1,
                height: 38,
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border-subtle)",
                background: "var(--color-bg-surface)",
                padding: "0 12px",
                fontSize: 13,
                color: "var(--color-text-primary)",
                outline: "none",
              }}
            >
              {modelsLoading ? (
                <option value="">{t("Loading models...", "모델 로딩 중...")}</option>
              ) : llmModels.length === 0 ? (
                <option value="">{t("No models available", "사용 가능한 모델 없음")}</option>
              ) : (
                llmModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}{" "}
                    ({(m.size / 1e9).toFixed(1)} GB)
                  </option>
                ))
              )}
            </select>
          </div>
          {activeEntityModel ? (
            <div style={{ display: "grid", gap: 2, fontSize: 12, color: "var(--color-text-muted)", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{t("Source:", "소스:")}</span>
                <span>
                  {activeEntityModel.source === "user"
                    ? t("User selection", "사용자 선택")
                    : t("Inherits chat model", "채팅 모델 사용")}
                </span>
              </div>
              {activeEntityModel.source === "fallback_chat_model" && activeEntityModel.effectiveModel ? (
                <div>
                  <span style={{ fontWeight: 600 }}>{t("Effective model:", "사용 모델:")}</span>{" "}
                  <span>{activeEntityModel.effectiveModel}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {entityBackfillStatus ? (
            <div style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--color-text-muted)", marginBottom: 10 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{t("Progress: ", "진행: ")}</span>
                <span>
                  {entityBackfillStatus.processedPapers} / {entityBackfillStatus.totalPapers}
                  {" "}({t("version", "버전")} {entityBackfillStatus.currentVersion})
                </span>
              </div>
              <div>
                <span style={{ fontWeight: 600 }}>{t("Queue: ", "대기열: ")}</span>
                <span>
                  {t(`${entityBackfillStatus.pending} pending, ${entityBackfillStatus.running} running`, `대기 ${entityBackfillStatus.pending}개, 실행 중 ${entityBackfillStatus.running}개`)}
                </span>
              </div>
            </div>
          ) : null}

          <button
            onClick={handleEntityBackfill}
            disabled={!desktopReady || entityBackfill.isPending}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              height: 38,
              padding: "0 14px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border-subtle)",
              background: !desktopReady || entityBackfill.isPending ? "var(--color-bg-panel)" : "var(--color-bg-elevated)",
              color: !desktopReady || entityBackfill.isPending ? "var(--color-text-muted)" : "var(--color-text-secondary)",
              cursor: !desktopReady || entityBackfill.isPending ? "not-allowed" : "pointer",
            }}
          >
            <RefreshCw size={13} />
            {entityBackfill.isPending
              ? t("Queueing...", "대기열 추가 중...")
              : t("Extract Entities for All Papers", "전체 논문 엔티티 추출 시작")}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(280px, 0.85fr)", gap: 12, alignItems: "start" }}>
        <div style={panelCardStyle}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={panelHeaderStyle}>
                <HardDriveDownload size={14} />
                {t("Desktop Actions", "데스크톱 작업")}
              </div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7, marginTop: 6 }}>
                {t(
                  "These actions are powered by the Electron preload bridge. They stay disabled in browser preview so the frontend still behaves safely outside the desktop shell.",
                  "이 기능들은 Electron preload bridge를 통해 동작합니다. 브라우저 미리보기에서는 비활성화되어 데스크톱 셸 밖에서도 안전하게 동작합니다.",
                )}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <ActionButton
              label={selectPdfFiles.isPending ? t("Opening PDF dialog...", "PDF 대화상자를 여는 중...") : t("Select PDFs", "PDF 선택")}
              onClick={handleSelectPdfFiles}
              disabled={!desktopReady || selectPdfFiles.isPending}
            />
            <ActionButton
              label={createBackup.isPending ? t("Creating backup...", "백업 생성 중...") : t("Create Backup", "백업 만들기")}
              onClick={handleCreateBackup}
              disabled={!desktopReady || createBackup.isPending}
            />
            <ActionButton
              label={t("Reveal Library", "라이브러리 열기")}
              onClick={() => handleReveal(desktop?.libraryPath ?? null, t("No library path available yet.", "아직 라이브러리 경로가 없습니다."))}
              disabled={!desktopReady || !desktop?.libraryPath || revealInExplorer.isPending}
            />
            <ActionButton
              label={t("Reveal Latest Backup", "최근 백업 열기")}
              onClick={() => handleReveal(latestBackupPath, t("Create a backup first to reveal it in Explorer.", "탐색기에서 열려면 먼저 백업을 만드세요."))}
              disabled={!desktopReady || !latestBackupPath || revealInExplorer.isPending}
            />
            <ActionButton
              icon={<RefreshCw size={13} />}
              label={requeuePending ? t("Queueing...", "대기열 추가 중...") : t("Re-extract All Papers", "전체 논문 재추출")}
              onClick={handleRequeueAll}
              disabled={!desktopReady || requeuePending}
            />
          </div>

          {feedback ? <div style={feedbackStyle}>{feedback}</div> : null}

          {selectedFiles.length > 0 ? (
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {t("Selected PDFs", "선택한 PDF")}
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {selectedFiles.slice(0, 5).map((filePath) => (
                  <div key={filePath} style={listItemStyle}>
                    <FolderOpen size={14} color="var(--color-accent)" />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filePath}</span>
                  </div>
                ))}
                {selectedFiles.length > 5 ? (
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    {t(`+ ${selectedFiles.length - 5} more files selected`, `+ ${selectedFiles.length - 5}개 파일이 더 선택됨`)}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <InfoCard title={t("Desktop Bridge", "데스크톱 브리지")} description={t("The frontend now reads runtime details directly from window.redouDesktop instead of assuming a browser-only environment.", "이제 프론트엔드는 브라우저 전용 환경으로 가정하지 않고 window.redouDesktop에서 런타임 정보를 직접 읽습니다.")} />
          <InfoCard title={t("Data Layer", "데이터 레이어")} description={t("Papers, folders, and notes are already using Supabase-backed adapters, so the desktop shell can now focus on file and window concerns.", "논문, 폴더, 노트는 이미 Supabase 기반 adapter를 사용하고 있어서, 데스크톱 셸은 파일과 창 처리에 집중할 수 있습니다.")} />
          <InfoCard title={t("Next Step", "다음 단계")} description={t("The biggest remaining gap is routing import, reader, and detachable-panel flows through this same bridge without falling back to the legacy renderer.", "가장 큰 남은 과제는 import, reader, detachable panel 흐름을 legacy renderer로 돌아가지 않고 이 브리지를 통해 연결하는 것입니다.")} />
          {latestBackupPath ? (
            <div style={successCardStyle}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "var(--color-success)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <CheckCircle2 size={14} />
                {t("Latest backup", "최근 백업")}
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--color-text-secondary)", marginTop: 8, wordBreak: "break-all" }}>
                {latestBackupPath}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled }: { icon?: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: 38,
        padding: "0 14px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-border-subtle)",
        background: disabled ? "var(--color-bg-panel)" : "var(--color-bg-elevated)",
        color: disabled ? "var(--color-text-muted)" : "var(--color-text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {icon ?? null}
      {label}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={{ color: "var(--color-text-primary)", wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

function InfoCard({ title, description }: { title: string; description: string }) {
  return (
    <div style={panelCardStyle}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.7 }}>{description}</div>
    </div>
  );
}

const panelCardStyle = {
  padding: 18,
  borderRadius: "var(--radius-lg)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border-subtle)",
  boxShadow: "var(--shadow-sm)",
};

const successCardStyle = {
  ...panelCardStyle,
  background: "linear-gradient(180deg, rgba(236, 253, 245, 0.9) 0%, rgba(255,255,255,0.92) 100%)",
};

const panelHeaderStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "var(--color-accent)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  marginBottom: 10,
};

const feedbackStyle = {
  padding: "12px 14px",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-subtle)",
  fontSize: 12.5,
  color: "var(--color-text-secondary)",
  lineHeight: 1.7,
  wordBreak: "break-word" as const,
};

const listItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
  borderRadius: "var(--radius-md)",
  background: "var(--color-bg-surface)",
  border: "1px solid var(--color-border-subtle)",
  fontSize: 12.5,
  color: "var(--color-text-secondary)",
};
