/**
 * After a chapter has been read to its end: "Finished John 3" with a button that reads the next
 * chapter (turning the page first) and a close button. Shown where the player was: in place of the
 * phone's mini-player, and as the desktop bar's strip. `audioStore.finished` drives it.
 */

import { useTranslation } from 'react-i18next';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { bibleStore } from '../../../stores/bibleStore';
import { moduleStore } from '../../../stores/moduleStore';

/** The chapter after `book:chapter`, into the next book at a book's end; null after Revelation 22. */
export function nextChapterOf(book: number, chapter: number): { book: number; chapter: number } | null {
  const count = moduleStore.getBookByNumber(book)?.chapter_count ?? 0;
  if (chapter < count) return { book, chapter: chapter + 1 };
  return book < 66 ? { book: book + 1, chapter: 1 } : null;
}

export function AudioFinished({ variant }: { variant: 'phone' | 'desktop' }) {
  const { t } = useTranslation();
  const finished = useStore(audioStore, () => audioStore.finished);
  const status = useStore(audioStore, () => audioStore.status);
  if (!finished || status !== 'idle') return null;

  const name = (b: number) => moduleStore.getBookName(b) || String(b);
  const next = nextChapterOf(finished.book, finished.chapter);
  const tabExists = bibleStore.tabs.some(x => x.id === finished.tabId);

  const playNext = async () => {
    if (!next) return;
    const tabId = tabExists ? finished.tabId : bibleStore.activeTabId ?? undefined;
    await bibleStore.navigateTo(next.book, next.chapter, undefined, { tabId });
    if (variant === 'phone') audioStore.openPlayer();
    void audioStore.play(tabId);
  };

  return (
    <div class={`audio-finished audio-finished--${variant}`} role="status" data-testid="audio-finished">
      <span class="audio-finished__text">
        {t('audio.finished.done', { ref: `${name(finished.book)} ${finished.chapter}` })}
      </span>
      {next && (
        <button type="button" class="audio-btn audio-btn--primary audio-finished__next" onClick={() => { void playNext(); }} data-testid="audio-finished-next">
          <i class="fa-solid fa-play" aria-hidden="true" />
          <span>{t('audio.finished.next', { ref: `${name(next.book)} ${next.chapter}` })}</span>
        </button>
      )}
      <button type="button" class="audio-btn" onClick={() => audioStore.dismissFinished()} title={t('audio.action.dismiss')} aria-label={t('audio.action.dismiss')}>
        <i class="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </div>
  );
}
