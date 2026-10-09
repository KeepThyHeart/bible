/** The interactive half of the drop-in: styles, data client, popup. Loaded on demand by the core (or bundled with it). */
import type { Config, Ref } from './types';
import { createData } from './data';
import { createPopup, type PopupDeps } from './popup';
import { css } from './style';

export interface UiCtx {
  cfg: Config;
  books: string[];
  ui(k: string): string;
  emit: PopupDeps['emit'];
  reader(ref: Ref, tr: string): void;
  base(): string;
  f: PopupDeps['f'];
}

export function start(x: UiCtx) {
  const c = x.cfg;
  const P = c.classPrefix;
  let sheet: CSSStyleSheet | null = null;
  let styleEl: HTMLStyleElement | null = null;
  if (c.theme !== 'none') {
    const text = css(P);
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      styleEl = document.createElement('style');
      if (c.nonce) styleEl.nonce = c.nonce;
      styleEl.textContent = text;
      document.head.appendChild(styleEl);
    }
  }
  const vars = Object.entries(c.style).map(([k, v]) => {
    const name = '--vh-' + k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
    document.documentElement.style.setProperty(name, v);
    return name;
  });
  const data = createData(() => c.source, x.base);
  const popup = createPopup({ cfg: () => c, data, books: () => x.books, ui: x.ui, emit: x.emit, reader: x.reader, f: x.f });
  popup.bind();

  if (c.load === 'eager') {
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`.${P}ref`))) {
      const r = x.f.decodeRef(el.dataset.vhRef || '');
      if (!r || seen.size >= 40 || seen.has('' + r.book * 1e3 + r.chapter)) continue;
      seen.add('' + r.book * 1e3 + r.chapter);
      data.prefetch({ tr: el.dataset.vhTr || c.translation, book: r.book, chapter: r.chapter, from: r.verse ?? 1, to: (r.endVerse ?? r.verse ?? c.chapterPreview) + (typeof c.context === 'number' ? c.context : c.context.after) });
    }
  }
  return {
    openFor: popup.openFor,
    hide: popup.hide,
    data,
    destroy() {
      popup.destroy();
      if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      styleEl?.remove();
      vars.forEach((n) => document.documentElement.style.removeProperty(n));
    },
  };
}

export type UiLib = { start: typeof start };
