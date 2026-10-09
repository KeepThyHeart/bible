/** Optional chapter reader (loaded with import() the first time it is needed). */
import type { ChapterSlice, Config, Ref } from '../types';
import type { DataClient } from '../data';
import { fillText } from '../render';

interface Ctx {
  ref: Ref;
  tr: string;
  data: DataClient;
  books: string[];
  ui(k: string): string;
  cfg: Config;
  chapters: string;
}

const EN: Record<string, string> = { prev: 'Previous chapter', next: 'Next chapter', copy: 'Copy', book: 'Book', chap: 'Chapter', close: 'Close', sm: 'A−', lg: 'A+', copied: 'Copied' };

const CSS = (P: string) => `@layer vh{
:where(.${P}rd){--vh-bg:#fff;--vh-fg:#1c1c1e;--vh-muted:#5c5c63;--vh-accent:#1a5fb4;--vh-border:#c9c9d0;--vh-words:#b3261e;box-sizing:border-box;width:min(40rem,100vw - 16px);height:min(46rem,100dvh - 16px);padding:0;border:1px solid var(--vh-border);border-radius:var(--vh-radius,10px);background:var(--vh-bg);color:var(--vh-fg);font:var(--vh-font-size,16px)/1.6 var(--vh-font,Georgia,serif);overflow:hidden}
:where(.${P}rd)[open]{display:flex;flex-direction:column}
:where(.${P}rd)::backdrop{background:rgba(0,0,0,.45)}
@media (prefers-color-scheme:dark){:where(.${P}rd:not(.${P}light)){--vh-bg:#1f2023;--vh-fg:#ececf0;--vh-muted:#a6a6b0;--vh-accent:#8ab4f8;--vh-border:#44454c;--vh-words:#ff8a80}}
:where(.${P}rd.${P}dark){--vh-bg:#1f2023;--vh-fg:#ececf0;--vh-muted:#a6a6b0;--vh-accent:#8ab4f8;--vh-border:#44454c;--vh-words:#ff8a80}
:where(.${P}rd__nav){display:flex;flex-wrap:wrap;gap:.4em;align-items:center;padding:.5em .7em;border-bottom:1px solid var(--vh-border);font:14px system-ui,sans-serif}
:where(.${P}rd__nav button,.${P}rd__nav select){font:inherit;color:inherit;background:transparent;border:1px solid var(--vh-border);border-radius:6px;padding:.25em .55em;cursor:pointer}
:where(.${P}rd__nav button:focus-visible,.${P}rd__nav select:focus-visible){outline:2px solid var(--vh-accent)}
:where(.${P}rd__body){overflow:auto;padding:.8em 1.1em;flex:1}
:where(.${P}rd__body .${P}v--target){background:color-mix(in srgb,var(--vh-accent) 18%,transparent);border-radius:3px}
:where(.${P}rd__sp){flex:1}
}`;

let sheet = false;

