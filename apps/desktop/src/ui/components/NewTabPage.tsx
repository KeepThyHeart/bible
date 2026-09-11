import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLayoutStore, type PanelContentType } from '../stores/useLayoutStore';
import { useBibleStore, encodeBibleContentKey } from '../stores/useBibleStore';
import { parseVerseReference, getAllBooks } from '../utils/verseParser';
import { useI18n } from '../contexts/useI18n';
import { genericEnglishTitle } from '../utils/paneNames';
// Same icon rule the panel tab uses, so a category tile and the tab it creates
// never disagree - separate lists drift.
import { chooserIconFor } from './paneIcons';
import type { DockviewPanelApi } from 'dockview-react';

interface NewTabPageProps {
  panelId: string;
  dockviewPanelApi?: DockviewPanelApi;
}

/** Parse "Book Chapter" format (without verse), e.g. "John 3", "Genesis 1" */
function parseBookChapter(input: string): { bookNumber: number; bookName: string; chapter: number } | undefined {
  const normalized = input.trim().toLowerCase();
  const match = normalized.match(/^([123]?\s*[a-z]+(?:\s+of\s+[a-z]+)?)\s+(\d+)$/i);
  if (!match) return undefined;

  const [, bookPart, chapterStr] = match;
  const bookNameLower = bookPart.trim();
  const allBooks = getAllBooks();
  for (const book of allBooks) {
    if (book.name.toLowerCase() === bookNameLower) {
      return { bookNumber: book.number, bookName: book.name, chapter: parseInt(chapterStr, 10) };
    }
  }
  // Try common abbreviations via parseVerseReference by appending ":1"
  const withVerse = parseVerseReference(`${input.trim()}:1`);
  if (withVerse) {
    return { bookNumber: withVerse.bookNumber, bookName: withVerse.bookName, chapter: withVerse.chapter };
  }
  return undefined;
}

/** Keywords that map to content types */
const KEYWORD_MAP: Record<string, PanelContentType> = {
  bible: 'bible',
  commentary: 'commentary',
  comm: 'commentary',
  books: 'book',
  book: 'book',
  dictionary: 'dictionary',
  dict: 'dictionary',
  notes: 'notes',
  note: 'notes',
  prayer: 'prayer',
  study: 'study',
  topics: 'topics',
  topic: 'topics',
};

/**
 * "New Tab" page shown when user clicks "+" in a dockview group.
 * Provides a quick-reference input and category buttons.
 *
 * - Type a verse reference (e.g. "John 3:16") and press Enter to open a Bible passage
 * - Type a keyword like "Commentary" or "Books" and press Enter
 * - Or click one of the quick action buttons
 */
