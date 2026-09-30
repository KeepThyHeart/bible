/**
 * XrefConstellationView: the canon as a night sky (task 0068, wireframe D). The centre star is the verse being
 * explored; the outer ring is every chapter of the Bible, Genesis at the top running clockwise. Cross-references sit
 * on rings around the centre (one per hop) and each star's ANGLE is its place in the Bible, so cross-references line
 * up in the direction of their book: a cluster low left is the Gospels. Select a star for its text, re-centre on it
 * and the sky re-forms around it (stars glide to their new places).
 *
 * The layout is pure (`constellation.ts`): no physics, instant and stable. React renders SVG. Data, depth and the
 * strength floor work exactly as in the verse web (same `getEgoGraph` request, shared controls).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { getBookName, bookFirstChapterIndex, CHAPTER_COUNT } from '@bible/core/browser';
import type { IXrefGraphProvider, VerseId, XrefGraph } from '@bible/core/browser';
import { defaultFormatRef, sectionVarOfVerse, useElementSize, usePrefersReducedMotion } from './common';
import type { FormatRef } from './common';
import { DEFAULT_XREF_CONTROL_LABELS, XrefControlsHelp, XrefDepthControl, XrefStrengthControl, fillTpl as fill, minWeightForStep } from './controls';
import type { XrefControlLabels } from './controls';
import { bookSegments, canonAngle, constellationLayout } from './constellation';
import type { Star } from './constellation';
import { neighbourInDirection, rankedNeighbours } from './webGraph';
import type { ArrowDir } from './webGraph';

export interface XrefConstellationLabels extends XrefControlLabels {
  region: string;
  toolbar: string;
  /** `{n}` is the number of connected verses shown. */
  summary: string;
  /** Explains the layout: angle = place in the Bible, rings = hops. */
  hint: string;
  /** Marks the start of the ring. */
  ringStart: string;
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
  /** `{ref}`. */
  recentreOn: string;
  selectOn: string;
  /** `{n}` is the degree. */
  connections: string;
  textLoading: string;
  list: string;
  edgeOut: string;
  edgeBoth: string;
  strength: string;
  /** `{hop}` is 0 (centre) to 3. */
  hopName: string;
}

export const DEFAULT_XREF_CONSTELLATION_LABELS: XrefConstellationLabels = {
  ...DEFAULT_XREF_CONTROL_LABELS,
  region: 'Constellation',
  toolbar: 'Constellation controls',
  summary: '{n} connected verses',
  hint: 'Each star sits in the direction of its place in the Bible: Genesis at the top, running clockwise to Revelation. The rings show how many hops a verse is from the centre.',
  ringStart: 'Genesis',
  truncated: 'Showing the strongest {n} connections',
  loading: 'Loading connections',
  empty: 'No cross-references for this verse',
  error: 'Could not load the connections',
  retry: 'Retry',
  graph: 'Cross-reference constellation',
  detail: 'Selected verse',
  recentre: 'Re-centre here',
  openInReader: 'Open in reader',
  recentreOn: 'Re-centre on {ref}',
  selectOn: 'Select {ref}',
  connections: '{n} connections',
  textLoading: 'Loading text',
  list: 'Connected verses, strongest first',
  edgeOut: '{from} cites {to}',
  edgeBoth: '{from} and {to} cite each other',
  strength: 'Strength {n} of 5',
  hopName: 'hop {hop}',
};

export interface XrefConstellationViewProps {
  provider: Pick<IXrefGraphProvider, 'getEgoGraph'>;
  anchor: VerseId;
  onAnchorChange?: (verseId: VerseId) => void;
  onOpenVerse: (verseId: VerseId, endVerseId?: VerseId) => void;
  formatRef?: FormatRef;
  /** Localized book name for the ring labels (default: the English medium name). */
  bookName?: (book: number) => string;
  getVerseText?: (verseId: VerseId, endVerseId?: VerseId) => Promise<string | undefined>;
  initialDepth?: 1 | 2 | 3;
  initialMaxNodes?: number;
  labels?: Partial<XrefConstellationLabels>;
  dir?: 'ltr' | 'rtl';
}

const ARROWS: Record<string, ArrowDir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
type Load = 'idle' | 'loading' | 'error';

const SEGMENTS = bookSegments();
const NT_START = bookFirstChapterIndex(40) / CHAPTER_COUNT;

