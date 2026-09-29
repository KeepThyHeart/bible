/**
 * XrefArcView: the whole Bible at chapter level. 1189 chapters along a canon bar, arcs above it joining chapters that
 * cross-reference each other, coloured by the section of the lower endpoint. One canvas, batched paths per
 * (section, weight level) bucket. Select a chapter to see only its arcs and a ranked list of partner chapters
 * (the text alternative and keyboard route); pick a book to isolate its arcs.
 *
 * Pure logic (x <-> chapter, filtering, bucketing, ranking) lives in `arcLayout.ts`. Strings are props.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { BIBLE_SECTIONS, CHAPTER_COUNT, bookFirstChapterIndex, chapterFromIndex, getBookName } from '@bible/core/browser';
import type { ChapterArcs, IXrefGraphProvider } from '@bible/core/browser';
import { resolveCssColor, resolveSectionColors, sectionVar, useElementSize } from './common';
import {
  arcGeometry, bookSegments, bucketArcs, buildPartnerIndex, chapterToX, connectionCount, filterArcs, floorFromSlider,
  jumpBook, maxPairWeight, sectionTable, sliderFromFloor, tickHeights, topChapters, topPartners, xToChapter,
  BOOK_COUNT, SECTION_COUNT,
} from './arcLayout';
import type { ArcBucket } from './arcLayout';

export interface XrefArcViewLabels {
  /** Accessible name of the whole view. */
  title: string;
  loading: string;
  /** Shown when no cross-reference data is installed. */
  empty: string;
  error: string;
  retry: string;
  /** Accessible name of the interactive canvas region. */
  canvasLabel: string;
  book: string;
  allBooks: string;
  minWeight: string;
  sections: string;
  reset: string;
  /** `{chapter}` is replaced. */
  open: string;
  explore: string;
  partners: string;
  topChapters: string;
  hint: string;
  /** `{chapter}`, `{count}`. */
  hover: string;
  /** `{list}`. */
  hoverStrongest: string;
  /** `{chapter}`, `{count}`, `{partner}`. */
  selected: string;
  /** `{chapter}`. */
  selectedNone: string;
  cleared: string;
  /** `{count}`. */
  links: string;
  /** `{count}`. */
  arcsShown: string;
}

export const DEFAULT_XREF_ARCS_LABELS: XrefArcViewLabels = {
  title: 'Cross-references across the Bible',
  loading: 'Loading cross-references',
  empty: 'No cross-reference data installed',
  error: 'Could not load cross-references',
  retry: 'Retry',
  canvasLabel: 'Chapter arcs. Left and Right choose a chapter, Page Up and Page Down jump a book, Enter opens it, Escape clears.',
  book: 'Book',
  allBooks: 'All books',
  minWeight: 'Minimum strength',
  sections: 'Sections',
  reset: 'Reset',
  open: 'Open {chapter}',
  explore: 'Explore {chapter}',
  partners: 'Strongest connections of {chapter}',
  topChapters: 'Most connected chapters',
  hint: 'Choose a chapter to see what it connects to.',
  hover: '{chapter}: {count} connected chapters',
  hoverStrongest: 'Strongest: {list}',
  selected: '{chapter} selected: {count} connected chapters. Strongest: {partner}.',
  selectedNone: '{chapter} selected: no connections.',
  cleared: 'Selection cleared',
  links: '{count} links',
  arcsShown: '{count} arcs shown',
};

export interface XrefArcViewProps {
  provider: Pick<IXrefGraphProvider, 'getChapterArcs'>;
  /** Chapter to select initially (and whenever it changes), e.g. the chapter open in the reader. */
  current?: { book: number; chapter: number };
  onOpenChapter: (book: number, chapter: number) => void;
  /** Optional: open the verse web / hopper for a chapter. */
  onExploreChapter?: (book: number, chapter: number) => void;
  bookName?: (book: number) => string;
  formatChapter?: (book: number, chapter: number) => string;
  labels?: Partial<XrefArcViewLabels>;
  dir?: 'ltr' | 'rtl';
}

type Status = 'loading' | 'ready' | 'empty' | 'error';

interface Palette {
  sections: string[];
  text: string;
  bg: string;
  accent: string;
}

