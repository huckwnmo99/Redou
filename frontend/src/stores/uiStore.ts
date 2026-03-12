import { create } from "zustand";
import { persistLocale, resolveInitialLocale, type AppLocale } from "@/lib/locale";
import type {
  NavItem,
  PaperDetailTab,
  PaperPageAnchor,
  SearchResultKind,
  SortKey,
  ViewMode,
} from "@/types/paper";

interface UIState {
  locale: AppLocale;
  activeNav: NavItem;
  activeFolderId: string | null;
  selectedPaperId: string | null;
  selectedNoteId: string | null;
  inspectorOpen: boolean;
  paperDetailOpen: boolean;
  paperDetailTab: PaperDetailTab;
  readerTargetAnchor: PaperPageAnchor | null;
  searchQuery: string;
  searchResultKind: SearchResultKind;
  searchPresetFilter: string[] | null;
  sortKey: SortKey;
  viewMode: ViewMode;

  setLocale: (locale: AppLocale) => void;
  setActiveNav: (nav: NavItem) => void;
  setActiveFolderId: (id: string | null) => void;
  setSelectedPaperId: (id: string | null) => void;
  setSelectedNoteId: (id: string | null) => void;
  openPaperDetail: (tab?: PaperDetailTab) => void;
  closePaperDetail: () => void;
  openNotesWorkspace: (paperId?: string | null, noteId?: string | null) => void;
  setPaperDetailTab: (tab: PaperDetailTab) => void;
  setReaderTargetAnchor: (anchor: PaperPageAnchor | null) => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  setSearchQuery: (q: string) => void;
  setSearchResultKind: (kind: SearchResultKind) => void;
  setSearchPresetFilter: (presetIds: string[] | null) => void;
  setSortKey: (key: SortKey) => void;
  setViewMode: (mode: ViewMode) => void;
}

const initialLocale = resolveInitialLocale();

export const useUIStore = create<UIState>((set) => ({
  locale: initialLocale,
  activeNav: "library",
  activeFolderId: null,
  selectedPaperId: null,
  selectedNoteId: null,
  inspectorOpen: false,
  paperDetailOpen: false,
  paperDetailTab: "overview",
  readerTargetAnchor: null,
  searchQuery: "",
  searchResultKind: "all",
  searchPresetFilter: null,
  sortKey: "addedAt",
  viewMode: "grid",

  setLocale: (locale) => {
    persistLocale(locale);
    set({ locale });
  },

  setActiveNav: (nav) =>
    set((state) => ({
      activeNav: nav,
      selectedPaperId: nav === "library" ? state.selectedPaperId : null,
      selectedNoteId: state.selectedNoteId,
      paperDetailOpen: nav === "library" ? state.paperDetailOpen : false,
      paperDetailTab: nav === "library" ? state.paperDetailTab : "overview",
      inspectorOpen: nav === "library" ? state.inspectorOpen : false,
    })),

  setActiveFolderId: (id) =>
    set({
      activeFolderId: id,
      selectedPaperId: null,
      selectedNoteId: null,
      paperDetailOpen: false,
      paperDetailTab: "overview",
      readerTargetAnchor: null,
      inspectorOpen: false,
    }),

  setSelectedPaperId: (id) =>
    set((state) => ({
      selectedPaperId: id,
      paperDetailOpen: id === null ? false : state.paperDetailOpen,
      paperDetailTab: id === null ? "overview" : state.paperDetailTab,
      readerTargetAnchor: id === null ? null : state.readerTargetAnchor,
      inspectorOpen: id !== null && state.activeNav === "library" ? !state.paperDetailOpen : false,
    })),

  setSelectedNoteId: (id) => set({ selectedNoteId: id }),

  openPaperDetail: (tab = "overview") =>
    set((state) => ({
      activeNav: "library",
      paperDetailOpen: state.selectedPaperId !== null,
      paperDetailTab: tab,
      inspectorOpen: false,
    })),

  closePaperDetail: () =>
    set((state) => ({
      paperDetailOpen: false,
      paperDetailTab: "overview",
      inspectorOpen: state.selectedPaperId !== null,
    })),

  openNotesWorkspace: (paperId = null, noteId = null) =>
    set((state) => ({
      activeNav: "library",
      selectedPaperId: paperId ?? state.selectedPaperId,
      selectedNoteId: noteId ?? state.selectedNoteId,
      paperDetailOpen: true,
      paperDetailTab: "notes",
      inspectorOpen: false,
    })),

  setPaperDetailTab: (tab) => set({ paperDetailTab: tab }),
  setReaderTargetAnchor: (anchor) => set({ readerTargetAnchor: anchor }),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSearchResultKind: (kind) => set({ searchResultKind: kind }),
  setSearchPresetFilter: (presetIds) => set({ searchPresetFilter: presetIds }),
  setSortKey: (key) => set({ sortKey: key }),
  setViewMode: (mode) => set({ viewMode: mode }),
}));
