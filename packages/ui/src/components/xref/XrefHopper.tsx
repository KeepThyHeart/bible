/**
 * XrefHopper: the cross-reference "thread hopper" (task 0068, view E). Cards, not a graph: the current verse at
 * the top, its ranked neighbours below, a breadcrumb trail of where you have been, and a thin canon strip that
 * shows where trail verses and neighbours sit in the Bible. Hop to a neighbour, jump back along the trail, or
 * open a verse in the reader. Verse text is shown only when `getVerseText` supplies it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { bookOf, canonPosition, weightStep } from '@bible/core/browser';
import type { IXrefGraphProvider, VerseId, XrefEdge } from '@bible/core/browser';
import { defaultFormatRef, sectionVar, usePrefersReducedMotion } from './common';
import type { FormatRef } from './common';
import { fillTemplate, goBack, hopTo, initialState, jumpTo, resetTrail } from './hopperTrail';
import type { HopperState } from './hopperTrail';

export interface XrefHopperLabels {
  /** Accessible name of the whole view. */
  region: string;
  currentVerse: string;
  openInReader: string;
  /** Accessible name of the list of neighbours. */
  neighbours: string;
  hop: string;
  open: string;
  /** Accessible names for the card buttons; `{ref}` is the neighbour reference. */
  hopTo: string;
  openRef: string;
  back: string;
  reset: string;
  trail: string;
  /** `{n}` is 1..5. */
  strength: string;
  cites: string;
  citedBy: string;
  both: string;
  sources: string;
  loading: string;
  empty: string;
  error: string;
  retry: string;
  showMore: string;
}

export const DEFAULT_XREF_HOPPER_LABELS: XrefHopperLabels = {
  region: 'Cross-reference hopper',
  currentVerse: 'Current verse',
  openInReader: 'Open in reader',
  neighbours: 'Cross-references',
  hop: 'Hop here',
  open: 'Open',
  hopTo: 'Hop to {ref}',
  openRef: 'Open {ref} in reader',
  back: 'Back',
  reset: 'Reset',
  trail: 'Trail',
  strength: 'strength {n} of 5',
  cites: 'cites',
  citedBy: 'cited by',
  both: 'cites and cited by',
  sources: 'Sources',
  loading: 'Loading cross-references',
  empty: 'No cross-references for this verse',
  error: 'Could not load cross-references',
  retry: 'Retry',
  showMore: 'Show more',
};

export interface XrefHopperProps {
  provider: Pick<IXrefGraphProvider, 'getNeighbours'>;
  /** The verse being explored. Changing the prop moves the hopper there and clears the trail. */
  anchor: VerseId;
  /** Called when the user hops, jumps back, goes back or resets. */
  onAnchorChange?: (verseId: VerseId) => void;
  onOpenVerse: (verseId: VerseId, endVerseId?: VerseId) => void;
  formatRef?: FormatRef;
  /** Optional verse text for previews (fetched lazily and cached per verse). Show nothing when absent. */
  getVerseText?: (verseId: VerseId, endVerseId?: VerseId) => Promise<string | undefined>;
  /** Neighbours per page (default 12). */
  limit?: number;
  labels?: Partial<XrefHopperLabels>;
  dir?: 'ltr' | 'rtl';
  /** Verses visited before `anchor`, oldest first. */
  initialTrail?: readonly VerseId[];
}

const DEFAULT_LIMIT = 12;

type Load =
  | { status: 'loading'; edges: XrefEdge[] | null }
  | { status: 'ready'; edges: XrefEdge[]; requested: number }
  | { status: 'error' };

const rangeKey = (v: VerseId, end?: VerseId) => `${v}-${end ?? v}`;

function useVerseText(
  getVerseText: XrefHopperProps['getVerseText'],
  cache: { current: Map<string, Promise<string | undefined>> },
  verseId: VerseId,
  end?: VerseId,
): string | undefined {
  const [text, setText] = useState<string | undefined>(undefined);
  const getRef = useRef(getVerseText);
  getRef.current = getVerseText;
  const has = !!getVerseText;
  useEffect(() => {
    setText(undefined);
    const get = getRef.current;
    if (!has || !get) return undefined;
    const key = rangeKey(verseId, end);
    let p = cache.current.get(key);
    if (!p) {
      p = Promise.resolve().then(() => get(verseId, end)).catch(() => undefined);
      cache.current.set(key, p);
    }
    let live = true;
    void p.then(t => { if (live) setText(t || undefined); });
    return () => { live = false; };
  }, [has, verseId, end, cache]);
  return text;
}

interface CardProps {
  edge: XrefEdge;
  labels: XrefHopperLabels;
  formatRef: FormatRef;
  getVerseText: XrefHopperProps['getVerseText'];
  cache: { current: Map<string, Promise<string | undefined>> };
  onHop: (verseId: VerseId) => void;
  onOpen: (verseId: VerseId, endVerseId?: VerseId) => void;
}

