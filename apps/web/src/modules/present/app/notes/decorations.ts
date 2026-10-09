import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { PresentItem } from '../../lib/protocol';
import type { DetectResult, NotesItem, NotesReason } from './types';

/**
 * Row 8: how the detection result is drawn in the editor.
 *
 *  - recognised item: blue underline (`pn-item`); amber dashed when it needs a
 *    choice (`pn-item--choose`, with the reason as a hover tooltip); green when
 *    it is the item the wall is showing (`pn-item--live`);
 *  - highlight (a bold span matched to a verse): subtle yellow underline
 *    (`pn-hl`), yellow background on hover;
 *  - a small ▶ widget after each showable item;
 *  - a left gutter with a green Play marker at the live item.
 *
 * `computeDecorations` is pure (detection in, descriptors out) so it can be
 * tested without ProseMirror; the plugin turns the descriptors into a
 * DecorationSet and keeps it mapped through edits between detection runs.
 */

export interface DecoSpan {
  id: string;
  kind: 'item' | 'highlight';
  from: number;
  to: number;
}

export type DecoDescriptor =
  | { type: 'inline'; from: number; to: number; attrs: Record<string, string>; span: DecoSpan }
  | { type: 'widget'; pos: number; itemId: string };

export type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface ComputeOptions {
  /** Size of the document the positions must fit in (detection can be a keystroke stale). */
  docSize: number;
  /** The item to draw green, or null. */
  playItemId: string | null;
  translate: Translate;
}

const at = (blockPos: number, offset: number) => blockPos + 1 + offset;

function reasonText(reason: NotesReason | undefined, translate: Translate): string | undefined {
  return reason ? translate(reason.key, reason.params) : undefined;
}

function itemClasses(item: NotesItem, playItemId: string | null): string {
  const classes = ['pn-item', `pn-item--${item.kind}`];
  if (item.status === 'choose') classes.push('pn-item--choose');
  if (item.source === 'pinned') classes.push('pn-item--pinned');
  if (item.id === playItemId) classes.push('pn-item--live');
  return classes.join(' ');
}

export function computeDecorations(result: DetectResult, opts: ComputeOptions): DecoDescriptor[] {
  const out: DecoDescriptor[] = [];
  const fits = (from: number, to: number) => from >= 0 && to > from && to <= opts.docSize;

  for (const item of result.items) {
    const from = at(item.blockPos, item.from);
    const to = item.endBlockPos !== undefined && item.endTo !== undefined ? at(item.endBlockPos, item.endTo) : at(item.blockPos, item.to);
    if (!fits(from, to)) continue;
    const attrs: Record<string, string> = { class: itemClasses(item, opts.playItemId), 'data-pn-item': item.id };
    const title = item.status === 'choose' ? reasonText(item.reason, opts.translate) : undefined;
    if (title) attrs.title = title;
    out.push({ type: 'inline', from, to, attrs, span: { id: item.id, kind: 'item', from, to } });
    if (item.item) out.push({ type: 'widget', pos: to, itemId: item.id });
  }

  for (const hl of result.highlights) {
    const from = at(hl.blockPos, hl.from);
    const to = at(hl.blockPos, hl.to);
    if (!fits(from, to)) continue;
    const attrs: Record<string, string> = {
      class: hl.status === 'choose' ? 'pn-hl pn-hl--choose' : 'pn-hl',
      'data-pn-hl': hl.id,
    };
    const title = hl.status === 'choose' ? reasonText(hl.reason, opts.translate) : undefined;
    if (title) attrs.title = title;
    out.push({ type: 'inline', from, to, attrs, span: { id: hl.id, kind: 'highlight', from, to } });
  }
  return out;
}

/** Whether two items show the same thing on the wall (verse index aside). */
export function isSameItem(a: PresentItem | null | undefined, b: PresentItem | null | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'passage': {
      const p = b as typeof a;
      return a.module === p.module && a.book === p.book && a.chapter === p.chapter
        && a.verseStart === p.verseStart && a.verseEnd === p.verseEnd;
    }
    case 'hymn':
      return a.hymnId === (b as typeof a).hymnId;
    case 'quote':
      return a.text === (b as typeof a).text;
    case 'text':
      return a.body === (b as typeof a).body;
  }
}

/**
 * Which note item the wall is showing. Prefers the item last shown from the
 * notes when it still matches; otherwise the first match; null when the wall
 * shows nothing that is in the notes.
 */
