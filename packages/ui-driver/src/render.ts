/**
 * Turns the page's RawNode tree into the compact text agents read.
 *
 *   [r12] button "Search" disabled
 *   [r3] textbox "Query" ="love"
 *   [r7] heading/2 "John 3"
 *   "For God so loved the world…"
 *
 * Budget rules keep a full screen under ~2k tokens: long child lists are cut to
 * their first items plus a count, and the whole output stops at `max` lines
 * with a count of what was left out.
 */
import type { PageSnapshot, RawNode } from './types.ts';

export interface RenderOpts {
  /** Deepest level printed; deeper content is summarised as `(+N inside)`. */
  depth?: number;
  /** Line budget (default 150). */
  max?: number;
  /** Children shown before a list is collapsed (default 10). */
  listMax?: number;
  /** No list collapsing and no line budget. */
  all?: boolean;
}

const q = (s: string) => JSON.stringify(s);

/** One node as one line, without indentation. */
export function nodeLine(n: RawNode): string {
  if (n.role === 'text') return q(n.name ?? '');
  let s = n.ref ? `[${n.ref}] ` : '';
  s += n.role;
  if (n.level) s += `/${n.level}`;
  if (n.name) s += ' ' + q(n.name);
  if (n.value !== undefined) s += ' =' + q(n.value);
  if (n.states?.length) s += ' ' + n.states.join(' ');
  return s;
}

/** Number of nodes below `n`. */
export function countNodes(n: RawNode): number {
  let c = 0;
  for (const k of n.children ?? []) c += 1 + countNodes(k);
  return c;
}

function roleSummary(nodes: RawNode[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.role, (counts.get(n.role) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, c]) => `${r}×${c}`).join(', ');
}

/** Render the children of `root` (the page node or a scoped element). */
export function renderTree(root: RawNode, opts: RenderOpts = {}): string[] {
  const max = opts.all ? Infinity : opts.max ?? 150;
  const listMax = opts.all ? Infinity : opts.listMax ?? 10;
  const depthMax = opts.depth ?? Infinity;
  const lines: string[] = [];
  let left = 0; // nodes not printed because the budget ran out

  const visit = (n: RawNode, depth: number) => {
    if (lines.length >= max) { left += 1 + countNodes(n); return; }
    const pad = '  '.repeat(depth);
    const kids = n.children ?? [];
    let line = pad + nodeLine(n);
    if (kids.length && depth >= depthMax) {
      line += ` (+${countNodes(n)} inside)`;
      lines.push(line);
      return;
    }
    lines.push(line);
    visitList(kids, depth + 1);
  };

  const visitList = (kids: RawNode[], depth: number) => {
    if (kids.length <= listMax + 2) { for (const k of kids) visit(k, depth); return; }
    const head = kids.slice(0, listMax - 1);
    const tail = kids[kids.length - 1];
    const mid = kids.slice(listMax - 1, -1);
    for (const k of head) visit(k, depth);
    if (lines.length < max) {
      lines.push('  '.repeat(depth) + `… +${mid.length} more (${roleSummary(mid)})`);
    } else {
      left += mid.reduce((a, k) => a + 1 + countNodes(k), 0);
    }
    visit(tail, depth);
  };

  if (root.role === 'page') visitList(root.children ?? [], 0);
  else visit(root, 0);
  if (left > 0) lines.push(`… +${left} more nodes (snapshot rN for a part, --max N, --all)`);
  return lines;
}

/** Header line: title, path, viewport, focus. */
export function headerLine(s: PageSnapshot): string {
  let path = s.url;
  try {
    const u = new URL(s.url);
    path = u.protocol === 'file:' ? u.pathname.split('/').slice(-2).join('/') + u.hash : u.pathname + u.search + u.hash;
  } catch { /* keep the raw url */ }
  return `page ${q(s.title)} ${path} ${s.vw}x${s.vh}` + (s.focus !== 'body' ? ` focus=${s.focus}` : '') + (s.modalOnly ? ' (modal only; snapshot without --visible for the rest)' : '');
}

export function renderSnapshot(s: PageSnapshot, opts: RenderOpts = {}): string {
  const lines = renderTree(s.root, opts);
  return [headerLine(s), ...(lines.length ? lines : ['(empty)'])].join('\n');
}

/** ref -> its line, for stale-ref messages. */
export function refLines(root: RawNode, into: Map<string, string> = new Map()): Map<string, string> {
  for (const k of root.children ?? []) {
    if (k.ref) into.set(k.ref, nodeLine(k));
    refLines(k, into);
  }
  return into;
}

/** `find`: nodes whose name or value contains `text` (case-insensitive), with their nearest ref'd ancestor. */
export function findNodes(root: RawNode, text: string, role?: string, limit = 15): string {
  const needle = text.toLowerCase();
  const hits: string[] = [];
  let total = 0;
  const visit = (n: RawNode, parent: RawNode | null) => {
    for (const k of n.children ?? []) {
      const hay = `${k.name ?? ''} ${k.value ?? ''}`.toLowerCase();
      if ((!role || k.role === role) && hay.includes(needle)) {
        total++;
        if (hits.length < limit) {
          const ctx = parent && parent.role !== 'page' ? `  < ${nodeLine({ ...parent, children: undefined, states: undefined, value: undefined })}` : '';
          hits.push(nodeLine(k) + ctx);
        }
      }
      visit(k, k.ref ? k : parent);
    }
  };
  visit(root, null);
  if (!total) return `no match for ${q(text)}`;
  return hits.join('\n') + (total > hits.length ? `\n… +${total - hits.length} more` : '');
}
