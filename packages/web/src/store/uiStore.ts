import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseLocation, type LocationTab } from '../lib/app-location.js';

interface UiState {
  /** `gallery` has no navbar entry — see app-location. */
  activeTab: LocationTab;
  isDarkMode: boolean;

  /** Switches section and puts it in the URL, so the change is linkable and goes in history. */
  setActiveTab: (tab: LocationTab) => void;
  /** Applies a section that came *from* the URL; does not write back. */
  applyTabFromUrl: (tab: LocationTab) => void;
  toggleDarkMode: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeTab: 'apps',
      isDarkMode: true,

      // The hash write is what actually navigates; `hashchange` applies it back here.
      // Setting state too keeps the switch instant rather than waiting for the event.
      setActiveTab: (tab) => {
        set({ activeTab: tab });
        if (parseLocation(window.location.hash).tab !== tab) {
          window.location.hash = `#/${tab}`;
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
