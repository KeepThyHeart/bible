import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { directionForLanguage } from '@bible/core/browser';
import { audioStore } from '../../stores/audioStore';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';
import { useNowPlaying } from '../../hooks/useNowPlaying';
import { useUserScrollIntent } from '../../hooks/useUserScrollIntent';
import { USER_SCROLL_PAUSE_MS } from '../../hooks/useFollowScroll';
import { VerseRenderer } from '../BiblePane/VerseRenderer';
import { centreTarget } from './centreScroll';

const RETRY_FRAMES = 12;

export interface AudioVersePaneProps {
  variant: 'popup' | 'phone';
  /** Test seam. */
  now?: () => number;
}

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The chapter text inside the player (phone screen, desktop pop-up): the verse
 * being read stays centred, and tapping a verse moves the reading position. It
 * never touches the Bible pane's selection, history or commentary.
 */
export function AudioVersePane({ variant, now = Date.now }: AudioVersePaneProps) {
  const { t } = useTranslation();
  const np = useNowPlaying();
  const fontFamily = useStore(settingsStore, () => settingsStore.fontFamily);
  const lineHeight = useStore(settingsStore, () => settingsStore.lineHeight);
  const fontSize = useStore(settingsStore, () => settingsStore.fontSize);
  const studyVerse = useStore(bibleStore, () => np.tab?.studyVerse ?? null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [showBack, setShowBack] = useState(false);
  const intent = useUserScrollIntent({ getScrollElement: () => scrollerRef.current, keysFromDocument: false, now });

  const { tab, book, chapter } = np;
  const ready = !!tab && !tab.loading && book !== null && chapter !== null && tab.book === book && tab.chapter === chapter;
  const chapterKey = ready ? `${book}:${chapter}` : null;
  const playingId = book !== null && chapter !== null && np.verse !== null ? book * 1_000_000 + chapter * 1_000 + np.verse : null;
  const verses = ready ? tab!.verses.filter(v => v.verse >= 1) : [];

  // Latest values for the long-lived effects below.
  const live = useRef({ playingId, ready });
  live.current = { playingId, ready };
  const centredKey = useRef<string | null>(null);
  // The selection when playback began or the reader last jumped: "Read from" is offered only when it changes after that.
  const studyBaseline = useRef<number | null | undefined>(undefined);
  if (studyBaseline.current === undefined && ready) studyBaseline.current = studyVerse;
  const checkFrame = useRef(0);
  const frame = useRef(0);

  const paused = () => now() - intent.lastAt.current < USER_SCROLL_PAUSE_MS;

  const verseEl = (id: number) => scrollerRef.current?.querySelector<HTMLElement>(`[data-verse-id="${id}"]`) ?? null;

  const inView = (id: number): boolean => {
    const scroller = scrollerRef.current;
    const el = verseEl(id);
    if (!scroller || !el) return true;
    const s = scroller.getBoundingClientRect();
    const v = el.getBoundingClientRect();
    return v.bottom > s.top && v.top < s.bottom;
  };

  const centre = (id: number, behavior: ScrollBehavior, attemptsLeft = RETRY_FRAMES) => {
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
      verseTop: v.top, verseHeight: v.height, scrollHeight: scroller.scrollHeight,
    });
    scroller.scrollTo({ top, behavior: behavior === 'smooth' && reducedMotion() ? 'auto' : behavior });
  };

  // A new chapter has arrived (or the pane just mounted): land on the verse at once.
  useEffect(() => {
    if (!chapterKey || centredKey.current === chapterKey) return;
    centredKey.current = chapterKey;
    setCursor(null);
    setShowBack(false);
    intent.clear();
    const id = live.current.playingId;
    if (id !== null) centre(id, 'auto');
  }, [chapterKey]);

  // Follow the verse being read.
  useEffect(() => {
    const off = audioStore.follow.subscribe(() => {
      const id = audioStore.follow.verseId;
      if (id === null || !live.current.ready) return;
      if (paused()) { setShowBack(!inView(id)); return; }
      setShowBack(false);
      setCursor(null); // the pause is over: the view is back on the verse being read
      if (centredKey.current !== `${Math.floor(id / 1_000_000)}:${Math.floor(id / 1_000) % 1_000}`) return; // the chapter turn lands it
      centre(id, 'smooth');
    });
    return () => { off(); cancelAnimationFrame(frame.current); };
  }, []);

  // Keep the pill honest while the reader scrolls, and let it go when the pause ends.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let pending = false;
    const check = () => {
      pending = false;
      const id = live.current.playingId;
      setShowBack(id !== null && paused() && !inView(id));
    };
    const onScroll = () => { if (!pending && paused()) { pending = true; checkFrame.current = requestAnimationFrame(check); } };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(checkFrame.current); };
  }, [ready]);

  // The pane resized (pop-up, rotation): re-centre instantly.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const id = live.current.playingId;
      if (id !== null && live.current.ready && !paused()) centre(id, 'auto');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  const jumpTo = (id: number) => {
    intent.clear();
    setShowBack(false);
    setCursor(null);
    studyBaseline.current = np.tab?.studyVerse ?? null;
    audioStore.jumpToVerse(id % 1000);
  };

  const onVerseClick = (id: number) => {
    if (typeof getSelection === 'function' && getSelection()?.toString()) return; // selecting text to copy
    jumpTo(id);
  };

  const backToPlaying = () => {
    intent.clear();
    setShowBack(false);
    if (playingId !== null) centre(playingId, 'auto');
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (verses.length === 0) return;
    const ids = verses.map(v => v.verse_id);
    const current = cursor ?? playingId ?? ids[0];
    const idx = Math.max(0, ids.indexOf(current));
    const move = (i: number) => {
      const id = ids[Math.min(ids.length - 1, Math.max(0, i))];
      e.preventDefault();
      intent.lastAt.current = now();
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
        if (cursor !== null && cursor !== playingId) e.stopPropagation();
        if (cursor !== null) {
          setCursor(null);
          if (playingId !== null) centre(playingId, 'smooth');
        }
        return;
    }
  };

  const moduleAbbr = tab?.moduleAbbr;
  const contentLang = moduleStore.getBibleModules().find(m => m.abbreviation === moduleAbbr)?.language_code;
  const contentDir = directionForLanguage(contentLang);
  const size = variant === 'phone' ? 20 : Math.min(fontSize, 22);

  const showReadFrom = ready && studyVerse !== null && studyVerse !== studyBaseline.current && playingId !== null && studyVerse !== playingId
    && Math.floor(studyVerse / 1000) === (book as number) * 1000 + (chapter as number);
  const readFromRef = showReadFrom ? `${np.chapterLabel}:${studyVerse! % 1000}` : '';
  const activeId = cursor ?? playingId;

  return (
    <div class={`audio-verses-wrap audio-verses-wrap--${variant}`}>
      <div
        ref={scrollerRef}
        class="audio-verses"
        role="listbox"
        tabIndex={0}
        aria-label={t('audio.verses.label')}
        aria-live="off"
        aria-activedescendant={activeId !== null && ready ? `audio-v-${activeId}` : undefined}
        dir={contentDir}
        lang={contentLang}
        data-content-dir={contentDir}
        style={{ fontFamily, lineHeight, fontSize: `${size}px` }}
        onKeyDown={onKeyDown}
      >
        {ready ? verses.map(v => (
          <div
            key={v.verse_id}
            id={`audio-v-${v.verse_id}`}
            role="option"
            aria-selected={v.verse_id === playingId}
            class={`audio-verses__opt${v.verse_id === cursor ? ' audio-verses__opt--cursor' : ''}`}
          >
            <VerseRenderer
              verse={v}
              displayMode="standard"
              showVerseNumbers
              isHighlighted={false}
              isSelected={false}
              isPlaying={v.verse_id === playingId}
              onVerseClick={onVerseClick}
            />
          </div>
        )) : (
          <div class="audio-verses__spinner" role="status" aria-live="off"><i class="fa-solid fa-spinner fa-spin" /></div>
        )}
      </div>
      {(showBack || showReadFrom) && (
        <div class="audio-verses__pills">
          {showBack && playingId !== null && (
            <button type="button" class="audio-verses__pill audio-verses__pill--back" onClick={backToPlaying}>
              {t('audio.verses.backTo', { verse: playingId % 1000 })}
            </button>
          )}
          {showReadFrom && (
            <button type="button" class="audio-verses__pill audio-verses__pill--from" onClick={() => jumpTo(studyVerse!)}>
              {t('audio.verses.readFrom', { ref: readFromRef })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
