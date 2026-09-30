import type { GenealogyGraph } from './GenealogyGraph';
import type { GraphLayout, LayoutEdge, LayoutNode, LayoutPoint } from './types';
import {
  NODE_H, edgeStyle, finish, firstVerse, gapNote, keyPersonIds, lineToChristSet, nodeWidth, parentEdge,
  resolvePerson, sameAsEdges,
} from './layoutCommon';

export interface LineageLayoutOptions {
  /**
   * Lineages to draw, in track order (the first forks above, the second below, ...).
   * Default: `matthew_1` + `luke_3` (the "Line to Christ": shared spine Adam..David, Matthew
   * above, Luke below, rejoining at Jesus) when both exist, else every lineage with at least
   * one step in the graph.
   */
  lineageIds?: string[];
  highlightLineToChrist?: boolean;
  /** Horizontal gap between nodes (default 28). */
  gap?: number;
  /** Vertical distance between tracks (default 84). */
  laneHeight?: number;
}

interface Pos { pid: string; key: string; verseId?: number; gap?: string[] }
interface Seq { lid: string; pos: Pos[] }
interface Segment { seq: number; left: string | null; right: string | null; keys: string[] }
interface Interval { seq: number; a: number; b: number; seg?: Segment; own: string[] }

/**
 * Horizontal lineage layout, oldest on the left. Persons shared by several lineages are laid
 * once on the main track (y = 0); stretches where the lineages differ fork onto separate tracks
 * and rejoin at the next shared person, the shorter fork stretched so shared persons line up.
 * Node ids are person ids, except for a person placed more than once (order conflict), whose
 * nodes are `personId@lineageId`. Coordinates: node x/y are centres.
 */
