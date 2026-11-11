import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useStore } from '../../../../hooks/useStore';
import { scanReferences, type ScannedReference } from '../../lib/referenceScan';
import type { PresentItem } from '../../lib/protocol';
import { notesDecoKey } from './decorations';
import { notesStore } from './notesStore';
import { selectionWatch } from './selectionWatch';
import './suggest.css';

// ---------------------------------------------------------------------------
// Pure decisions (tested on their own)
// ---------------------------------------------------------------------------

export interface SelectionFacts {
  /** The selected text, hard breaks as `\n`. */
  text: string;
  /** The selection is a non-empty text selection. */
  nonEmpty: boolean;
  /** Both ends are in the same textblock. */
  sameBlock: boolean;
  /** A mouse drag is still going on. */
  dragging: boolean;
  /** The selection overlaps text that is already an item. */
  insideItem: boolean;
  /** Escape or an outside click closed the popup for this very selection. */
  dismissed: boolean;
  /** The chooser popover is open. */
  chooserOpen: boolean;
}

export interface SelectionActions {
  /** Set when the text reads as a Bible reference: what "Make a verse item" would pin. */
  verse: ScannedReference | null;
  hymn: boolean;
  quote: boolean;
}

/** Which buttons the popup shows for this selection, or null for no popup. */
export function selectionActions(facts: SelectionFacts, scan: (text: string) => ScannedReference[] = scanReferences): SelectionActions | null {
  if (!facts.nonEmpty || !facts.sameBlock || facts.dragging || facts.insideItem || facts.dismissed || facts.chooserOpen) return null;
  const text = facts.text.trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  return { verse: scan(text)[0] ?? null, hymn: true, quote: true };
}

/** Leading/trailing whitespace of `text` taken off a `from`..`to` range that `text` spans one-to-one. */
export function trimRange(text: string, from: number, to: number): { from: number; to: number } {
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  return { from: from + lead, to: Math.max(from + lead, to - trail) };
}