const FALLBACK_PALETTE: Palette = { sections: Array(SECTION_COUNT).fill('#888888'), text: '#888888', bg: '#ffffff', accent: '#3b82f6' };
const BASE_ALPHA = [0.12, 0.22, 0.38, 0.6];
const BASE_WIDTH = [0.6, 0.8, 1.1, 1.5];
const TOUCH_ALPHA = [0.5, 0.65, 0.8, 0.95];
const TOUCH_WIDTH = [1, 1.3, 1.7, 2.2];
const BAR_H = 16;
const TICK_H = 16;
const PARTNER_LIMIT = 12;

const fmt = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

function indexOfChapter(book: number, chapter: number): number {
  if (!(book >= 1 && book <= BOOK_COUNT)) return -1;
  const first = bookFirstChapterIndex(book);
  const next = book === BOOK_COUNT ? CHAPTER_COUNT : bookFirstChapterIndex(book + 1);
  return Math.min(next - 1, Math.max(first, first + chapter - 1));
}

interface DrawParams {
  width: number;
  height: number;
  palette: Palette;
  maxWeight: number;
  base: ArcBucket[];
  touch: ArcBucket[] | null;
  ticks: Float32Array;
  sectionsOn: readonly boolean[];
  selected: number | null;
  hover: number | null;
  book: number | null;
  bookName: (book: number) => string;
}