export function layoutLineage(g: GenealogyGraph, opts: LineageLayoutOptions = {}): GraphLayout {
  const GAP = opts.gap ?? 28;
  const LANE = opts.laneHeight ?? 84;
  const highlight = opts.highlightLineToChrist !== false;

  const hasSteps = (lid: string) => !!g.lineage(lid)?.steps.some(s => g.has(s.personId));
  let ids = opts.lineageIds
    ?? (hasSteps('matthew_1') && hasSteps('luke_3')
      ? ['matthew_1', 'luke_3']
      : g.lineages().filter(l => hasSteps(l.id)).map(l => l.id));
  ids = [...new Set(ids)].filter(hasSteps);
  const spine = ids.includes('matthew_1') && ids.includes('luke_3');
  const adam = resolvePerson(g, 'adam');

  // 1. Sequences in drawn (oldest -> youngest) order. `gap` sits on the node after the gap.
  const seqs: Seq[] = ids.map(lid => {
    const l = g.lineage(lid)!;
    const steps = l.steps.filter(s => g.has(s.personId));
    const pos: Pos[] = [];
    if (l.direction === 'ascending') {
      // Text step j+1's gap lies between text j and j+1, i.e. just before drawn text j.
      for (let j = steps.length - 1; j >= 0; j--) {
        const later = steps[j + 1];
        pos.push({ pid: steps[j].personId, key: '', verseId: steps[j].verseId, gap: later?.gapBefore?.length ? later.gapBefore : undefined });
      }
    } else {
      for (const s of steps) pos.push({ pid: s.personId, key: '', verseId: s.verseId, gap: s.gapBefore?.length ? s.gapBefore : undefined });
    }
    if (pos.length) pos[0].gap = undefined;
    if (spine && lid === 'luke_3' && adam) {
      const a = pos.findIndex(p => p.pid === adam);
      if (a > 0) { pos.splice(0, a); pos[0].gap = undefined; }
    }
    return { lid, pos };
  });

  // 2. Merge into one linear order; shared persons are matched by LIS so the order stays consistent.
  const order: string[] = [];
  const members = new Map<string, Set<number>>();
  const keyPid = new Map<string, string>();
  seqs.forEach((sq, k) => {
    const idx = new Map(order.map((key, i) => [key, i]));
    const used = new Set<string>();
    const cand: number[] = [];
    sq.pos.forEach((p, i) => {
      if (idx.has(p.pid) && !used.has(p.pid)) { cand.push(i); used.add(p.pid); }
    });
    const matched = new Set(lis(cand, i => idx.get(sq.pos[i].pid)!));
    const pending: string[] = [];
    const flush = (beforeKey: string | null) => {
      if (!pending.length) return;
      order.splice(beforeKey === null ? order.length : order.indexOf(beforeKey), 0, ...pending);
      pending.length = 0;
    };
    sq.pos.forEach((p, i) => {
      if (matched.has(i)) {
        p.key = p.pid;
        flush(p.key);
      } else {
        let key = keyPid.has(p.pid) ? `${p.pid}@${sq.lid}` : p.pid;
        for (let n = 2; keyPid.has(key); n++) key = `${p.pid}@${sq.lid}#${n}`;
        p.key = key;
        keyPid.set(key, p.pid);
        pending.push(key);
      }
      const m = members.get(p.key);
      if (m) m.add(k); else members.set(p.key, new Set([k]));
    });
    flush(null);
  });
  const shared = (key: string) => (members.get(key)?.size ?? 0) >= 2;

  // 3. Nodes.
  const keyIds = keyPersonIds(g);
  const onLine = highlight ? lineToChristSet(g) : new Set<string>();
  const nodes = new Map<string, LayoutNode>();
  for (const key of order) {
    const pid = keyPid.get(key)!;
    const person = g.person(pid)!;
    nodes.set(key, {
      id: key, personId: pid, label: person.name, x: 0, y: 0, w: nodeWidth(person.name), h: NODE_H,
      importance: keyIds.has(pid) ? 0 : 1, sex: person.sex, colorKey: person.tribe,
      flags: {
        lineages: [...members.get(key)!].sort((a, b) => a - b).map(k => seqs[k].lid),
        ...(onLine.has(pid) ? { onLineToChrist: true } : {}),
        ...(person.kind === 'group' ? { group: true } : {}),
      },
    });
  }
  const span = (ks: string[]) => ks.reduce((s, key) => s + nodes.get(key)!.w, 0);

  // 4. Segments, and x of shared persons (serialised along the main track).
  const segs: Segment[] = [];
  const need = new Map<string, Map<string, number>>(); // right anchor -> left anchor -> min centre distance
  seqs.forEach((sq, k) => {
    let left: string | null = null;
    let cur: string[] = [];
    const close = (right: string | null) => {
      if (cur.length) segs.push({ seq: k, left, right, keys: cur });
      if (left !== null && right !== null) {
        const d = span(cur) + (cur.length + 1) * GAP + nodes.get(left)!.w / 2 + nodes.get(right)!.w / 2;
        const m = need.get(right) ?? new Map<string, number>();
        m.set(left, Math.max(m.get(left) ?? 0, d));
        need.set(right, m);
      }
    };
    for (const p of sq.pos) {
      if (shared(p.key)) { close(p.key); left = p.key; cur = []; } else cur.push(p.key);
    }
    close(null);
  });
  const sharedOrder = order.filter(shared);
  let prev: LayoutNode | null = null;
  for (const s of sharedOrder) {
    const n = nodes.get(s)!;
    let x = 0;
    if (prev === null) {
      for (const sg of segs) if (sg.left === null && sg.right === s) x = Math.max(x, span(sg.keys) + sg.keys.length * GAP);
      x += n.w / 2;
    } else {
      x = prev.x + prev.w / 2 + GAP + n.w / 2;
      for (const [a, d] of need.get(s) ?? []) x = Math.max(x, nodes.get(a)!.x + d);
    }
    n.x = x;
    prev = n;
  }

  // 5. Place segments (stretched between anchors) and choose tracks.
  const intervals: Interval[] = [];
  for (const sg of segs) {
    const ns = sg.keys.map(key => nodes.get(key)!);
    const A = sg.left !== null ? nodes.get(sg.left)! : null;
    const B = sg.right !== null ? nodes.get(sg.right)! : null;
    if (A && B) {
      const gap = ((B.x - B.w / 2) - (A.x + A.w / 2) - span(sg.keys)) / (ns.length + 1);
      let x = A.x + A.w / 2 + gap;
      for (const n of ns) { n.x = x + n.w / 2; x += n.w + gap; }
      intervals.push({ seq: sg.seq, a: A.x, b: B.x, seg: sg, own: [A.id, B.id] });
    } else if (B) {
      let x = B.x - B.w / 2 - GAP;
      for (let i = ns.length - 1; i >= 0; i--) { ns[i].x = x - ns[i].w / 2; x -= ns[i].w + GAP; }
      intervals.push({ seq: sg.seq, a: ns[0].x - ns[0].w / 2, b: B.x, seg: sg, own: [B.id] });
    } else {
      let x = A ? A.x + A.w / 2 + GAP : 0;
      for (const n of ns) { n.x = x + n.w / 2; x += n.w + GAP; }
      const last = ns[ns.length - 1];
      intervals.push({ seq: sg.seq, a: A ? A.x : ns[0].x - ns[0].w / 2, b: last.x + last.w / 2, seg: sg, own: A ? [A.id] : [] });
    }
  }
  // Direct links between two shared persons also occupy the main track.
  seqs.forEach((sq, k) => {
    for (let i = 1; i < sq.pos.length; i++) {
      const u = sq.pos[i - 1].key, v = sq.pos[i].key;
      if (shared(u) && shared(v)) intervals.push({ seq: k, a: nodes.get(u)!.x, b: nodes.get(v)!.x, own: [u, v] });
    }
  });
  for (const iv of intervals) {
    if (!iv.seg) continue;
    const clash = intervals.some(o => o !== iv && o.seq !== iv.seq && Math.max(o.a, iv.a) < Math.min(o.b, iv.b))
      || sharedOrder.some(s => {
        if (iv.own.includes(s)) return false;
        const n = nodes.get(s)!;
        return Math.max(n.x - n.w / 2, iv.a) < Math.min(n.x + n.w / 2, iv.b);
      });
    const y = clash ? laneOf(iv.seg.seq) * LANE : 0;
    for (const key of iv.seg.keys) nodes.get(key)!.y = y;
  }

  // 6. Flags: gap notes, and persons one text inserts where another goes straight on.
  for (const sq of seqs) for (const p of sq.pos) if (p.gap) nodes.get(p.key)!.flags.gapNote = gapNote(g, p.gap);
  const compare: { lid: string; pids: string[] }[] = seqs.map(s => ({ lid: s.lid, pids: s.pos.map(p => p.pid) }));
  if (spine) {
    const pids: string[] = [];
    for (const id of ['genesis_5', 'genesis_11']) {
      const l = g.lineage(id);
      if (!l) continue;
      for (const s of l.direction === 'ascending' ? [...l.steps].reverse() : l.steps) if (!pids.includes(s.personId)) pids.push(s.personId);
    }
    if (pids.length) compare.push({ lid: 'genesis', pids });
  }
  for (const sq of seqs) {
    for (const other of compare) {
      if (other.lid === sq.lid) continue;
      const idx = new Map(other.pids.map((p, i) => [p, i]));
      sq.pos.forEach((p, i) => {
        if (idx.has(p.pid)) return;
        let j = i - 1; while (j >= 0 && !idx.has(sq.pos[j].pid)) j--;
        let k = i + 1; while (k < sq.pos.length && !idx.has(sq.pos[k].pid)) k++;
        if (j >= 0 && k < sq.pos.length && idx.get(sq.pos[k].pid)! - idx.get(sq.pos[j].pid)! === 1) {
          nodes.get(p.key)!.flags.oneTextOnly = true;
        }
      });
    }
  }

  // 7. Edges.
  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const sq of seqs) {
    const asc = g.lineage(sq.lid)!.direction === 'ascending';
    for (let i = 1; i < sq.pos.length; i++) {
      const pu = sq.pos[i - 1], pv = sq.pos[i];
      const id = `${pu.key}->${pv.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const u = nodes.get(pu.key)!, v = nodes.get(pv.key)!;
      const stored = parentEdge(g, pu.pid, pv.pid);
      const gap = !!pv.gap;
      edges.push({
        id, from: u.id, to: v.id, points: hPoints(u, v),
        style: gap ? 'dashed' : edgeStyle(stored),
        kind: gap ? 'gap' : 'parent',
        ...(u.flags.onLineToChrist && v.flags.onLineToChrist ? { onLineToChrist: true } : {}),
        verseId: firstVerse(stored) ?? (asc ? pu.verseId : pv.verseId),
      });
    }
  }
  const byPerson = new Map<string, LayoutNode[]>();
  for (const n of nodes.values()) { const l = byPerson.get(n.personId); if (l) l.push(n); else byPerson.set(n.personId, [n]); }
  edges.push(...sameAsEdges(g, byPerson, seen));

  // Every placement of a person placed twice carries '@lineageId' (the first one is renamed here).
  const taken = new Set(nodes.keys());
  const rename = new Map<string, string>();
  for (const [pid, list] of byPerson) {
    if (list.length < 2) continue;
    const orig = list.find(n => n.id === pid);
    if (!orig) continue;
    let id = `${pid}@${orig.flags.lineages![0]}`;
    for (let n = 1; taken.has(id); n++) id = `${pid}@${orig.flags.lineages![0]}#${n}`;
    taken.add(id);
    rename.set(orig.id, id);
  }
  if (rename.size) {
    for (const n of nodes.values()) n.id = rename.get(n.id) ?? n.id;
    for (const e of edges) { e.from = rename.get(e.from) ?? e.from; e.to = rename.get(e.to) ?? e.to; }
  }
  return finish([...nodes.values()], edges);
}

/** Track of lineage k when it must fork: -1 (above), +1 (below), -2, +2, ... */
function laneOf(k: number): number {
  const n = Math.floor(k / 2) + 1;
  return k % 2 === 0 ? -n : n;
}

function hPoints(u: LayoutNode, v: LayoutNode): LayoutPoint[] {
  const x1 = u.x + u.w / 2, x2 = v.x - v.w / 2;
  if (u.y === v.y) return [{ x: x1, y: u.y }, { x: x2, y: v.y }];
  const mx = (x1 + x2) / 2;
  return [{ x: x1, y: u.y }, { x: mx, y: u.y }, { x: mx, y: v.y }, { x: x2, y: v.y }];
}

/** Longest strictly increasing subsequence of `items` by `val`, in order. */
function lis<T>(items: T[], val: (t: T) => number): T[] {
  const tails: number[] = [];
  const prev: number[] = new Array(items.length).fill(-1);
  for (let i = 0; i < items.length; i++) {
    const v = val(items[i]);
    let lo = 0, hi = tails.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (val(items[tails[m]]) < v) lo = m + 1; else hi = m; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out: T[] = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.push(items[i]);
  return out.reverse();
}