/** A quote item from selected text: wrapping quote marks dropped, a `"…" – Name` ending read as the attribution. */
export function quoteFromText(text: string): PresentItem {
  const flat = text.replace(/\s+/g, ' ').trim();
  const attributed = /^["“'‘](.+)["”'’]\s*[-–—]\s*(.+)$/u.exec(flat);
  if (attributed) return { kind: 'quote', text: attributed[1].trim(), attribution: attributed[2].trim() };
  const wrapped = /^["“'‘](.+)["”'’]$/u.exec(flat);
  return { kind: 'quote', text: (wrapped ? wrapped[1] : flat).trim() };
}

export interface Rect { top: number; bottom: number; left: number; right: number }

/**
 * Where the popup goes: centred above the selection start, or below the end
 * when there is no room above, and always inside the viewport (8 px margin).
 */
export function placePopup(start: Rect, end: Rect, size: { width: number; height: number }, viewport: { width: number; height: number }): { top: number; left: number } {
  const gap = 8;
  const above = start.top - size.height - gap;
  const top = above >= gap ? above : Math.min(end.bottom + gap, viewport.height - size.height - gap);
  const centre = start.top === end.top ? (start.left + end.right) / 2 : start.left;
  const left = Math.max(gap, Math.min(centre - size.width / 2, viewport.width - size.width - gap));
  return { top: Math.max(gap, top), left };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Current {
  from: number;
  to: number;
  text: string;
  actions: SelectionActions;
}

const leafText = (leaf: { type: { name: string } }) => (leaf.type.name === 'hard_break' ? '\n' : ' ');

function readSelection(view: EditorView, dismissed: Dismissed | null): Current | null {
  const sel = view.state.selection;
  const nonEmpty = sel instanceof TextSelection && !sel.empty;
  const sameBlock = nonEmpty && sel.$from.parent.isTextblock && sel.$from.sameParent(sel.$to);
  const text = sameBlock ? view.state.doc.textBetween(sel.from, sel.to, '\n', leafText) : '';
  const spans = notesDecoKey.getState(view.state)?.spans ?? [];
  const insideItem = spans.some((s) => s.kind === 'item' && s.from < sel.to && s.to > sel.from);
  const actions = selectionActions({
    text,
    nonEmpty,
    sameBlock,
    dragging: selectionWatch.dragging,
    insideItem,
    dismissed: !!dismissed && dismissed.doc === view.state.doc && dismissed.from === sel.from && dismissed.to === sel.to,
    chooserOpen: !!notesStore.chooser,
  });
  if (!actions) return null;
  const range = trimRange(text, sel.from, sel.to);
  return { ...range, text: text.trim(), actions };
}

interface Dismissed { doc: unknown; from: number; to: number }

/**
 * A small toolbar beside a text selection in the notes: make the selected
 * text a verse, hymn or quote item (it then gets its own Show button). It
 * does not put anything on the screen. There is deliberately no highlight
 * button: bold is how highlights are made.
 */
export function SelectionPopup() {
  const { t } = useTranslation();
  useStore(selectionWatch, () => selectionWatch.view?.state);
  useStore(selectionWatch, () => selectionWatch.dragging);
  useStore(notesStore, () => notesStore.detection);
  useStore(notesStore, () => notesStore.chooser);
  const [dismissed, setDismissed] = useState<Dismissed | null>(null);
  const [size, setSize] = useState({ width: 300, height: 40 });
  const root = useRef<HTMLDivElement>(null);

  const view = selectionWatch.view;
  const current = view ? readSelection(view, dismissed) : null;

  const dismiss = () => {
    const v = selectionWatch.view;
    if (!v) return;
    const { from, to } = v.state.selection;
    setDismissed({ doc: v.state.doc, from, to });
  };

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target || root.current?.contains(target) || selectionWatch.view?.dom.contains(target)) return;
      dismiss();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [!!current]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width && (Math.abs(r.width - size.width) > 1 || Math.abs(r.height - size.height) > 1)) setSize({ width: r.width, height: r.height });
  });

  if (!view || !current) return null;

  let style: Record<string, string> | undefined;
  try {
    const pos = placePopup(view.coordsAtPos(current.from), view.coordsAtPos(current.to), size, { width: window.innerWidth, height: window.innerHeight });
    // rtl-physical: anchored to measured viewport coordinates (coordsAtPos)
    style = { top: `${pos.top}px`, left: `${pos.left}px` };
  } catch {
    return null; // the positions are not drawn (yet)
  }

  const { verse } = current.actions;
  const pinVerse = () => {
    if (!verse) return;
    const item: PresentItem = { kind: 'passage', module: notesStore.module, book: verse.book, chapter: verse.chapter };
    if (verse.verseStart !== undefined) item.verseStart = verse.verseStart;
    if (verse.verseEnd !== undefined) item.verseEnd = verse.verseEnd;
    notesStore.pinRange(current.from, current.to, item);
  };
  const chooseHymn = () => {
    const start = view.coordsAtPos(current.from);
    const end = view.coordsAtPos(current.to);
    notesStore.openChooser({
      mode: 'selection',
      from: current.from,
      to: current.to,
      query: current.text.replace(/\s+/g, ' '),
      anchor: new DOMRect(start.left, start.top, Math.max(0, end.right - start.left), end.bottom - start.top),
    });
  };
  const pinQuote = () => notesStore.pinRange(current.from, current.to, quoteFromText(current.text));

  return (
    <div
      class="pn-selpop"
      ref={root}
      style={style}
      role="toolbar"
      aria-label={t('present.notes.select.label', { defaultValue: 'Make the selected text an item' })}
      onMouseDown={(e) => e.preventDefault()}
    >
      {verse && (
        <button type="button" class="pz-btn pn-selpop__btn" title={verse.matchedText} onClick={pinVerse}>
          {t('present.notes.select.verse', { defaultValue: 'Make a verse item' })}
        </button>
      )}
      <button type="button" class="pz-btn pn-selpop__btn" onClick={chooseHymn}>
        {t('present.notes.select.hymn', { defaultValue: 'Make a hymn item' })}
      </button>
      <button type="button" class="pz-btn pn-selpop__btn" onClick={pinQuote}>
        {t('present.notes.select.quote', { defaultValue: 'Make a quote item' })}
      </button>
    </div>
  );
}
