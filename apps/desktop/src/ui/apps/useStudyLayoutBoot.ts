import { create } from 'zustand';

/**
 * What the Study view needs from session restore, held outside App's state so the
 * stage can render views without props. dockview must not build any layout until
 * the session has said which one it is (`layoutDecided`).
 */
interface StudyLayoutBootState {
  savedLayout: Record<string, any> | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  layoutDecided: boolean;
  setSavedLayout(layout: Record<string, any> | null): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  setLayoutDecided(decided: boolean): void;
  reset(): void;
}

export const useStudyLayoutBoot = create<StudyLayoutBootState>((set) => ({
  savedLayout: null,
  layoutDecided: false,
  setSavedLayout: (savedLayout) => set({ savedLayout }),
  setLayoutDecided: (layoutDecided) => set({ layoutDecided }),
  reset: () => set({ savedLayout: null, layoutDecided: false }),
}));
