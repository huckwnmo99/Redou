import { LeftSidebar } from "./LeftSidebar";
import { TopBar } from "./TopBar";
import { RightInspector } from "./RightInspector";
import { useDesktopJobBridge } from "@/lib/desktop";
import { LibraryView } from "@/features/library/LibraryView";
import { PaperDetailView } from "@/features/paper/PaperDetailView";
import { SearchView } from "@/features/search/SearchView";
import { FiguresView } from "@/features/figures/FiguresView";
import { SettingsView } from "@/features/settings/SettingsView";
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
    case "settings":
      return <SettingsView />;
    default:
      return null;
  }
}

export function AppShell() {
  const { inspectorOpen } = useUIStore();
  const latestJob = useDesktopJobBridge();

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
              display: "flex",
              overflow: "hidden",
              background: "var(--color-bg-surface)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <MainContent />
            </div>

            {inspectorOpen ? <RightInspector /> : null}
          </div>
        </div>
      </div>

      {latestJob ? (
        <div
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
            pointerEvents: "none",
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
