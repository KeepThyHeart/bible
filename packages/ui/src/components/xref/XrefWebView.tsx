/**
 * XrefWebView: force-directed ego network around one verse (the "explore" view of the cross-reference graph).
 *
 * Simulation lifecycle: the d3 simulation and its node objects live in refs, never in state. A new graph is
 * MERGED into the existing nodes (webGraph.ts) so persisting verses keep their positions, then the simulation is
 * re-heated. Renders are driven from ticks: at most one requestAnimationFrame is scheduled, which bumps a version
 * counter. With prefers-reduced-motion the simulation runs to rest synchronously and never animates.
 *
 * Minimum strength is applied by REFETCHING with `EgoOptions.minWeight` (the provider is the source of truth for
 * the "truncated" flag). Pan/zoom is not implemented; the stage always fits the wrapper.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { ForceLink, Simulation } from 'd3-force';
import { bookOf } from '@bible/core/browser';
import type { IXrefGraphProvider, VerseId, XrefGraph } from '@bible/core/browser';
import { defaultFormatRef, sectionVar, usePrefersReducedMotion, useElementSize } from './common';
import type { FormatRef } from './common';
import { edgeWidth, mergeGraph, neighbourInDirection, nodeRadius, rankedNeighbours, truncateLabel } from './webGraph';
import type { ArrowDir, SimLink, SimNode } from './webGraph';

export interface XrefWebViewLabels {
  region: string;
  toolbar: string;
  depth: string;
  /** `{n}` is the depth. */
  depthOption: string;
  minWeight: string;
  back: string;
  releasePins: string;
  /** `{n}` is the number of connections shown. */
  truncated: string;
  loading: string;
  empty: string;
  error: string;
  retry: string;
  graph: string;
  detail: string;
  recentre: string;
  openInReader: string;
  /** `{ref}` is the formatted reference. */
  recentreOn: string;
  selectOn: string;
  /** `{n}` is the degree. */
  connections: string;
  textLoading: string;
  showList: string;
  hideList: string;
  list: string;
  /** `{from}` cites `{to}`. */
  edgeOut: string;
  edgeBoth: string;
  strength: string;
  pinned: string;
}

export const DEFAULT_XREF_WEB_LABELS: XrefWebViewLabels = {
  region: 'Verse web',
  toolbar: 'Verse web controls',
  depth: 'Depth',
  depthOption: '{n}',
  minWeight: 'Minimum strength',
  back: 'Back',
  releasePins: 'Release pins',
  truncated: 'Showing the strongest {n} connections',
  loading: 'Loading connections',
  empty: 'No cross-references for this verse',
  error: 'Could not load the connections',
  retry: 'Retry',
  graph: 'Cross-reference network',
  detail: 'Selected verse',
  recentre: 'Re-centre here',
  openInReader: 'Open in reader',
  recentreOn: 'Re-centre on {ref}',
  selectOn: 'Select {ref}',
  connections: '{n} connections',
  textLoading: 'Loading text',
  showList: 'Show list',
  hideList: 'Hide list',
  list: 'Connected verses, strongest first',
  edgeOut: '{from} cites {to}',
  edgeBoth: '{from} and {to} cite each other',
  strength: 'Strength {n} of 5',
  pinned: 'pinned',
};

export interface XrefWebViewProps {
  provider: Pick<IXrefGraphProvider, 'getEgoGraph'>;
  /** Initial (and re-synced) centre verse. */
  anchor: VerseId;
  onAnchorChange?: (verseId: VerseId) => void;
  onOpenVerse: (verseId: VerseId, endVerseId?: VerseId) => void;
  formatRef?: FormatRef;
  getVerseText?: (verseId: VerseId, endVerseId?: VerseId) => Promise<string | undefined>;
  initialDepth?: 1 | 2 | 3;
  initialMaxNodes?: number;
  labels?: Partial<XrefWebViewLabels>;
  dir?: 'ltr' | 'rtl';
}

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

const ARROWS: Record<string, ArrowDir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

type Load = 'idle' | 'loading' | 'error';

