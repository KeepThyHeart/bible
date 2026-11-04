import type { Config, LocalePack, Ref } from './types';
import { createDetector } from './detect';
import { createScanner } from './scan';
import type { UiLib } from './ui';
import { decodeRef, encodeRef, linkFor, refText } from './format';
import { escapeHtml } from './render';
import { chapters, pack as en } from './locales/en.generated';

const DEFAULTS: Config = {
  source: { type: 'php', url: 'verse-hover.php' },
  translation: 'KJV',
  load: 'lazy',
  context: 0,
  chapterPreview: 5,
  click: 'popup',
  threshold: 'normal',
  requireVerse: false,
  ignore: [],
  observe: true,
  theme: 'auto',
  style: {},
  verseLayout: 'inline',
  showVerseNumbers: true,
  showVersion: true,
  showHeadings: false,
  formatting: true,
  wordsOfChrist: true,
  hoverDelay: 150,
  hideDelay: 250,
  classPrefix: 'vh-',
  autoInit: true,
};

const packs = new Map<string, LocalePack>([['en', en]]);
let script: HTMLScriptElement | null = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
let cfg: Config = { ...DEFAULTS };
let active: ReturnType<typeof build> | null = null;

const scriptBase = () => (script?.src || location.href);
const toList = (v: unknown): string[] => (v ? (Array.isArray(v) ? v : [v]).map(String) : []);

function readConfig(user?: Partial<Config>): Config {
  let attr: Partial<Config> = {};
  try { attr = JSON.parse(script?.getAttribute('data-vh') || '{}'); } catch { /* ignore bad JSON */ }
  const win = (window as unknown as { VerseHoverConfig?: Partial<Config> }).VerseHoverConfig || {};
  const c = { ...DEFAULTS, ...win, ...attr, ...user } as Config;
  if (!(attr.click || win.click || user?.click)) c.click = c.linkUrl ? 'link' : 'popup';
  return c;
}

