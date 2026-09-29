import type { GenealogyGraph } from './GenealogyGraph';
import type { GraphLayout, LayoutEdge, LayoutNode } from './types';
import {
  H_GAP, ROW_H, TreeNode, countReachable, extraEdges, finish, firstVerse, keyPersonIds, lineToChristSet,
  lineagesByPerson, measureTree, pairKey, personNode, placeTree, resolvePerson, sameAsEdges, treeEdge,
  verticalPoints,
} from './layoutCommon';

export interface TribesLayoutOptions {
  /** Order of the tribes (KJV): Gen 49 (default), Num 26 or Rev 7. */
  list?: 'gen_49' | 'num_26' | 'rev_7';
  /** Generations shown below each tribe head (default 2). */
  depth?: number;
  collapsed?: string[];
  highlightLineToChrist?: boolean;
}

/** Tribe heads per list, as in the KJV (ids or names; matched case-insensitively). */
export const TRIBE_LISTS: Record<'gen_49' | 'num_26' | 'rev_7', string[]> = {
  gen_49: ['Reuben', 'Simeon', 'Levi', 'Judah', 'Zebulun', 'Issachar', 'Dan', 'Gad', 'Asher', 'Naphtali', 'Joseph', 'Benjamin'],
  num_26: ['Reuben', 'Simeon', 'Gad', 'Judah', 'Issachar', 'Zebulun', 'Manasseh', 'Ephraim', 'Benjamin', 'Dan', 'Asher', 'Naphtali'],
  rev_7: ['Judah', 'Reuben', 'Gad', 'Asher', 'Naphtali', 'Manasseh', 'Simeon', 'Levi', 'Issachar', 'Zebulun', 'Joseph', 'Benjamin'],
};

/**
 * Jacob on row 0, the mothers of his sons on row 1, the tribe heads (in the chosen list's
 * order) on row 2, then `depth` generations of descendants. colorKey is the mother's id for
 * Jacob's sons and is inherited by their descendants. In Num 26 Joseph sits on a row of his own
 * above Manasseh and Ephraim, and Levi (not numbered with the tribes) stands apart at the end.
 * Missing persons are skipped silently. Node x/y are centres.
 */
