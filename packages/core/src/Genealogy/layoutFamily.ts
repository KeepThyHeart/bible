import type { GenealogyGraph } from './GenealogyGraph';
import type { GraphLayout, LayoutEdge, LayoutNode } from './types';
import {
  H_GAP, ROW_H, TreeNode, countReachable, extraEdges, finish, firstVerse, keyPersonIds, lineToChristSet,
  lineagesByPerson, measureTree, pairKey, personNode, placeForest, placeTree, sameAsEdges, sidePoints, treeEdge,
} from './layoutCommon';

export interface FamilyLayoutOptions {
  /** Ancestor generations shown above the focus (default 3). */
  up?: number;
  /** Descendant generations shown below the focus (default 2). */
  down?: number;
  /** Trace ancestors through mothers too (default true); else fathers only. */
  showMothers?: boolean;
  /** Person ids whose branch is folded (ancestors above an ancestor, descendants below a descendant). */
  collapsed?: string[];
  highlightLineToChrist?: boolean;
}

/**
 * Hourglass around one person: ancestors above (row -1, -2, ...), the focus and spouses on
 * row 0, descendants below with each person's children grouped by the other parent, in birth
 * order. Tidy layout by recursive width allocation: deterministic and non-overlapping. A person
 * is placed once; further links to them are dashed 'cross' edges. Node x/y are centres.
 */
