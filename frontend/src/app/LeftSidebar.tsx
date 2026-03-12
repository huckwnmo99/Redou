import { Images, Library, Search, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Separator } from "radix-ui";
import { CategoryTree } from "@/features/library/CategoryTree";
import { SearchSidebar } from "@/features/search/SearchSidebar";
import { localeText } from "@/lib/locale";
import { useAllPapers } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { NavItem } from "@/types/paper";

function SidebarButton({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active?: boolean;
  icon: typeof Library;
  label: string;
  count?: number;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        width: "100%",
        borderRadius: "var(--radius-sm)",
        border: "none",
        cursor: onClick ? "pointer" : "default",
        background: active ? "var(--color-accent-subtle)" : "transparent",
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        fontSize: "12.5px",
        textAlign: "left",
      }}
    >
      <Icon size={14} style={{ color: active ? "var(--color-accent)" : "var(--color-text-muted)" }} />
      <span style={{ flex: 1 }}>{label}</span>
      {typeof count === "number" ? (
        <span style={{ fontSize: 10.5, color: "var(--color-text-muted)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
      ) : null}
    </button>
  );
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          padding: "4px 10px",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-text-muted)",
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 2 }}>{children}</div>
    </div>
  );
}

function WorkspaceSidebar() {
  const { activeNav, locale } = useUIStore();
  const { data: papers = [] } = useAllPapers();
  const figurePapers = papers.filter((paper) => paper.figureCount > 0).length;
  const t = (english: string, korean: string) => localeText(locale, english, korean);

  if (activeNav === "library") {
    return <CategoryTree />;
  }

  if (activeNav === "search") {
    return <SearchSidebar />;
  }

  if (activeNav === "figures") {
    return (
      <SidebarSection title={t("Figure Views", "Figure 보기") }>
        <SidebarButton active icon={Images} label={t("All Figures", "전체 Figure")} count={figurePapers} />
      </SidebarSection>
    );
  }

  return (
    <SidebarSection title={t("Settings Sections", "설정 섹션") }>
      <SidebarButton active icon={Settings} label={t("Workspace", "워크스페이스")} />
    </SidebarSection>
  );
}

export function LeftSidebar() {
  const { activeNav, locale, setActiveNav } = useUIStore();
  const t = (english: string, korean: string) => localeText(locale, english, korean);
  const navItems: { id: NavItem; label: string; icon: typeof Library }[] = [
    { id: "library", label: t("Library", "라이브러리"), icon: Library },
    { id: "search", label: t("Search", "검색"), icon: Search },
    { id: "figures", label: t("Figures", "Figure"), icon: Images },
  ];

  return (
    <aside
      style={{
        width: "var(--sidebar-width)",
        minWidth: "var(--sidebar-width)",
        background: "var(--color-bg-panel)",
        borderRight: "1px solid var(--color-border-subtle)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "var(--topbar-height)",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          borderBottom: "1px solid var(--color-border-subtle)",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: "var(--radius-sm)",
            background: "var(--color-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Library size={14} color="#fff" />
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", letterSpacing: "-0.01em" }}>
          Redou
        </span>
      </div>

      <div style={{ padding: "8px 8px 0", flexShrink: 0 }}>
        {navItems.map(({ id, label, icon: Icon }) => {
          const isActive = activeNav === id;
          return (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 10px",
                width: "100%",
                borderRadius: "var(--radius-sm)",
                border: "none",
                cursor: "pointer",
                background: isActive ? "var(--color-accent-subtle)" : "transparent",
                color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                fontSize: "13px",
                fontWeight: isActive ? 500 : 400,
                transition: "background var(--transition-fast), color var(--transition-fast)",
                marginBottom: 1,
              }}
            >
              <Icon size={15} style={{ flexShrink: 0, color: isActive ? "var(--color-accent)" : "var(--color-text-muted)" }} />
              {label}
            </button>
          );
        })}
      </div>

      <Separator.Root
        decorative
        style={{
          height: 1,
          background: "var(--color-border-subtle)",
          margin: "8px 0",
          flexShrink: 0,
        }}
      />

      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px", minHeight: 0 }}>
        <WorkspaceSidebar />
      </div>

      <Separator.Root
        decorative
        style={{
          height: 1,
          background: "var(--color-border-subtle)",
          flexShrink: 0,
        }}
      />
      <div style={{ padding: "8px" }}>
        <button
          aria-label={t("Open settings", "설정 열기")}
          onClick={() => setActiveNav("settings")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 10px",
            width: "100%",
            borderRadius: "var(--radius-sm)",
            border: "none",
            cursor: "pointer",
            background: activeNav === "settings" ? "var(--color-accent-subtle)" : "transparent",
            color: activeNav === "settings" ? "var(--color-accent)" : "var(--color-text-secondary)",
            fontSize: "13px",
            fontWeight: activeNav === "settings" ? 500 : 400,
          }}
        >
          <Settings size={15} style={{ flexShrink: 0, color: activeNav === "settings" ? "var(--color-accent)" : "var(--color-text-muted)" }} />
          {t("Settings", "설정")}
        </button>
      </div>
    </aside>
  );
}
