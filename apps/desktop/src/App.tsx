import { useMemo, useState, type ReactElement } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { annotationPresets, initialCategories, initialPapers, initialSearchQuery } from "./data/mock-data";
import { CategoryView } from "./views/CategoryView";
import { LibraryView } from "./views/LibraryView";
import { PaperDetailView } from "./views/PaperDetailView";
import { ReaderView } from "./views/ReaderView";
import { SearchView } from "./views/SearchView";
import { SettingsView } from "./views/SettingsView";
import type { CategorySelection, PaperRecord, TopCategory, ViewKey } from "./types";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findTopCategory(categories: TopCategory[], topId: string) {
  return categories.find((category) => category.id === topId) ?? categories[0];
}

function findSubCategory(topCategory: TopCategory, subId: string) {
  return topCategory.subcategories.find((subcategory) => subcategory.id === subId) ?? topCategory.subcategories[0];
}

export default function App() {
  const [categories, setCategories] = useState(initialCategories);
  const [papers] = useState(initialPapers);
  const [currentView, setCurrentView] = useState<ViewKey>("library");
  const [selectedCategory, setSelectedCategory] = useState<CategorySelection>({
    topId: initialCategories[0].id,
    subId: initialCategories[0].subcategories[0].id
  });
  const [selectedPaperId, setSelectedPaperId] = useState(initialPapers[0].id);
  const [query, setQuery] = useState(initialSearchQuery);

  const selectedTopCategory = findTopCategory(categories, selectedCategory.topId);
  const selectedSubCategory = findSubCategory(selectedTopCategory, selectedCategory.subId);

  const categoryLabel = `${selectedTopCategory.name} / ${selectedSubCategory.name}`;

  const papersInSelectedCategory = useMemo(
    () =>
      papers.filter((paper) =>
        paper.categories.some(
          (categoryRef) =>
            categoryRef.topId === selectedCategory.topId &&
            categoryRef.subId === selectedCategory.subId
        )
      ),
    [papers, selectedCategory]
  );

  const selectedPaper =
    papers.find((paper) => paper.id === selectedPaperId) ??
    papersInSelectedCategory[0] ??
    papers[0];

  const searchFilteredPapers = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return papersInSelectedCategory;
    }

    return papers.filter((paper) => {
      const text = [
        paper.title,
        paper.summary,
        paper.objective,
        paper.result,
        paper.tags.join(" ")
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(normalized);
    });
  }, [papers, papersInSelectedCategory, query]);

  const openPaper = (paperId: string) => {
    setSelectedPaperId(paperId);
    setCurrentView("paper");
  };

  const openReader = (paperId: string) => {
    setSelectedPaperId(paperId);
    setCurrentView("reader");
  };

  const addTopCategory = () => {
    const name = window.prompt("New top category name");
    if (!name) {
      return;
    }

    const key = slugify(name);
    if (!key) {
      return;
    }

    const newTop: TopCategory = {
      id: `top-${key}`,
      name,
      color: "#7c3aed",
      note: "새로 만든 상위 카테고리",
      subcategories: [
        {
          id: `sub-${key}-general`,
          name: "General",
          note: "새 상위 카테고리의 기본 하위 카테고리"
        }
      ]
    };

    setCategories((prev) => [...prev, newTop]);
    setSelectedCategory({
      topId: newTop.id,
      subId: newTop.subcategories[0].id
    });
    setCurrentView("categories");
  };

  const addSubCategory = () => {
    const name = window.prompt(`New sub category under ${selectedTopCategory.name}`);
    if (!name) {
      return;
    }

    const key = slugify(name);
    if (!key) {
      return;
    }

    const newSubId = `sub-${selectedTopCategory.id.replace("top-", "")}-${key}`;

    setCategories((prev) =>
      prev.map((category) =>
        category.id === selectedTopCategory.id
          ? {
              ...category,
              subcategories: [
                ...category.subcategories,
                {
                  id: newSubId,
                  name,
                  note: `${selectedTopCategory.name} 아래에 추가된 하위 카테고리`
                }
              ]
            }
          : category
      )
    );
    setSelectedCategory({
      topId: selectedTopCategory.id,
      subId: newSubId
    });
    setCurrentView("categories");
  };

  const headerConfig = {
    library: {
      title: `Category: ${categoryLabel}`,
      subtitle: `${papersInSelectedCategory.length} papers in selected sub category`,
      actions: [{ label: "Import PDF" }, { label: "New Top Category", onClick: addTopCategory }]
    },
    categories: {
      title: `Category: ${categoryLabel}`,
      subtitle: `${papersInSelectedCategory.length} papers, ${papersInSelectedCategory.reduce((sum, paper) => sum + paper.noteCount, 0)} notes, ${papersInSelectedCategory.reduce((sum, paper) => sum + paper.figureCount, 0)} saved figures`,
      actions: [
        { label: "New Top Category", onClick: addTopCategory },
        { label: "New Sub Category", onClick: addSubCategory }
      ]
    },
    paper: {
      title: selectedPaper.title,
      subtitle: `${selectedPaper.journal} / ${selectedPaper.year} / DOI detected`,
      actions: [
        { label: "Open Reader", onClick: () => openReader(selectedPaper.id) },
        { label: "Move Category" }
      ]
    },
    reader: {
      title: "PDF Reader",
      subtitle: "paragraph-linked notes / category-linked annotations / detachable panel compatible",
      actions: [{ label: "Detach Notes" }, { label: "Reader Focus" }]
    },
    search: {
      title: "Search",
      subtitle: `Query: ${query || "none"} / scope: ${categoryLabel}`,
      actions: [{ label: "Scope Category" }, { label: "Semantic Ready" }]
    },
    settings: {
      title: "Settings",
      subtitle: "account, backup, restore, trash, workspace preferences",
      actions: [{ label: "Google Connected" }]
    }
  }[currentView];

  let body: ReactElement;

  switch (currentView) {
    case "library":
      body = (
        <LibraryView
          onOpenPaper={openPaper}
          onOpenReader={openReader}
          papers={papersInSelectedCategory}
          subCategoryName={selectedSubCategory.name}
          topCategory={selectedTopCategory}
        />
      );
      break;
    case "categories":
      body = (
        <CategoryView
          papers={papersInSelectedCategory}
          subCategoryName={selectedSubCategory.name}
          subCategoryNote={selectedSubCategory.note}
          topCategory={selectedTopCategory}
        />
      );
      break;
    case "paper":
      body = (
        <PaperDetailView
          categoryLabel={categoryLabel}
          onOpenReader={() => openReader(selectedPaper.id)}
          paper={selectedPaper}
          topCategory={selectedTopCategory}
        />
      );
      break;
    case "reader":
      body = (
        <ReaderView
          categoryLabel={categoryLabel}
          paper={selectedPaper}
          presets={annotationPresets}
        />
      );
      break;
    case "search":
      body = (
        <SearchView
          categoryLabel={categoryLabel}
          papers={searchFilteredPapers.length > 0 ? searchFilteredPapers : papersInSelectedCategory}
          query={query}
        />
      );
      break;
    case "settings":
      body = <SettingsView />;
      break;
    default:
      body = (
        <LibraryView
          onOpenPaper={openPaper}
          onOpenReader={openReader}
          papers={papersInSelectedCategory}
          subCategoryName={selectedSubCategory.name}
          topCategory={selectedTopCategory}
        />
      );
  }

  return (
    <div className="page">
      <div className="app-shell">
        <Sidebar
          categories={categories}
          currentView={currentView}
          onAddSubCategory={addSubCategory}
          onAddTopCategory={addTopCategory}
          onChangeView={setCurrentView}
          onSelectCategory={setSelectedCategory}
          selectedCategory={selectedCategory}
        />

        <main className="workspace">
          <TopBar
            actions={headerConfig.actions}
            onQueryChange={setQuery}
            query={query}
            searchPlaceholder="Search title, note, chunk, figure"
            subtitle={headerConfig.subtitle}
            title={headerConfig.title}
          />
          {body}
        </main>
      </div>
    </div>
  );
}
