import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useDictionaryStore, type DictionaryEntry, type DictionaryEntrySummary } from '../../stores/useDictionaryStore';
import { useTextSettingsStore, getFontFamilyCSS } from '../../stores/useTextSettingsStore';
import { dictionaryAPI } from '../../services/electronAPI';
import { formatVerseReference } from '../../utils/verseReference';
import type { DockviewPanelApi } from 'dockview-react';
import { dictionaryDefinitionToHtml } from '@bible/core';
import { sanitizeHtml } from '../../utils/sanitize';
import { cleanModuleName } from '../../utils/verseFormatting';
import PaneEmptyState from '../onboarding/PaneEmptyState';
import PassageSettingsMenu from '../bible/PassageSettingsMenu';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { moveIntoBooksPane } from '../BookPane/moveIntoBooksPane';

interface DictionarySinglePanelProps {
  /** Dockview panel ID */
  panelId?: string;
  /** Dockview panel API for updating tab title */
  dockviewPanelApi?: DockviewPanelApi;
  /** The dictionary module abbreviation */
  contentKey: string;
}

/** One page of the Browse dialog. See DictionaryPane for why paging, not a count. */
const BROWSE_PAGE_SIZE = 100;

/**
 * Lightweight single-dictionary panel.
 *
 * Displays one dictionary module with lookup, search, and browse.
 * No tab bar, no module selector - just the content.
 */