export function layoutFamily(g: GenealogyGraph, focusId: string, opts: FamilyLayoutOptions = {}): GraphLayout {
  if (!g.has(focusId)) return finish([], []);
  const up = opts.up ?? 3;
  const down = opts.down ?? 2;
  const showMothers = opts.showMothers !== false;
  const collapsed = new Set(opts.collapsed ?? []);
  const ctx = {
    keys: keyPersonIds(g),
    onLine: opts.highlightLineToChrist === false ? new Set<string>() : lineToChristSet(g),
    lineages: lineagesByPerson(g),
  };

  const placed = new Map<string, LayoutNode>();
  const claim = (pid: string, important = false) => {
    const n = personNode(g, pid, ctx, { important });
    placed.set(pid, n);
    return n;
  };
  const edges: LayoutEdge[] = [];
  const drawn = new Set<string>();
  const treeLinks: [LayoutNode, LayoutNode][] = []; // parent, child

  const focus = claim(focusId, true);
  focus.flags.focus = true;

  // Spouses: stated marriages, then any other parent of the focus's children.
  const spouses: string[] = [...g.spouseIds(focusId)];
  const other = (child: string, parent: string) => {
    const f = g.fatherId(child), m = g.motherId(child);
    if (f === parent) return m;
    if (m === parent) return f;
    return g.parentIds(child).find(p => p !== parent);
  };
  for (const c of g.childIds(focusId)) {
    const o = other(c, focusId);
    if (o && !spouses.includes(o)) spouses.push(o);
  }
  const spouseNodes = spouses.filter(s => !placed.has(s)).map(s => claim(s));

  // Ancestors.
  // A person with two listed fathers gets both; the second is expanded one level only (`secondary`).
  const secondary = new Set<string>();
  const parentsOf = (pid: string) => {
    const fathers = uniqIds(g.fatherEdges(pid).map(e => e.from)).slice(0, 2);
    const m = showMothers ? g.motherId(pid) : undefined;
    return [...fathers, m].filter((x): x is string => !!x);
  };
  const buildUp = (t: TreeNode, depth: number) => {
    const pid = t.node.personId;
    const ps = parentsOf(pid);
    if (!ps.length) return;
    if (depth >= up || (pid !== focusId && collapsed.has(pid)) || secondary.has(pid)) {
      const hidden = countReachable(pid, parentsOf);
      if (hidden) t.node.flags.collapsed = hidden;
      return;
    }
    const fatherIds = g.fatherEdges(pid).map(e => e.from);
    for (const p of ps) {
      if (placed.has(p)) continue; // pedigree collapse: drawn as a cross edge later
      const second = fatherIds.length > 1 && fatherIds.indexOf(p) > 0 && p !== g.motherId(pid);
      if (second) secondary.add(p);
      const kid: TreeNode = { node: claim(p), kids: [] };
      t.kids.push(kid);
      treeLinks.push([kid.node, t.node]);
      buildUp(kid, depth + 1);
    }
  };
  const upRoot: TreeNode = { node: focus, kids: [] };
  buildUp(upRoot, 0);

  // Descendants, grouped by the other parent (spouse order for the focus, else first appearance).
  const groupedChildren = (pid: string): string[] => {
    const groups = new Map<string, string[]>();
    if (pid === focusId) for (const s of spouses) groups.set(s, []);
    for (const c of g.childIds(pid)) {
      const o = other(c, pid) ?? '';
      const list = groups.get(o);
      if (list) list.push(c); else groups.set(o, [c]);
    }
    const unknown = groups.get('') ?? [];
    groups.delete('');
    return [...[...groups.values()].flat(), ...unknown];
  };
  const buildDown = (t: TreeNode, depth: number) => {
    const pid = t.node.personId;
    const cs = g.childIds(pid);
    if (!cs.length) return;
    if (depth >= down || collapsed.has(pid)) {
      const hidden = countReachable(pid, x => g.childIds(x));
      if (hidden) t.node.flags.collapsed = hidden;
      return;
    }
    for (const c of groupedChildren(pid)) {
      if (placed.has(c)) continue;
      const kid: TreeNode = { node: claim(c), kids: [] };
      t.kids.push(kid);
      treeLinks.push([t.node, kid.node]);
      buildDown(kid, depth + 1);
    }
  };
  const downRoot: TreeNode = { node: focus, kids: [] };
  buildDown(downRoot, 0);

  // Positions: ancestors centred over the focus at x = 0; spouses to its right; children centred under the couple row.
  measureTree(upRoot);
  placeTree(upRoot, -upRoot.width! / 2, 0, -ROW_H);
  let x = focus.x + focus.w / 2;
  for (const s of spouseNodes) { s.x = x + H_GAP + s.w / 2; s.y = 0; x = s.x + s.w / 2; }
  const rowCentre = (focus.x - focus.w / 2 + x) / 2;
  for (const k of downRoot.kids) measureTree(k);
  placeForest(downRoot.kids, rowCentre, ROW_H, ROW_H);

  // Edges: tree links, focus marriages, the spouses' links to their children with the focus.
  for (const [p, c] of treeLinks) {
    const edge = treeEdge(g, p, c);
    if (secondary.has(p.personId)) {
      const stored = g.fatherEdges(c.personId).find(e => e.from === p.personId);
      const label = stored?.qualifier ?? stored?.reading;
      if (label && label !== 'default') edge.label = label;
      if (edge.style === 'solid') edge.style = 'dashed';
    }
    edges.push(edge);
    drawn.add(pairKey(p.personId, c.personId));
  }
  for (const s of spouseNodes) {
    const e = g.spouses(focusId).find(e => e.from === s.personId || e.to === s.personId);
    edges.push({ id: `spouse:${focus.id}-${s.id}`, from: focus.id, to: s.id, points: sidePoints(focus, s), style: 'solid', kind: 'spouse', verseId: firstVerse(e) });
    drawn.add(pairKey(focusId, s.personId));
    for (const k of downRoot.kids) {
      if (g.parentIds(k.node.personId).includes(s.personId)) {
        edges.push(treeEdge(g, s, k.node));
        drawn.add(pairKey(s.personId, k.node.personId));
      }
    }
  }
  edges.push(...extraEdges(g, placed, drawn));
  const byPerson = new Map([...placed].map(([pid, n]) => [pid, [n]]));
  edges.push(...sameAsEdges(g, byPerson, new Set()));
  return finish([...placed.values()], edges);
}

function uniqIds(a: string[]): string[] { return [...new Set(a)]; }