function strokeBuckets(ctx: CanvasRenderingContext2D, buckets: ArcBucket[], p: DrawParams, alphas: number[], widths: number[], factor: number, baseY: number, maxH: number) {
  for (const b of buckets) {
    ctx.beginPath();
    for (let i = 0; i < b.ends.length; i += 2) {
      const g = arcGeometry(b.ends[i], b.ends[i + 1], p.width, baseY, maxH);
      ctx.moveTo(g.x1, baseY);
      ctx.quadraticCurveTo(g.cx, g.cy, g.x2, baseY);
    }
    ctx.globalAlpha = alphas[b.level] * factor;
    ctx.lineWidth = widths[b.level];
    ctx.strokeStyle = p.palette.sections[b.section];
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function draw(ctx: CanvasRenderingContext2D, p: DrawParams) {
  const { width, height, palette } = p;
  ctx.clearRect(0, 0, width, height);
  const barY = height - BAR_H;
  const tickBase = barY - 1;
  const baseY = tickBase - TICK_H - 2;
  const maxH = Math.max(8, baseY - 4);
  const colW = width / CHAPTER_COUNT;
  const sect = sectionTable();

  strokeBuckets(ctx, p.base, p, BASE_ALPHA, BASE_WIDTH, p.selected === null ? 1 : 0.25, baseY, maxH);
  if (p.touch) strokeBuckets(ctx, p.touch, p, TOUCH_ALPHA, TOUCH_WIDTH, 1, baseY, maxH);

  // ticks
  for (let i = 0; i < CHAPTER_COUNT; i++) {
    const h = p.ticks[i];
    if (h <= 0) continue;
    ctx.globalAlpha = p.sectionsOn[sect[i]] ? 0.9 : 0.25;
    ctx.fillStyle = palette.sections[sect[i]];
    ctx.fillRect(i * colW, tickBase - h, Math.max(1, colW - 0.4), h);
  }
  ctx.globalAlpha = 1;

  // canon bar
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';
  for (const seg of bookSegments(width)) {
    const s = sect[seg.firstChapter];
    const dim = !p.sectionsOn[s] || (p.book !== null && p.book !== seg.book);
    ctx.globalAlpha = dim ? 0.3 : 0.9;
    ctx.fillStyle = palette.sections[s];
    ctx.fillRect(seg.x0, barY, seg.x1 - seg.x0, BAR_H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.bg;
    ctx.fillRect(seg.x0, barY, 1, BAR_H);
    const w = seg.x1 - seg.x0;
    if (w > 22) {
      const name = p.bookName(seg.book);
      if (ctx.measureText(name).width < w - 4) {
        ctx.fillStyle = palette.text;
        ctx.fillText(name, seg.x0 + 3, barY + BAR_H / 2);
      }
    }
  }

  // hover and selection markers
  if (p.hover !== null && p.hover !== p.selected) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = palette.accent;
    ctx.fillRect(p.hover * colW - 1, 0, Math.max(3, colW + 2), height);
    ctx.globalAlpha = 1;
  }
  if (p.selected !== null) {
    const x = chapterToX(p.selected, width);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

export function XrefArcView({ provider, current, onOpenChapter, onExploreChapter, bookName, formatChapter, labels, dir }: XrefArcViewProps) {
  const L = { ...DEFAULT_XREF_ARCS_LABELS, ...labels };
  const nameOfBook = useCallback((b: number) => (bookName ? bookName(b) : getBookName(b, 'medium')), [bookName]);
  const nameOfChapter = useCallback(
    (index: number) => {
      const { book, chapter } = chapterFromIndex(index);
      return formatChapter ? formatChapter(book, chapter) : `${nameOfBook(book)} ${chapter}`;
    },
    [formatChapter, nameOfBook],
  );

  const [status, setStatus] = useState<Status>('loading');
  const [arcs, setArcs] = useState<ChapterArcs | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<number | null>(() => (current ? indexOfChapter(current.book, current.chapter) : null));
  const [book, setBook] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [sectionsOn, setSectionsOn] = useState<boolean[]>(() => Array(SECTION_COUNT).fill(true));
  const [slider, setSlider] = useState<number | null>(null);
  const [palette, setPalette] = useState<Palette>(FALLBACK_PALETTE);
  const [themeTick, setThemeTick] = useState(0);
  const [announce, setAnnounce] = useState('');

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef(0);
  const size = useElementSize(wrapRef, { width: 640, height: 300 });

  // Follow the reader's chapter.
  const curBook = current?.book;
  const curChapter = current?.chapter;
  useEffect(() => {
    if (curBook === undefined || curChapter === undefined) return;
    const i = indexOfChapter(curBook, curChapter);
    if (i >= 0) setSelected(i);
  }, [curBook, curChapter]);

  // Load (ignoring stale responses).
  useEffect(() => {
    const token = ++requestRef.current;
    setStatus('loading');
    let promise: Promise<ChapterArcs>;
    try {
      promise = Promise.resolve(provider.getChapterArcs());
    } catch (e) {
      promise = Promise.reject(e);
    }
    promise.then(
      (data) => {
        if (token !== requestRef.current) return;
        setArcs(data);
        setStatus(data && data.pairs.length > 0 ? 'ready' : 'empty');
      },
      () => {
        if (token !== requestRef.current) return;
        setStatus('error');
      },
    );
    return () => {
      // a newer effect run (or unmount) makes this response stale
      if (requestRef.current === token) requestRef.current++;
    };
  }, [provider, reloadKey]);

  // Theme: re-resolve colours on data-theme / colour-scheme changes.
  useEffect(() => {
    const bump = () => setThemeTick((t) => t + 1);
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      mo = new MutationObserver(bump);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    let mq: MediaQueryList | null = null;
    if (typeof matchMedia === 'function') {
      mq = matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener?.('change', bump);
    }
    return () => {
      mo?.disconnect();
      mq?.removeEventListener?.('change', bump);
    };
  }, []);
  useEffect(() => {
    const el = canvasRef.current ?? wrapRef.current;
    setPalette({
      sections: resolveSectionColors(el),
      text: resolveCssColor(el, 'var(--kth-text)', '#888888'),
      bg: resolveCssColor(el, 'var(--kth-bg)', '#ffffff'),
      accent: resolveCssColor(el, 'var(--kth-accent)', '#3b82f6'),
    });
  }, [themeTick, status]);

  // Derived data.
  const pairs = arcs?.pairs;
  const maxWeight = useMemo(() => (pairs ? maxPairWeight(pairs) : 0), [pairs]);
  const partnerIndex = useMemo(() => (pairs ? buildPartnerIndex(pairs) : null), [pairs]);
  const ticks = useMemo(() => (arcs ? tickHeights(arcs.chapterTotals, TICK_H) : new Float32Array(CHAPTER_COUNT)), [arcs]);
  const explicitFloor = slider === null ? null : floorFromSlider(slider, maxWeight);
  const base = useMemo(
    () => (pairs ? filterArcs(pairs, { book, sections: sectionsOn, floor: explicitFloor }) : { pairs: new Uint32Array(0), floor: 0 }),
    [pairs, book, sectionsOn, explicitFloor],
  );
  const baseBuckets = useMemo(() => bucketArcs(base.pairs, maxWeight), [base, maxWeight]);
  const touchBuckets = useMemo(
    () => (pairs && selected !== null ? bucketArcs(filterArcs(pairs, { chapter: selected, sections: sectionsOn }).pairs, maxWeight) : null),
    [pairs, selected, sectionsOn, maxWeight],
  );
  const sliderValue = slider ?? sliderFromFloor(base.floor, maxWeight);
  const partners = useMemo(() => (partnerIndex && selected !== null ? topPartners(partnerIndex, selected, PARTNER_LIMIT) : []), [partnerIndex, selected]);
  const overall = useMemo(() => (arcs ? topChapters(arcs.chapterTotals, 10) : []), [arcs]);

  // Draw.
  useEffect(() => {
    if (status !== 'ready') return;
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = size.width;
    const h = size.height;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, {
      width: w, height: h, palette, maxWeight, base: baseBuckets, touch: touchBuckets, ticks, sectionsOn, selected, hover, book, bookName: nameOfBook,
    });
  }, [status, size, palette, maxWeight, baseBuckets, touchBuckets, ticks, sectionsOn, selected, hover, book, nameOfBook]);

  // Announcements.
  useEffect(() => {
    if (selected === null || !partnerIndex) return;
    const name = nameOfChapter(selected);
    const count = connectionCount(partnerIndex, selected);
    const top = topPartners(partnerIndex, selected, 1)[0];
    setAnnounce(top ? fmt(L.selected, { chapter: name, count, partner: nameOfChapter(top.chapter) }) : fmt(L.selectedNone, { chapter: name }));
    // labels intentionally not a dependency: announce on selection changes only
  }, [selected, partnerIndex, nameOfChapter]);

  const reset = () => {
    setSelected(null);
    setBook(null);
    setSlider(null);
    setSectionsOn(Array(SECTION_COUNT).fill(true));
    setAnnounce(L.cleared);
  };

  const openIndex = (index: number) => {
    const { book: b, chapter } = chapterFromIndex(index);
    onOpenChapter(b, chapter);
  };

  const pointerX = (e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const widthOf = () => {
    const w = wrapRef.current?.getBoundingClientRect().width;
    return w && w > 0 ? w : size.width;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { x } = pointerX(e);
    const c = xToChapter(x, widthOf());
    setHover(c < 0 ? null : c);
  };
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const { x, y } = pointerX(e);
    const c = xToChapter(x, widthOf());
    if (c < 0) return;
    if (y >= size.height - BAR_H) {
      const b = chapterFromIndex(c).book;
      setBook((prev) => (prev === b ? null : b));
    } else {
      setSelected(c);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const start = selected ?? (current ? Math.max(0, indexOfChapter(current.book, current.chapter)) : 0);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight': next = selected === null ? start : Math.min(CHAPTER_COUNT - 1, selected + 1); break;
      case 'ArrowLeft': next = selected === null ? start : Math.max(0, selected - 1); break;
      case 'PageDown': next = jumpBook(start, 1); break;
      case 'PageUp': next = jumpBook(start, -1); break;
      case 'Home': next = 0; break;
      case 'End': next = CHAPTER_COUNT - 1; break;
      case 'Enter':
        if (selected !== null) { e.preventDefault(); openIndex(selected); }
        return;
      case 'Escape':
        e.preventDefault();
        reset();
        return;
      default: return;
    }
    e.preventDefault();
    setSelected(next);
  };

  const hoverText = useMemo(() => {
    if (hover === null || !partnerIndex) return '';
    const count = connectionCount(partnerIndex, hover);
    let text = fmt(L.hover, { chapter: nameOfChapter(hover), count });
    const top = topPartners(partnerIndex, hover, 3);
    if (top.length) text += `. ${fmt(L.hoverStrongest, { list: top.map((t) => nameOfChapter(t.chapter)).join(', ') })}`;
    return text;
  }, [hover, partnerIndex, nameOfChapter, labels]);

  const selectedName = selected === null ? '' : nameOfChapter(selected);
  const selectedRef = selected === null ? null : chapterFromIndex(selected);

  return (
    <section className="kth-xref-arcs" dir={dir} aria-label={L.title}>
      {status === 'loading' && <p className="kth-xref-arcs__state" role="status">{L.loading}</p>}
      {status === 'empty' && <p className="kth-xref-arcs__state" role="status">{L.empty}</p>}
      {status === 'error' && (
        <div className="kth-xref-arcs__state" role="alert">
          <span>{L.error}</span>
          <button type="button" className="kth-btn" onClick={() => setReloadKey((k) => k + 1)}>{L.retry}</button>
        </div>
      )}
      {status === 'ready' && (
        <>
          <div className="kth-xref-arcs__toolbar">
            <label className="kth-xref-arcs__field">
              <span>{L.book}</span>
              <select
                className="kth-select"
                value={book ?? 0}
                onChange={(e) => { const v = Number(e.target.value); setBook(v > 0 ? v : null); }}
              >
                <option value={0}>{L.allBooks}</option>
                {Array.from({ length: BOOK_COUNT }, (_, i) => i + 1).map((b) => (
                  <option key={b} value={b}>{nameOfBook(b)}</option>
                ))}
              </select>
            </label>
            <label className="kth-xref-arcs__field">
              <span>{L.minWeight}</span>
              <input
                className="kth-xref-arcs__slider"
                type="range"
                min={0}
                max={1000}
                step={10}
                value={sliderValue}
                aria-valuetext={fmt(L.arcsShown, { count: base.pairs.length / 4 })}
                onChange={(e) => setSlider(Number(e.target.value))}
              />
            </label>
            <span className="kth-xref-arcs__count">{fmt(L.arcsShown, { count: base.pairs.length / 4 })}</span>
            <button type="button" className="kth-btn" onClick={reset}>{L.reset}</button>
          </div>

          <div className="kth-xref-arcs__legend" role="group" aria-label={L.sections}>
            {BIBLE_SECTIONS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className="kth-xref-arcs__legend-item"
                aria-pressed={sectionsOn[i]}
                onClick={() => setSectionsOn((prev) => prev.map((v, j) => (j === i ? !v : v)))}
              >
                <span className="kth-xref-arcs__swatch" style={{ background: sectionVar(s.firstBook) }} aria-hidden="true" />
                {s.name}
              </button>
            ))}
          </div>

        </>
      )}
      <div
        ref={wrapRef}
        className="kth-xref-arcs__canvas-wrap"
        hidden={status !== 'ready'}
        role="application"
        aria-label={L.canvasLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
      >
        <canvas ref={canvasRef} className="kth-xref-arcs__canvas" aria-hidden="true" />
      </div>
      {status === 'ready' && (
        <>
          <p className="kth-xref-arcs__hover">{hoverText}</p>
          <p className="kth-xref-arcs__live" aria-live="polite" role="status">{announce}</p>

          {selectedRef ? (
            <div className="kth-xref-arcs__panel">
              <div className="kth-xref-arcs__actions">
                <button type="button" className="kth-btn" onClick={() => onOpenChapter(selectedRef.book, selectedRef.chapter)}>
                  {fmt(L.open, { chapter: selectedName })}
                </button>
                {onExploreChapter && (
                  <button type="button" className="kth-btn kth-btn--ghost" onClick={() => onExploreChapter(selectedRef.book, selectedRef.chapter)}>
                    {fmt(L.explore, { chapter: selectedName })}
                  </button>
                )}
              </div>
              <h3 className="kth-xref-arcs__heading">{fmt(L.partners, { chapter: selectedName })}</h3>
              <ul className="kth-xref-arcs__list" aria-label={fmt(L.partners, { chapter: selectedName })}>
                {partners.map((p) => (
                  <li key={p.chapter} className="kth-xref-arcs__item">
                    <button type="button" className="kth-xref-arcs__partner" onClick={() => openIndex(p.chapter)}>
                      <span>{nameOfChapter(p.chapter)}</span>
                      <span className="kth-xref-arcs__links">{fmt(L.links, { count: p.count })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="kth-xref-arcs__panel">
              <p className="kth-xref-arcs__hint">{L.hint}</p>
              <h3 className="kth-xref-arcs__heading">{L.topChapters}</h3>
              <ul className="kth-xref-arcs__list" aria-label={L.topChapters}>
                {overall.map((c) => (
                  <li key={c} className="kth-xref-arcs__item">
                    <button type="button" className="kth-xref-arcs__partner" onClick={() => setSelected(c)}>
                      <span>{nameOfChapter(c)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
