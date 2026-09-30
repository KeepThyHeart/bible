/**
 * GenealogyView: one SVG that draws a precomputed `GraphLayout` (from layoutLineage / layoutFamily /
 * layoutTribes; this component never calls them). A node's (x, y) is its CENTRE, (w, h) its size.
 *
 * - Pan (pointer drag), wheel zoom anchored at the pointer, two-finger pinch, keyboard (+ / - / arrows / Home)
 *   and a Fit button, all through core's `PanZoom`. Nothing is animated, so `prefers-reduced-motion` is honoured
 *   by construction.
 * - Level of detail: importance 0 is always labelled, 1 from zoom 0.5, 2 from zoom 0.9; smaller nodes are dots.
 * - Accessibility: roving tabindex over the nodes (arrows move to the nearest node by layout coordinates, Enter or
 *   Space selects) and a visually hidden list that mirrors the visible nodes for screen readers.
 * - The viewport is uncontrolled by default and refits when the layout changes; pass `viewport` +
 *   `onViewportChange` to control it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { PanZoom } from '@bible/core/browser';
import type { GraphLayout, LayoutEdge, LayoutNode } from '@bible/core/browser';
import { hexagonPoints, labelVisible, nearestInDirection, offsetPoints, pathData, shapeOf } from './geometry';
import type { Direction } from './geometry';
import { cx, fill } from './util';

export interface GenealogyViewLabels {
  /** Accessible name of the drawing. */
  graph: string;
  /** Accessible name of the zoom toolbar. */
  toolbar: string;
  fit: string;
  zoomIn: string;
  zoomOut: string;
  /** Accessible name of the screen-reader list of people. */
  outline: string;
  empty: string;
  onLineToChrist: string;
  oneTextOnly: string;
  disputed: string;
  /** `{count}` is replaced. */
  collapsed: string;
  selected: string;
}

export const DEFAULT_GENEALOGY_VIEW_LABELS: GenealogyViewLabels = {
  graph: 'Family tree',
  toolbar: 'Tree controls',
  fit: 'Fit to view',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  outline: 'People in this tree',
  empty: 'Nothing to show',
  onLineToChrist: 'on the line to Christ',
  oneTextOnly: 'in one text only',
  disputed: 'disputed',
  collapsed: '{count} more hidden',
  selected: 'selected',
};

export interface GenealogyViewport { k: number; tx: number; ty: number }

export interface GenealogyViewProps {
  layout: GraphLayout;
  /** Selected PERSON id (or null). */
  selectedId?: string | null;
  onSelect?: (personId: string) => void;
  /** Double-click or "F" on a node: re-centre the tree on this person. */
  onFocusPerson?: (personId: string) => void;
  /** Dim everything that is not on the line to Christ. */
  highlight?: boolean;
  labels?: Partial<GenealogyViewLabels>;
  /** Controlled viewport (screen = world * k + t). Omit for an uncontrolled, auto-fitting view. */
  viewport?: GenealogyViewport;
  onViewportChange?: (viewport: GenealogyViewport) => void;
}

const FALLBACK_SIZE = { w: 800, h: 600 };
const KEY_PAN = 60;
const KEY_ZOOM = 1.2;
const DRAG_THRESHOLD = 3;
/** Below this scale a fitted layout would be unreadable; fit opens at this scale instead (centred on the focus). */
const MIN_FIT_SCALE = 0.9;
const arrowDir: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function toPanZoom(v: GenealogyViewport): PanZoom { return new PanZoom(v.k, v.tx, v.ty); }
function fromPanZoom(p: PanZoom): GenealogyViewport { return { k: p.k, tx: p.tx, ty: p.ty }; }
function colorClass(key?: string): string {
  const safe = key ? key.toLowerCase().replace(/[^a-z0-9_-]/g, '-') : '';
  return safe ? `kth-genealogy-color-${safe}` : '';
}

