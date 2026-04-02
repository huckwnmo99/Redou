import { useCallback, useEffect, useState } from "react";
import { LeftSidebar } from "./LeftSidebar";
import { TopBar } from "./TopBar";
import { RightInspector } from "./RightInspector";
import { useDesktopJobBridge } from "@/lib/desktop";
import { LibraryView } from "@/features/library/LibraryView";
import { PaperDetailView } from "@/features/paper/PaperDetailView";
import { SearchView } from "@/features/search/SearchView";
import { FiguresView } from "@/features/figures/FiguresView";
import { SettingsView } from "@/features/settings/SettingsView";
import { ProcessingView } from "@/features/processing/ProcessingView";
import { ChatView } from "@/features/chat/ChatView";
import { NotesView } from "@/features/notes/NotesView";
import { useUIStore } from "@/stores/uiStore";

function MainContent() {
  const { activeNav, paperDetailOpen, selectedPaperId } = useUIStore();

  switch (activeNav) {
    case "library":
      return paperDetailOpen && selectedPaperId ? <PaperDetailView /> : <LibraryView />;
    case "search":
      return <SearchView />;
    case "figures":
      return <FiguresView />;
    case "chat":
      return <ChatView />;
    case "notes":
      return <NotesView />;
    case "processing":
      return <ProcessingView />;
    case "settings":
      return <SettingsView />;
    default:
      return null;
  }
}

export function AppShell() {
  const { inspectorOpen, setPendingDropPaths, setActiveNav } = useUIStore();
  const latestJob = useDesktopJobBridge();
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    // Only count as leave when cursor exits the window
    if (e.relatedTarget) return;
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const api = window.redouDesktop;
    const pdfPaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f.name.toLowerCase().endsWith(".pdf")) continue;
      const p = api?.getFilePathForDrop(f) ?? "";
      if (p) pdfPaths.push(p);
    }
    if (pdfPaths.length > 0) {
      setPendingDropPaths(pdfPaths);
    }
  }, [setPendingDropPaths]);

  useEffect(() => {
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [handleDragOver, handleDragLeave, handleDrop]);

  const jobTone = latestJob?.kind === "failed"
    ? {
        border: "rgba(220, 38, 38, 0.22)",
        background: "rgba(254, 242, 242, 0.96)",
        accent: "#dc2626",
      }
    : latestJob?.kind === "completed"
      ? {
          border: "rgba(15, 118, 110, 0.22)",
          background: "rgba(240, 253, 250, 0.96)",
          accent: "#0f766e",
        }
      : {
          border: "rgba(37, 99, 235, 0.22)",
          background: "rgba(239, 246, 255, 0.96)",
          accent: "#2563eb",
        };

  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        background: "rgba(255,255,255,0.2)",
        overflow: "hidden",
        padding: 10,
        gap: 10,
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-xl)",
          background: "rgba(248,250,252,0.82)",
          boxShadow: "var(--shadow-md)",
          backdropFilter: "blur(16px)",
        }}
      >
        <LeftSidebar />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <TopBar />
          <div
            style={{
              flex: 1,
              position: "relative",
              overflow: "hidden",
              background: "var(--color-bg-surface)",
            }}
          >
            <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
              <MainContent />
            </div>

            {inspectorOpen ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: "var(--inspector-height)",
                  zIndex: 20,
                  boxShadow: "0 -4px 24px rgba(15, 23, 42, 0.10)",
                }}
              >
                <RightInspector />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {dragOver ? (
        <div
          style={{
            position: "absolute",
            inset: 10,
            borderRadius: "var(--radius-xl)",
            border: "3px dashed var(--color-accent)",
            background: "rgba(37, 99, 235, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "20px 32px",
              borderRadius: 16,
              background: "rgba(255, 255, 255, 0.95)",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
              fontSize: 15,
              fontWeight: 700,
              color: "var(--color-accent)",
              letterSpacing: "-0.02em",
            }}
          >
            Drop PDF files to import
          </div>
        </div>
      ) : null}

      {latestJob ? (
        <div
          onClick={() => setActiveNav("processing")}
          style={{
            position: "absolute",
            right: 26,
            bottom: 24,
            width: 320,
            padding: "13px 14px",
            borderRadius: "var(--radius-lg)",
            border: `1px solid ${jobTone.border}`,
            background: jobTone.background,
            boxShadow: "var(--shadow-md)",
            zIndex: 40,
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: jobTone.accent }}>{latestJob.title}</div>
            {latestJob.progress !== undefined ? (
              <div style={{ fontSize: 11.5, fontWeight: 700, color: jobTone.accent }}>
                {Math.max(0, Math.min(100, Math.round(latestJob.progress)))}%
              </div>
            ) : null}
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.65, color: "var(--color-text-secondary)" }}>
            {latestJob.description}
          </div>
        </div>
      ) : null}
    </div>
  );
}
