import { useEffect } from "react";
import { AppShell } from "@/app/AppShell";
import { AuthView } from "@/features/auth/AuthView";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuthSession } from "@/lib/auth";
import { localeText, syncDocumentLocale } from "@/lib/locale";
import { useUIStore } from "@/stores/uiStore";

export function App() {
  const locale = useUIStore((state) => state.locale);
  const { data: session, isLoading } = useAuthSession();

  useEffect(() => {
    syncDocumentLocale(locale);
  }, [locale]);

  // Mouse back button → navigate back within the SPA
  useEffect(() => {
    const handleMouseBack = (e: MouseEvent) => {
      // button 3 = mouse back, button 4 = mouse forward
      if (e.button !== 3) return;
      e.preventDefault();
      e.stopPropagation();

      const state = useUIStore.getState();

      if (state.paperDetailOpen) {
        // Paper detail open → close it, go back to library
        state.closePaperDetail();
        state.setSelectedPaperId(null);
      } else if (state.activeNav !== "library") {
        // On notes/figures/settings tab → go back to library
        state.setActiveNav("library");
      }
    };

    // mouseup catches auxiliary button clicks
    window.addEventListener("mouseup", handleMouseBack);
    return () => window.removeEventListener("mouseup", handleMouseBack);
  }, []);

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)",
          color: "var(--color-text-secondary)",
          fontSize: 13,
        }}
      >
        {localeText(locale, "Loading workspace...", "워크스페이스를 불러오는 중...")}
      </div>
    );
  }

  return (
    <>
      {session ? <AppShell /> : <AuthView />}
      <ConfirmDialog />
    </>
  );
}
