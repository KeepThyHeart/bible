/**
 * The chapter text inside the pop-up: the verse being read stays on an anchor line a third of the way down, and
 * clicking a verse (or Enter on the cursor verse) moves the reading position. It never touches the Bible pane's
 * selection or history. A user scroll pauses following for 8 seconds, with a "Back to verse N" button.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { audioStore } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { useNowPlaying } from './useNowPlaying';
import { ANCHOR, centreTarget, endPadding } from './centreScroll';
import { AudioIcon } from './AudioIcons';
import './audio.css';

/** How long following stays paused after the reader scrolls. */
export const USER_SCROLL_PAUSE_MS = 8000;
const RETRY_FRAMES = 12;

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const AudioVersePane: React.FC<{ now?: () => number }> = ({ now: clock = Date.now }) => {
  const { t } = useI18n();
  const np = useNowPlaying();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [showBack, setShowBack] = useState(false);
  const [pad, setPad] = useState({ top: 0, bottom: 0 });
  const padRef = useRef(pad);
  const lastUserAt = useRef(-Infinity);
  const frame = useRef(0);
  const anchor = ANCHOR.popup;

  const { book, chapter, ready } = np;
  const chapterKey = ready ? `${book}:${chapter}` : null;
  const playingId = book !== null && chapter !== null && np.verse !== null ? book * 1_000_000 + chapter * 1_000 + np.verse : null;
  const verses = np.verseList;

  const live = useRef({ playingId, ready });
  live.current = { playingId, ready };
  const centredKey = useRef<string | null>(null);

  // "Read from" is offered only after the reader selects a verse in the Bible pane (an event, not a value).
  const [selectionTouched, setSelectionTouched] = useState(false);
  const selWatch = useRef<{ panelId: string | null | undefined; verse: number | null | undefined }>({ panelId: undefined, verse: undefined });
  useEffect(() => {
    const w = selWatch.current;
    if (w.panelId !== np.panelId) { selWatch.current = { panelId: np.panelId, verse: np.selectedVerseId }; setSelectionTouched(false); return; }
    if (w.verse !== np.selectedVerseId) { w.verse = np.selectedVerseId; setSelectionTouched(true); }
  }, [np.panelId, np.selectedVerseId]);

  const paused = useCallback(() => clock() - lastUserAt.current < USER_SCROLL_PAUSE_MS, [clock]);
  const verseEl = (id: number) => scrollerRef.current?.querySelector<HTMLElement>(`[data-verse-id="${id}"]`) ?? null;
  const inView = (id: number): boolean => {
    const scroller = scrollerRef.current;
    const el = verseEl(id);
    if (!scroller || !el) return true;
    const s = scroller.getBoundingClientRect();
    const v = el.getBoundingClientRect();
    return v.bottom > s.top && v.top < s.bottom;
  };

  const centre = useCallback((id: number, behavior: ScrollBehavior, attemptsLeft = RETRY_FRAMES) => {
    cancelAnimationFrame(frame.current);
    const scroller = scrollerRef.current;
    const el = verseEl(id);
    if (!scroller || !el) {
      if (attemptsLeft > 0) frame.current = requestAnimationFrame(() => centre(id, behavior, attemptsLeft - 1));
      return;
    }
    const s = scroller.getBoundingClientRect();
    const v = el.getBoundingClientRect();
    const top = centreTarget({
      scrollTop: scroller.scrollTop, scrollerTop: s.top, clientHeight: scroller.clientHeight,
      verseTop: v.top, verseHeight: v.height, scrollHeight: scroller.scrollHeight, anchor,
    });
    scroller.scrollTo?.({ top, behavior: behavior === 'smooth' && reducedMotion() ? 'auto' : behavior });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  // A new chapter has arrived (or the pane just mounted): land on the verse at once.
  useEffect(() => {
    if (!chapterKey || centredKey.current === chapterKey) return;
    centredKey.current = chapterKey;
    setCursor(null);
    setShowBack(false);
    lastUserAt.current = -Infinity;
    const id = live.current.playingId;
    if (id !== null) centre(id, 'auto');
  }, [chapterKey, centre]);

  // Follow the verse being read.
  useEffect(() => {
    const off = audioStore.follow.subscribe(() => {
      const id = audioStore.follow.verseId;
      if (id === null || !live.current.ready) return;
      if (paused()) { setShowBack(!inView(id)); return; }
      setShowBack(false);
      setCursor(null);
      if (centredKey.current !== `${Math.floor(id / 1_000_000)}:${Math.floor(id / 1_000) % 1_000}`) return; // the chapter turn lands it
      centre(id, 'smooth');
    });
    return () => { off(); cancelAnimationFrame(frame.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre, paused]);

  // A user scroll (wheel, touch, a press on the scrollbar) pauses following; the pill honours the pause.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const touch = () => {
      lastUserAt.current = clock();
      const id = live.current.playingId;
      requestAnimationFrame(() => setShowBack(id !== null && !inView(id)));
    };
    const onScroll = () => { if (paused()) { const id = live.current.playingId; setShowBack(id !== null && !inView(id)); } };
    el.addEventListener('wheel', touch, { passive: true });
    el.addEventListener('touchmove', touch, { passive: true });
    el.addEventListener('mousedown', touch);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', touch);
      el.removeEventListener('touchmove', touch);
      el.removeEventListener('mousedown', touch);
      el.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, clock, paused]);

  // Spacers at both ends, sized from the pane, so the first and last verses can sit on the anchor line.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => {
      const p = endPadding(el.clientHeight, anchor);
      const last = padRef.current;
      if (last.top === p.top && last.bottom === p.bottom) return false;
      padRef.current = p;
      setPad(p);
      return true;
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (measure()) return;
      const id = live.current.playingId;
      if (id !== null && live.current.ready && !paused()) centre(id, 'auto');
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, anchor, centre, paused]);

  // The spacers changed the scrollable range: land the verse being read on the anchor line again.
  useEffect(() => {
    const id = live.current.playingId;
    if (id === null || !live.current.ready || paused()) return;
    if (centredKey.current !== `${Math.floor(id / 1_000_000)}:${Math.floor(id / 1_000) % 1_000}`) return;
    centre(id, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pad.top, pad.bottom]);

  const jumpTo = (id: number) => {
    lastUserAt.current = -Infinity;
    setShowBack(false);
    setCursor(null);
    setSelectionTouched(false);
    audioStore.jumpToVerse(id % 1000);
  };

  const onVerseClick = (id: number) => {
    if (typeof getSelection === 'function' && getSelection()?.toString()) return; // selecting text to copy
    jumpTo(id);
  };

  const backToPlaying = () => {
    lastUserAt.current = -Infinity;
    setShowBack(false);
    if (playingId !== null) centre(playingId, 'auto');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (verses.length === 0) return;
    const ids = verses.map((v) => v.verse_id);
    const current = cursor ?? playingId ?? ids[0];
    const idx = Math.max(0, ids.indexOf(current));
    const move = (i: number) => {
      const id = ids[Math.min(ids.length - 1, Math.max(0, i))];
      e.preventDefault();
      lastUserAt.current = clock();
      setCursor(id);
      centre(id, 'smooth');
    };
    switch (e.key) {
      case 'ArrowDown': return move(idx + 1);
      case 'ArrowUp': return move(idx - 1);
      case 'Home': return move(0);
      case 'End': return move(ids.length - 1);
      case 'Enter':
      case ' ':
        e.preventDefault();
        return jumpTo(current);
      case 'Escape':
        // A moved cursor goes back to the verse being read first; the next Escape leaves the player.
        if (cursor !== null) {
          e.stopPropagation();
          setCursor(null);
          if (playingId !== null) centre(playingId, 'smooth');
        }
        return;
    }
  };

  const selected = np.selectedVerseId;
  const showReadFrom = ready && selectionTouched && selected !== null && playingId !== null && selected !== playingId
    && Math.floor(selected / 1000) === (book as number) * 1000 + (chapter as number);
  const readFromRef = showReadFrom ? `${np.chapterLabel}:${selected! % 1000}` : '';
  const activeId = cursor ?? playingId;

  return (
    <div className="audio-verses-wrap">
      <div
        ref={scrollerRef}
        className="audio-verses"
        role="listbox"
        tabIndex={0}
        dir="auto"
        aria-label={t('audio.verses.label')}
        aria-activedescendant={activeId !== null && ready ? `audio-v-${activeId}` : undefined}
        data-testid="audio-verse-pane"
        onKeyDown={onKeyDown}
      >
        {ready && <div aria-hidden="true" style={{ blockSize: `${pad.top}px` }} />}
        {ready ? verses.map((v) => (
          <div
            key={v.verse_id}
            id={`audio-v-${v.verse_id}`}
            role="option"
            aria-selected={v.verse_id === playingId}
            data-verse-id={v.verse_id}
            className={`audio-verses__opt${v.verse_id === cursor ? ' audio-verses__opt--cursor' : ''}`}
            onClick={() => onVerseClick(v.verse_id)}
          >
            <span className="audio-verses__num" aria-hidden="true">{v.verse}</span>
            {v.text}
          </div>
        )) : (
          <div className="audio-verses__spinner" role="status" aria-live="off"><AudioIcon name="spinner" className="audio-spin" size={24} /></div>
        )}
        {ready && <div aria-hidden="true" style={{ blockSize: `${pad.bottom}px` }} />}
      </div>
      {(showBack || showReadFrom) && (
        <div className="audio-verses__pills">
          {showBack && playingId !== null && (
            <button type="button" className="audio-verses__pill" data-testid="audio-back-to" onClick={backToPlaying}>
              {t('audio.verses.backTo', { verse: playingId % 1000 })}
            </button>
          )}
          {showReadFrom && (
            <button type="button" className="audio-verses__pill" data-testid="audio-read-from" onClick={() => jumpTo(selected!)}>
              {t('audio.verses.readFrom', { ref: readFromRef })}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
