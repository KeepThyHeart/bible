/**
 * Paint controller (slot `readerPaintControllers`): while audio reads this pane, marks the verse
 * being read with `verse--playing` and, with auto-scroll on, keeps it in view.
 *
 * Highlight only: it never selects, never moves the Study / Commentary panes and never touches
 * history (the page turn itself is `followToChapter`). Nothing renders.
 */
import { useEffect } from 'react';
import type { ReaderPaintProps } from '../host/slots';
import { useAudio, useFollow } from './audioState';
import { panelIdOfTab } from './desktopPorts';

export const PLAYING_CLASS = 'verse--playing';
/** After the reader scrolls the pane by hand, auto-scroll stays out of the way for this long. */
export const USER_SCROLL_PAUSE_MS = 8000;
/** A verse this close to the top or bottom edge (a fraction of the height) is scrolled to centre. */
const COMFORT_MARGIN = 0.15;
const RETRY_FRAMES = 12;

const rowOf = (container: HTMLElement, verseId: number) =>
  container.querySelector<HTMLElement>(`[data-verse-id="${verseId}"]`);

/**
 * Put the class on the verse's row(s) and take it off every other. Idempotent: it writes only when
 * something changes (even a no-op classList.add queues a mutation record, which would make the
 * observer below loop forever).
 */
export function applyPlayingVerse(container: HTMLElement, verseId: number | null): void {
  for (const el of container.querySelectorAll<HTMLElement>(`.${PLAYING_CLASS}`)) {
    if (verseId === null || el.dataset.verseId !== String(verseId)) el.classList.remove(PLAYING_CLASS);
  }
  if (verseId !== null) for (const el of container.querySelectorAll<HTMLElement>(`[data-verse-id="${verseId}"]`)) { if (!el.classList.contains(PLAYING_CLASS)) el.classList.add(PLAYING_CLASS); }
}

/** Scroll the verse into view unless it is already comfortably visible. Returns false when its row is not mounted yet. */
export function scrollVerseIntoView(container: HTMLElement, verseId: number, instant = false): boolean {
  const verseEl = rowOf(container, verseId);
  if (!verseEl) return false;
  const scroller = container.getBoundingClientRect();
  const verse = verseEl.getBoundingClientRect();
  const margin = scroller.height * COMFORT_MARGIN;
  if (!instant && verse.top >= scroller.top + margin && verse.bottom <= scroller.bottom - margin) return true;
  const target = container.scrollTop + (verse.top - scroller.top) - container.clientHeight / 2 + verse.height / 2;
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  container.scrollTo({ top: Math.max(0, target), behavior: instant || reduced ? 'auto' : 'smooth' });
  return true;
}

const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

export function PlayingVerseController({ tabId, containerRef }: ReaderPaintProps): null {
  const follow = useFollow();
  const followAlong = useAudio(s => s.prefs.followAlong);
  const autoScroll = useAudio(s => s.prefs.autoScroll);
  const panelId = panelIdOfTab(tabId);
  const mine = panelId !== undefined && follow.tabId === panelId;
  const verseId = mine && followAlong ? follow.verseId : null;

  // The highlight, re-applied whenever React redraws the rows.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    applyPlayingVerse(container, verseId);
    if (verseId === null) return;
    const mo = new MutationObserver(() => applyPlayingVerse(container, verseId));
    mo.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => { mo.disconnect(); applyPlayingVerse(container, null); };
  }, [containerRef, verseId]);

  // The reader's own scrolling, by intent (not scroll events, so our smooth scrolls never pause us).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || verseId === null) return;
    const mark = () => { (container as HTMLElement & { _audioUserAt?: number })._audioUserAt = Date.now(); };
    const onKey = (e: KeyboardEvent) => { if (SCROLL_KEYS.has(e.key) && container.contains(document.activeElement)) mark(); };
    container.addEventListener('wheel', mark, { passive: true });
    container.addEventListener('touchmove', mark, { passive: true });
    container.addEventListener('pointerdown', mark, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('wheel', mark);
      container.removeEventListener('touchmove', mark);
      container.removeEventListener('pointerdown', mark);
      document.removeEventListener('keydown', onKey);
    };
  }, [containerRef, verseId !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the verse being read.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || verseId === null || !autoScroll) return;
    const userAt = (container as HTMLElement & { _audioUserAt?: number })._audioUserAt ?? 0;
    if (Date.now() - userAt < USER_SCROLL_PAUSE_MS) return;
    let frame = 0;
    const attempt = (left: number) => {
      if (scrollVerseIntoView(container, verseId) || left <= 0) return;
      // A chapter just turned: its rows may not have mounted yet.
      frame = requestAnimationFrame(() => attempt(left - 1));
    };
    attempt(RETRY_FRAMES);
    return () => { if (frame) cancelAnimationFrame(frame); };
  }, [containerRef, verseId, autoScroll]);

  return null;
}
