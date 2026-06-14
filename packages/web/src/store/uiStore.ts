import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  activeTab: 'editor' | 'resources' | 'deploys' | 'workflows';
  isDarkMode: boolean;
  isNodePaletteOpen: boolean;
  isCodePanelOpen: boolean;
  isConsolePanelOpen: boolean;
  isAiPanelOpen: boolean;

  layoutDirection: 'LR' | 'TB';

  setActiveTab: (tab: UiState['activeTab']) => void;
  toggleDarkMode: () => void;
  toggleNodePalette: () => void;
  toggleCodePanel: () => void;
  toggleConsolePanel: () => void;
  toggleAiPanel: () => void;
  setCodePanelOpen: (open: boolean) => void;
  setLayoutDirection: (dir: 'LR' | 'TB') => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeTab: 'workflows',
      isDarkMode: true,
      isNodePaletteOpen: true,
      isCodePanelOpen: true,
      isConsolePanelOpen: true,
      isAiPanelOpen: false,
      layoutDirection: 'LR',

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

      setLayoutDirection: (dir) => set({ layoutDirection: dir }),
    }),
    {
      name: 'zaa-ui-storage',
      partialize: (state) => ({ isDarkMode: state.isDarkMode }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (state.isDarkMode) document.documentElement.classList.add('dark');
          else document.documentElement.classList.remove('dark');
        }
      },
    }
  )
);
