/**
 * Changes between two snapshots, in a few lines:
 *
 *   url: /read/John.3 → /read/John.4
 *   + [r40] dialog "Settings" (+12 inside)
 *       [r41] button "Close"
 *   - [r7] button "Open"
 *   ~ [r2] searchbox "Search": ="lo" → ="love"
 *   ~ [r20] main: 31 changed, +5, -2
 *
 * Nodes are matched by ref (refs are stable, see runtime.js); text lines by
 * their parent and position. Many changes under one parent fold into one line.
 */
import type { PageSnapshot, RawNode } from './types.ts';
import { countNodes, headerLine, nodeLine } from './render.ts';

interface Flat {
  key: string;
  parent: string;
  node: RawNode;
  order: number;
}

function flatten(root: RawNode): Map<string, Flat> {
  const out = new Map<string, Flat>();
  let order = 0;
  const visit = (n: RawNode, parentKey: string) => {
    let t = 0;
    for (const k of n.children ?? []) {
      const key = k.ref ?? `${parentKey}/t${t++}`;
      out.set(key, { key, parent: parentKey, node: k, order: order++ });
      visit(k, key);
    }
  };
  visit(root, '');
  return out;
}

const q = (s: string | undefined) => JSON.stringify(s ?? '');

/** What changed on a node itself (not its children), or '' when nothing did. */
export function nodeChange(a: RawNode, b: RawNode): string {
  if (a.role === 'text' || b.role === 'text') return a.name === b.name ? '' : `${q(b.name)} (was ${q(a.name)})`;
  const parts: string[] = [];
  if (a.role !== b.role || a.level !== b.level) parts.push(`role ${a.role} → ${b.role}`);
  if (a.name !== b.name) parts.push(`name ${q(a.name)} → ${q(b.name)}`);
  if (a.value !== b.value) parts.push(`=${q(a.value)} → =${q(b.value)}`);
  const sa = new Set(a.states ?? []);
  const sb = new Set(b.states ?? []);
  const plus = [...sb].filter(s => !sa.has(s)).map(s => '+' + s);
  const minus = [...sa].filter(s => !sb.has(s)).map(s => '-' + s);
  if (plus.length || minus.length) parts.push([...plus, ...minus].join(' '));
  if (!parts.length) return '';
  const label = nodeLine({ ...b, value: undefined, states: undefined, children: undefined, name: a.name === b.name ? b.name : undefined });
  return `${label}: ${parts.join(', ')}`;
}

export interface DiffOpts {
  /** Line cap (default 12). */
  max?: number;
  /** Changes under one parent before they fold into a summary (default 4). */
  fold?: number;
}

export function diffSnapshots(prev: PageSnapshot | undefined, cur: PageSnapshot, opts: DiffOpts = {}): string[] {
  const max = opts.max ?? 12;
  const fold = opts.fold ?? 4;
  const head: string[] = [];
  if (!prev) return [headerLine(cur), '(no earlier snapshot: everything is new; run snapshot)'];
  if (prev.url !== cur.url) head.push(`url: ${short(prev.url)} → ${short(cur.url)}`);
  if (prev.title !== cur.title) head.push(`title: ${q(cur.title)}`);
  if (prev.focus !== cur.focus) head.push(`focus: ${prev.focus} → ${cur.focus}`);
  if (prev.vw !== cur.vw || prev.vh !== cur.vh) head.push(`viewport: ${cur.vw}x${cur.vh}`);

  const a = flatten(prev.root);
  const b = flatten(cur.root);

  interface Change { parent: string; order: number; kind: '+' | '-' | '~'; lines: string[] }
  const changes: Change[] = [];

  for (const [key, f] of b) {
    const old = a.get(key);
    if (!old) {
      if (b.has(f.parent) && !a.has(f.parent)) continue; // inside an added subtree
      const inside = countNodes(f.node);
      const lines = [`+ ${nodeLine(f.node)}` + (inside ? ` (+${inside} inside)` : '')];
      for (const k of (f.node.children ?? []).slice(0, inside > 3 ? 3 : inside)) lines.push(`    ${nodeLine(k)}`);
      changes.push({ parent: f.parent, order: f.order, kind: '+', lines });
    } else {
      const c = nodeChange(old.node, f.node);
      if (c) changes.push({ parent: f.parent, order: f.order, kind: '~', lines: [`~ ${c}`] });
    }
  }
  for (const [key, f] of a) {
    if (b.has(key)) continue;
    if (a.has(f.parent) && !b.has(f.parent)) continue; // inside a removed subtree
    const inside = countNodes(f.node);
    changes.push({ parent: f.parent, order: f.order + 0.5, kind: '-', lines: [`- ${nodeLine(f.node)}` + (inside ? ` (+${inside} inside)` : '')] });
  }

  // Fold parents with many changes.
  const byParent = new Map<string, Change[]>();
  for (const c of changes) {
    const list = byParent.get(c.parent) ?? [];
    list.push(c);
    byParent.set(c.parent, list);
  }
  const out: { order: number; lines: string[] }[] = [];
  for (const [parent, list] of byParent) {
    if (list.length > fold) {
      const n = (k: string) => list.filter(c => c.kind === k).length;
      const p = b.get(parent)?.node ?? a.get(parent)?.node;
      const label = p ? nodeLine({ ...p, children: undefined, value: undefined, states: undefined }) : 'page';
      const bits = [n('~') ? `${n('~')} changed` : '', n('+') ? `+${n('+')}` : '', n('-') ? `-${n('-')}` : ''].filter(Boolean);
      const first = list.find(c => c.kind !== '-') ?? list[0];
      out.push({ order: Math.min(...list.map(c => c.order)), lines: [`~ ${label}: ${bits.join(', ')}; first: ${first.lines[0].slice(2, 80)}`] });
    } else {
      for (const c of list) out.push({ order: c.order, lines: c.lines });
    }
  }
  out.sort((x, y) => x.order - y.order);

  const body: string[] = [];
  let hidden = 0;
  for (const o of out) {
    if (body.length + head.length >= max) { hidden += 1; continue; }
    body.push(...o.lines);
  }
  if (hidden) body.push(`… +${hidden} more changes (snapshot)`);
  const all = [...head, ...body];
  return all.length ? all : ['no changes'];
}

function short(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return u.pathname.split('/').slice(-1)[0] + u.hash;
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}
