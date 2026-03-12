import {
  ArrowLeft,
  ArrowUpDown,
  LayoutGrid,
  List,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import type { CSSProperties } from "react";
import { DropdownMenu, Select } from "radix-ui";
import { IconButton } from "@/components/IconButton";
import { ImportPdfDialog } from "@/features/import/ImportPdfDialog";
import { localeText } from "@/lib/locale";
import { useFolders, usePaperById } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";
import type { SortKey } from "@/types/paper";

function getSortOptions(locale: "en" | "ko"): { value: SortKey; label: string }[] {
  return [
    { value: "addedAt", label: localeText(locale, "Date Added", "추가일") },
    { value: "year", label: localeText(locale, "Year", "연도") },
    { value: "title", label: localeText(locale, "Title", "제목") },
    { value: "citations", label: localeText(locale, "Citations", "인용 수") },
  ];
}

function getBreadcrumb({
  activeNav,
  activeFolderId,
  folderName,
  locale,
  paperDetailOpen,
  paperTitle,
}: {
  activeNav: string;
  activeFolderId: string | null;
  folderName?: string;
  locale: "en" | "ko";
  paperDetailOpen: boolean;
  paperTitle?: string;
}) {
  if (activeNav === "library") {
    if (paperDetailOpen && paperTitle) {
      return paperTitle;
    }

    if (!activeFolderId) return localeText(locale, "All Papers", "전체 논문");
    if (activeFolderId === "starred") return localeText(locale, "Starred", "중요 표시");
    if (activeFolderId === "recent") return localeText(locale, "Recent", "최근 항목");
    return folderName ?? localeText(locale, "Library", "라이브러리");
  }

  if (activeNav === "search") return localeText(locale, "Search", "검색");
  if (activeNav === "figures") return localeText(locale, "Figures", "Figure");
  if (activeNav === "settings") return localeText(locale, "Settings", "설정");
  return activeNav.charAt(0).toUpperCase() + activeNav.slice(1);
}

export function TopBar() {
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const {
    activeNav,
    activeFolderId,
    locale,
    selectedPaperId,
    paperDetailOpen,
    searchQuery,
    searchResultKind,
    sortKey,
    viewMode,
    inspectorOpen,
    closePaperDetail,
    openPaperDetail,
    setSearchQuery,
    setSelectedPaperId,
    setSortKey,
    setViewMode,
    toggleInspector,
  } = useUIStore();
  const { data: folders = [] } = useFolders();
  const { data: selectedPaper } = usePaperById(selectedPaperId);
  const t = (english: string, korean: string) => localeText(locale, english, korean);
  const sortOptions = getSortOptions(locale);

  const folderName = folders.find((folder) => folder.id === activeFolderId)?.name;
  const importFolderId = activeFolderId && activeFolderId !== "starred" && activeFolderId !== "recent" ? activeFolderId : null;
  const breadcrumb = getBreadcrumb({
    activeNav,
    activeFolderId,
    folderName,
    locale,
    paperDetailOpen,
    paperTitle: selectedPaper?.title,
  });

  const showLibraryControls = activeNav === "library" && !paperDetailOpen;
  const showPaperDetailControls = activeNav === "library" && paperDetailOpen;
  const showSearchControls = activeNav === "search";

  return (
    <>
      <header
        style={{
          height: "var(--topbar-height)",
          background: "var(--color-bg-surface)",
          borderBottom: "1px solid var(--color-border-subtle)",
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 120, maxWidth: 300, flexShrink: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={breadcrumb}
          >
            {breadcrumb}
          </span>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-md)",
            padding: "0 10px",
            gap: 8,
            maxWidth: 460,
            height: 32,
          }}
        >
          <Search size={14} style={{ color: "var(--color-text-muted)", flexShrink: 0 }} />
          <input
            aria-label={t("Search papers", "논문 검색")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("Search papers, authors, tags", "논문, 저자, 태그 검색")}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--color-text-primary)",
              fontSize: 13,
            }}
          />
          {searchQuery ? (
            <button
              aria-label={t("Clear search", "검색 지우기")}
              onClick={() => setSearchQuery("")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--color-text-muted)",
                fontSize: 11,
                fontWeight: 600,
                padding: "0 2px",
              }}
            >
              {t("Clear", "지우기")}
            </button>
          ) : null}
        </div>

        <div style={{ flex: 1 }} />

        {showLibraryControls ? (
          <>
            <Select.Root value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
              <Select.Trigger
                aria-label={t("Sort papers", "논문 정렬")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  height: 30,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-border-subtle)",
                  background: "var(--color-bg-elevated)",
                  color: "var(--color-text-secondary)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <ArrowUpDown size={12} />
                <Select.Value />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  position="popper"
                  sideOffset={4}
                  style={{
                    background: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "var(--shadow-md)",
                    padding: 4,
                    zIndex: 9999,
                    minWidth: 140,
                  }}
                >
                  <Select.Viewport>
                    {sortOptions.map((option) => (
                      <Select.Item
                        key={option.value}
                        value={option.value}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "var(--radius-xs)",
                          fontSize: 12.5,
                          cursor: "pointer",
                          color: "var(--color-text-secondary)",
                          outline: "none",
                        }}
                      >
                        <Select.ItemText>{option.label}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>

            <IconButton aria-label={t("Filters will be added later", "필터는 나중에 추가됩니다")} size="sm" disabled>
              <SlidersHorizontal size={14} />
            </IconButton>

            <div
              style={{
                display: "flex",
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: 2,
                gap: 2,
              }}
            >
              <IconButton aria-label={t("Use grid view", "그리드 보기") } size="sm" active={viewMode === "grid"} onClick={() => setViewMode("grid")} style={{ width: 24, height: 24 }}>
                <LayoutGrid size={13} />
              </IconButton>
              <IconButton aria-label={t("Use list view", "리스트 보기") } size="sm" active={viewMode === "list"} onClick={() => setViewMode("list")} style={{ width: 24, height: 24 }}>
                <List size={13} />
              </IconButton>
            </div>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  aria-label={t("Add paper", "논문 추가")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "0 12px",
                    height: 30,
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    background: "var(--color-accent)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <Plus size={13} />
                  {t("Add Paper", "논문 추가")}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  sideOffset={5}
                  align="end"
                  style={{
                    background: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    boxShadow: "var(--shadow-md)",
                    padding: 4,
                    zIndex: 9999,
                    minWidth: 180,
                  }}
                >
                  <DropdownMenu.Item
                    onSelect={(event) => {
                      event.preventDefault();
                      setImportDialogOpen(true);
                    }}
                    style={menuItemStyle}
                  >
                    {t("Import PDF", "PDF 가져오기")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item disabled style={{ ...menuItemStyle, opacity: 0.45, cursor: "not-allowed" }}>
                    {t("Add by DOI / URL", "DOI / URL로 추가")}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item disabled style={{ ...menuItemStyle, opacity: 0.45, cursor: "not-allowed" }}>
                    {t("Manual Entry", "직접 입력")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        ) : null}

        {showPaperDetailControls ? (
          <button
            aria-label={t("Back to library", "라이브러리로 돌아가기")}
            onClick={closePaperDetail}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border-subtle)",
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            <ArrowLeft size={13} />
            {t("Back to Library", "라이브러리로")}
          </button>
        ) : null}

        {showSearchControls ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 12px",
              borderRadius: "999px",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-subtle)",
              color: "var(--color-text-secondary)",
              fontSize: 12,
              fontWeight: 600,
              textTransform: "capitalize",
            }}
          >
            {searchResultKind === "all" ? t("All results", "전체 결과") : searchResultKind}
          </div>
        ) : null}

        <IconButton aria-label={inspectorOpen ? t("Close inspector", "인스펙터 닫기") : t("Open inspector", "인스펙터 열기")} size="sm" active={inspectorOpen} onClick={toggleInspector}>
          {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </IconButton>
      </header>

      <ImportPdfDialog
        open={importDialogOpen}
        defaultFolderId={importFolderId}
        defaultFolderName={folderName}
        onClose={() => setImportDialogOpen(false)}
        onOpenImportedPaper={(paperId) => {
          setSelectedPaperId(paperId);
          openPaperDetail("overview");
          setImportDialogOpen(false);
        }}
      />
    </>
  );
}

const menuItemStyle: CSSProperties = {
  padding: "7px 12px",
  borderRadius: "var(--radius-xs)",
  fontSize: 12.5,
  cursor: "pointer",
  color: "var(--color-text-secondary)",
  outline: "none",
};
