import { create } from 'zustand';
import type { QuizRequest } from '@bible/core/browser';

interface QuizLaunchState {
  /** A quiz to start as soon as the Quiz pane is showing (set by commands). */
  pending: QuizRequest | null;
  request: (request: QuizRequest) => void;
  /** Returns the pending request and clears it, so a request starts one quiz only. */
  take: () => QuizRequest | null;
}

export const useQuizLaunchStore = create<QuizLaunchState>((set, get) => ({
  pending: null,
  request: (request) => set({ pending: request }),
  take: () => {
    const request = get().pending; // allow-getstate: one-shot hand-off, not render state
    if (request) set({ pending: null });
    return request;
  },
}));