function build(c: Config) {
  const locs = toList(c.locale).length ? toList(c.locale) : ['en'];
  const list = locs.map((l) => packs.get(l)).filter(Boolean) as LocalePack[];
  const P = c.classPrefix;
  const detector = createDetector(list.length ? list : [en], chapters, {
    threshold: c.threshold, requireVerse: c.requireVerse, ignore: c.ignore, translations: c.translations,
  });
  const main = list[0] || en;
  let ui_: ReturnType<UiLib['start']> | null = null;
  let dead = false;
  const uiText = (k: string) => main.ui[k] ?? en.ui[k] ?? k;
  const w = window as unknown as { __vhUi?: UiLib };
  const loadUi = (): Promise<UiLib> =>
    w.__vhUi
      ? Promise.resolve(w.__vhUi)
      : new Promise((ok, fail) => {
          const s = document.createElement('script');
          s.src = c.uiUrl || new URL('verse-hover-ui.min.js', scriptBase()).href;
          const nonce = c.nonce ?? script?.nonce;
          if (nonce) s.nonce = nonce;
          s.onload = () => (w.__vhUi ? ok(w.__vhUi) : fail(new Error('ui')));
          s.onerror = () => fail(new Error('ui'));
          document.head.appendChild(s);
        });

  let loose: ReturnType<typeof createDetector> | undefined;
  const make = (ref: Ref, text: string, host: Element): HTMLElement => {
    const url = linkFor(c.linkUrl, ref, c.translation, main.books[ref.book - 1], text);
    ensure();
    // Without a URL the reference is a focusable role=button span (a real <button> cannot wrap across lines).
    const el = document.createElement(url ? 'a' : 'span');
    if (url) { (el as HTMLAnchorElement).href = url; if (c.linkTarget) { (el as HTMLAnchorElement).target = c.linkTarget; el.setAttribute('rel', 'noopener'); } }
    else { el.tabIndex = 0; el.setAttribute('role', 'button'); }
    el.className = `${P}ref` + (ref.endVerse !== undefined || ref.endChapter !== undefined ? ` ${P}ref--range` : '') + (ref.verse === undefined ? ` ${P}ref--chapter` : '');
    el.dataset.vhRef = encodeRef(ref);
    if (ref.tr) el.dataset.vhTr = ref.tr;
    el.textContent = text;
    void host;
    return el;
  };
  const scanner = createScanner({
    detect: (t) => detector.detect(t),
    make,
    mark: (el) => {
      let v = el.getAttribute('data-vh-ref') || '';
      if (!decodeRef(v)) {
        const r = (loose ||= createDetector(main, chapters, { threshold: 0 })).detect(v)[0];
        if (!r) return;
        el.setAttribute('data-vh-ref', (v = encodeRef(r)));
      }
      ensure();
      el.classList.add(`${P}ref`);
      if (!el.matches('a,button,[tabindex]')) { el.tabIndex = 0; el.setAttribute('role', 'button'); }
    },
    prefix: P, skip: c.skip, scope: c.scope, observe: c.observe,
  });

  let started = false;
  /** Loads the interactive half the first time a reference exists (also for nodes added later). */
  function ensure() {
    if (started) return;
    started = true;
    loadUi().then(
      (lib) => {
        if (dead) return;
        ui_ = lib.start({
          cfg: c, books: main.books, ui: uiText, base: scriptBase, f: { decodeRef, linkFor, refText },
          emit: (name, detail) => {
            c.on?.[name]?.(detail);
            document.dispatchEvent(new CustomEvent('vh:' + name, { detail }));
          },
          reader: (ref, tr) => void openReader(ref, tr),
        });
      },
      (e) => {
        console.warn('verse-hover: could not load the popup script (' + (c.uiUrl || 'verse-hover-ui.min.js') + '); references stay plain.');
        scanner.destroy(); // leave the page as it was rather than inert dotted text
        c.on?.error?.(e);
      },
    );
  }

  void scanner.scan().then(() => {
    scanner.watch();
    c.on?.ready?.({});
    document.dispatchEvent(new CustomEvent('vh:ready'));
  });

  async function openReader(ref: Ref, tr: string) {
    const url = c.plusUrl || new URL('verse-hover-plus.min.js', scriptBase()).href;
    try {
      const mod = await import(/* @vite-ignore */ url);
      mod.open({ ref, tr, data: ui_!.data, books: main.books, ui: uiText, cfg: c, chapters });
    } catch (e) {
      c.on?.error?.(e);
    }
  }

  return {
    scanner, detector, main, c,
    openFor: (el: HTMLElement) => ui_?.openFor(el),
    hide: () => ui_?.hide(),
    destroy() { dead = true; scanner.destroy(); ui_?.destroy(); },
  };
}

const VerseHover = {
  init(user?: Partial<Config>) {
    if (active) active.destroy();
    cfg = readConfig(user);
    active = build(cfg);
  },
  scan: (el?: Node) => active?.scanner.scan(el ?? document.body),
  unscan: (el?: Node) => active?.scanner.unscan(el),
  parse: (text: string) => (active?.detector ?? createDetector(en, chapters)).detect(text),
  open(ref: Ref | string, anchor?: HTMLElement) {
    const r = typeof ref === 'string' ? decodeRef(ref) ?? createDetector(en, chapters, { threshold: 0 }).detect(ref)[0] : ref;
    if (!active || !r) return;
    let el = anchor;
    if (!el) { el = document.createElement('span'); el.dataset.vhRef = encodeRef(r); el.className = cfg.classPrefix + 'ref'; el.style.cssText = 'position:fixed;left:50%;top:30%'; document.body.appendChild(el); }
    active.openFor(el);
  },
  close: () => active?.hide(),
  setTranslation(abbr: string) { cfg.translation = abbr; },
  addLocale(p: LocalePack) {
    packs.set(p.id, p);
    if (active && toList(cfg.locale).includes(p.id)) { const c = cfg; active.destroy(); active = build(c); }
  },
  destroy() { active?.destroy(); active = null; },
  escapeHtml,
  refText,
  version: '0.1.0',
};

export default VerseHover;
export { VerseHover };

if (typeof document !== 'undefined' && script && !script.hasAttribute('data-vh-manual')) {
  const go = () => { if (readConfig().autoInit !== false) VerseHover.init(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
}
if (typeof window !== 'undefined') (window as unknown as { VerseHover: unknown }).VerseHover = VerseHover;
