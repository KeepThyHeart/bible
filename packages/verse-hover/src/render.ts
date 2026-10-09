import type { RenderContext, Seg, Verse } from './types';

const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'SUP', 'SUB', 'MARK', 'Q']);

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');

/** Default template; same syntax as a custom one. `P` is the class prefix. */
export const defaultTemplate = (P: string) =>
  `<div class="${P}pop__head"><strong class="${P}pop__ref" data-vh-slot="ref"></strong> <small class="${P}pop__ver" data-vh-slot="version"></small>` +
  `<button type="button" class="${P}pop__close" data-vh-slot="close">×</button></div>` +
  `<div class="${P}pop__status" data-vh-slot="status"></div>` +
  `<div class="${P}pop__body" data-vh-slot="verses"><span class="${P}v" data-vh-slot="verse"><sup class="${P}v__num" data-vh-slot="num"></sup><span class="${P}v__text" data-vh-slot="text"></span> </span></div>` +
  `<div class="${P}pop__foot"><a class="${P}pop__link" data-vh-slot="link"></a> <span class="${P}pop__copy" data-vh-slot="copyright"></span></div>`;

export function parseTemplate(src: string | HTMLTemplateElement | undefined, P: string): HTMLTemplateElement {
  if (src && typeof src !== 'string') return src;
  if (typeof src === 'string' && src[0] === '#') {
    const el = document.querySelector(src);
    if (el instanceof HTMLTemplateElement) return el;
  }
  const t = document.createElement('template');
  // Templates are author-controlled markup (like the script itself); data is never put through innerHTML.
  t.innerHTML = typeof src === 'string' && src[0] !== '#' ? src : defaultTemplate(P);
  return t;
}

const slot = (root: ParentNode, name: string) => root.querySelector<HTMLElement>(`[data-vh-slot="${name}"]`);

/** Words are rendered as spans: s = supplied, w = words of Christ, d = divine name. */
export function fillText(el: Element, v: Verse, P: string) {
  if (typeof v === 'string') { el.textContent = v; return; }
  el.textContent = '';
  for (const seg of v as Seg[]) {
    if (typeof seg === 'string') el.appendChild(document.createTextNode(seg));
    else {
      const s = document.createElement('span');
      s.className = [...seg[0]].map((c) => `${P}w-${c}`).join(' ');
      s.textContent = seg[1];
      el.appendChild(s);
    }
  }
}

export interface RenderOpts {
  P: string;
  block: boolean;
  numbers: boolean;
  version: boolean;
  headings: boolean;
  status?: string;
  closeLabel: string;
  linkLabel: string;
  more?: boolean;
}

export function render(tpl: HTMLTemplateElement, ctx: RenderContext, o: RenderOpts): DocumentFragment {
  const f = tpl.content.cloneNode(true) as DocumentFragment;
  const set = (name: string, text: string | undefined) => {
    const el = slot(f, name);
    if (!el) return;
    if (text) el.textContent = text;
    else el.remove();
  };
  set('ref', ctx.refText);
  set('version', o.version ? ctx.version : '');
  set('version-name', ctx.versionName);
  set('copyright', ctx.copyright);
  const st = slot(f, 'status');
  if (st) { if (o.status) st.textContent = o.status; else st.remove(); }
  const close = slot(f, 'close');
  if (close) close.setAttribute('aria-label', o.closeLabel);
  const link = slot(f, 'link') as HTMLAnchorElement | null;
  if (link) {
    if (ctx.link) {
      link.href = ctx.link;
      if (!link.textContent) link.textContent = o.linkLabel;
    } else link.remove();
  }
  const box = slot(f, 'verses');
  if (box) {
    const proto = slot(box, 'verse');
    if (!proto) {
      box.textContent = ctx.verses.map((v) => (typeof v.text === 'string' ? v.text : v.text.map((s) => (typeof s === 'string' ? s : s[1])).join(''))).join(' ');
    } else {
      const heading = slot(box, 'heading');
      heading?.remove();
      proto.remove();
      let first = true;
      for (const v of ctx.verses) {
        if (o.headings && v.heading) {
          const h = (heading ? (heading.cloneNode(false) as HTMLElement) : document.createElement('div')) as HTMLElement;
          h.classList.add(o.P + 'h');
          h.textContent = v.heading;
          box.appendChild(h);
        }
        if (o.block && !first && INLINE.has(proto.tagName)) box.appendChild(document.createElement('br'));
        first = false;
        const el = proto.cloneNode(true) as HTMLElement;
        el.classList.add(o.P + (v.target ? 'v--target' : 'v--ctx'));
        const num = slot(el, 'num');
        if (num) { if (o.numbers) num.textContent = '' + v.n; else num.remove(); }
        const text = slot(el, 'text');
        if (text) fillText(text, v.text, o.P);
        box.appendChild(el);
      }
      if (o.more) box.appendChild(document.createTextNode(' …'));
    }
  }
  return f;
}
