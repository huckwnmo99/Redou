import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "radix-ui";
import { supabase } from "@/lib/supabase";
import { localeText } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";
import type { ProcessingJobStatus } from "@/types/paper";

interface ProcessingJob {
  id: string;
  paper_id: string;
  job_type: string;
  status: ProcessingJobStatus;
  source_path: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  paper_title?: string;
}

const statusConfig: Record<ProcessingJobStatus, { label: string; labelKo: string; color: string; bg: string; icon: typeof Clock }> = {
  queued: { label: "Queued", labelKo: "대기 중", color: "#2563eb", bg: "rgba(37,99,235,0.10)", icon: Clock },
  running: { label: "Processing", labelKo: "처리 중", color: "#d97706", bg: "rgba(217,119,6,0.10)", icon: Loader2 },
  succeeded: { label: "Completed", labelKo: "완료", color: "#0f766e", bg: "rgba(15,118,110,0.10)", icon: CheckCircle2 },
  failed: { label: "Failed", labelKo: "실패", color: "#dc2626", bg: "rgba(220,38,38,0.10)", icon: AlertCircle },
};

function useProcessingJobs() {
  return useQuery({
    queryKey: ["processing-jobs-all"],
    queryFn: async (): Promise<ProcessingJob[]> => {
      const { data: jobs, error } = await supabase
        .from("processing_jobs")
        .select("id, paper_id, job_type, status, source_path, created_at, started_at, finished_at, error_message")
        .order("created_at", { ascending: false });

      if (error || !jobs) return [];

      // Fetch paper titles
      const paperIds = [...new Set(jobs.map((j: ProcessingJob) => j.paper_id).filter(Boolean))];
      const { data: papers } = await supabase
        .from("papers")
        .select("id, title")
        .in("id", paperIds);

      const titleMap = new Map((papers ?? []).map((p: { id: string; title: string }) => [p.id, p.title]));

      // Deduplicate: keep only the most recent job per paper (already sorted by created_at desc)
      const seen = new Set<string>();
      const deduped: ProcessingJob[] = [];
      for (const j of jobs as ProcessingJob[]) {
        if (seen.has(j.paper_id)) continue;
        seen.add(j.paper_id);
        deduped.push({ ...j, paper_title: titleMap.get(j.paper_id) ?? "Unknown" });
      }
      return deduped;
    },
    refetchInterval: 3000,
  });
}

function formatTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ProcessingView() {
  const locale = useUIStore((s) => s.locale);
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const { data: jobs = [], isLoading } = useProcessingJobs();

  const running = jobs.filter((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued");
  const completed = jobs.filter((j) => j.status === "succeeded");
  const failed = jobs.filter((j) => j.status === "failed");

  const sections = [
    { key: "running", title: t("Processing", "처리 중"), jobs: running },
    { key: "queued", title: t("Queued", "대기열"), jobs: queued },
    { key: "failed", title: t("Failed", "실패"), jobs: failed },
    { key: "completed", title: t("Completed", "완료"), jobs: completed },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border-subtle)", flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
          {t("Processing Pipeline", "처리 파이프라인")}
        </h2>
        <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
          {t(
            `${running.length} processing · ${queued.length} queued · ${completed.length} completed · ${failed.length} failed`,
            `${running.length}개 처리 중 · ${queued.length}개 대기 · ${completed.length}개 완료 · ${failed.length}개 실패`,
          )}
        </p>
      </div>

      <ScrollArea.Root style={{ flex: 1, overflow: "hidden" }}>
        <ScrollArea.Viewport style={{ height: "100%", width: "100%" }}>
          {isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
              {t("Loading...", "불러오는 중...")}
            </div>
          ) : (
            <div style={{ padding: "12px 20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>
              {sections.map(({ key, title, jobs: sectionJobs }) => {
                if (sectionJobs.length === 0) return null;
                return (
                  <div key={key}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.07em",
                      textTransform: "uppercase",
                      color: "var(--color-text-muted)",
                      marginBottom: 8,
                      padding: "0 2px",
                    }}>
                      {title} ({sectionJobs.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {sectionJobs.map((job, idx) => (
                        <JobCard key={job.id} job={job} order={key === "queued" ? idx + 1 : undefined} locale={locale} />
                      ))}
                    </div>
                  </div>
                );
              })}

              {jobs.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--color-text-muted)", fontSize: 13 }}>
                  {t("No processing jobs found.", "처리 작업이 없습니다.")}
                </div>
              ) : null}
            </div>
          )}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical">
          <ScrollArea.Thumb />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </div>
  );
}

function JobCard({ job, order, locale }: { job: ProcessingJob; order?: number; locale: import("@/lib/locale").AppLocale }) {
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  const cfg = statusConfig[job.status];
  const Icon = cfg.icon;

  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: "var(--radius-md)",
      background: "var(--color-bg-elevated)",
      border: `1px solid ${job.status === "running" ? cfg.color : "var(--color-border-subtle)"}`,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {order != null ? (
          <span style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: cfg.bg,
            color: cfg.color,
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            {order}
          </span>
        ) : null}
        <Icon
          size={14}
          style={{
            color: cfg.color,
            flexShrink: 0,
            ...(job.status === "running" ? { animation: "spin 1.5s linear infinite" } : {}),
          }}
        />
        <span style={{
          padding: "2px 8px",
          borderRadius: "var(--radius-xs)",
          background: cfg.bg,
          color: cfg.color,
          fontSize: 10.5,
          fontWeight: 600,
        }}>
          {locale === "ko" ? cfg.labelKo : cfg.label}
        </span>
        <span style={{
          fontSize: 10.5,
          color: "var(--color-text-muted)",
          padding: "2px 6px",
          background: "var(--color-bg-surface)",
          borderRadius: "var(--radius-xs)",
        }}>
          {job.job_type === "import_pdf" ? t("Import & Extract", "임포트 & 추출") : t("Embeddings", "임베딩")}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {formatDate(job.created_at)} {formatTime(job.created_at)}
        </span>
      </div>

      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: "var(--color-text-primary)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {job.paper_title}
      </div>

      {job.status === "running" && job.started_at ? (
        <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)" }}>
          {t("Started at", "시작 시간")}: {formatTime(job.started_at)}
        </div>
      ) : null}

      {job.status === "succeeded" && job.finished_at ? (
        <div style={{ fontSize: 11.5, color: "var(--color-text-secondary)" }}>
          {t("Finished at", "완료 시간")}: {formatTime(job.finished_at)}
        </div>
      ) : null}

      {job.status === "failed" && job.error_message ? (
        <div style={{
          fontSize: 11.5,
          color: cfg.color,
          background: cfg.bg,
          padding: "6px 10px",
          borderRadius: "var(--radius-sm)",
          lineHeight: 1.5,
        }}>
          {job.error_message}
        </div>
      ) : null}
    </div>
  );
}
