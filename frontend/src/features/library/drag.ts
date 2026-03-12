export const PAPER_DRAG_MIME = "application/x-redou-paper-id";

export function writePaperDragData(dataTransfer: DataTransfer, paperId: string) {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(PAPER_DRAG_MIME, paperId);
  dataTransfer.setData("text/plain", paperId);
}

export function readPaperDragData(dataTransfer: DataTransfer): string | null {
  const paperId = dataTransfer.getData(PAPER_DRAG_MIME) || dataTransfer.getData("text/plain");
  const normalized = paperId.trim();
  return normalized ? normalized : null;
}
