import type { ChapterSlice, Config, Manifest, Ref, RenderContext } from './types';
import type { DataClient } from './data';
import { parseTemplate, render } from './render';

const MAX_SHOWN = 30;

export interface PopupDeps {
  cfg: () => Config;
  data: DataClient;
  books: () => string[];
  ui: (k: string) => string;
  emit: (name: 'open' | 'close' | 'error', detail: unknown) => void;
  reader: (ref: Ref, tr: string) => void;
  /** Reference helpers, passed in by the core so a split build does not carry them twice. */
  f: { decodeRef(s: string): Ref | null; refText(r: Ref, book: string): string; linkFor(t: string | undefined, r: Ref, tr: string, book: string, text: string): string | null };
}

/** Visible target and context range for one reference, per chapter. */
export function plan(ref: Ref, cfg: Config, counts?: number): { ch: number; from: number; to: number; tf: number; tt: number }[] {
  const ctx = typeof cfg.context === 'number' ? { before: cfg.context, after: cfg.context } : cfg.context;
  if (ref.verse === undefined) {
    const n = Math.max(1, cfg.chapterPreview);
    return [{ ch: ref.chapter, from: 1, to: n, tf: 1, tt: n }];
  }
  const single = ref.endVerse === undefined && ref.endChapter === undefined;
  if (ref.endChapter !== undefined && ref.endChapter !== ref.chapter) {
    const out = [{ ch: ref.chapter, from: ref.verse, to: counts || 200, tf: ref.verse, tt: counts || 200 }];
    out.push({ ch: ref.endChapter, from: 1, to: ref.endVerse ?? 200, tf: 1, tt: ref.endVerse ?? 200 });
    return out;
  }
  const tt = ref.endVerse ?? ref.verse;
  const b = single ? Math.max(0, ctx.before) : 0;
  const a = single ? Math.max(0, ctx.after) : 0;
  return [{ ch: ref.chapter, from: Math.max(1, ref.verse - b), to: tt + a, tf: ref.verse, tt }];
}

