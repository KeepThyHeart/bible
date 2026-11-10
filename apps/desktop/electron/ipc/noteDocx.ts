/**
 * Note HTML -> .docx. Parses the editor's HTML into a small tree (so nested lists, links and
 * entities are handled properly instead of by regex) and emits real Word formatting:
 * headings, bold/italic/underline/strike/sub/superscript, hyperlinks, numbered and bulleted
 * nested lists, block quotes, indentation, rules and code.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink,
  LevelFormat, BorderStyle, ShadingType,
} from 'docx';

type HtmlNode = { tag: string; attrs: Record<string, string>; children: HtmlNode[] } | { text: string };

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr']);
const SOFT_TAB = '    ';

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…',
};

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function stripControl(s: string): string { return s.replace(CONTROL, ''); }

export function decodeEntities(s: string): string {
  return stripControl(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return stripControl(code === 0 ? '\uFFFD' : String.fromCodePoint(code)); } catch { return m; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function parseHtml(html: string): HtmlNode[] {
  const root: { tag: string; attrs: Record<string, string>; children: HtmlNode[] } = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith('<!--')) continue;
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      top.children.push({ text: decodeEntities(m[4]) });
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[3])) !== null) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    }
    const node = { tag, attrs, children: [] as HtmlNode[] };
    top.children.push(node);
    if (!VOID.has(tag) && !m[3].trimEnd().endsWith('/')) stack.push(node);
  }
  return root.children;
}

interface Fmt { bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean; sup?: boolean; sub?: boolean; code?: boolean; link?: string; color?: string; highlight?: string }

function isEl(n: HtmlNode): n is Exclude<HtmlNode, { text: string }> { return 'tag' in n; }

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'table', 'tr', 'tbody', 'thead', 'tfoot', 'td', 'th', 'colgroup', 'label']);

function run(text: string, f: Fmt): TextRun {
  return new TextRun({
    text,
    bold: f.bold || undefined,
    italics: f.italics || undefined,
    underline: f.underline || f.link ? {} : undefined,
    strike: f.strike || undefined,
    superScript: f.sup || undefined,
    subScript: f.sub || undefined,
    font: f.code ? 'Courier New' : undefined,
    color: f.link ? '0563C1' : f.color,
    shading: f.highlight ? { type: ShadingType.CLEAR, fill: f.highlight, color: 'auto' } : undefined,
  });
}

/** Inline children -> runs / hyperlinks. */
function inlineRuns(nodes: HtmlNode[], f: Fmt, out: (TextRun | ExternalHyperlink)[] = []): (TextRun | ExternalHyperlink)[] {
  for (const n of nodes) {
    if (!isEl(n)) {
      const text = n.text.replace(/\s*\n\s*/g, ' ');
      if (text) out.push(run(text, f));
      continue;
    }
    const t = n.tag;
    if (t === 'img') { if (n.attrs.alt) out.push(run(`[image: ${n.attrs.alt}]`, f)); continue; }
    if (t === 'br') { out.push(new TextRun({ break: 1 })); continue; }
    if (BLOCK_TAGS.has(t)) continue;
    const next: Fmt = { ...f };
    if (t === 'strong' || t === 'b') next.bold = true;
    else if (t === 'em' || t === 'i') next.italics = true;
    else if (t === 'u') next.underline = true;
    else if (t === 's' || t === 'del' || t === 'strike') next.strike = true;
    else if (t === 'sup') next.sup = true;
    else if (t === 'sub') next.sub = true;
    else if (t === 'code' || t === 'kbd' || t === 'samp') next.code = true;
    else if (t === 'a' && n.attrs.href && /^(https?:|mailto:)/i.test(n.attrs.href)) {
      const inner = inlineRuns(n.children, { ...f, link: n.attrs.href });
      out.push(new ExternalHyperlink({ link: n.attrs.href, children: inner as TextRun[] }));
      continue;
    }
    const style = n.attrs.style ?? '';
    const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style)?.[1];
    if (t === 'mark') next.highlight = hex(n.attrs['data-color'] ?? bg) ?? 'FFFF00';
    else if (bg && hex(bg)) next.highlight = hex(bg);
    const col = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1];
    if (col && hex(col)) next.color = hex(col);
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) next.bold = true;
    if (/font-style\s*:\s*italic/i.test(style)) next.italics = true;
    if (/text-decoration[^;]*underline/i.test(style)) next.underline = true;
    inlineRuns(n.children, next, out);
  }
  return out;
}

