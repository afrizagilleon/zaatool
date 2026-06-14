import { create } from 'zustand';

interface UiState {
  activeTab: 'editor' | 'resources' | 'deploys';
  isDarkMode: boolean;
  isNodePaletteOpen: boolean;
  isCodePanelOpen: boolean;
  isConsolePanelOpen: boolean;
  isAiPanelOpen: boolean;

  setActiveTab: (tab: UiState['activeTab']) => void;
  toggleDarkMode: () => void;
  toggleNodePalette: () => void;
  toggleCodePanel: () => void;
  toggleConsolePanel: () => void;
  toggleAiPanel: () => void;
  setCodePanelOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'editor',
  isDarkMode: true,
  isNodePaletteOpen: true,
  isCodePanelOpen: true,
  isConsolePanelOpen: true,
  isAiPanelOpen: false,

  setActiveTab: (tab) => set({ activeTab: tab }),

  toggleDarkMode: () =>
    set((state) => {
      const next = !state.isDarkMode;
      if (next) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { isDarkMode: next };
    }),

  toggleNodePalette: () =>
    set((state) => ({ isNodePaletteOpen: !state.isNodePaletteOpen })),

  toggleCodePanel: () =>
    set((state) => ({ isCodePanelOpen: !state.isCodePanelOpen })),

  toggleConsolePanel: () =>
    set((state) => ({ isConsolePanelOpen: !state.isConsolePanelOpen })),

  toggleAiPanel: () =>
    set((state) => ({ isAiPanelOpen: !state.isAiPanelOpen })),

  setCodePanelOpen: (open) => set({ isCodePanelOpen: open }),
}));
