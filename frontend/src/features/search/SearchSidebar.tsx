import { CategoryTree } from "@/features/library/CategoryTree";
import { localeText } from "@/lib/locale";
import { useHighlightPresets } from "@/lib/queries";
import { useUIStore } from "@/stores/uiStore";

export function SearchSidebar() {
  const { locale, searchPresetFilter, setSearchPresetFilter } = useUIStore();
  const { data: presets = [] } = useHighlightPresets();
  const t = (en: string, ko: string) => localeText(locale, en, ko);

  return (
    <div style={{ display: "grid", gap: 14, paddingBottom: 12 }}>
      <div>
        <div style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
          {t("Folder Scope", "폴더 범위")}
        </div>
        <CategoryTree />
      </div>

      {presets.length > 0 && (
        <>
          <div style={{ height: 1, background: "var(--color-border-subtle)", margin: "0 4px" }} />
          <div>
            <div style={{ padding: "4px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-muted)" }}>
              {t("Preset Collections", "프리셋 컬렉션")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
              {presets.map((preset) => {
                const active = searchPresetFilter?.includes(preset.id) ?? false;
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      if (!searchPresetFilter) {
                        setSearchPresetFilter([preset.id]);
                      } else if (active) {
                        const next = searchPresetFilter.filter((id) => id !== preset.id);
                        setSearchPresetFilter(next.length > 0 ? next : null);
                      } else {
                        setSearchPresetFilter([...searchPresetFilter, preset.id]);
                      }
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "3px 10px", borderRadius: 999,
                      border: active ? `1.5px solid ${preset.colorHex}` : "1px solid var(--color-border-subtle)",
                      background: active ? `${preset.colorHex}18` : "transparent",
                      color: active ? preset.colorHex : "var(--color-text-secondary)",
                      fontSize: 11, fontWeight: active ? 600 : 400,
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: preset.colorHex, flexShrink: 0 }} />
                    {preset.name}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
