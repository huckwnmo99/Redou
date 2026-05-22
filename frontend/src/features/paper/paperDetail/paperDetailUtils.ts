import { localeText } from "@/lib/locale";
import type { Paper, PaperPageAnchor, ProcessingJobStatus } from "@/types/paper";

export function formatAuthors(paper: Paper) {
  return paper.authors.map((author) => author.name).join(", ");
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function buildInsightCards(paper: Paper) {
  const [first, second, third] = splitSentences(paper.abstract);

  return [
    {
      title: "목적",
      body: first ?? "이 논문의 목적과 현재 연구 흐름에서 중요한 이유를 정리합니다.",
    },
    {
      title: "주요 결과",
      body: second ?? first ?? "기억할 가치가 있는 가장 강력한 결과나 주장을 정리합니다.",
    },
    {
      title: "한계",
      body: third ?? "가정, 부족한 증거, 나중에 재확인할 사항을 기록합니다.",
    },
  ];
}

export function summarize(text: string, maxLength = 148) {
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}...` : text;
}

export function formatProcessingLabel(status?: ProcessingJobStatus, locale: "en" | "ko" = "en") {
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  if (!status) return t("No active pipeline job", "파이프라인 작업 없음");
  if (status === "queued") return t("Queued", "대기 중");
  if (status === "running") return t("Running", "처리 중");
  if (status === "succeeded") return t("Ready", "완료");
  return t("Failed", "실패");
}

export function processingCopy(status: ProcessingJobStatus | undefined, locale: "en" | "ko") {
  const t = (en: string, ko: string) => localeText(locale, en, ko);
  if (status === "queued") {
    return t("The PDF is stored and queued for processing.", "PDF가 저장되었고 처리 대기 중입니다.");
  }
  if (status === "running") {
    return t("Processing the PDF now.", "PDF를 처리하고 있습니다.");
  }
  if (status === "failed") {
    return t("Processing failed. Retry or inspect manually.", "처리에 실패했습니다. 재시도하거나 수동으로 확인하세요.");
  }
  if (status === "succeeded") {
    return t("Processing complete. The PDF reader is ready.", "처리 완료. PDF 리더를 사용할 수 있습니다.");
  }
  return t("Processing signals will appear once a job is created.", "처리 작업이 생성되면 상태가 표시됩니다.");
}

export function formatFileSize(fileSize?: number) {
  if (!fileSize || Number.isNaN(fileSize)) {
    return "Unknown size";
  }

  if (fileSize < 1024 * 1024) {
    return `${Math.max(1, Math.round(fileSize / 1024))} KB`;
  }

  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function readerActionMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function buildFallbackAnchor(paperId: string, pageNumber: number, pageLabel?: string): PaperPageAnchor {
  return {
    paperId,
    pageNumber,
    pageLabel: pageLabel ?? String(pageNumber),
    anchorId: `paper:${paperId}:page:${pageNumber}`,
  };
}
