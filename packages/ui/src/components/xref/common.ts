/**
 * Shared helpers for the cross-reference graph views (task 0068): section colours from the KTH tokens,
 * a default reference formatter, and two small hooks (reduced motion, element size).
 */
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { getBookName, bookOf, sectionIndexOfBook } from '@bible/core/browser';
import type { VerseId } from '@bible/core/browser';

/** Formats a verse (or passage) for display; apps pass their localized formatter. */
export type FormatRef = (verseId: VerseId, endVerseId?: VerseId) => string;

export const defaultFormatRef: FormatRef = (verseId, endVerseId) => {
  const name = getBookName(bookOf(verseId), 'medium');
  const ch = Math.floor(verseId / 1000) % 1000;
  const v = verseId % 1000;
  const start = `${name} ${ch}:${v}`;
  if (endVerseId === undefined || endVerseId === verseId) return start;
  const endCh = Math.floor(endVerseId / 1000) % 1000;
  const endV = endVerseId % 1000;
  return endCh === ch ? `${start}-${endV}` : `${start}-${endCh}:${endV}`;
};

/** `var(--kth-section-N)` for a book (1..66). */
export function sectionVar(book: number): string {
  return `var(--kth-section-${sectionIndexOfBook(book)})`;
}

export function sectionVarOfVerse(verseId: VerseId): string {
  return sectionVar(bookOf(verseId));
}

/** Resolve a `var(--kth-...)` expression to a concrete colour string, for canvas drawing. */
export function resolveCssColor(el: Element | null, expr: string, fallback = '#888888'): string {
  if (!el || typeof getComputedStyle !== 'function') return fallback;
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(expr.trim());
  if (!m) return expr;
  const v = getComputedStyle(el).getPropertyValue(m[1]).trim();
  return v || fallback;
}

/** All ten section colours, resolved from the tokens (re-read when the theme changes: call again). */
export function resolveSectionColors(el: Element | null): string[] {
  return Array.from({ length: 10 }, (_, i) => resolveCssColor(el, `var(--kth-section-${i})`));
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Content-box size of an element, kept current with ResizeObserver (falls back to `initial`). */
export function useElementSize(ref: RefObject<HTMLElement | null>, initial = { width: 640, height: 420 }) {
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      if (w > 0 && h > 0) setSize(prev => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