export function layoutTribes(g: GenealogyGraph, opts: TribesLayoutOptions = {}): GraphLayout {
  const list = opts.list ?? 'gen_49';
  const depth = opts.depth ?? 2;
  const collapsed = new Set(opts.collapsed ?? []);
  const jacob = resolvePerson(g, 'jacob');
  if (!jacob) return finish([], []);
  const ctx = {
    keys: keyPersonIds(g),
    onLine: opts.highlightLineToChrist === false ? new Set<string>() : lineToChristSet(g),
    lineages: lineagesByPerson(g),
  };

  const sons = g.childIds(jacob);
  const match = (name: string, among: string[]): string | undefined => {
    const k = name.toLowerCase();
    return among.find(id => id.toLowerCase() === k)
      ?? among.find(id => { const p = g.person(id)!; return [p.name, ...(p.aliases ?? [])].some(n => n.toLowerCase() === k); })
      ?? (g.has(k) ? k : undefined);
  };
  const joseph = match('Joseph', sons);
  const josephKids = joseph ? g.childIds(joseph) : [];
  const numbered = list === 'num_26';

  const heads: string[] = [];
  for (const name of TRIBE_LISTS[list]) {
    const among = (name === 'Manasseh' || name === 'Ephraim') ? josephKids : sons;
    const id = match(name, among);
    if (id && id !== jacob && !heads.includes(id)) heads.push(id);
  }
  const levi = numbered ? match('Levi', sons) : undefined;
  if (levi && !heads.includes(levi)) heads.push(levi);

  // Mothers of Jacob's sons: stated wives first (dataset order), then any other mother.
  const wives: string[] = [];
  for (const w of g.spouseIds(jacob)) if (sons.some(s => g.motherId(s) === w)) wives.push(w);
  for (const s of sons) { const m = g.motherId(s); if (m && !wives.includes(m)) wives.push(m); }
  const motherOfHead = (h: string) => g.motherId(h) ?? (josephKids.includes(h) && joseph ? g.motherId(joseph) : undefined);

  const placed = new Map<string, LayoutNode>();
  const claim = (pid: string, o: { important?: boolean; colorKey?: string } = {}) => {
    const n = personNode(g, pid, ctx, o);
    placed.set(pid, n);
    return n;
  };
  const jacobNode = claim(jacob, { important: true, colorKey: undefined });
  jacobNode.colorKey = undefined;
  const wifeNodes = wives.map(w => claim(w, { important: true, colorKey: w }));
  const josephRow = numbered && joseph && heads.some(h => josephKids.includes(h)) && !heads.includes(joseph);
  const josephNode = josephRow ? claim(joseph!, { important: true, colorKey: g.motherId(joseph!) }) : undefined;
  const headRow = josephRow ? 3 : 2;

  const trees: TreeNode[] = [];
  for (const h of heads) {
    if (placed.has(h)) continue;
    trees.push({ node: claim(h, { important: true, colorKey: motherOfHead(h) }), kids: [] });
  }
  // Descendants, preferring those of the head's tribe.
  const treeLinks: [LayoutNode, LayoutNode][] = [];
  const buildDown = (t: TreeNode, level: number, tribe: string) => {
    const pid = t.node.personId;
    const cs = [...g.childIds(pid)];
    cs.sort((a, b) => Number(g.person(b)!.tribe === tribe) - Number(g.person(a)!.tribe === tribe));
    if (!cs.length) return;
    if (level >= depth || collapsed.has(pid)) {
      const hidden = countReachable(pid, x => g.childIds(x));
      if (hidden) t.node.flags.collapsed = hidden;
      return;
    }
    for (const c of cs) {
      if (placed.has(c)) continue;
      const kid: TreeNode = { node: claim(c, { colorKey: t.node.colorKey }), kids: [] };
      t.kids.push(kid);
      treeLinks.push([t.node, kid.node]);
      buildDown(kid, level + 1, tribe);
    }
  };
  for (const t of trees) buildDown(t, 0, g.person(t.node.personId)!.tribe ?? t.node.personId);

  // Positions: tribe heads left to right (Levi apart in Num 26), then the rows above.
  let x = 0;
  for (const t of trees) {
    if (numbered && t.node.personId === levi && trees.length > 1) x += 3 * H_GAP;
    measureTree(t);
    placeTree(t, x, headRow * ROW_H, ROW_H);
    x += t.width! + H_GAP;
  }
  const centreOf = (ns: LayoutNode[]) => ns.reduce((s, n) => s + n.x, 0) / ns.length;
  if (josephNode) {
    const kids = trees.filter(t => josephKids.includes(t.node.personId)).map(t => t.node);
    josephNode.x = centreOf(kids);
    josephNode.y = 2 * ROW_H;
  }
  const headNodes = trees.map(t => t.node);
  const childrenOfWife = (w: string) => [
    ...headNodes.filter(n => g.motherId(n.personId) === w),
    ...(josephNode && g.motherId(josephNode.personId) === w ? [josephNode] : []),
  ];
  // Wives over their sons, then swept apart left to right.
  const want = wifeNodes.map((n, i) => ({ n, i, x: childrenOfWife(n.personId).length ? centreOf(childrenOfWife(n.personId)) : Infinity }));
  let fallback = headNodes.length ? Math.max(...headNodes.map(n => n.x + n.w / 2)) : 0;
  for (const wv of want) if (wv.x === Infinity) { wv.x = fallback + H_GAP + wv.n.w / 2; fallback = wv.x + wv.n.w / 2; }
  want.sort((a, b) => a.x - b.x || a.i - b.i);
  let right = -Infinity;
  for (const wv of want) {
    wv.n.x = Math.max(wv.x, right + H_GAP + wv.n.w / 2);
    wv.n.y = ROW_H;
    right = wv.n.x + wv.n.w / 2;
  }
  jacobNode.x = wifeNodes.length ? centreOf(wifeNodes) : headNodes.length ? centreOf(headNodes) : 0;
  jacobNode.y = 0;

  // Edges.
  const edges: LayoutEdge[] = [];
  const drawn = new Set<string>();
  const add = (e: LayoutEdge, a: string, b: string) => { edges.push(e); drawn.add(pairKey(a, b)); };
  for (const w of wifeNodes) {
    const se = g.spouses(jacob).find(e => e.from === w.personId || e.to === w.personId);
    add({ id: `spouse:${jacobNode.id}-${w.id}`, from: jacobNode.id, to: w.id, points: verticalPoints(jacobNode, w), style: 'solid', kind: 'spouse', verseId: firstVerse(se) }, jacob, w.personId);
  }
  const treeParent = new Map<string, LayoutNode>();
  for (const n of [...headNodes, ...(josephNode ? [josephNode] : [])]) {
    const m = g.motherId(n.personId);
    const f = g.fatherId(n.personId);
    const parent = (m && placed.get(m)) ?? (f && placed.get(f)) ?? undefined;
    if (parent && parent.y < n.y) { treeParent.set(n.personId, parent); add(treeEdge(g, parent, n), parent.personId, n.personId); }
  }
  for (const [p, c] of treeLinks) add(treeEdge(g, p, c), p.personId, c.personId);
  // Jacob -> son is implied by Jacob -> wife -> son.
  const skip = (from: string, to: string) => from === jacob && treeParent.get(to)?.personId === g.motherId(to);
  edges.push(...extraEdges(g, placed, drawn, skip));
  edges.push(...sameAsEdges(g, new Map([...placed].map(([pid, n]) => [pid, [n]])), new Set()));
  return finish([...placed.values()], edges);
}
