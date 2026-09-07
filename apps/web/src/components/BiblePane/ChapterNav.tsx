import { useTranslation } from 'react-i18next';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { isSingleChapterBook } from '../../constants';

export function ChapterNav() {
  const { t } = useTranslation();
  const tab = useStore(bibleStore, () => bibleStore.getActiveTab());

  if (!tab?.book || !tab.chapter) return null;

  const book = moduleStore.getBookByNumber(tab.book);
  const maxChapter = book?.chapter_count ?? 999;

  // Paging is a sequential step: it modifies the current history entry instead
  // of appending one per chapter read through.
  const PAGE = { replace: true } as const;

  const goToPrev = () => {
    if (!tab.book || !tab.chapter) return;

    if (tab.chapter > 1) {
      bibleStore.navigateTo(tab.book, tab.chapter - 1, undefined, PAGE);
    } else if (tab.book > 1) {
      const prevBook = moduleStore.getBookByNumber(tab.book - 1);
      if (prevBook) {
        bibleStore.navigateTo(tab.book - 1, prevBook.chapter_count, undefined, PAGE);
      }
    }
  };

  const goToNext = () => {
    if (!tab.book || !tab.chapter) return;

    if (tab.chapter < maxChapter) {
      bibleStore.navigateTo(tab.book, tab.chapter + 1, undefined, PAGE);
    } else if (tab.book < 66) {
      bibleStore.navigateTo(tab.book + 1, 1, undefined, PAGE);
    }
  };

  const canGoPrev = tab.book > 1 || tab.chapter > 1;
  const canGoNext = tab.book < 66 || tab.chapter < maxChapter;

  const bookName = moduleStore.getBookName(tab.book);

  return (
    <div class="chapter-nav">
      <button class="chapter-nav__btn" disabled={!canGoPrev} onClick={goToPrev}>
        {t('chapterNav.prev')}
      </button>
      <span class="chapter-nav__label">{isSingleChapterBook(tab.book) ? bookName : `${bookName} ${tab.chapter}`}</span>
      <button class="chapter-nav__btn" disabled={!canGoNext} onClick={goToNext}>
        {t('chapterNav.next')}
      </button>
    </div>
  );
}