/** #rgb / #rrggbb / rgb(r,g,b) -> RRGGBB, else undefined. */
function hex(v?: string): string | undefined {
  if (!v) return undefined;
  v = v.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (m) return [m[1], m[2], m[3]].map(x => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
}

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
};

interface Ctx { quote: number; list?: { ordered: boolean; level: number; instance: number; task?: boolean } }

let olCounter = 0;

function alignOf(n: Exclude<HtmlNode, { text: string }>) {
  const m = /text-align\s*:\s*(left|right|center|justify)/i.exec(n.attrs.style ?? '');
  if (!m) return undefined;
  return ({ left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER, justify: AlignmentType.JUSTIFIED } as const)[m[1].toLowerCase() as 'left'];
}

/** Leading soft tabs (the editor's paragraph indent) become a real left indent. */
function softIndent(children: (TextRun | ExternalHyperlink)[], nodes: HtmlNode[]): { left: number } | undefined {
  let lead = 0;
  const first = nodes.find(n => !isEl(n) || n.tag !== 'br');
  let text = first && !isEl(first) ? first.text : '';
  text = text.replace(/ /g, ' ');
  while (text.startsWith(SOFT_TAB)) { lead++; text = text.slice(SOFT_TAB.length); }
  if (lead && first && !isEl(first)) {
    first.text = text;
    children.length = 0;
    children.push(...inlineRuns(nodes, {}));
    return { left: 720 * lead };
  }
  return undefined;
}

function blocks(nodes: HtmlNode[], ctx: Ctx, out: Paragraph[]): void {
  let pending: HtmlNode[] = [];
  const flush = () => {
    if (!pending.length) return;
    const runs = inlineRuns(pending, {});
    if (runs.length && pending.some(n => (isEl(n) ? true : n.text.trim()))) out.push(para(runs, ctx));
    pending = [];
  };
  for (const n of nodes) {
    if (!isEl(n) || !BLOCK_TAGS.has(n.tag)) { pending.push(n); continue; }
    flush();
    const t = n.tag;
    if (t === 'hr') {
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: '999999' } }, spacing: { before: 100, after: 100 } }));
    } else if (HEADINGS[t]) {
      const runs = inlineRuns(n.children, {});
      if (runs.length) out.push(new Paragraph({ heading: HEADINGS[t], children: runs, alignment: alignOf(n) }));
    } else if (t === 'ul' || t === 'ol') {
      const level = ctx.list ? ctx.list.level + 1 : 0;
      const instance = t === 'ol' && level === 0 ? ++olCounter : (ctx.list?.instance ?? 0);
      const task = n.attrs['data-type'] === 'taskList';
      blocks(n.children, { ...ctx, list: { ordered: t === 'ol', level: Math.min(level, 8), instance, task } }, out);
    } else if (t === 'li') {
      listItem(n, ctx, out);
    } else if (t === 'blockquote') {
      blocks(n.children, { ...ctx, quote: ctx.quote + 1 }, out);
    } else if (t === 'pre') {
      const text = collectText(n.children);
      text.split('\n').forEach(line => out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New' })], indent: { left: 360 * (ctx.quote + 1) } })));
    } else if (t === 'label') {
      continue;
    } else if (t === 'table' || t === 'tr' || t === 'tbody' || t === 'thead' || t === 'tfoot' || t === 'colgroup' || t === 'td' || t === 'th') {
      blocks(n.children, ctx, out);
    } else {
      // p / div
      const hasBlock = n.children.some(c => isEl(c) && BLOCK_TAGS.has(c.tag));
      if (hasBlock) { blocks(n.children, ctx, out); continue; }
      const runs = inlineRuns(n.children, {});
      if (!runs.length) continue;
      const indent = softIndent(runs, n.children);
      out.push(para(runs, ctx, alignOf(n), indent));
    }
  }
  flush();
}

