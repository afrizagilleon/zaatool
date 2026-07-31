import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fromUiTab, parseLocation } from '../lib/app-location.js';

interface UiState {
  activeTab: 'editor' | 'notebooks' | 'resources' | 'deploys' | 'workflows';
  isDarkMode: boolean;
  isNodePaletteOpen: boolean;
  isCodePanelOpen: boolean;
  isConsolePanelOpen: boolean;
  isAiPanelOpen: boolean;

  layoutDirection: 'LR' | 'TB';

  isCodeEditorOpen: boolean;
  codeEditorNodeId: string | null;

  /** Switches section and puts it in the URL, so the change is linkable and goes in history. */
  setActiveTab: (tab: UiState['activeTab']) => void;
  /** Applies a section that came *from* the URL; does not write back. */
  applyTabFromUrl: (tab: UiState['activeTab']) => void;
  toggleDarkMode: () => void;
  toggleNodePalette: () => void;
  toggleCodePanel: () => void;
  toggleConsolePanel: () => void;
  toggleAiPanel: () => void;
  setCodePanelOpen: (open: boolean) => void;
  setLayoutDirection: (dir: 'LR' | 'TB') => void;
  openCodeEditor: (nodeId: string) => void;
  closeCodeEditor: () => void;
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
      isCodeEditorOpen: false,
      codeEditorNodeId: null,

      // The hash write is what actually navigates; `hashchange` applies it back here.
      // Setting state too keeps the switch instant rather than waiting for the event.
      setActiveTab: (tab) => {
        set({ activeTab: tab });
        const wanted = fromUiTab(tab);
        if (parseLocation(window.location.hash).tab !== wanted) {
          window.location.hash = `#/${wanted}`;
        }
      },

      applyTabFromUrl: (tab) => set({ activeTab: tab }),

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

      openCodeEditor: (nodeId) => {
        console.log("[uiStore] openCodeEditor called with nodeId:", nodeId);
        set({ isCodeEditorOpen: true, codeEditorNodeId: nodeId });
      },
      closeCodeEditor: () => {
        console.log("[uiStore] closeCodeEditor called");
        set({ isCodeEditorOpen: false, codeEditorNodeId: null });
      },
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