function NeighbourCard({ edge, labels, formatRef, getVerseText, cache, onHop, onOpen }: CardProps) {
  const target = edge.to;
  const end = edge.toEnd !== undefined && edge.toEnd !== target ? edge.toEnd : undefined;
  const ref = formatRef(target, end);
  const step = weightStep(edge.weight);
  const text = useVerseText(getVerseText, cache, target, end);
  const direction = edge.direction === 'out' ? labels.cites : edge.direction === 'in' ? labels.citedBy : labels.both;
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      e.preventDefault();
      onHop(target);
    }
  };
  return (
    <li
      className="kth-xref-hopper-card"
      style={{ '--kth-xref-color': sectionVar(bookOf(target)) } as React.CSSProperties}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <span className="kth-xref-hopper-bar" aria-hidden="true" />
      <div className="kth-xref-hopper-card-main">
        <div className="kth-xref-hopper-card-head">
          <span className="kth-xref-hopper-ref">{ref}</span>
          <span className="kth-xref-hopper-weight" role="img" aria-label={fillTemplate(labels.strength, { n: step })}>
            {[1, 2, 3, 4, 5].map(i => (
              <span
                key={i}
                aria-hidden="true"
                className={i <= step ? 'kth-xref-hopper-dot kth-xref-hopper-dot--on' : 'kth-xref-hopper-dot'}
              />
            ))}
          </span>
          <span className="kth-xref-hopper-direction">{direction}</span>
        </div>
        {edge.phrase ? <p className="kth-xref-hopper-phrase">{edge.phrase}</p> : null}
        {text ? <p className="kth-xref-hopper-text">{text}</p> : null}
        {edge.sources.length > 0 ? (
          <p className="kth-xref-hopper-sources">
            <span className="kth-xref-hopper-meta">{labels.sources}</span> {edge.sources.join(', ')}
          </p>
        ) : null}
      </div>
      <div className="kth-xref-hopper-actions">
        <button
          type="button"
          className="kth-btn kth-btn--sm kth-btn--primary"
          aria-label={fillTemplate(labels.hopTo, { ref })}
          onClick={() => onHop(target)}
        >
          {labels.hop}
        </button>
        <button
          type="button"
          className="kth-btn kth-btn--sm"
          aria-label={fillTemplate(labels.openRef, { ref })}
          onClick={() => onOpen(target, end)}
        >
          {labels.open}
        </button>
      </div>
    </li>
  );
}