function collectText(nodes: HtmlNode[]): string {
  return nodes.map(n => (isEl(n) ? (n.tag === 'br' ? '\n' : collectText(n.children)) : n.text)).join('');
}

function para(runs: (TextRun | ExternalHyperlink)[], ctx: Ctx, alignment?: (typeof AlignmentType)[keyof typeof AlignmentType], indent?: { left: number }): Paragraph {
  const left = ctx.quote * 720 + (indent?.left ?? 0);
  return new Paragraph({
    children: runs,
    alignment,
    indent: left ? { left } : undefined,
    border: ctx.quote ? { left: { style: BorderStyle.SINGLE, size: 12, space: 8, color: 'AAAAAA' } } : undefined,
    spacing: { after: 120 },
    ...(ctx.list ? listProps(ctx.list) : {}),
  });
}

function listProps(l: { ordered: boolean; level: number; instance: number }) {
  return l.ordered ? { numbering: { reference: 'note-ol', level: l.level, instance: l.instance } } : { bullet: { level: l.level } };
}

function listItem(li: Exclude<HtmlNode, { text: string }>, ctx: Ctx, out: Paragraph[]): void {
  const lctx: Ctx = ctx.list ? ctx : { ...ctx, list: { ordered: false, level: 0, instance: 0 } };
  const task = lctx.list!.task || li.attrs['data-type'] === 'taskItem';
  const mark = task ? (li.attrs['data-checked'] === 'true' ? '\u2611 ' : '\u2610 ') : '';
  let first = true;
  let inline: HtmlNode[] = [];
  const emit = (runs: (TextRun | ExternalHyperlink)[], align?: (typeof AlignmentType)[keyof typeof AlignmentType]) => {
    if (!runs.length) return;
    if (first) {
      const r = mark ? [new TextRun({ text: mark }), ...runs] : runs;
      out.push(task
        ? para(r, { quote: lctx.quote }, align, { left: 720 * (lctx.list!.level + 1) })
        : para(r, lctx, align));
      first = false;
    } else {
      out.push(para(runs, { quote: lctx.quote }, align, { left: 720 * (lctx.list!.level + 1) }));
    }
  };
  const flushInline = () => {
    if (inline.some(n => (isEl(n) ? true : n.text.trim()))) emit(inlineRuns(inline, {}));
    inline = [];
  };
  const walk = (nodes: HtmlNode[]) => {
    for (const c of nodes) {
      if (!isEl(c) || !BLOCK_TAGS.has(c.tag)) { inline.push(c); continue; }
      flushInline();
      if (c.tag === 'label') continue;
      if (c.tag === 'p' || c.tag === 'div') {
        if (c.children.some(x => isEl(x) && BLOCK_TAGS.has(x.tag))) walk(c.children);
        else emit(inlineRuns(c.children, {}), alignOf(c));
      } else {
        blocks([c], lctx, out);
      }
    }
  };
  walk(li.children);
  flushInline();
}

export function htmlToParagraphs(html: string, title: string): Paragraph[] {
  olCounter = 0;
  const out: Paragraph[] = [];
  out.push(new Paragraph({
    heading: HeadingLevel.TITLE,
    children: [new TextRun({ text: title, bold: true })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));
  blocks(parseHtml(html), { quote: 0 }, out);
  return out;
}

export async function buildNoteDocx(html: string, title: string): Promise<Buffer> {
  const levels = Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.DECIMAL,
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const doc = new Document({
    numbering: { config: [{ reference: 'note-ol', levels }] },
    sections: [{ properties: {}, children: htmlToParagraphs(html, title) }],
  });
  return Packer.toBuffer(doc);
}
