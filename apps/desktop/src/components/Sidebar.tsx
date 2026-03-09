import type { CategorySelection, TopCategory, ViewKey } from "../types";

interface SidebarProps {
  categories: TopCategory[];
  currentView: ViewKey;
  selectedCategory: CategorySelection;
  onChangeView: (view: ViewKey) => void;
  onSelectCategory: (selection: CategorySelection) => void;
  onAddTopCategory: () => void;
  onAddSubCategory: () => void;
}

const viewItems: Array<{ key: ViewKey; label: string }> = [
  { key: "library", label: "Library" },
  { key: "categories", label: "Category View" },
  { key: "paper", label: "Paper Detail" },
  { key: "reader", label: "Reader + Notes" },
  { key: "search", label: "Search" },
  { key: "settings", label: "Settings" }
];

export function Sidebar({
  categories,
  currentView,
  selectedCategory,
  onChangeView,
  onSelectCategory,
  onAddTopCategory,
  onAddSubCategory
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div>
          <h1>Redou</h1>
          <div className="muted">desktop shell</div>
        </div>
        <div className="muted">‹</div>
      </div>

      <section className="side-section">
        <div className="side-title">
          <span>Workspace</span>
        </div>
        <div className="nav-list">
          {viewItems.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${currentView === item.key ? "active" : ""}`}
              onClick={() => onChangeView(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="side-section">
        <div className="side-title">
          <span>Categories</span>
          <span>{categories.length}</span>
        </div>
        <div className="side-actions">
          <button className="mini-button" onClick={onAddTopCategory} type="button">
            + Top
          </button>
          <button className="mini-button" onClick={onAddSubCategory} type="button">
            + Sub
          </button>
        </div>

        <div className="folder-tree">
          {categories.map((top) => {
            const activeTop = selectedCategory.topId === top.id;

            return (
              <div className="category-group" key={top.id}>
                <button
                  className={`folder-item ${activeTop ? "active-top" : ""}`}
                  onClick={() =>
                    onSelectCategory({
                      topId: top.id,
                      subId: top.subcategories[0]?.id ?? ""
                    })
                  }
                  type="button"
                >
                  {`Top Category: ${top.name}`}
                </button>

                <div className="folder-indent">
                  {top.subcategories.map((sub) => {
                    const isActive =
                      selectedCategory.topId === top.id &&
                      selectedCategory.subId === sub.id;

                    return (
                      <button
                        key={sub.id}
                        className={`folder-item ${isActive ? "active" : ""}`}
                        onClick={() =>
                          onSelectCategory({
                            topId: top.id,
                            subId: sub.id
                          })
                        }
                        type="button"
                      >
                        {`Sub Category: ${sub.name}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

