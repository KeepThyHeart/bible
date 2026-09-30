import { create } from 'zustand';

export type XrefGraphView = 'hopper' | 'web' | 'compass' | 'arcs';

export const XREF_GRAPH_VIEW_STORAGE_KEY = 'xrefGraph.lastView';

/** Viewport width below which the dialog is full-screen and the Hopper is the default view. */
export const XREF_GRAPH_PHONE_WIDTH = 600;

const VIEWS: readonly XrefGraphView[] = ['hopper', 'web', 'compass', 'arcs'];

function readSavedView(): XrefGraphView | null {
  try {
    const raw = window.localStorage.getItem(XREF_GRAPH_VIEW_STORAGE_KEY);
    return VIEWS.includes(raw as XrefGraphView) ? (raw as XrefGraphView) : null;
  } catch {
    return null;
  }
}

function saveView(view: XrefGraphView): void {
  try {
    window.localStorage.setItem(XREF_GRAPH_VIEW_STORAGE_KEY, view);
  } catch {
    /* storage unavailable: the choice simply is not remembered */
  }
}

/** The last used view, else Hopper on a narrow viewport and Verse web otherwise. */
export function defaultXrefGraphView(): XrefGraphView {
  const saved = readSavedView();
  if (saved) return saved;
  const narrow = typeof window !== 'undefined' && window.innerWidth < XREF_GRAPH_PHONE_WIDTH;
  return narrow ? 'hopper' : 'web';
}

interface XrefGraphState {
  isOpen: boolean;
  /** The verse being explored, or null when nothing is open. */
  anchor: number | null;
  view: XrefGraphView;
  openGraph: (verseId: number, view?: XrefGraphView) => void;
  close: () => void;
  setAnchor: (verseId: number) => void;
  setView: (view: XrefGraphView) => void;
}

export const useXrefGraphStore = create<XrefGraphState>((set) => ({
  isOpen: false,
  anchor: null,
  view: 'web',
  openGraph: (verseId, view) => {
    const next = view ?? defaultXrefGraphView();
    if (view) saveView(view);
    set({ isOpen: true, anchor: verseId, view: next });
  },
  close: () => set({ isOpen: false }),
  setAnchor: (verseId) => set({ anchor: verseId }),
  setView: (view) => {
    saveView(view);
    set({ view });
  },
}));