/** Arc path of the canon ring between two canon positions. */
function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const a0 = canonAngle(from);
  const a1 = canonAngle(Math.min(to, from + 0.99999));
  const large = to - from > 0.5 ? 1 : 0;
  const p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  return `M${p(a0)} A${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

export function XrefConstellationView({
  provider,
  anchor: anchorProp,
  onAnchorChange,
  onOpenVerse,
  formatRef = defaultFormatRef,
  bookName = (b) => getBookName(b, 'medium'),
  getVerseText,
  initialDepth = 2,
  initialMaxNodes = 60,
  labels: labelOverrides,
  dir,
}: XrefConstellationViewProps) {
  const L = useMemo(() => ({ ...DEFAULT_XREF_CONSTELLATION_LABELS, ...labelOverrides }), [labelOverrides]);
  const reduced = usePrefersReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(stageRef);

  const [anchor, setAnchor] = useState<VerseId>(anchorProp);
  const [history, setHistory] = useState<VerseId[]>([]);
  const [depth, setDepth] = useState<1 | 2 | 3>(initialDepth);
  const [minStep, setMinStep] = useState(1);
  const [queryStep, setQueryStep] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setQueryStep(minStep), 250);
    return () => clearTimeout(t);
  }, [minStep]);
  const [attempt, setAttempt] = useState(0);
  const [graph, setGraph] = useState<XrefGraph | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [selected, setSelected] = useState<VerseId | null>(null);
  const [hoverId, setHoverId] = useState<VerseId | null>(null);
  const [focusId, setFocusId] = useState<VerseId | null>(null);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState<{ id: VerseId; value: string | undefined } | null>(null);

  const reqRef = useRef(0);
  const unmounted = useRef(false);
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const onAnchorChangeRef = useRef(onAnchorChange);
  onAnchorChangeRef.current = onAnchorChange;
  const nodeEls = useRef(new Map<VerseId, SVGGElement>());

  useEffect(() => {
    unmounted.current = false;
    return () => { unmounted.current = true; };
  }, []);

  // Fetch. Only the latest request may apply.
  useEffect(() => {
    const id = ++reqRef.current;
    setLoad('loading');
    new Promise<XrefGraph>((resolve) => {
      resolve(providerRef.current.getEgoGraph(anchor, {
        depth,
        maxNodes: initialMaxNodes,
        ...(queryStep > 1 ? { minWeight: minWeightForStep(queryStep) } : {}),
      }));
    }).then(
      (g) => {
        if (unmounted.current || id !== reqRef.current) return;
        setGraph(g);
        setLoad('idle');
      },
      () => {
        if (unmounted.current || id !== reqRef.current) return;
        setLoad('error');
      },
    );
  }, [anchor, depth, queryStep, initialMaxNodes, attempt]);

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

  const ref = useCallback((id: VerseId, end?: VerseId) => formatRef(id, end), [formatRef]);
  const layout = useMemo(
    () => (graph ? constellationLayout(graph, { width, height }, (id, end) => ref(id, end)) : null),
    [graph, width, height, ref],
  );
  const stars = layout?.stars ?? [];
  const byId = useMemo(() => new Map(stars.map((s) => [s.id, s])), [stars]);
  const ranked = useMemo(() => (graph ? rankedNeighbours(graph) : []), [graph]);

  // Verse text for the selection.
  useEffect(() => {
    if (selected === null || !getVerseText) return undefined;
    let cancelled = false;
    const star = byId.get(selected);
    Promise.resolve(getVerseText(selected, star?.endVerseId)).then(
      (value) => { if (!cancelled && !unmounted.current) setText({ id: selected, value }); },
      () => { if (!cancelled && !unmounted.current) setText({ id: selected, value: undefined }); },
    );
    return () => { cancelled = true; };
    // byId changes with every layout; the text only depends on the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, getVerseText]);

  const focusStar = (id: VerseId) => {
    setFocusId(id);
    nodeEls.current.get(id)?.focus();
  };
  const onStarKeyDown = (e: KeyboardEvent<SVGGElement>, id: VerseId) => {
    const arrow = ARROWS[e.key];
    if (arrow) {
      e.preventDefault();
      const next = neighbourInDirection(stars, id, arrow);
      if (next !== undefined) focusStar(next);
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

  const activeId = hoverId ?? (focused ? focusId : null);
  const tabStop = focusId !== null && byId.has(focusId) ? focusId : anchor;
  const isEmpty = load === 'idle' && graph !== null && graph.nodes.length <= 1;
  const selStar = selected !== null ? byId.get(selected) : undefined;
  const neighbours = new Set<VerseId>();
  if (activeId !== null && layout) {
    for (const e of layout.edges) {
      if (e.from === activeId) neighbours.add(e.to);
      else if (e.to === activeId) neighbours.add(e.from);
    }
  }
  const starLabel = (s: Star) => ref(s.id, s.endVerseId);
  const edgeTitle = (from: VerseId, to: VerseId, direction: string, step: number) => {
    const a = ref(from);
    const b = ref(to);
    const dirText = direction === 'both'
      ? fill(L.edgeBoth, { from: a, to: b })
      : direction === 'out' ? fill(L.edgeOut, { from: a, to: b }) : fill(L.edgeOut, { from: b, to: a });
    return `${dirText} (${fill(L.strength, { n: step })})`;
  };
  const edgeDir = new Map((graph?.edges ?? []).map((e) => [`${e.from}>${e.to}`, e.direction]));

  const cx = layout?.cx ?? width / 2;
  const cy = layout?.cy ?? height / 2;
  const R = layout?.ringRadius ?? Math.min(width, height) / 2 - 40;
  const ringR = R + 12;
  const rootClass = ['kth-xref-web', 'kth-xref-star', reduced ? 'kth-xref-star--still' : ''].filter(Boolean).join(' ');

  return (
    <div
      className={rootClass}
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
        <XrefDepthControl labels={L} depth={depth} onChange={setDepth} className="kth-xref-web__btn" />
        <XrefStrengthControl labels={L} step={minStep} onChange={setMinStep} />
        {graph && !isEmpty && (
          <span className="kth-xref-web__value" aria-live="polite">{fill(L.summary, { n: Math.max(0, graph.nodes.length - 1) })}</span>
        )}
        <XrefControlsHelp labels={L} buttonClass="kth-xref-web__btn" />
      </div>

      {graph?.truncated && (
        <p className="kth-xref-web__notice" role="note">{fill(L.truncated, { n: Math.max(0, graph.nodes.length - 1) })}</p>
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
        <div className="kth-xref-web__stage" ref={stageRef}>
          <svg
            className="kth-xref-web__svg kth-xref-star__svg"
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-label={L.graph}
          >
            <rect className="kth-xref-web__bg kth-xref-star__bg" x={0} y={0} width={width} height={height} onClick={() => setSelected(null)} />
            {/* The canon: one arc per book, coloured by section. */}
            <g className="kth-xref-star__canon" aria-hidden="true">
              {SEGMENTS.map((s) => (
                <path
                  key={s.book}
                  className="kth-xref-star__book"
                  d={arcPath(cx, cy, ringR, s.start, s.end)}
                  style={{ stroke: `var(--kth-section-${s.section})` }}
                />
              ))}
              {layout && layout.hopRadii.slice(1).map((r, i) => (
                <circle key={i} className="kth-xref-star__ring" cx={cx} cy={cy} r={r} />
              ))}
              {[0, NT_START].map((p) => {
                const a = canonAngle(p);
                return (
                  <line
                    key={p}
                    className="kth-xref-star__divide"
                    x1={cx + Math.cos(a) * R * 0.2}
                    y1={cy + Math.sin(a) * R * 0.2}
                    x2={cx + Math.cos(a) * (ringR + 14)}
                    y2={cy + Math.sin(a) * (ringR + 14)}
                  />
                );
              })}
              <text className="kth-xref-star__ringlabel" x={cx + 6} y={cy - ringR - 18}>{`${L.ringStart} →`}</text>
              {[40, 66].map((b) => {
                const p = b === 66 ? 0.97 : NT_START;
                const a = canonAngle(p);
                const x = cx + Math.cos(a) * (ringR + 26);
                const y = cy + Math.sin(a) * (ringR + 26);
                return (
                  <text
                    key={b}
                    className="kth-xref-star__ringlabel"
                    x={x}
                    y={y}
                    textAnchor={Math.cos(a) > 0.2 ? 'start' : Math.cos(a) < -0.2 ? 'end' : 'middle'}
                    dominantBaseline="middle"
                  >
                    {bookName(b)}
                  </text>
                );
              })}
            </g>

            <g>
              {layout?.edges.map((e) => {
                const hi = activeId !== null && (e.from === activeId || e.to === activeId);
                const dim = activeId !== null && !hi;
                const cls = ['kth-xref-star__edge', hi ? 'kth-xref-star__edge--hi' : '', dim ? 'kth-xref-star__edge--dim' : ''].filter(Boolean).join(' ');
                return (
                  <path key={e.key} className={cls} d={e.d} strokeWidth={0.6 + e.step * 0.4}>
                    <title>{edgeTitle(e.from, e.to, edgeDir.get(e.key) ?? 'out', e.step)}</title>
                  </path>
                );
              })}
            </g>

            <g>
              {stars.map((s) => {
                const isAnchor = s.hop === 0;
                const near = activeId !== null && (s.id === activeId || neighbours.has(s.id));
                const dim = activeId !== null && !near;
                const label = starLabel(s);
                const side = s.labelSide ?? (activeId === s.id ? (Math.cos(s.angle) >= 0 ? 'start' : 'end') : null);
                const cls = ['kth-xref-star__star', dim ? 'kth-xref-star__star--dim' : ''].filter(Boolean).join(' ');
                const color = sectionVarOfVerse(s.id);
                return (
                  <g
                    key={s.id}
                    ref={(el) => {
                      if (el) {
                        nodeEls.current.set(s.id, el);
                        // Set by hand: preact writes the SVG attribute as `tabIndex`, which is not `tabindex`.
                        el.setAttribute('tabindex', s.id === tabStop ? '0' : '-1');
                      } else nodeEls.current.delete(s.id);
                    }}
                    className={cls}
                    style={{ transform: `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)` }}
                    role="button"
                    aria-label={label}
                    aria-pressed={selected === s.id}
                    aria-description={`${fill(L.hopName, { hop: s.hop })}, ${fill(L.connections, { n: s.degree })}`}
                    onClick={(e) => { e.stopPropagation(); setSelected(s.id); setFocusId(s.id); }}
                    {...({ onDoubleClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); recentre(s.id); } } as object)}
                    onKeyDown={(e) => onStarKeyDown(e, s.id)}
                    onFocus={() => { setFocusId(s.id); setFocused(true); }}
                    onBlur={() => setFocused(false)}
                    onMouseEnter={() => setHoverId(s.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    <title>{`${label} (${fill(L.hopName, { hop: s.hop })}, ${fill(L.connections, { n: s.degree })})`}</title>
                    <circle className="kth-xref-star__halo" r={s.radius * 2.6} style={{ fill: color }} />
                    {isAnchor && <circle className="kth-xref-web__anchor-ring" r={s.radius + 4} />}
                    {selected === s.id && <circle className="kth-xref-web__sel-ring" r={s.radius + 3} />}
                    {focused && focusId === s.id && <circle className="kth-xref-web__focus-ring" r={s.radius + 6} />}
                    <circle className="kth-xref-star__core" r={s.radius} style={{ fill: color }} />
                    {side && (
                      <text
                        className="kth-xref-web__label kth-xref-star__label"
                        x={side === 'above' ? 0 : side === 'start' ? s.radius + 5 : -s.radius - 5}
                        y={side === 'above' ? -s.radius - 6 : 4}
                        textAnchor={side === 'above' ? 'middle' : side}
                        aria-hidden="true"
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {selStar && (
          <aside className="kth-xref-web__detail" aria-label={L.detail}>
            <h3 className="kth-xref-web__detail-title">{ref(selStar.id, selStar.endVerseId)}</h3>
            {getVerseText && (
              <p className="kth-xref-web__detail-text">{text && text.id === selStar.id ? text.value : L.textLoading}</p>
            )}
            <p className="kth-xref-web__detail-meta">{fill(L.connections, { n: selStar.degree })}</p>
            <div className="kth-xref-web__detail-actions">
              <button type="button" className="kth-xref-web__btn" onClick={() => recentre(selStar.id)} disabled={selStar.id === anchor}>
                {L.recentre}
              </button>
              <button type="button" className="kth-xref-web__btn" onClick={() => onOpenVerse(selStar.id, selStar.endVerseId)}>
                {L.openInReader}
              </button>
            </div>
          </aside>
        )}
      </div>

      <p className="kth-xref-star__hint">{L.hint}</p>

      <div className="kth-xref-web__list kth-xref-web__sr">
        <ul aria-label={L.list} className="kth-xref-web__items">
          {ranked.map((r) => {
            const name = ref(r.verseId, r.endVerseId);
            return (
              <li key={r.verseId} className="kth-xref-web__item">
                <span className="kth-xref-web__item-ref">{name}</span>
                <span className="kth-xref-web__item-meta">{fill(L.strength, { n: r.step })}</span>
                <button type="button" className="kth-xref-web__btn" tabIndex={-1} aria-label={fill(L.selectOn, { ref: name })} onClick={() => setSelected(r.verseId)}>
                  {L.detail}
                </button>
                <button type="button" className="kth-xref-web__btn" tabIndex={-1} aria-label={fill(L.recentreOn, { ref: name })} onClick={() => recentre(r.verseId)}>
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
