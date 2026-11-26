import { create } from 'zustand';

/** Notes viewing zoom, in percent. A view-only scale: the note's own font sizes are never touched. */
export const NOTES_ZOOM_MIN = 50;
export const NOTES_ZOOM_MAX = 300;
export const NOTES_ZOOM_STEP = 10;
export const NOTES_ZOOM_DEFAULT = 100;
export const NOTES_ZOOM_STORAGE_KEY = 'kth.notesZoom';

export function clampNotesZoom(value: number): number {
  if (!Number.isFinite(value)) return NOTES_ZOOM_DEFAULT;
  return Math.min(NOTES_ZOOM_MAX, Math.max(NOTES_ZOOM_MIN, Math.round(value)));
}

function load(): number {
  try {
    const raw = window.localStorage.getItem(NOTES_ZOOM_STORAGE_KEY);
    return raw === null ? NOTES_ZOOM_DEFAULT : clampNotesZoom(Number(raw));
  } catch {
    return NOTES_ZOOM_DEFAULT;
  }
}

function persist(value: number): void {
  try {
    window.localStorage.setItem(NOTES_ZOOM_STORAGE_KEY, String(value));
  } catch {
    /* storage unavailable: the zoom still works for this session */
  }
}

interface NotesZoomState {
  percent: number;
  setPercent: (value: number) => void;
  step: (direction: 1 | -1) => void;
  reset: () => void;
}

export const useNotesZoomStore = create<NotesZoomState>((set, get) => {
  const apply = (value: number) => {
    const next = clampNotesZoom(value);
    persist(next);
    set({ percent: next });
  };
  return {
    percent: load(),
    setPercent: apply,
    step: (direction) => apply(get().percent + direction * NOTES_ZOOM_STEP),
    reset: () => apply(NOTES_ZOOM_DEFAULT),
  };
});

// Another window (a popped-out Notes pane) changed the zoom: follow it.
try {
  window.addEventListener('storage', (e) => {
    if (e.key === NOTES_ZOOM_STORAGE_KEY && e.newValue !== null) {
      useNotesZoomStore.setState({ percent: clampNotesZoom(Number(e.newValue)) });
    }
  });
} catch {
  /* no window (tests in a bare environment) */
}