const DictionarySinglePanel: React.FC<DictionarySinglePanelProps> = ({
  panelId,
  dockviewPanelApi,
  contentKey: abbreviation,
}) => {
  const { t } = useI18n();
  const [currentEntry, setCurrentEntry] = useState<DictionaryEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupInput, setLookupInput] = useState('');
  const [allEntries, setAllEntries] = useState<DictionaryEntrySummary[]>([]);
  // False until a page comes back short: there is no entry-count API, so the
  // end of the dictionary can only be detected by asking for one more page.
  const [allEntriesComplete, setAllEntriesComplete] = useState(false);
  const [searchResults, setSearchResults] = useState<DictionaryEntrySummary[]>([]);
  /** Which list the Browse dialog is showing, so its count line can say so. */
  const [browseMode, setBrowseMode] = useState<'all' | 'search'>('all');
  const [showBrowseModal, setShowBrowseModal] = useState(false);
  const [loadingBrowse, setLoadingBrowse] = useState(false);

  const textSettings = useTextSettingsStore(state => state.getSettings('dictionary'));

  // Resolve the module's display name.
  //
  // This panel is restored from the layout, so on a cold start where no
  // multi-tab Books pane ever mounted nothing else populates the catalog. A
  // one-shot `getState()` read then found nothing and the panel was stuck
  // showing the raw abbreviation forever - hence: load it if empty, and
  // subscribe so the name lands when it arrives.
  const availableDictionaries = useDictionaryStore(s => s.availableDictionaries);
  const loadAvailableDictionaries = useDictionaryStore(s => s.loadAvailableDictionaries);

  useEffect(() => {
    if (availableDictionaries.length === 0) {
      loadAvailableDictionaries();
    }
  }, [availableDictionaries.length, loadAvailableDictionaries]);

  const moduleName = useMemo(
    () => availableDictionaries.find(d => d.abbreviation === abbreviation)?.name
      ?? cleanModuleName(abbreviation),
    [availableDictionaries, abbreviation],
  );

  // Update dockview tab title when entry changes
  useEffect(() => {
    if (dockviewPanelApi) {
      if (currentEntry) {
        const label = currentEntry.word || currentEntry.entry_key;
        dockviewPanelApi.setTitle(`${abbreviation} - ${label}`);
      } else {
        dockviewPanelApi.setTitle(moduleName);
      }
    }
  }, [dockviewPanelApi, currentEntry, abbreviation, moduleName]);

  const lookupEntry = useCallback(async (entryKey: string): Promise<DictionaryEntry | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const entry = await dictionaryAPI.getEntryByKey(abbreviation, entryKey);
      setCurrentEntry(entry);
      if (!entry) {
        setError(t('dictionarySinglePanel.noEntryFound', { key: entryKey }));
      }
      return entry;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dictionarySinglePanel.loadEntryFailed'));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [abbreviation, t]);

  /**
   * Enter cascades: exact entry key -> text search -> open a single unambiguous
   * hit, or show the matches. Mirrors `DictionaryPane.handleLookup` - see the
   * long comment there for why exact-key-only was the wrong default.
   *
   * The typed term stays in the box so a miss leaves something to correct.
   */
  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = lookupInput.trim();
    if (!term) return;

    // Strong's numbers are stored zero-padded: "G3588" -> "03588".
    const strongsMatch = term.match(/^[GgHh](\d+)$/);
    const key = strongsMatch ? strongsMatch[1].padStart(5, '0') : term;

    if (await lookupEntry(key)) return;

    try {
      const results = await dictionaryAPI.searchEntries(abbreviation, key, 50);
      if (results.length === 1) {
        await lookupEntry(results[0].entry_key);
        return;
      }
      if (results.length > 1) {
        setSearchResults(results);
        setBrowseMode('search');
        setError(null);
        setShowBrowseModal(true);
      }
      // Zero results: the not-found message from the exact lookup still stands.
    } catch (err) {
      console.error('Dictionary search error:', err);
    }
  };

  /** Text search over the whole dictionary, shown in the browse dialog. */
  const runSearch = useCallback(async (term: string) => {
    if (!term) return;
    setLoadingBrowse(true);
    try {
      const results = await dictionaryAPI.searchEntries(abbreviation, term, 50);
      setSearchResults(results);
      setBrowseMode('search');
      setShowBrowseModal(true);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoadingBrowse(false);
    }
  }, [abbreviation]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await runSearch(lookupInput.trim());
  };

  /**
   * The return leg of "Open in own panel": put this dictionary back in the
   * Books pane as a tab, on the entry currently open, and close this panel.
   */
  const handleMoveIntoBooksPane = useCallback(() => {
    moveIntoBooksPane({
      type: 'dictionary',
      abbreviation,
      name: moduleName,
      entryKey: currentEntry?.entry_key ?? null,
      sourcePanelId: panelId,
    });
  }, [abbreviation, moduleName, currentEntry, panelId]);

  const handleBrowse = async () => {
    setBrowseMode('all');
    if (allEntries.length === 0) {
      setLoadingBrowse(true);
      try {
        const entries = await dictionaryAPI.getAllEntries(abbreviation, BROWSE_PAGE_SIZE);
        setAllEntries(entries);
        setAllEntriesComplete(entries.length < BROWSE_PAGE_SIZE);
      } catch (err) {
        console.error('Browse error:', err);
      } finally {
        setLoadingBrowse(false);
      }
    }
    setShowBrowseModal(true);
  };

  /**
   * Fetch the next page and append it. Stopping dead at 100 entries with
   * nothing said would make a lexicon of thousands read as a tiny module.
   */
  const handleLoadMore = async () => {
    setLoadingBrowse(true);
    try {
      const entries = await dictionaryAPI.getAllEntries(abbreviation, BROWSE_PAGE_SIZE, allEntries.length);
      setAllEntries(prev => [...prev, ...entries]);
      setAllEntriesComplete(entries.length < BROWSE_PAGE_SIZE);
    } catch (err) {
      console.error('Browse error:', err);
    } finally {
      setLoadingBrowse(false);
    }
  };

  const browseEntries = browseMode === 'search' ? searchResults : allEntries;

  const browseDialogRef = useFocusTrap<HTMLDivElement>(showBrowseModal);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-md px-md py-sm border-b border-border bg-background">
        <span className="text-sm text-text-secondary flex-shrink-0">{moduleName}</span>
        <form onSubmit={handleLookup} className="flex-1 flex items-center gap-sm">
          <input
            type="text"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder={t('dictionarySinglePanel.lookupPlaceholder')}
            className="flex-1 px-sm py-xs border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!lookupInput.trim() || isLoading}
            className="px-md py-xs bg-accent text-text-on-accent rounded hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('dictionarySinglePanel.lookupButton')}
          </button>
          {/* "Search text" (not "Search"): Enter already falls back to a search,
              so this button's distinct job is finding entries that *mention* the
              word rather than the entry *for* it. Matches DictionaryPane. */}
          <button
            type="button"
            onClick={handleSearch}
            disabled={!lookupInput.trim() || loadingBrowse}
            className="px-md py-xs bg-control text-text-primary rounded hover:bg-control-hover disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('dictionarySinglePanel.searchDefinitionsTitle')}
          >
            {t('dictionarySinglePanel.searchDefinitionsButton')}
          </button>
        </form>
        <button
          type="button"
          onClick={handleBrowse}
          className="px-md py-xs text-sm rounded hover:bg-background-warm transition-colors flex-shrink-0"
          aria-haspopup="dialog"
        >
          {t('dictionarySinglePanel.browseButton')}
        </button>
        {/*
          "Dictionary pane", not "Books pane". `moveIntoBooksPane` sends a module
          to a pane of its own kind now that the two are segregated, so a label
          naming the Books pane would describe a destination it does not go to.
        */}
        <button
          type="button"
          onClick={handleMoveIntoBooksPane}
          className="px-md py-xs text-sm rounded hover:bg-background-warm transition-colors flex-shrink-0"
          title={t('dictionarySinglePanel.moveIntoBooksPaneTitle')}
          data-testid="dictionary-single-move-into-books"
        >
          {t('dictionarySinglePanel.moveIntoBooksPane')}
        </button>
        {/* This panel had no text-settings control at all, so the one dictionary
            surface a reader can detach was also the one they could not set the
            type size on. */}
        <PassageSettingsMenu paneKey="dictionary" />
      </div>

      {/* Content Area */}
      <div
        className="flex-1 overflow-auto pane-content-dictionary"
        style={{
          '--pane-font-family-dictionary': getFontFamilyCSS(textSettings.fontFamily),
          '--pane-font-size-dictionary': `${textSettings.fontSize}px`,
          '--pane-line-height-dictionary': textSettings.lineHeight
        } as React.CSSProperties}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-text-secondary">{t('dictionarySinglePanel.loading')}</div>
          </div>
        ) : error ? (
          // Was a bare red line. A failed lookup is the most common thing that
          // lands here - including the Enter cascade's "no entry and no
          // matches" - so it offers the same two ways forward DictionaryPane
          // does rather than a dead end.
          <PaneEmptyState
            icon="🚫"
            testId="dictionary-single-error-state"
            title={t('dictionaryPane.lookupFailedTitle')}
            description={error}
            hint={t('dictionaryPane.lookupFailedHint')}
            actions={[
              {
                label: t('dictionaryPane.searchInsteadAction'),
                onClick: () => { void runSearch(lookupInput.trim()); },
                primary: true,
                testId: 'dictionary-single-error-search',
              },
              {
                label: t('onboarding.empty.dictionaryEntry.action'),
                onClick: () => { void handleBrowse(); },
                testId: 'dictionary-single-error-browse',
              },
            ]}
          />
        ) : !currentEntry ? (
          // Was a bare grey line of text. Someone who does not yet know what to
          // type needs a way in, so this matches DictionaryPane: explain the
          // pane and offer the browse list as an actual action.
          <PaneEmptyState
            icon="🔎"
            testId="dictionary-single-no-entry-state"
            title={t('dictionaryPane.singleNoEntryTitle')}
            description={t('dictionaryPane.singleNoEntryDescription')}
            actions={[
              {
                label: t('onboarding.empty.dictionaryEntry.action'),
                onClick: () => { void handleBrowse(); },
                primary: true,
                testId: 'dictionary-single-empty-browse',
              },
            ]}
          />
        ) : (
          <div className="px-xl py-lg max-w-4xl mx-auto">
            {/* Entry Header */}
            <div className="mb-lg">
              <h2 className="text-3xl font-bold text-text-heading mb-sm">
                {currentEntry.entry_key}
                {currentEntry.word && (
                  <span className="ms-md text-2xl text-text-secondary">{currentEntry.word}</span>
                )}
              </h2>
              <div className="flex items-center gap-md text-sm text-text-secondary mb-sm">
                {currentEntry.transliteration && <span className="italic">{currentEntry.transliteration}</span>}
                {currentEntry.pronunciation && <span>/{currentEntry.pronunciation}/</span>}
                {currentEntry.part_of_speech && (
                  <span className="px-sm py-xs bg-accent/10 text-accent rounded">{currentEntry.part_of_speech}</span>
                )}
              </div>
            </div>

            {/* Definition */}
            <div className="mb-xl">
              <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionarySinglePanel.definitionHeading')}</h3>
              <div className="prose prose-lg max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(dictionaryDefinitionToHtml(currentEntry.definition, currentEntry.newline_handling)) }} />
            </div>

            {/* Etymology */}
            {currentEntry.etymology && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionarySinglePanel.etymologyHeading')}</h3>
                <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(dictionaryDefinitionToHtml(currentEntry.etymology, currentEntry.newline_handling)) }} />
              </div>
            )}

            {/* Usage Notes */}
            {currentEntry.usage_notes && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionarySinglePanel.usageNotesHeading')}</h3>
                <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(dictionaryDefinitionToHtml(currentEntry.usage_notes, currentEntry.newline_handling)) }} />
              </div>
            )}

            {/* Related Words */}
            {currentEntry.related_words && currentEntry.related_words.length > 0 && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionarySinglePanel.relatedWordsHeading')}</h3>
                <div className="flex flex-wrap gap-sm">
                  {currentEntry.related_words.map((relatedKey, index) => (
                    <button
                      key={index}
                      onClick={() => lookupEntry(relatedKey)}
                      className="px-md py-sm bg-accent/10 text-accent rounded hover:bg-accent hover:text-text-on-accent transition-colors"
                    >
                      {relatedKey}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Example Verses */}
            {currentEntry.example_verses && currentEntry.example_verses.length > 0 && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionarySinglePanel.exampleVersesHeading')}</h3>
                <div className="space-y-sm">
                  {currentEntry.example_verses.map((verse, index) => (
                    <div key={index} className="p-md bg-background rounded">
                      <div className="text-sm font-semibold text-accent mb-xs">
                        {formatVerseReference(verse.verse_id)}
                      </div>
                      {verse.text && <div className="text-sm text-text-secondary">{verse.text}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Browse Modal */}
      {showBrowseModal && (
        <div
          className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50"
          onClick={() => setShowBrowseModal(false)}
        >
          {/* Dialog semantics, focus trap and Escape brought to parity with
              DictionaryPane's browse dialog - this copy had none of them. */}
          <div
            ref={browseDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dictionary-single-browse-title"
            className="rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden"
            style={{ backgroundColor: 'var(--theme-surface-elevated)' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setShowBrowseModal(false);
              }
            }}
          >
            <div className="px-xl py-lg border-b border-border">
              <h2 id="dictionary-single-browse-title" className="text-2xl font-semibold text-text-heading">
                {t('dictionarySinglePanel.browseTitle', { name: moduleName })}
              </h2>
            </div>
            <div className="overflow-y-auto max-h-[60vh] p-xl">
              {/* Only blank the list for the first page; "Load more" must leave
                  what is already read on screen. */}
              {loadingBrowse && browseEntries.length === 0 ? (
                <div className="text-center text-text-secondary">{t('dictionarySinglePanel.loadingEntries')}</div>
              ) : (
                <div className="space-y-sm">
                  <p className="text-sm text-text-secondary" data-testid="dictionary-single-browse-count">
                    {browseMode === 'search'
                      ? t('dictionarySinglePanel.browseMatchCount', { count: browseEntries.length })
                      : allEntriesComplete
                        ? t(
                          'dictionarySinglePanel.browseShowingAll',
                          { count: browseEntries.length },
                        )
                        : t(
                          'dictionarySinglePanel.browseShowingFirst',
                          { count: browseEntries.length },
                        )}
                  </p>
                  {browseEntries.map((entry) => (
                    <button
                      type="button"
                      key={entry.entry_key}
                      className="w-full text-start p-md border rounded cursor-pointer hover:bg-background-warm transition-colors"
                      onClick={() => { void lookupEntry(entry.entry_key); setShowBrowseModal(false); }}
                    >
                      <span className="block font-semibold text-text-heading">
                        {entry.entry_key}
                        {entry.word && <span className="ms-md text-text-secondary">{entry.word}</span>}
                      </span>
                      <span className="block text-sm text-text-secondary line-clamp-2 mt-xs">
                        {entry.definition.replace(/<[^>]*>/g, '')}
                      </span>
                    </button>
                  ))}
                  {browseMode === 'all' && !allEntriesComplete && (
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingBrowse}
                      className="w-full px-md py-sm bg-control text-text-primary rounded hover:bg-control-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="dictionary-single-browse-load-more"
                    >
                      {loadingBrowse
                        ? t('dictionarySinglePanel.loadingEntries')
                        : t('dictionarySinglePanel.browseLoadMore')}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="px-xl py-md border-t border-border flex justify-end">
              <button
                type="button"
                className="px-lg py-sm bg-control text-text-primary rounded hover:bg-control-hover"
                onClick={() => setShowBrowseModal(false)}
              >
                {t('dictionarySinglePanel.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DictionarySinglePanel;