export function XrefWebView({
  provider,
  anchor: anchorProp,
  onAnchorChange,
  onOpenVerse,
  formatRef = defaultFormatRef,
  getVerseText,
  initialDepth = 2,
  initialMaxNodes = 60,
  labels: labelOverrides,
  dir,
}: XrefWebViewProps) {
  const L = useMemo(() => ({ ...DEFAULT_XREF_WEB_LABELS, ...labelOverrides }), [labelOverrides]);
  const reduced = usePrefersReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { width, height } = useElementSize(wrapRef);

  const [anchor, setAnchor] = useState<VerseId>(anchorProp);
  const [history, setHistory] = useState<VerseId[]>([]);
  const [depth, setDepth] = useState<1 | 2 | 3>(initialDepth);
  const [minWeight, setMinWeight] = useState(0);
  // The slider moves freely; the request follows it after a pause, so dragging does not fire one per step.
  const [queryWeight, setQueryWeight] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQueryWeight(minWeight), 250);
    return () => clearTimeout(t);
  }, [minWeight]);
  const [attempt, setAttempt] = useState(0);
  const [graph, setGraph] = useState<XrefGraph | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [selected, setSelected] = useState<VerseId | null>(null);
  const [hoverId, setHoverId] = useState<VerseId | null>(null);
  const [focusId, setFocusId] = useState<VerseId | null>(null);
  const [focused, setFocused] = useState(false);
  const [showList, setShowList] = useState(false);
  const [text, setText] = useState<{ id: VerseId; value: string | undefined } | null>(null);
  const [, setVersion] = useState(0);

  // Refs: the simulation never lives in state.
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const rafRef = useRef<number | null>(null);
  const reqRef = useRef(0);
  const unmountedRef = useRef(false);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const onAnchorChangeRef = useRef(onAnchorChange);
  onAnchorChangeRef.current = onAnchorChange;
  const nodeEls = useRef(new Map<VerseId, SVGGElement>());
  const dragRef = useRef<{ id: VerseId; moved: boolean; sx: number; sy: number } | null>(null);
  const suppressClick = useRef(false);

  const bump = useCallback(() => {
    if (unmountedRef.current) return;
    setVersion((v) => v + 1);
  }, []);

  const spreadRef = useRef(1);

  const scheduleRender = useCallback(() => {
    if (rafRef.current !== null || unmountedRef.current) return;
    const run = () => {
      rafRef.current = null;
      bump();
    };
    rafRef.current = (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(run)
      : (setTimeout(run, 16) as unknown as number));
  }, [bump]);

  // Create the simulation once.
  useEffect(() => {
    unmountedRef.current = false;
    const link = forceLink<SimNode, SimLink>([])
      .id((d) => d.id)
      .distance((l) => (36 + (1 - l.weight) * 90) * spreadRef.current)
      .strength((l) => 0.15 + l.weight * 0.6);
    const sim = forceSimulation<SimNode>([])
      .force('link', link)
      .force('charge', forceManyBody<SimNode>().strength(-140))
      .force('center', forceCenter(0, 0))
      // The pane is wide and short: a stronger pull on y keeps the cloud an ellipse inside it.
      .force('x', forceX<SimNode>(0).strength(0.03))
      .force('y', forceY<SimNode>(0).strength(0.14))
      .force('collide', forceCollide<SimNode>().radius((d) => nodeRadius(d.degree, d.hop) + 4))
      .on('tick', scheduleRender);
    sim.stop();
    if (nodesRef.current.length) {
      sim.nodes(nodesRef.current);
      link.links(linksRef.current);
    }
    simRef.current = sim;
    return () => {
      unmountedRef.current = true;
      reqRef.current += 1;
      sim.on('tick', null);
      sim.stop();
      simRef.current = null;
      if (rafRef.current !== null) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current);
        clearTimeout(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleRender]);

  // Pull the cloud into the shape of the stage: wide stages spread sideways, tall (phone) stages downwards.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || width <= 0 || height <= 0) return;
    const ratio = width / height;
    const clamp = (v: number) => Math.min(0.2, Math.max(0.02, v));
    (sim.force('x') as ReturnType<typeof forceX<SimNode>>).strength(clamp(0.07 / ratio));
    (sim.force('y') as ReturnType<typeof forceY<SimNode>>).strength(clamp(0.055 * ratio));
    if (nodesRef.current.length) sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
  }, [width, height]);

  const applyGraph = useCallback((g: XrefGraph) => {
    const sim = simRef.current;
    const merged = mergeGraph(nodesRef.current, g);
    nodesRef.current = merged.nodes;
    linksRef.current = merged.links;
    if (!sim) return;
    // A busy graph needs more room: spread links and repulsion with the node count so labels stay readable.
    const n = merged.nodes.length;
    spreadRef.current = 1 + Math.min(0.5, n / 120);
    (sim.force('charge') as ReturnType<typeof forceManyBody<SimNode>>).strength(-(140 + Math.min(n, 100) * 2.5));
    const link = sim.force('link') as ForceLink<SimNode, SimLink>;
    link.links([]);
    sim.nodes(merged.nodes);
    link.links(merged.links);
    sim.alpha(0.6);
    if (reducedRef.current) {
      sim.stop();
      sim.tick(300);
    } else {
      sim.restart();
    }
  }, []);

  // Fetch. Only the latest request may apply.
  useEffect(() => {
    const id = ++reqRef.current;
    setLoad('loading');
    new Promise<XrefGraph>((resolve) => {
      resolve(providerRef.current.getEgoGraph(anchor, {
        depth,
        maxNodes: initialMaxNodes,
        ...(queryWeight > 0 ? { minWeight: queryWeight } : {}),
      }));
    }).then(
      (g) => {
        if (unmountedRef.current || id !== reqRef.current) return;
        applyGraph(g);
        setGraph(g);
        setLoad('idle');
        bump();
      },
      () => {
        if (unmountedRef.current || id !== reqRef.current) return;
        setLoad('error');
      },
    );
  }, [anchor, depth, queryWeight, initialMaxNodes, attempt, applyGraph, bump]);

  // Re-sync when the prop changes.
  useEffect(() => {
    if (anchorProp !== anchorRef.current) {
      setHistory((h) => [...h, anchorRef.current]);
      setAnchor(anchorProp);
      setSelected(null);
    }
  }, [anchorProp]);

  const recentre = useCallback((id: VerseId) => {
    if (id === anchorRef.current) return;
    setHistory((h) => [...h, anchorRef.current]);
    setAnchor(id);
    setSelected(null);
    onAnchorChangeRef.current?.(id);
  }, []);

  const goBack = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setAnchor(prev);
    setSelected(null);
    onAnchorChangeRef.current?.(prev);
  };

  // Verse text for the selection.
  useEffect(() => {
    if (selected === null || !getVerseText) return undefined;
    let cancelled = false;
    const node = nodesRef.current.find((n) => n.id === selected);
    Promise.resolve(getVerseText(selected, node?.endVerseId)).then(
      (value) => { if (!cancelled && !unmountedRef.current) setText({ id: selected, value }); },
      () => { if (!cancelled && !unmountedRef.current) setText({ id: selected, value: undefined }); },
    );
    return () => { cancelled = true; };
  }, [selected, getVerseText]);

  // ---- drag / pin ----
  const toSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const scale = rect && rect.width > 0 ? width / rect.width : 1;
    return {
      x: (clientX - (rect?.left ?? 0) - (rect?.width ?? width) / 2) * scale,
      y: (clientY - (rect?.top ?? 0) - (rect?.height ?? height) / 2) * scale,
    };
  };

  const onNodePointerDown = (e: ReactPointerEvent<SVGGElement>, id: VerseId) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragRef.current = { id, moved: false, sx: e.clientX, sy: e.clientY };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* not captured */ }
  };
  const onNodePointerMove = (e: ReactPointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    const node = nodesRef.current.find((n) => n.id === d.id);
    if (!node) return;
    d.moved = true;
    const p = toSvg(e.clientX, e.clientY);
    node.fx = p.x;
    node.fy = p.y;
    if (reducedRef.current) {
      node.x = p.x;
      node.y = p.y;
      bump();
    } else {
      simRef.current?.alphaTarget(0.25).restart();
    }
  };
  const onNodePointerUp = (e: ReactPointerEvent<SVGGElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
    simRef.current?.alphaTarget(0);
    if (d?.moved) {
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      bump();
    }
  };

  const releasePins = () => {
    for (const n of nodesRef.current) { n.fx = null; n.fy = null; }
    if (reducedRef.current) bump();
    else simRef.current?.alpha(0.4).restart();
    bump();
  };

  // ---- keyboard ----
  const focusNode = (id: VerseId) => {
    setFocusId(id);
    nodeEls.current.get(id)?.focus();
  };
  const onNodeKeyDown = (e: KeyboardEvent<SVGGElement>, id: VerseId) => {
    const arrow = ARROWS[e.key];
    if (arrow) {
      e.preventDefault();
      const next = neighbourInDirection(nodesRef.current, id, arrow);
      if (next !== undefined) focusNode(next);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      recentre(id);
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      setSelected(id);
    }
  };
  const onRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && selected !== null) {
      e.stopPropagation();
      setSelected(null);
    }
  };

  // ---- render data ----
  const nodes = nodesRef.current;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const activeId = hoverId ?? (focused ? focusId : null);
  const ref = (id: VerseId, end?: VerseId) => formatRef(id, end);
  const anchorNode = nodeById.get(anchor);
  const tabStop = focusId !== null && nodeById.has(focusId) ? focusId : (anchorNode ? anchor : nodes[0]?.id);
  const ranked = useMemo(() => (graph ? rankedNeighbours(graph) : []), [graph]);
  const pinCount = nodes.reduce((c, n) => c + (n.fx != null ? 1 : 0), 0);
  const selNode = selected !== null ? nodeById.get(selected) : undefined;
  const isEmpty = load === 'idle' && graph !== null && graph.nodes.length <= 1;
  const endOf = (v: unknown): VerseId => (typeof v === 'object' && v !== null ? (v as SimNode).id : (v as VerseId));
  // The active node's neighbours, built once per render (not per node).
  const activeNeighbours = new Set<VerseId>();
  if (activeId !== null) {
    for (const l of linksRef.current) {
      const a = endOf(l.source);
      const b = endOf(l.target);
      if (a === activeId) activeNeighbours.add(b);
      else if (b === activeId) activeNeighbours.add(a);
    }
  }

  const edgeTitle = (l: SimLink) => {
    const from = ref(l.from);
    const to = ref(l.to);
    const dirText = l.direction === 'both'
      ? fill(L.edgeBoth, { from, to })
      : l.direction === 'out' ? fill(L.edgeOut, { from, to }) : fill(L.edgeOut, { from: to, to: from });
    return `${dirText} (${fill(L.strength, { n: l.step })})`;
  };

  const half = { w: width / 2, h: height / 2 };

  return (
    <div
      ref={wrapRef}
      className="kth-xref-web"
      role="region"
      aria-label={L.region}
      aria-busy={load === 'loading'}
      dir={dir}
      onKeyDown={onRootKeyDown}
    >
      <div className="kth-xref-web__toolbar" role="toolbar" aria-label={L.toolbar}>
        <button type="button" className="kth-xref-web__btn" onClick={goBack} disabled={history.length === 0}>
          {L.back}
        </button>
        <div className="kth-xref-web__group" role="group" aria-label={L.depth}>
          {([1, 2, 3] as const).map((n) => (
            <button
              key={n}
              type="button"
              className="kth-xref-web__btn"
              aria-pressed={depth === n}
              onClick={() => setDepth(n)}
            >
              {fill(L.depthOption, { n })}
            </button>
          ))}
        </div>
        <label className="kth-xref-web__field">
          <span>{L.minWeight}</span>
          <input
            type="range"
            className="kth-xref-web__slider"
            min={0}
            max={1}
            step={0.05}
            value={minWeight}
            onChange={(e) => setMinWeight(Number(e.currentTarget.value))}
          />
        </label>
        <button type="button" className="kth-xref-web__btn" onClick={releasePins} disabled={pinCount === 0}>
          {L.releasePins}
        </button>
        <button
          type="button"
          className="kth-xref-web__btn"
          aria-pressed={showList}
          onClick={() => setShowList((s) => !s)}
        >
          {showList ? L.hideList : L.showList}
        </button>
      </div>

      {graph?.truncated && (
        <p className="kth-xref-web__notice" role="note">
          {fill(L.truncated, { n: Math.max(0, graph.nodes.length - 1) })}
        </p>
      )}
      {load === 'loading' && <p className="kth-xref-web__status" role="status">{L.loading}</p>}
      {load === 'error' && (
        <p className="kth-xref-web__error" role="alert">
          <span>{L.error}</span>
          <button type="button" className="kth-xref-web__btn" onClick={() => setAttempt((a) => a + 1)}>{L.retry}</button>
        </p>
      )}
      {isEmpty && <p className="kth-xref-web__status" role="status">{L.empty}</p>}

      <div className="kth-xref-web__body">
        <div className="kth-xref-web__stage">
          <svg
            ref={svgRef}
            className="kth-xref-web__svg"
            viewBox={`${-half.w} ${-half.h} ${width} ${height}`}
            role="group"
            aria-label={L.graph}
            {...({ onDoubleClick: releasePins } as object)}
          >
            <rect
              className="kth-xref-web__bg"
              x={-half.w}
              y={-half.h}
              width={width}
              height={height}
            />
            <g>
              {linksRef.current.map((l) => {
                const s = nodeById.get(endOf(l.source));
                const t = nodeById.get(endOf(l.target));
                if (!s || !t) return null;
                const hi = activeId !== null && (s.id === activeId || t.id === activeId);
                const dim = activeId !== null && !hi;
                const cls = [
                  'kth-xref-web__edge',
                  l.direction === 'both' ? '' : 'kth-xref-web__edge--oneway',
                  hi ? 'kth-xref-web__edge--hi' : '',
                  dim ? 'kth-xref-web__edge--dim' : '',
                ].filter(Boolean).join(' ');
                return (
                  <line
                    key={l.key}
                    className={cls}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    strokeWidth={edgeWidth(l.weight)}
                  >
                    <title>{edgeTitle(l)}</title>
                  </line>
                );
              })}
            </g>
            <g>
              {nodes.map((n) => {
                const r = nodeRadius(n.degree, n.hop);
                const label = ref(n.id, n.endVerseId);
                const isAnchor = n.id === anchor;
                const near = activeId !== null && (n.id === activeId || activeNeighbours.has(n.id));
                const dim = activeId !== null && !near;
                const cls = ['kth-xref-web__node', dim ? 'kth-xref-web__node--dim' : ''].filter(Boolean).join(' ');
                return (
                  <g
                    key={n.id}
                    ref={(el) => {
                      if (el) {
                        nodeEls.current.set(n.id, el);
                        // Set by hand: preact writes the SVG attribute as `tabIndex`, which is not `tabindex`.
                        el.setAttribute('tabindex', n.id === tabStop ? '0' : '-1');
                      } else nodeEls.current.delete(n.id);
                    }}
                    className={cls}
                    transform={`translate(${n.x} ${n.y})`}
                    role="button"
                    aria-label={label}
                    aria-pressed={selected === n.id}
                    aria-description={fill(L.connections, { n: n.degree })}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (suppressClick.current) return;
                      setSelected(n.id);
                      setFocusId(n.id);
                    }}
                    {...({ onDoubleClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); recentre(n.id); } } as object)}
                    onKeyDown={(e) => onNodeKeyDown(e, n.id)}
                    onFocus={() => { setFocusId(n.id); setFocused(true); }}
                    onBlur={() => setFocused(false)}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onPointerDown={(e) => onNodePointerDown(e, n.id)}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={onNodePointerUp}
                    onPointerCancel={onNodePointerUp}
                  >
                    <title>{`${label} (${fill(L.connections, { n: n.degree })}${n.fx != null ? `, ${L.pinned}` : ''})`}</title>
                    {isAnchor && <circle className="kth-xref-web__anchor-ring" r={r + 5} />}
                    {selected === n.id && <circle className="kth-xref-web__sel-ring" r={r + 3} />}
                    {focused && focusId === n.id && <circle className="kth-xref-web__focus-ring" r={r + 7} />}
                    <circle
                      className={n.hop >= 2 ? 'kth-xref-web__dot kth-xref-web__dot--far' : 'kth-xref-web__dot'}
                      r={r}
                      style={{ fill: sectionVar(bookOf(n.id)) }}
                    />
                    {(n.hop < 2 || isAnchor || near) && (
                      <text className="kth-xref-web__label" y={r + 12} textAnchor="middle" aria-hidden="true">
                        {truncateLabel(label)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {selNode && (
          <aside className="kth-xref-web__detail" aria-label={L.detail}>
            <h3 className="kth-xref-web__detail-title">{ref(selNode.id, selNode.endVerseId)}</h3>
            {getVerseText && (
              <p className="kth-xref-web__detail-text">
                {text && text.id === selNode.id ? text.value : L.textLoading}
              </p>
            )}
            <p className="kth-xref-web__detail-meta">{fill(L.connections, { n: selNode.degree })}</p>
            <div className="kth-xref-web__detail-actions">
              <button
                type="button"
                className="kth-xref-web__btn"
                onClick={() => recentre(selNode.id)}
                disabled={selNode.id === anchor}
              >
                {L.recentre}
              </button>
              <button
                type="button"
                className="kth-xref-web__btn"
                onClick={() => onOpenVerse(selNode.id, selNode.endVerseId)}
              >
                {L.openInReader}
              </button>
            </div>
          </aside>
        )}
      </div>

      <div className={showList ? 'kth-xref-web__list' : 'kth-xref-web__list kth-xref-web__sr'}>
        <ul aria-label={L.list} className="kth-xref-web__items">
          {ranked.map((r) => {
            const name = ref(r.verseId, r.endVerseId);
            return (
              <li key={r.verseId} className="kth-xref-web__item">
                <span className="kth-xref-web__item-ref">{name}</span>
                <span className="kth-xref-web__item-meta">{fill(L.strength, { n: r.step })}</span>
                <button
                  type="button"
                  className="kth-xref-web__btn"
                  aria-label={fill(L.selectOn, { ref: name })}
                  tabIndex={showList ? undefined : -1}
                  onClick={() => setSelected(r.verseId)}
                >
                  {L.detail}
                </button>
                <button
                  type="button"
                  className="kth-xref-web__btn"
                  aria-label={fill(L.recentreOn, { ref: name })}
                  tabIndex={showList ? undefined : -1}
                  onClick={() => recentre(r.verseId)}
                >
                  {L.recentre}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