export function findPlayItemId(
  items: readonly NotesItem[],
  live: PresentItem | null | undefined,
  lastShownId: string | null,
): string | null {
  if (!live) return null;
  const matches = items.filter((it) => isSameItem(it.item, live));
  if (matches.length === 0) return null;
  return matches.find((it) => it.id === lastShownId)?.id ?? matches[0].id;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface DecorationHost {
  translate: Translate;
  /** ▶ widget or gutter marker pressed. */
  onPlay: (itemId: string) => void;
  /** A recognised item was clicked; `el` is the clicked element for popover placement. */
  onItemClick: (itemId: string, el: HTMLElement) => void;
  onHighlightClick: (highlightId: string, el: HTMLElement) => void;
  /** i18n for the marker's tooltip. */
  playTitle: () => string;
}

export interface DecoMeta {
  detection?: DetectResult | null;
  playItemId?: string | null;
}

interface DecoState {
  detection: DetectResult | null;
  playItemId: string | null;
  deco: DecorationSet;
  spans: DecoSpan[];
  /** Document position of the live item's start, kept mapped through edits. */
  playPos: number | null;
}

export const notesDecoKey = new PluginKey<DecoState>('notesDecorations');

const EMPTY: DecoState = { detection: null, playItemId: null, deco: DecorationSet.empty, spans: [], playPos: null };

function playButton(host: DecorationHost, itemId: string): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pn-play';
  btn.setAttribute('contenteditable', 'false');
  btn.title = host.playTitle();
  btn.setAttribute('aria-label', host.playTitle());
  btn.textContent = '▶';
  // Keep the caret where it is: pressing ▶ must not move the selection.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    host.onPlay(itemId);
  });
  return btn;
}

function rebuild(doc: import('prosemirror-model').Node, detection: DetectResult | null, playItemId: string | null, host: DecorationHost): DecoState {
  if (!detection) return { ...EMPTY, playItemId };
  const descriptors = computeDecorations(detection, { docSize: doc.content.size, playItemId, translate: host.translate });
  const decos: Decoration[] = [];
  const spans: DecoSpan[] = [];
  for (const d of descriptors) {
    if (d.type === 'inline') {
      decos.push(Decoration.inline(d.from, d.to, d.attrs, { span: d.span }));
      spans.push(d.span);
    } else {
      decos.push(Decoration.widget(d.pos, () => playButton(host, d.itemId), { side: 1, key: `play-${d.itemId}`, ignoreSelection: true }));
    }
  }
  const play = playItemId ? spans.find((s) => s.kind === 'item' && s.id === playItemId) : undefined;
  return { detection, playItemId, deco: DecorationSet.create(doc, decos), spans, playPos: play ? play.from : null };
}

export function createDecorationPlugins(host: DecorationHost): Plugin[] {
  const decorate = new Plugin<DecoState>({
    key: notesDecoKey,
    state: {
      init: () => EMPTY,
      apply(tr, value, _old, newState) {
        const meta = tr.getMeta(notesDecoKey) as DecoMeta | undefined;
        if (meta) {
          return rebuild(
            newState.doc,
            meta.detection !== undefined ? meta.detection : value.detection,
            meta.playItemId !== undefined ? meta.playItemId : value.playItemId,
            host,
          );
        }
        if (!tr.docChanged) return value;
        return {
          ...value,
          deco: value.deco.map(tr.mapping, tr.doc),
          spans: value.spans.map((s) => ({ ...s, from: tr.mapping.map(s.from, 1), to: tr.mapping.map(s.to, -1) })).filter((s) => s.to > s.from),
          playPos: value.playPos === null ? null : tr.mapping.map(value.playPos, 1),
        };
      },
    },
    props: {
      decorations: (state) => notesDecoKey.getState(state)?.deco ?? DecorationSet.empty,
      handleClick(_view, _pos, event) {
        const el = (event.target as HTMLElement | null)?.closest?.('[data-pn-item],[data-pn-hl]') as HTMLElement | null;
        if (!el) return false;
        if (el.dataset.pnItem) host.onItemClick(el.dataset.pnItem, el);
        else if (el.dataset.pnHl) host.onHighlightClick(el.dataset.pnHl, el);
        return false;
      },
    },
    view: (view) => new PlayGutter(view, host),
  });
  return [decorate];
}

/** The green Play marker in the left gutter, aligned to the live item's line. */
class PlayGutter {
  private readonly gutter: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly scroller: HTMLElement | null;
  private readonly onResize = () => this.update(this.view);

  constructor(private view: EditorView, private host: DecorationHost) {
    this.scroller = view.dom.parentElement;
    this.gutter = document.createElement('div');
    this.gutter.className = 'pn-gutter';
    this.gutter.setAttribute('contenteditable', 'false');
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'pn-gutter__play';
    this.button.textContent = '▶';
    this.button.addEventListener('mousedown', (e) => e.preventDefault());
    this.button.addEventListener('click', (e) => {
      e.preventDefault();
      const id = notesDecoKey.getState(this.view.state)?.playItemId;
      if (id) this.host.onPlay(id);
    });
    this.gutter.appendChild(this.button);
    this.scroller?.appendChild(this.gutter);
    window.addEventListener('resize', this.onResize);
    this.update(view);
  }

  update(view: EditorView): void {
    this.view = view;
    const st = notesDecoKey.getState(view.state);
    const scroller = this.scroller;
    if (!scroller || !st || st.playPos === null || st.playPos > view.state.doc.content.size) {
      this.gutter.hidden = true;
      return;
    }
    this.button.title = this.host.playTitle();
    this.button.setAttribute('aria-label', this.host.playTitle());
    try {
      const coords = view.coordsAtPos(Math.min(st.playPos + 1, view.state.doc.content.size));
      const box = scroller.getBoundingClientRect();
      this.gutter.hidden = false;
      this.gutter.style.height = `${scroller.scrollHeight}px`;
      this.button.style.top = `${coords.top - box.top + scroller.scrollTop}px`;
    } catch {
      this.gutter.hidden = true;
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.gutter.remove();
  }
}
