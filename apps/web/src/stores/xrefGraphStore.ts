import { Store } from './Store';

export type XrefGraphView = 'hopper' | 'web' | 'compass' | 'arcs';

const VIEW_KEY = 'bible-reader-xref-graph-view';
const VIEWS: readonly XrefGraphView[] = ['hopper', 'web', 'compass', 'arcs'];

function isView(v: unknown): v is XrefGraphView {
  return typeof v === 'string' && (VIEWS as readonly string[]).includes(v);
}

/** Hopper on phone-width viewports, else the verse web. */
function defaultView(): XrefGraphView {
  return typeof window !== 'undefined' && window.innerWidth < 600 ? 'hopper' : 'web';
}

function loadView(): XrefGraphView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (isView(v)) return v;
  } catch { /* storage unavailable */ }
  return defaultView();
}

function saveView(view: XrefGraphView): void {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
}

/** State of the cross-reference graph dialog: open flag, shared anchor verse and the active view. */
class XrefGraphStore extends Store {
  isOpen = false;
  anchor: number | null = null;
  view: XrefGraphView = loadView();

  /** Open on `verseId`. Without `view`, the last used view (or the viewport default) is used. */
  open(verseId: number, view?: XrefGraphView): void {
    this.anchor = verseId;
    this.view = view ?? loadView();
    if (view) saveView(view);
    this.isOpen = true;
    this.notify();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.notify();
  }

  setAnchor(verseId: number): void {
    if (this.anchor === verseId) return;
    this.anchor = verseId;
    this.notify();
  }

  setView(view: XrefGraphView): void {
    saveView(view);
    if (this.view === view) return;
    this.view = view;
    this.notify();
  }
}

export const xrefGraphStore = new XrefGraphStore();