export function XrefHopper({
  provider,
  anchor,
  onAnchorChange,
  onOpenVerse,
  formatRef = defaultFormatRef,
  getVerseText,
  limit = DEFAULT_LIMIT,
  labels: labelOverrides,
  dir,
  initialTrail,
}: XrefHopperProps) {
  const labels: XrefHopperLabels = { ...DEFAULT_XREF_HOPPER_LABELS, ...labelOverrides };
  const reduced = usePrefersReducedMotion();
  const pageSize = Math.max(1, Math.floor(limit));

  const [st, setSt] = useState<HopperState>(() => initialState(anchor, initialTrail));
  const [count, setCount] = useState(pageSize);
  const [retryKey, setRetryKey] = useState(0);
  const [load, setLoad] = useState<Load>({ status: 'loading', edges: null });
  const cache = useRef(new Map<string, Promise<string | undefined>>());
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const onAnchorChangeRef = useRef(onAnchorChange);
  onAnchorChangeRef.current = onAnchorChange;

  // Re-sync when the parent changes the anchor.
  const lastAnchor = useRef(anchor);
  useEffect(() => {
    if (lastAnchor.current === anchor) return;
    lastAnchor.current = anchor;
    setSt(prev => (prev.current === anchor ? prev : { current: anchor, trail: [] }));
    setCount(pageSize);
    setLoad({ status: 'loading', edges: null });
  }, [anchor, pageSize]);

  // Fetch neighbours; only the latest request may update the UI.
  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    setLoad(prev => (prev.status === 'ready' ? { status: 'loading', edges: prev.edges } : prev.status === 'loading' ? prev : { status: 'loading', edges: null }));
    let p: Promise<XrefEdge[]>;
    try {
      p = Promise.resolve(providerRef.current.getNeighbours(st.current, count));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      edges => { if (id === requestId.current) setLoad({ status: 'ready', edges, requested: count }); },
      () => { if (id === requestId.current) setLoad({ status: 'error' }); },
    );
    return () => { /* stale results are dropped by the id check */ };
  }, [st.current, count, retryKey]);

  const move = useCallback((next: HopperState) => {
    setSt(prev => {
      if (next === prev) return prev;
      return next;
    });
    setCount(pageSize);
    setLoad({ status: 'loading', edges: null });
    lastAnchor.current = next.current;
    onAnchorChangeRef.current?.(next.current);
  }, [pageSize]);

  const doHop = (v: VerseId) => { if (v !== st.current) move(hopTo(st, v)); };
  const doBack = () => { const n = goBack(st); if (n !== st) move(n); };
  const doReset = () => { const n = resetTrail(st); if (n !== st) move(n); };
  const doJump = (i: number) => { const n = jumpTo(st, i); if (n !== st) move(n); };

  const currentText = useVerseText(getVerseText, cache, st.current);
  const edges = load.status === 'ready' ? load.edges : load.status === 'loading' ? load.edges : null;
  const visible = edges ? edges.slice(0, count) : [];
  const canShowMore = load.status === 'ready' && load.edges.length >= load.requested;

  const stripVerses: Array<{ id: VerseId; kind: 'trail' | 'neighbour' | 'current' }> = [
    ...st.trail.map(id => ({ id, kind: 'trail' as const })),
    ...visible.map(e => ({ id: e.to, kind: 'neighbour' as const })),
    { id: st.current, kind: 'current' as const },
  ];

  const rootClass = reduced ? 'kth-xref-hopper kth-xref-hopper--still' : 'kth-xref-hopper';

  return (
    <section className={rootClass} dir={dir} aria-label={labels.region}>
      <header
        className="kth-xref-hopper-current"
        style={{ '--kth-xref-color': sectionVar(bookOf(st.current)) } as React.CSSProperties}
      >
        <span className="kth-xref-hopper-bar" aria-hidden="true" />
        <div className="kth-xref-hopper-card-main">
          <span className="kth-xref-hopper-meta">{labels.currentVerse}</span>
          <h3 className="kth-xref-hopper-title">{formatRef(st.current)}</h3>
          {currentText ? <p className="kth-xref-hopper-text">{currentText}</p> : null}
        </div>
        <button type="button" className="kth-btn kth-btn--sm" onClick={() => onOpenVerse(st.current)}>
          {labels.openInReader}
        </button>
      </header>

      <nav className="kth-xref-hopper-nav" aria-label={labels.trail}>
        <button type="button" className="kth-btn kth-btn--sm kth-btn--ghost" disabled={st.trail.length === 0} onClick={doBack}>
          {labels.back}
        </button>
        <button type="button" className="kth-btn kth-btn--sm kth-btn--ghost" disabled={st.trail.length === 0} onClick={doReset}>
          {labels.reset}
        </button>
        <ol className="kth-xref-hopper-trail">
          {st.trail.map((v, i) => (
            <li key={`${i}-${v}`} className="kth-xref-hopper-crumb">
              <button type="button" className="kth-xref-hopper-crumb-btn" onClick={() => doJump(i)}>
                {formatRef(v)}
              </button>
            </li>
          ))}
          <li className="kth-xref-hopper-crumb kth-xref-hopper-crumb--current" aria-current="location">
            {formatRef(st.current)}
          </li>
        </ol>
      </nav>

      <svg
        className="kth-xref-hopper-strip"
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect className="kth-xref-hopper-strip-bg" x="0" y="3" width="100" height="2" />
        {stripVerses.map((s, i) => {
          const x = canonPosition(s.id) * 100;
          const cls = `kth-xref-hopper-tick kth-xref-hopper-tick--${s.kind}`;
          return (
            <line
              key={`${i}-${s.id}-${s.kind}`}
              className={cls}
              style={{ '--kth-xref-color': sectionVar(bookOf(s.id)) } as React.CSSProperties}
              x1={x}
              x2={x}
              y1={s.kind === 'current' ? 0 : 1.5}
              y2={s.kind === 'current' ? 8 : 6.5}
            />
          );
        })}
      </svg>

      <div className="kth-xref-hopper-body" aria-busy={load.status === 'loading'}>
        {load.status === 'error' ? (
          <div className="kth-xref-hopper-state" role="alert">
            <p>{labels.error}</p>
            <button type="button" className="kth-btn kth-btn--sm" onClick={() => setRetryKey(k => k + 1)}>
              {labels.retry}
            </button>
          </div>
        ) : load.status === 'loading' && !edges ? (
          <p className="kth-xref-hopper-state" role="status">{labels.loading}</p>
        ) : visible.length === 0 ? (
          <p className="kth-xref-hopper-state" role="status">{labels.empty}</p>
        ) : (
          <>
            <ol
              key={st.current}
              className={reduced ? 'kth-xref-hopper-list' : 'kth-xref-hopper-list kth-xref-hopper-list--enter'}
              aria-label={labels.neighbours}
            >
              {visible.map(e => (
                <NeighbourCard
                  key={`${e.to}-${e.toEnd ?? ''}`}
                  edge={e}
                  labels={labels}
                  formatRef={formatRef}
                  getVerseText={getVerseText}
                  cache={cache}
                  onHop={doHop}
                  onOpen={onOpenVerse}
                />
              ))}
            </ol>
            {canShowMore ? (
              <button type="button" className="kth-btn kth-xref-hopper-more" onClick={() => setCount(c => c + pageSize)}>
                {labels.showMore}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