export function open(x: Ctx) {
  const P = x.cfg.classPrefix;
  const t = (k: string) => x.ui(k) !== k ? x.ui(k) : EN[k];
  const counts = x.chapters.split(',').map(Number);
  let { book, chapter } = x.ref;
  let tr = x.tr;
  let target = x.ref.verse ? [x.ref.verse, x.ref.endVerse ?? x.ref.verse] : [0, 0];
  let size = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--vh-font-size')) || 16;

  if (!sheet) {
    sheet = true;
    const s = document.createElement('style');
    if (x.cfg.nonce) s.nonce = x.cfg.nonce;
    s.textContent = CSS(P);
    document.head.appendChild(s);
  }
  const dlg = document.createElement('dialog');
  dlg.className = `${P}rd` + (x.cfg.theme === 'dark' ? ` ${P}dark` : x.cfg.theme === 'light' ? ` ${P}light` : '');
  dlg.setAttribute('aria-label', t('chap'));
  if (!x.cfg.wordsOfChrist) dlg.classList.add(P + 'nowoc');
  const nav = document.createElement('div');
  nav.className = P + 'rd__nav';
  const body = document.createElement('div');
  body.className = P + 'rd__body';
  body.tabIndex = 0;
  body.setAttribute('role', 'document');
  dlg.append(nav, body);

  const btn = (label: string, fn: () => void, aria?: string) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.onclick = fn;
    if (aria) b.setAttribute('aria-label', aria);
    return b;
  };
  const sel = (label: string, opts: [string, string][], val: string, fn: (v: string) => void) => {
    const s = document.createElement('select');
    s.setAttribute('aria-label', label);
    for (const [v, text] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = text; s.appendChild(o); }
    s.value = val; s.onchange = () => fn(s.value);
    return s;
  };

  const step = (dir: 1 | -1) => {
    chapter += dir;
    if (chapter < 1) { book = book === 1 ? 66 : book - 1; chapter = counts[book - 1]; }
    else if (chapter > counts[book - 1]) { book = book === 66 ? 1 : book + 1; chapter = 1; }
    target = [0, 0];
    go();
  };

  function drawNav() {
    nav.replaceChildren(
      btn('‹', () => step(-1), t('prev')),
      sel(t('book'), x.books.map((n, i) => ['' + (i + 1), n]), '' + book, (v) => { book = +v; chapter = 1; target = [0, 0]; go(); }),
      sel(t('chap'), Array.from({ length: counts[book - 1] }, (_, i) => ['' + (i + 1), '' + (i + 1)]), '' + chapter, (v) => { chapter = +v; target = [0, 0]; go(); }),
      btn('›', () => step(1), t('next')),
    );
    if (x.cfg.translations && x.cfg.translations.length > 1) nav.appendChild(sel('Version', x.cfg.translations.map((a) => [a, a]), tr, (v) => { tr = v; go(); }));
    const sp = document.createElement('span'); sp.className = P + 'rd__sp';
    nav.append(sp,
      btn(t('sm'), () => { size = Math.max(11, size - 2); body.style.fontSize = size + 'px'; }),
      btn(t('lg'), () => { size = Math.min(34, size + 2); body.style.fontSize = size + 'px'; }),
      btn(t('copy'), () => {
        const text = Array.from(body.querySelectorAll(`.${P}v`)).map((v) => v.textContent).join(' ');
        const label = `${x.books[book - 1]} ${chapter} (${tr})`;
        void navigator.clipboard?.writeText(`${label}\n${text}`);
      }),
      btn('×', () => dlg.close(), t('close')),
    );
  }

  async function go() {
    drawNav();
    body.textContent = t('loading') === 'loading' ? '…' : t('loading');
    try {
      const sl: ChapterSlice = await x.data.get({ tr, book, chapter, from: 1, to: 999 });
      body.replaceChildren();
      sl.v.forEach((v, i) => {
        const n = sl.f + i;
        if (sl.h?.[n]) { const h = document.createElement('div'); h.className = P + 'h'; h.textContent = sl.h[n]; body.appendChild(h); }
        const el = document.createElement('span');
        el.className = `${P}v` + (n >= target[0] && n <= target[1] && target[0] ? ` ${P}v--target` : '');
        el.id = `${P}rd-v${n}`;
        const num = document.createElement('sup');
        num.className = P + 'v__num'; num.textContent = '' + n;
        const text = document.createElement('span');
        fillText(text, v, P);
        el.append(num, text, ' ');
        body.appendChild(el);
      });
      body.scrollTop = 0;
      if (target[0]) body.querySelector(`#${P}rd-v${target[0]}`)?.scrollIntoView({ block: 'center' });
    } catch {
      body.textContent = t('error') === 'error' ? 'Error' : t('error');
    }
  }

  dlg.addEventListener('close', () => dlg.remove());
  document.body.appendChild(dlg);
  dlg.showModal();
  body.style.fontSize = size + 'px';
  void go();
  return dlg;
}