export function GenealogyView({
  layout, selectedId = null, onSelect, onFocusPerson, highlight = false, labels: labelOverrides,
  viewport, onViewportChange,
}: GenealogyViewProps) {
  const labels = { ...DEFAULT_GENEALOGY_VIEW_LABELS, ...labelOverrides };
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const sizeRef = useRef(FALLBACK_SIZE);
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [inner, setInner] = useState<GenealogyViewport>({ k: 1, tx: 0, ty: 0 });
  const [rovingId, setRovingId] = useState<string | null>(null);
  const vp = viewport ?? inner;
  const vpRef = useRef(vp);
  vpRef.current = vp;
  const propsRef = useRef({ viewport, onViewportChange });
  propsRef.current = { viewport, onViewportChange };

  const commit = useCallback((next: GenealogyViewport) => {
    vpRef.current = next;
    if (!propsRef.current.viewport) setInner(next);
    propsRef.current.onViewportChange?.(next);
  }, []);
  const update = useCallback((fn: (p: PanZoom) => PanZoom) => {
    commit(fromPanZoom(fn(toPanZoom(vpRef.current))));
  }, [commit]);
  const fit = useCallback((readable = false) => {
    update((p) => {
      const { w, h } = sizeRef.current;
      p.fit(layout.bounds, w, h);
      if (readable && p.k < MIN_FIT_SCALE) {
        // A very wide layout (the whole line, all tribes) would open as unreadable dots:
        // open at a readable scale, on the focus person, else the start of the layout at the left edge.
        p.k = MIN_FIT_SCALE;
        const focus = layout.nodes.find((n) => n.flags.focus);
        if (focus) p.centerOn(focus.x, focus.y, w, h);
        else {
          p.centerOn(layout.bounds.x, layout.bounds.y + layout.bounds.h / 2, w, h);
          p.tx = 24 - layout.bounds.x * p.k;
        }
      }
      return p;
    });
  }, [update, layout.bounds, layout.nodes]);

  // Measure the container (ResizeObserver where available).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = r.width > 0 && r.height > 0 ? { w: r.width, h: r.height } : FALLBACK_SIZE;
      if (next.w !== sizeRef.current.w || next.h !== sizeRef.current.h) {
        sizeRef.current = next;
        setSize(next);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit on mount and whenever the layout changes (uncontrolled only).
  useLayoutEffect(() => {
    if (!propsRef.current.viewport) fit(true);
  }, [layout]);

  // Wheel zoom must be non-passive to preventDefault, so it is attached natively.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      update((p) => p.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [update]);

  // ---- pointer: drag to pan, two pointers to pinch ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);
  const local = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointers.current.size === 0) moved.current = false;
    pointers.current.set(e.pointerId, local(e));
    // Capture only once a drag starts (see capture below): capturing here would send the click to the svg, not the node.
  };
  const capture = (id: number) => {
    try { svgRef.current?.setPointerCapture?.(id); } catch { /* not capturable */ }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    if (pointers.current.size === 1) {
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!moved.current) capture(e.pointerId);
      moved.current = true;
      pointers.current.set(e.pointerId, cur);
      update((p) => p.pan(dx, dy));
    } else if (pointers.current.size === 2) {
      const others = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1] ?? prev;
      const before = Math.hypot(prev.x - others.x, prev.y - others.y) || 1;
      const after = Math.hypot(cur.x - others.x, cur.y - others.y) || 1;
      const mid = { x: (cur.x + others.x) / 2, y: (cur.y + others.y) / 2 };
      const midPrev = { x: (prev.x + others.x) / 2, y: (prev.y + others.y) / 2 };
      pointers.current.set(e.pointerId, cur);
      for (const id of pointers.current.keys()) capture(id);
      moved.current = true;
      update((p) => p.pan(mid.x - midPrev.x, mid.y - midPrev.y).zoomAt(after / before, mid.x, mid.y));
    }
  };
  const endPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    try { svgRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
  };

  // ---- keyboard: viewport keys (svg or any node focused) ----
  const onSvgKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const { w, h } = sizeRef.current;
    if (e.key === '+' || e.key === '=') { update((p) => p.zoomAt(KEY_ZOOM, w / 2, h / 2)); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { update((p) => p.zoomAt(1 / KEY_ZOOM, w / 2, h / 2)); e.preventDefault(); }
    else if (e.key === 'Home') { fit(false); e.preventDefault(); }
    else if (e.target === e.currentTarget && arrowDir[e.key]) {
      const d = arrowDir[e.key];
      update((p) => p.pan(d === 'left' ? KEY_PAN : d === 'right' ? -KEY_PAN : 0, d === 'up' ? KEY_PAN : d === 'down' ? -KEY_PAN : 0));
      e.preventDefault();
    }
  };

  // ---- nodes ----
  const nodes = layout.nodes;
  const selectedNodeIds = useMemo(
    () => new Set(nodes.filter((n) => selectedId !== null && n.personId === selectedId).map((n) => n.id)),
    [nodes, selectedId],
  );
  const activeId = nodes.some((n) => n.id === rovingId)
    ? rovingId
    : (nodes.find((n) => selectedNodeIds.has(n.id)) ?? nodes.find((n) => n.flags.focus) ?? nodes[0])?.id ?? null;

  // tabindex is set imperatively: preact/compat writes SVG `tabIndex` as a case-sensitive attribute that
  // browsers ignore, while `tabindex` works on both runtimes.
  useLayoutEffect(() => {
    svgRef.current?.setAttribute('tabindex', '0');
    for (const [id, el] of nodeRefs.current) el.setAttribute('tabindex', id === activeId ? '0' : '-1');
  });

  const focusNode = (id: string) => {
    setRovingId(id);
    nodeRefs.current.get(id)?.focus?.();
    const n = nodes.find((x) => x.id === id);
    if (n) {
      const s = toPanZoom(vpRef.current).toScreen(n.x, n.y);
      const { w, h } = sizeRef.current;
      if (s.x < 0 || s.y < 0 || s.x > w || s.y > h) update((p) => p.centerOn(n.x, n.y, w, h));
    }
  };
  const onNodeKeyDown = (e: KeyboardEvent<SVGGElement>, n: LayoutNode) => {
    const d = arrowDir[e.key];
    if (d) {
      const next = nearestInDirection(nodes, n.id, d);
      if (next) focusNode(next.id);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === 'Enter' || e.key === ' ') {
      onSelect?.(n.personId);
      e.preventDefault();
      e.stopPropagation();
    } else if ((e.key === 'f' || e.key === 'F') && onFocusPerson) {
      onFocusPerson(n.personId);
      e.preventDefault();
    }
  };
  const onNodeClick = (n: LayoutNode) => {
    if (moved.current) return;
    setRovingId(n.id);
    onSelect?.(n.personId);
  };

  const flagText = (n: LayoutNode): string[] => {
    const out: string[] = [];
    if (n.flags.onLineToChrist) out.push(labels.onLineToChrist);
    if (n.flags.oneTextOnly) out.push(labels.oneTextOnly);
    if (n.flags.disputed) out.push(labels.disputed);
    if (n.flags.collapsed) out.push(fill(labels.collapsed, { count: n.flags.collapsed }));
    if (n.flags.gapNote) out.push(n.flags.gapNote);
    if (selectedNodeIds.has(n.id)) out.push(labels.selected);
    return out;
  };
  const nodeName = (n: LayoutNode) => [n.label, ...flagText(n)].join(', ');

  const k = vp.k;
  return (
    <div ref={rootRef} className={cx('kth-genealogy-view', highlight && 'kth-genealogy-view--highlight')}>
      <div className="kth-genealogy-view__toolbar" role="toolbar" aria-label={labels.toolbar}>
        <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.zoomOut}
          onClick={() => update((p) => p.zoomAt(1 / KEY_ZOOM, size.w / 2, size.h / 2))}>−</button>
        <button type="button" className="kth-btn kth-btn--sm" aria-label={labels.zoomIn}
          onClick={() => update((p) => p.zoomAt(KEY_ZOOM, size.w / 2, size.h / 2))}>+</button>
        <button type="button" className="kth-btn kth-btn--sm" onClick={() => fit(false)}>{labels.fit}</button>
      </div>
      <svg
        ref={svgRef}
        className="kth-genealogy-view__svg"
        role={"graphics-document" as never}
        aria-label={labels.graph}
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.w} ${size.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onKeyDown={onSvgKeyDown}
      >
        <g className="kth-genealogy-viewport" data-k={k} transform={`translate(${vp.tx} ${vp.ty}) scale(${k})`}>
          <g className="kth-genealogy-edges">
            {layout.edges.map((e) => <EdgeShape key={e.id} edge={e} dim={highlight && !e.onLineToChrist} />)}
          </g>
          <g className="kth-genealogy-nodes">
            {nodes.map((n) => {
              const shape = shapeOf(n);
              const full = labelVisible(n.importance, k);
              const isSel = selectedNodeIds.has(n.id);
              return (
                <g
                  key={n.id}
                  ref={(el) => { if (el) nodeRefs.current.set(n.id, el); else nodeRefs.current.delete(n.id); }}
                  className={cx(
                    'kth-genealogy-node', `kth-genealogy-node--${shape}`, colorClass(n.colorKey),
                    !full && 'kth-genealogy-node--dot',
                    isSel && 'kth-genealogy-node--selected',
                    n.flags.focus && 'kth-genealogy-node--focus',
                    n.flags.onLineToChrist && 'kth-genealogy-node--christ',
                    n.flags.oneTextOnly && 'kth-genealogy-node--one-text',
                    n.flags.disputed && 'kth-genealogy-node--disputed',
                    highlight && !n.flags.onLineToChrist && 'kth-genealogy-node--dim',
                  )}
                  data-node-id={n.id}
                  data-person-id={n.personId}
                  transform={`translate(${n.x} ${n.y})`}
                  role={"graphics-symbol" as never}
                  aria-label={nodeName(n)}
                  aria-current={isSel ? 'true' : undefined}
                  onClick={() => onNodeClick(n)}
                  {...({ onDoubleClick: () => onFocusPerson?.(n.personId) } as object)}
                  onKeyDown={(e) => onNodeKeyDown(e, n)}
                  onFocus={() => setRovingId(n.id)}
                >
                  {full ? <NodeBody node={n} shape={shape} showGapText={k >= 0.5} /> : <NodeDot node={n} k={k} />}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      {nodes.length === 0 && <p className="kth-genealogy-view__empty">{labels.empty}</p>}
      <ul className="kth-visually-hidden" aria-label={labels.outline}>
        {nodes.map((n) => (
          <li key={n.id}>
            <button type="button" tabIndex={-1} aria-current={selectedNodeIds.has(n.id) ? 'true' : undefined}
              onClick={() => onSelect?.(n.personId)}>
              {nodeName(n)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EdgeShape({ edge, dim }: { edge: LayoutEdge; dim: boolean }) {
  const cls = cx(
    'kth-genealogy-edge', `kth-genealogy-edge--${edge.kind}`, `kth-genealogy-edge--${edge.style}`,
    edge.onLineToChrist && 'kth-genealogy-edge--christ',
    dim && 'kth-genealogy-edge--dim',
  );
  if (edge.style === 'double') {
    return (
      <g className={cls} data-edge-id={edge.id}>
        <path d={pathData(offsetPoints(edge.points, -2))} />
        <path d={pathData(offsetPoints(edge.points, 2))} />
      </g>
    );
  }
  return (
    <>
      <path className={cls} data-edge-id={edge.id} d={pathData(edge.points)} />
      {edge.label ? <EdgeLabel edge={edge} /> : null}
    </>
  );
}

function EdgeLabel({ edge }: { edge: LayoutEdge }) {
  const pts = edge.points;
  if (pts.length < 2) return null;
  const a = pts[Math.floor((pts.length - 1) / 2)], b = pts[Math.ceil((pts.length - 1) / 2)];
  return (
    <text className="kth-genealogy-edge__label" x={(a.x + b.x) / 2 + 4} y={(a.y + b.y) / 2} dominantBaseline="central">
      {edge.label}
    </text>
  );
}

function NodeDot({ node, k }: { node: LayoutNode; k: number }) {
  const r = Math.min(Math.min(node.w, node.h) / 2, 5 / Math.max(k, 0.05));
  return <circle className="kth-genealogy-node__dot" r={r} />;
}

function NodeBody({ node, shape, showGapText }: { node: LayoutNode; shape: string; showGapText: boolean }) {
  const { w, h, flags } = node;
  return (
    <>
      {shape === 'group' ? (
        <polygon className="kth-genealogy-node__shape" points={hexagonPoints(w, h)} />
      ) : (
        <rect className="kth-genealogy-node__shape" x={-w / 2} y={-h / 2} width={w} height={h}
          rx={shape === 'female' ? h / 2 : shape === 'male' ? 3 : 8} />
      )}
      <text className="kth-genealogy-node__label" textAnchor="middle" dominantBaseline="central">{node.label}</text>
      {flags.onLineToChrist && <circle className="kth-genealogy-node__christ-mark" cx={w / 2} cy={-h / 2} r={4} />}
      {flags.collapsed ? (
        <g className="kth-genealogy-node__badge" transform={`translate(${w / 2} ${h / 2})`}>
          <rect x={-12} y={-8} width={24} height={16} rx={8} />
          <text textAnchor="middle" dominantBaseline="central">{flags.collapsed > 99 ? '99+' : `+${flags.collapsed}`}</text>
        </g>
      ) : null}
      {flags.gapNote ? (
        <g className="kth-genealogy-node__gap">
          <line x1={0} y1={-h / 2} x2={0} y2={-h / 2 - 8} />
          {showGapText && <text y={-h / 2 - 12} textAnchor="middle">{flags.gapNote}</text>}
        </g>
      ) : null}
    </>
  );
}