const NewTabPage: React.FC<NewTabPageProps> = ({ panelId, dockviewPanelApi }) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the input on mount
  useEffect(() => {
    // Small delay to ensure the panel is fully rendered
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const replaceWithPanel = useCallback((contentType: PanelContentType, contentKey?: string, displayName?: string, subtitle?: string) => {
    const api = useLayoutStore.getState().dockviewApi; // allow-getstate: event handler - dockview API access outside render
    if (!api || !dockviewPanelApi) return;

    // Get the group of the current newtab panel
    const currentPanel = api.getPanel(panelId);
    if (!currentPanel) return;
    const group = currentPanel.group;

    // Create the replacement BEFORE closing the placeholder.
    //
    // Closing first looks tidier but is a trap: if this New Tab page is the
    // only panel in its group, closing it removes the group, and dockview then
    // accepts the now-dangling group object as a position and opens the
    // replacement into a group that is no longer in the grid. The panel - and
    // with it the whole pane - silently disappears. Creating first keeps the
    // group alive, and if creation fails the user still has the New Tab page
    // rather than an empty workbench.
    const index = group.panels.indexOf(currentPanel);
    const createdId = useLayoutStore.getState().addPanel( // allow-getstate: event handler - imperative panel creation
      contentType,
      contentKey,
      displayName || contentType,
      { referenceGroup: group, direction: 'within', ...(index >= 0 ? { index } : {}) },
      subtitle,
    );

    if (!createdId) {
      setError(t('layout.newTab.createFailed'));
      return;
    }

    currentPanel.api.close();
  }, [panelId, dockviewPanelApi, t]);

  /**
   * Open a typed passage in the default Bible. Immediate whenever the default
   * is already known - every normal session, since the Bible pane has loaded
   * the installed list long before anyone types here - and waits for that list
   * only when it has not been loaded.
   */
  const openPassage = useCallback((
    book: number,
    chapter: number,
    bookName: string,
    selectedVerseId?: number,
  ) => {
    const open = (abbreviation: string | undefined): void => {
      if (!abbreviation) {
        // No Bible installed: there is nothing to open the passage in.
        setError(t('layout.newTab.createFailed'));
        return;
      }
      // No displayMode: let the seed carry the app default (Standard) rather
      // than pinning Reading, which hides verse numbers.
      const contentKey = encodeBibleContentKey({ abbreviation, book, chapter, selectedVerseId });
      replaceWithPanel('bible', contentKey, `${bookName} ${chapter}`, abbreviation);
    };

    const bibleStore = useBibleStore.getState(); // allow-getstate: event handler - imperative store access outside render
    const known = bibleStore.getDefaultBible();
    if (known) {
      open(known);
      return;
    }
    void bibleStore.resolveDefaultBible().then(open);
  }, [replaceWithPanel, t]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setError(null);

    // Check for keyword match first
    const lower = trimmed.toLowerCase();
    const matchedType = KEYWORD_MAP[lower];
    if (matchedType) {
      // Title-casing the user's own text applied English casing rules to a
      // string that becomes the panel's persisted title. Since the input has
      // already matched a known content type, use that type's canonical English
      // label instead - `localizePaneLabel` recognizes it and translates it at
      // render time, in whatever locale is active later.
      replaceWithPanel(matchedType, undefined, genericEnglishTitle(matchedType));
      return;
    }

    // Try parsing as a full verse reference (e.g. "John 3:16")
    const parsed = parseVerseReference(trimmed);
    if (parsed) {
      // The verse the user typed. Dropping it opened "John 5:5" on John 5
      // with nothing selected and no scroll - the reference was parsed and
      // then thrown away one line later.
      openPassage(parsed.bookNumber, parsed.chapter, parsed.bookName, parsed.verseIdStart);
      return;
    }

    // Try parsing as "Book Chapter" (no verse, e.g. "John 3")
    const chapterRef = parseBookChapter(trimmed);
    if (chapterRef) {
      openPassage(chapterRef.bookNumber, chapterRef.chapter, chapterRef.bookName);
      return;
    }

    // One ICU message with the offending input as a placeholder - never a
    // translated prefix glued to an English tail.
    setError(
      t('newTabPage.unrecognizedInput', { input: trimmed }),
    );
  }, [query, replaceWithPanel, openPassage, t]);

  const handleQuickAction = useCallback((type: PanelContentType) => {
    // Deliberately NOT the button's visible label. That text is already
    // localized, and this value becomes the panel's persisted title - so
    // creating a pane in Arabic would write "التفسير" into the saved layout,
    // where `localizePaneLabel` (which matches generic English) can never
    // translate it again, even after switching back to English. Store the
    // canonical English label and let the tab strip localize per render.
    replaceWithPanel(type, undefined, genericEnglishTitle(type));
  }, [replaceWithPanel]);

  const inputId = `newtab-query-${panelId}`;
  const errorId = `newtab-error-${panelId}`;

  return (
    <div className="h-full flex flex-col items-center justify-center bg-background text-text-primary overflow-auto">
      <div className="w-full max-w-xl px-lg py-lg">
        <h2 className="text-lg font-semibold text-text-heading text-center mb-xs">
          {t('newTabPage.heading')}
        </h2>

        <p className="text-sm text-text-secondary text-center mb-md leading-relaxed">
          {t('newTabPage.intro')}
        </p>

        {/* Quick reference input */}
        <form onSubmit={handleSubmit}>
          <label htmlFor={inputId} className="sr-only">
            {t('newTabPage.inputLabel')}
          </label>
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(null); }}
            placeholder={t('newTabPage.placeholder')}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className="w-full px-md py-sm text-base rounded-lg border-2 border-border bg-input text-input-text placeholder:text-input-placeholder focus:outline-none focus:border-accent"
          />
        </form>

        {error && (
          <p id={errorId} role="alert" className="text-xs text-danger-text mt-xs">
            {error}
          </p>
        )}

        {/* A fixed four-column grid, not a wrapping flex row. The tiles are
            deliberately uniform: the pane is a chooser, and ragged rows of
            label-width buttons made the eight kinds read as a sentence rather
            than a menu. Four columns fit the `max-w-xl` body at a comfortable
            tile size, and each tile stacks its icon over its label so a narrow
            pane shrinks the tiles instead of reflowing the grid. */}
        <div className="grid grid-cols-4 gap-sm mt-lg">
          {([
            // Row 1 is where a new pane usually goes: Scripture, then the two
            // places the user writes. Row 2 is the study apparatus that hangs
            // off a verse. Array order is row order.
            ['bible', t('newTabPage.type.bible')],
            ['notes', t('newTabPage.type.notes')],
            ['prayer', t('newTabPage.type.prayer')],
            ['book', t('newTabPage.type.book')],
            ['study', t('newTabPage.type.study')],
            ['commentary', t('newTabPage.type.commentary')],
            ['dictionary', t('newTabPage.type.dictionary')],
            ['topics', t('newTabPage.type.topics')],
          ] as [PanelContentType, string][]).map(([type, label]) => {
            // Every tile carries a glyph. The tab strip's iconless rule is
            // about a crowded horizontal strip, not about a grid of tiles the
            // user is scanning cold - see `chooserIconFor`.
            const icon = chooserIconFor(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => handleQuickAction(type)}
                className="flex flex-col items-center justify-center gap-xs min-w-0 px-xs py-md text-xs rounded border border-border bg-transparent text-text-primary hover:bg-background-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors"
              >
                {icon && <span aria-hidden="true" className="text-xl leading-none">{icon}</span>}
                <span className="w-full text-center leading-tight break-words">{label}</span>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-text-muted text-center mt-md leading-relaxed">
          {t('newTabPage.hint')}
        </p>
      </div>
    </div>
  );
};

export default NewTabPage;
