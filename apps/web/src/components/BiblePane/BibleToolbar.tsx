import { useState, useRef, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { TranslationDialog } from './TranslationDialog';

interface BibleToolbarProps {
  onOpenSettings?: (section?: string) => void;
}

export function BibleToolbar({ onOpenSettings }: BibleToolbarProps) {
  const { t } = useTranslation();
  const tab = useStore(bibleStore, () => bibleStore.getActiveTab());
  const displayMode = tab?.displayMode ?? 'standard';
  const canGoBack = useStore(bibleStore, () => bibleStore.canGoBack());
  // Read as state, not through a getter, so the open menu re-renders when a
  // click inside it navigates.
  const history = useStore(bibleStore, () => bibleStore.getHistory());
  const historyIndex = useStore(bibleStore, () => bibleStore.getHistoryIndex());
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const [showTranslationDialog, setShowTranslationDialog] = useState(false);

  if (!tab) return null;

  const handleTranslationSelect = (abbr: string) => {
    bibleStore.setTabTranslation(tab.id, abbr);
    setShowTranslationDialog(false);
  };

  // Close the history menu on an outside click. Registered for the component's
  // life with the open flag in a ref: Preact flushes effects on an animation
  // frame, so an open-triggered listener is not live for the menu's first
  // frames — the same reason the translation dialog does it this way.
  const historyOpenRef = useRef(false);
  historyOpenRef.current = showHistory;
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!historyOpenRef.current) return;
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Navigate to previous/next chapter
  const book = tab.book ? moduleStore.getBookByNumber(tab.book) : null;
  const maxChapter = book?.chapter_count ?? 999;

  // Paging is a sequential step, so it modifies the current history entry
  // rather than leaving a breadcrumb for every chapter passed through.
  const PAGE = { replace: true } as const;

  const goToPrevChapter = () => {
    if (!tab.book || !tab.chapter) return;
    if (tab.chapter > 1) {
      bibleStore.navigateTo(tab.book, tab.chapter - 1, undefined, PAGE);
    } else if (tab.book > 1) {
      const prevBook = moduleStore.getBookByNumber(tab.book - 1);
      if (prevBook) bibleStore.navigateTo(tab.book - 1, prevBook.chapter_count, undefined, PAGE);
    }
  };

  const goToNextChapter = () => {
    if (!tab.book || !tab.chapter) return;
    if (tab.chapter < maxChapter) {
      bibleStore.navigateTo(tab.book, tab.chapter + 1, undefined, PAGE);
    } else if (tab.book < 66) {
      bibleStore.navigateTo(tab.book + 1, 1, undefined, PAGE);
    }
  };

  const canGoPrevChapter = tab.book !== null && tab.chapter !== null && (tab.book > 1 || (tab.chapter ?? 0) > 1);
  const canGoNextChapter = tab.book !== null && tab.chapter !== null && (tab.book < 66 || (tab.chapter ?? 0) < maxChapter);

  return (
    <div class="bible-toolbar">
      <div class="bible-toolbar__left">
        {/* History navigation - far left.
            The back arrow is `reply` — a curved, directional glyph. The
            circular `rotate-left` it replaced is the universal "reload" mark,
            which is not what the button does. */}
        <div class="bible-toolbar__nav" title={t('bibleToolbar.history')} ref={historyRef}>
          <button
            class="bible-toolbar__nav-btn"
            disabled={!canGoBack}
            onClick={() => bibleStore.goBack()}
            title={t('bibleToolbar.goBack')}
            aria-label={t('bibleToolbar.goBack')}
          >
            <i class="fa-solid fa-reply" />
          </button>
          {/* No forward button: Back plus the Recent Passages menu covers it,
              and the menu says where it is going by name. */}
          <button
            class="bible-toolbar__nav-btn"
            onClick={() => setShowHistory(v => !v)}
            // Without this the document-level dismissal below closes the menu a
            // beat before this button's own click would toggle it back open.
            onMouseDown={(e) => e.stopPropagation()}
            title={t('bibleToolbar.recentPassages')}
            aria-label={t('bibleToolbar.recentPassages')}
            aria-expanded={showHistory}
            aria-haspopup="menu"
            data-testid="history-dropdown-toggle"
          >
            <i class="fa-solid fa-clock-rotate-left" />
          </button>
          {showHistory && (
            <div class="bible-toolbar__history-menu" role="menu">
              <div class="bible-toolbar__history-heading">{t('bibleToolbar.recentPassages')}</div>
              {history.length === 0 ? (
                <div class="bible-toolbar__history-empty">{t('bibleToolbar.noHistory')}</div>
              ) : (
                history
                  .map((entry, index) => ({ entry, index }))
                  // Most recent first: the passage a reader wants is almost
                  // always the one they just came from.
                  .reverse()
                  .map(({ entry, index }) => {
                    const isCurrent = index === historyIndex;
                    const bookName = moduleStore.getBookName(entry.book) || `Book ${entry.book}`;
                    return (
                      <button
                        key={index}
                        role="menuitem"
                        aria-current={isCurrent ? 'true' : undefined}
                        class={`bible-toolbar__history-item${isCurrent ? ' bible-toolbar__history-item--current' : ''}`}
                        onClick={() => {
                          void bibleStore.goToHistoryEntry(index);
                          setShowHistory(false);
                        }}
                      >
                        <span class="bible-toolbar__history-dot" aria-hidden="true" />
                        <span class="bible-toolbar__history-label">
                          {bookName} {entry.chapter}{entry.verse ? `:${entry.verse}` : ''}
                        </span>
                        <span class="bible-toolbar__history-module">{entry.moduleAbbr}</span>
                      </button>
                    );
                  })
              )}
            </div>
          )}
        </div>

        {/* Display mode dropdown */}
        <select
          class="bible-toolbar__mode-select"
          value={displayMode}
          onChange={(e) => { if (tab) bibleStore.setDisplayMode(tab.id, (e.target as HTMLSelectElement).value as 'standard' | 'reading' | 'study'); }}
        >
          {(['standard', 'reading', 'study'] as const).map(mode => (
            <option key={mode} value={mode}>{t('bibleToolbar.mode' + mode.charAt(0).toUpperCase() + mode.slice(1))}</option>
          ))}
        </select>

        <button
          class="bible-toolbar__translation-btn"
          onClick={() => setShowTranslationDialog(true)}
          title={t('bibleToolbar.changeTranslation')}
        >
          {tab.moduleAbbr} <i class="fa-solid fa-caret-down" style={{ fontSize: '10px', opacity: 0.6 }} />
        </button>
      </div>

      <div class="bible-toolbar__right">
        <button
          class="bible-toolbar__btn"
          onClick={() => onOpenSettings?.('bible-font')}
          title={t('bibleToolbar.textSettings')}
        >
          Aa
        </button>

        {/* Chapter navigation - far right (hidden on mobile) */}
        <div class="bible-toolbar__nav bible-toolbar__chapter-nav" title={t('bibleToolbar.chapter')}>
          <button
            class="bible-toolbar__nav-btn"
            disabled={!canGoPrevChapter}
            onClick={goToPrevChapter}
            title={t('bibleToolbar.prevChapter')}
          >
            <i class="fa-solid fa-chevron-left" />
          </button>
          <button
            class="bible-toolbar__nav-btn"
            disabled={!canGoNextChapter}
            onClick={goToNextChapter}
            title={t('bibleToolbar.nextChapter')}
          >
            <i class="fa-solid fa-chevron-right" />
          </button>
        </div>
      </div>

      <TranslationDialog
        isOpen={showTranslationDialog}
        onClose={() => setShowTranslationDialog(false)}
        currentAbbr={tab.moduleAbbr}
        onSelect={handleTranslationSelect}
      />
    </div>
  );
}