export function createPopup(d: PopupDeps) {
  const pop = document.createElement('div');
  pop.id = 'vh-pop';
  pop.setAttribute('role', 'dialog');
  pop.tabIndex = -1;
  let link: HTMLElement | null = null;
  let ref: Ref | null = null;
  let tr = '';
  let pinned = false;
  let open = false;
  let showT = 0;
  let hideT = 0;
  let token = 0;
  let lastPtr = { x: 0, y: 0 };
  let ptype = 'mouse';
  let raf = 0;
  const P = () => d.cfg().classPrefix;
  const hasPopover = typeof (pop as any).showPopover === 'function';

  function mount() {
    if (pop.isConnected) return;
    pop.className = `${P()}pop`;
    const c = d.cfg();
    if (c.theme === 'dark') pop.classList.add(P() + 'dark');
    if (c.theme === 'light') pop.classList.add(P() + 'light');
    if (!c.wordsOfChrist) pop.classList.add(P() + 'nowoc');
    if (hasPopover) pop.setAttribute('popover', 'manual');
    document.body.appendChild(pop);
  }

  const linkTr = (el: HTMLElement, r: Ref) => el.closest<HTMLElement>('[data-vh-version]')?.dataset.vhVersion || el.dataset.vhTr || r.tr || d.cfg().translation;
  const refOf = (el: HTMLElement) => d.f.decodeRef(el.dataset.vhRef || '');

  function bookName(r: Ref) { return d.books()[r.book - 1] || '' + r.book; }

  async function load(r: Ref, t: string): Promise<{ verses: RenderContext['verses']; n: number; man: Manifest | null; more: boolean }> {
    const c = d.cfg();
    const man = await d.data.manifest(t);
    const steps = plan(r, c, man?.counts?.[r.book - 1]?.[r.chapter - 1]);
    const slices = await Promise.all(steps.map((s) => d.data.get({ tr: t, book: r.book, chapter: s.ch, from: s.from, to: s.to })));
    const verses: RenderContext['verses'] = [];
    let more = false;
    steps.forEach((s, i) => {
      const sl: ChapterSlice = slices[i];
      sl.v.forEach((text, j) => {
        const n = sl.f + j;
        if (n < s.from || n > s.to) return;
        if (verses.length >= MAX_SHOWN) { more = true; return; }
        verses.push({ n, text: c.formatting ? text : plain(text), target: n >= s.tf && n <= s.tt, heading: sl.h?.[n] });
      });
      if (r.verse === undefined && sl.n !== undefined && sl.n > s.to) more = true;
    });
    return { verses, n: verses.length, man, more };
  }

  const plain = (v: ChapterSlice['v'][number]) => (typeof v === 'string' ? v : v.map((s) => (typeof s === 'string' ? s : s[1])).join(''));

  async function show(el: HTMLElement, pin: boolean) {
    const r = refOf(el);
    if (!r) return;
    const c = d.cfg();
    const my = ++token;
    const t = linkTr(el, r);
    link?.removeAttribute('aria-expanded');
    link = el; ref = r; tr = t;
    pinned = pin;
    mount();
    const text = d.f.refText(r, bookName(r));
    const tpl = parseTemplate(c.template, P());
    const draw = (status: string | undefined, ctx?: Awaited<ReturnType<typeof load>>) => {
      const rc: RenderContext = {
        ref: r, refText: text, version: t, versionName: ctx?.man?.name || '', verses: ctx?.verses || [],
        link: d.f.linkFor(c.linkUrl, r, t, bookName(r), text) || undefined, copyright: ctx?.man?.copyright,
        dir: ctx?.man?.dir || 'ltr', lang: ctx?.man?.lang || '',
      };
      pop.setAttribute('aria-label', `${text} (${t})`);
      pop.dir = rc.dir;
      if (rc.lang) pop.lang = rc.lang;
      pop.classList.toggle(P() + 'pop--loading', !ctx && !status?.startsWith('!'));
      pop.classList.toggle(P() + 'pop--error', !!status && status[0] === '!');
      pop.replaceChildren(c.render ? c.render(rc) : render(tpl, rc, {
        P: P(), block: c.verseLayout === 'block', numbers: c.showVerseNumbers, version: c.showVersion, headings: c.showHeadings,
        status: status?.replace(/^!/, ''), closeLabel: d.ui('close'), linkLabel: d.ui('chapter'), more: ctx?.more,
      }));
      const body = pop.querySelector(`.${P()}pop__body`);
      body?.classList.toggle(P() + 'pop__body--block', c.verseLayout === 'block');
      if (ctx?.more || r.verse === undefined) addRead(r, t);
    };
    const reveal = () => {
      pop.classList.add(P() + 'pop--open');
      if (hasPopover) { try { (pop as any).showPopover(); } catch { /* already open */ } }
      pop.classList.toggle(P() + 'pop--pinned', pinned);
      if (!open) d.emit('open', { ref: r, translation: t });
      open = true;
      place();
      watchPos();
    };
    const slow = window.setTimeout(() => { if (my === token) { draw(d.ui('loading')); reveal(); } }, 100);
    link.setAttribute('aria-expanded', 'true');
    link.setAttribute('aria-describedby', pop.id);
    try {
      const ctx = await load(r, t);
      clearTimeout(slow);
      if (my !== token) return;
      if (!ctx.verses.length) draw('!' + d.ui('notFound'));
      else draw(undefined, ctx);
    } catch (e) {
      clearTimeout(slow);
      if (my !== token) return;
      draw('!' + d.ui('error'));
      d.emit('error', e);
    }
    reveal();
  }

  /** "Open chapter" button for the optional reader bundle. */
  function addRead(r: Ref, t: string) {
    if (d.cfg().click !== 'reader' && !d.cfg().plusUrl) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = P() + 'pop__read'; b.textContent = d.ui('chapter');
    b.onclick = () => d.reader(r, t);
    pop.appendChild(b);
  }

  function place() {
    if (!link) return;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const sheet = vw < 480;
    pop.classList.toggle(P() + 'pop--sheet', sheet);
    if (sheet) { pop.style.left = pop.style.top = ''; return; }
    const rects = Array.from(link.getClientRects());
    if (!rects.length) return;
    let best = rects[0], dist = 1e9;
    for (const r of rects) {
      const dx = lastPtr.x < r.left ? r.left - lastPtr.x : lastPtr.x > r.right ? lastPtr.x - r.right : 0;
      const dy = lastPtr.y < r.top ? r.top - lastPtr.y : lastPtr.y > r.bottom ? lastPtr.y - r.bottom : 0;
      if (dx + dy < dist) { dist = dx + dy; best = r; }
    }
    const w = pop.offsetWidth, h = pop.offsetHeight, g = 6;
    const below = best.bottom + g + h <= vh - 8 || best.top - g - h < 8;
    let top = below ? best.bottom + g : best.top - g - h;
    top = Math.max(8, Math.min(top, vh - h - 8));
    const left = Math.max(8, Math.min(best.left + best.width / 2 - w / 2, vw - w - 8));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.classList.toggle(P() + 'pop--below', below);
    pop.classList.toggle(P() + 'pop--above', !below);
    pop.style.setProperty('--vh-arrow', Math.round(best.left + best.width / 2 - left) + 'px');
  }

  function watchPos() {
    if (raf) return;
    raf = 1;
    addEventListener('scroll', () => open && place(), { capture: true, passive: true });
  }

  function hide() {
    clearTimeout(showT); clearTimeout(hideT);
    token++;
    if (!open) return;
    open = false; pinned = false;
    pop.classList.remove(P() + 'pop--open', P() + 'pop--pinned');
    if (hasPopover) { try { (pop as any).hidePopover(); } catch { /* not open */ } }
    link?.removeAttribute('aria-expanded');
    link?.removeAttribute('aria-describedby');
    d.emit('close', { ref });
  }

  let quiet = false;
  /** Close, and give focus back to the link without that focus reopening the popup. */
  function dismiss() {
    const f = pop.contains(document.activeElement);
    hide();
    if (f && link) { quiet = true; link.focus(); quiet = false; }
  }
  const schedHide = () => { clearTimeout(hideT); if (!pinned) hideT = window.setTimeout(hide, d.cfg().hideDelay); };
  const refEl = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(`.${P()}ref`) : null);
  const inPop = (t: EventTarget | null) => t instanceof Node && pop.contains(t);

  const on = (type: string, fn: (e: any) => void, cap = true) => document.addEventListener(type, fn, cap);
  const offs: (() => void)[] = [];
  function bind() {
    const add = (type: string, fn: (e: any) => void) => { on(type, fn); offs.push(() => document.removeEventListener(type, fn, true)); };
    add('pointerdown', (e: PointerEvent) => { ptype = e.pointerType; lastPtr = { x: e.clientX, y: e.clientY }; if (open && !inPop(e.target) && !refEl(e.target)) hide(); });
    add('pointerover', (e: PointerEvent) => {
      const el = refEl(e.target);
      if (e.pointerType === 'touch') return;
      lastPtr = { x: e.clientX, y: e.clientY };
      if (el) {
        const r = refOf(el); if (r) d.data.prefetch({ tr: linkTr(el, r), book: r.book, chapter: r.chapter, ...(() => { const s = plan(r, d.cfg())[0]; return { from: s.from, to: s.to }; })() });
        clearTimeout(hideT); clearTimeout(showT);
        if (el === link && open) return;
        showT = window.setTimeout(() => void show(el, false), d.cfg().hoverDelay);
      } else if (inPop(e.target)) clearTimeout(hideT);
    });
    add('pointerout', (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const to = e.relatedTarget;
      if (refEl(e.target) && refEl(to) === refEl(e.target)) return;
      if ((refEl(e.target) || inPop(e.target)) && !inPop(to) && refEl(to) !== link) { clearTimeout(showT); schedHide(); }
    });
    add('focusin', (e: FocusEvent) => { const el = refEl(e.target); if (el && !quiet) { clearTimeout(hideT); void show(el, false); } });
    add('focusout', (e: FocusEvent) => { if ((refEl(e.target) || inPop(e.target)) && !inPop(e.relatedTarget as Node) && !refEl(e.relatedTarget)) schedHide(); });
    add('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) dismiss();
    });
    add('click', (e: MouseEvent) => {
      const c = d.cfg();
      if (inPop(e.target)) {
        if ((e.target as Element).closest('[data-vh-slot=close]')) dismiss();
        return;
      }
      const el = refEl(e.target);
      if (!el) return;
      const touch = ptype === 'touch' || ptype === 'pen';
      const r = refOf(el);
      if (c.click === 'reader' && r) { e.preventDefault(); d.reader(r, linkTr(el, r)); return; }
      if (c.click === 'none' || c.click === 'popup' && el.tagName === 'A') e.preventDefault();
      if (touch && !(open && link === el)) { e.preventDefault(); void show(el, true); return; }
      if (el.tagName !== 'A') { // button: Enter / click pins, again closes
        if (open && link === el && pinned) hide(); else void show(el, true);
      } else if (open && link === el) pinned = true;
      ptype = 'mouse';
    });
    const rep = () => { if (open) place(); };
    window.addEventListener('resize', rep);
    offs.push(() => window.removeEventListener('resize', rep));
  }

  return {
    pop, bind, hide,
    openFor: (el: HTMLElement) => void show(el, true),
    destroy() { hide(); offs.forEach((f) => f()); offs.length = 0; pop.remove(); },
    current: () => (open ? { ref, tr } : null),
  };
}
