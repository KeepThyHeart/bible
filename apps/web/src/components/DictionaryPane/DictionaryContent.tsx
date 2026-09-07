import { useRef, useEffect, useMemo, useCallback, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { dictionaryStore } from '../../stores/dictionaryStore';
import { searchStore } from '../../stores/searchStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { useStore } from '../../hooks/useStore';
import { useVersePopup } from '../../hooks/useVersePopup';
import { processCommentaryLinks } from '../../../../../packages/core/src/Services/CommentaryLinkProcessor';
import { linkStrongsRefs } from '../../utils/strongsLinks';
import { sanitizeHtml } from '../../utils/sanitize';
import { newlinesToLineBreaks, resolveNewlineHandling } from '@bible/core/browser';
import type { IBibleDataProvider } from '../../providers/interfaces';

/**
 * The Strong's number this entry represents, or null for an ordinary dictionary.
 * Strong's entry keys are 5-digit zero-padded and carry no prefix ("00025"), so
 * the G/H comes from which of the two lexicons the tab is showing.
 */
function strongsNumberFor(moduleAbbr: string, entryKey: string): string | null {
  if (!/^strongs/i.test(moduleAbbr)) return null;
  const digits = entryKey.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  return `${/hebrew/i.test(moduleAbbr) ? 'H' : 'G'}${digits}`;
}

interface DictionaryContentProps {
  tabId: string;
  bibleProvider?: IBibleDataProvider;
}

export function DictionaryContent({ tabId, bibleProvider }: DictionaryContentProps) {
  const { t } = useTranslation();
  const tab = useStore(dictionaryStore, () => dictionaryStore.tabs.find(t => t.id === tabId));
  const tabState = useStore(dictionaryStore, () => dictionaryStore.getTabState(tabId));
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { containerProps: versePopupProps, popupJsx: versePopupJsx } = useVersePopup(bibleProvider);

  // Handle clicks on Strong's cross-reference links
  const handleStrongsClick = useCallback((e: Event) => {
    const target = e.target as HTMLElement;
    const link = target.closest('.strongs-link') as HTMLAnchorElement | null;
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      const strongsNum = link.dataset.strongs;
      if (strongsNum) {
        dictionaryStore.openStrongs(strongsNum);
      }
    }
  }, []);

  if (!tab) return null;

  const {
    searchQuery, suggestions, searchLoading, searchError, searchCompleted,
    entry, entryLoading,
    browseLetters, browseLetter, browseEntries, browseOffset, browseTotal, browseLoading,
    adjacentPrev, adjacentNext,
  } = tabState;

  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions]);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (suggestions.length === 0 && !searchQuery) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          searchRef.current && !searchRef.current.contains(e.target as Node)) {
        dictionaryStore.clearTabSuggestions(tabId);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dictionaryStore.clearTabSuggestions(tabId);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [tabId, suggestions.length, searchQuery]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0 || !dropdownRef.current) return;
    const items = dropdownRef.current.querySelectorAll('.dictionary-content__search-dropdown-item');
    items[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const handleSearchKeyDown = useCallback((e: KeyboardEvent) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // highlightedIndex resets to -1 every time the suggestions change, so
      // requiring a highlight meant Enter did nothing at all unless the user
      // had first pressed ArrowDown. Typing a word and pressing Enter should
      // open the best match, which is what the list is already sorted by.
      const index = highlightedIndex >= 0 && highlightedIndex < suggestions.length
        ? highlightedIndex
        : 0;
      dictionaryStore.loadEntryInTab(tabId, suggestions[index].entry_key);
      dictionaryStore.clearTabSuggestions(tabId);
    }
  }, [suggestions, highlightedIndex, tabId]);

  // ── Entry view ───────────────────────────────────────────────────────
  if (entry && !entryLoading) {
    const strongsNumber = strongsNumberFor(tab.moduleAbbr, entry.entry_key);
    return (
      <div class="dictionary-content">
        {/* Full-width search bar */}
        <div class="dictionary-content__search-wrapper">
          <input
            ref={searchRef}
            class="dictionary-content__search"
            type="text"
            placeholder={`${t('dictionaryContent.search')} ${tab.moduleName}...`}
            value={searchQuery}
            onInput={(e) => dictionaryStore.setTabSearchQuery(tabId, (e.target as HTMLInputElement).value)}
            onKeyDown={handleSearchKeyDown}
          />
          {(suggestions.length > 0 || searchLoading || searchCompleted || searchError) && searchQuery && (
            <div class="dictionary-content__search-dropdown" ref={dropdownRef}>
              {searchLoading && suggestions.length === 0 && (
                <div class="dictionary-content__search-dropdown-loading">{t('dictionaryContent.searching')}</div>
              )}
              {suggestions.map((s, i) => (
                <button
                  key={s.entry_key}
                  class={`dictionary-content__search-dropdown-item ${i === highlightedIndex ? 'dictionary-content__search-dropdown-item--highlighted' : ''}`}
                  onClick={() => dictionaryStore.loadEntryInTab(tabId, s.entry_key)}
                >
                  <span class="dictionary-pane__suggestion-word">{s.word}</span>
                  {s.transliteration && (
                    <span class="dictionary-pane__suggestion-translit">({s.transliteration})</span>
                  )}
                </button>
              ))}
              {/* Say something when there is nothing. Rendering an empty
                  dropdown made a failed or fruitless search look like a
                  dead key press. */}
              {!searchLoading && suggestions.length === 0 && (searchError || searchCompleted) && (
                <div class="dictionary-content__search-dropdown-empty">
                  {searchError ?? t('dictionaryContent.noResults', { query: searchQuery, module: tab.moduleName })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Entry content */}
        <div class="dictionary-pane__entry">
          <div class="dictionary-pane__entry-header">
            <h3 class="dictionary-pane__entry-word">{entry.word}</h3>
            {entry.transliteration && (
              <span class="dictionary-pane__entry-translit">{entry.transliteration}</span>
            )}
            {entry.pronunciation && (
              <span class="dictionary-pane__entry-pron">[{entry.pronunciation}]</span>
            )}
            {entry.part_of_speech && (
              <span class="dictionary-pane__entry-pos">{entry.part_of_speech}</span>
            )}
            <div class="dictionary-pane__entry-nav">
              <button
                class="dictionary-content__toolbar-btn"
                disabled={!adjacentPrev}
                onClick={() => dictionaryStore.navigatePrev(tabId)}
                title={adjacentPrev ? `${t('dictionaryContent.prevEntry')} ${adjacentPrev.word || adjacentPrev.entry_key}` : t('dictionaryContent.noPrevEntry')}
              >
                <i class="fa-solid fa-chevron-left fa-xs" />
              </button>
              <button
                class="dictionary-content__toolbar-btn"
                disabled={!adjacentNext}
                onClick={() => dictionaryStore.navigateNext(tabId)}
                title={adjacentNext ? `${t('dictionaryContent.nextEntry')} ${adjacentNext.word || adjacentNext.entry_key}` : t('dictionaryContent.noNextEntry')}
              >
                <i class="fa-solid fa-chevron-right fa-xs" />
              </button>
              <button
                class="dictionary-content__toolbar-btn"
                onClick={() => dictionaryStore.clearEntryInTab(tabId)}
                title={t('dictionaryContent.browseEntries')}
              >
                <i class="fa-solid fa-list fa-xs" /> {t('dictionaryContent.browse')}
              </button>
            </div>
          </div>

          {/* Strong's lexicon entries can be searched across the Bible text.
              Clicking an interlinear chip lands here, so this is the one place
              that search is reachable without retyping the number by hand. */}
          {strongsNumber && (
            <button
              type="button"
              class="dictionary-content__strongs-search"
              data-testid="dictionary-search-occurrences"
              onClick={() => {
                searchStore.performSearch(strongsNumber);
                commentaryStore.setRightPaneMode('search');
                commentaryStore.expand();
              }}
            >
              <i class="fa-solid fa-magnifying-glass fa-xs" />
              <span>{t('dictionaryContent.searchOccurrences', { number: strongsNumber })}</span>
            </button>
          )}

          {entry.definition && (() => {
            // Order matters: `processCommentaryLinks` HTML-escapes each text
            // segment as it inserts anchors, so the escaping is already done
            // and only the line breaks are left to add. Deciding on the raw
            // definition, before the anchors exist, keeps the HTML fallback
            // from seeing markup this code just generated.
            const breaks = resolveNewlineHandling(entry.definition, entry.newline_handling) === 'significant';
            let linkedDef = processCommentaryLinks(entry.definition, { bookNumber: 1, chapter: 1 });
            linkedDef = linkStrongsRefs(linkedDef, tab.moduleAbbr);
            if (breaks) linkedDef = newlinesToLineBreaks(linkedDef);
            return (
              <div
                class="dictionary-pane__entry-definition"
                {...versePopupProps}
                onClick={(e: Event) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('.strongs-link')) {
                    handleStrongsClick(e);
                  } else {
                    versePopupProps.onClick(e);
                  }
                }}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(linkedDef) }}
              />
            );
          })()}

          {entry.etymology && (
            <div class="dictionary-pane__entry-section">
              <div class="dictionary-pane__entry-section-label">{t('dictionaryContent.etymology')}</div>
              <div>{entry.etymology}</div>
            </div>
          )}

          {entry.usage_notes && (
            <div class="dictionary-pane__entry-section">
              <div class="dictionary-pane__entry-section-label">{t('dictionaryContent.usage')}</div>
              <div>{entry.usage_notes}</div>
            </div>
          )}

          {/* Bottom nav links (book-pane style) */}
          {(adjacentPrev || adjacentNext) && (
            <div class="dictionary-content__bottom-nav">
              {adjacentPrev ? (
                <button
                  class="dictionary-content__bottom-nav-link"
                  onClick={() => dictionaryStore.navigatePrev(tabId)}
                >
                  <span class="dictionary-content__bottom-nav-arrow">&#8592;</span>
                  <div>
                    <div class="dictionary-content__bottom-nav-label">{t('dictionaryContent.previous')}</div>
                    <div class="dictionary-content__bottom-nav-title">{adjacentPrev.word || adjacentPrev.entry_key}</div>
                  </div>
                </button>
              ) : <div />}
              {adjacentNext ? (
                <button
                  class="dictionary-content__bottom-nav-link dictionary-content__bottom-nav-link--next"
                  onClick={() => dictionaryStore.navigateNext(tabId)}
                >
                  <div>
                    <div class="dictionary-content__bottom-nav-label">{t('dictionaryContent.next')}</div>
                    <div class="dictionary-content__bottom-nav-title">{adjacentNext.word || adjacentNext.entry_key}</div>
                  </div>
                  <span class="dictionary-content__bottom-nav-arrow">&#8594;</span>
                </button>
              ) : <div />}
            </div>
          )}
        </div>
        {versePopupJsx}
      </div>
    );
  }

  // ── Browse view (no entry loaded) ────────────────────────────────────
  return (
    <div class="dictionary-content">
      {/* Search with dropdown */}
      <div class="dictionary-content__search-wrapper">
        <input
          ref={searchRef}
          class="dictionary-content__search"
          type="text"
          placeholder={`Search ${tab.moduleName}...`}
          value={searchQuery}
          onInput={(e) => dictionaryStore.setTabSearchQuery(tabId, (e.target as HTMLInputElement).value)}
          onKeyDown={handleSearchKeyDown}
        />
        {(suggestions.length > 0 || searchLoading || searchCompleted || searchError) && searchQuery && (
          <div class="dictionary-content__search-dropdown" ref={dropdownRef}>
            {searchLoading && suggestions.length === 0 && (
              <div class="dictionary-content__search-dropdown-loading">{t('dictionaryContent.searching')}</div>
            )}
            {suggestions.map((s, i) => (
              <button
                key={s.entry_key}
                class={`dictionary-content__search-dropdown-item ${i === highlightedIndex ? 'dictionary-content__search-dropdown-item--highlighted' : ''}`}
                onClick={() => dictionaryStore.loadEntryInTab(tabId, s.entry_key)}
              >
                <span class="dictionary-pane__suggestion-word">{s.word}</span>
                {s.transliteration && (
                  <span class="dictionary-pane__suggestion-translit">({s.transliteration})</span>
                )}
                {s.part_of_speech && (
                  <span class="dictionary-pane__suggestion-pos">{s.part_of_speech}</span>
                )}
              </button>
            ))}
            {!searchLoading && suggestions.length === 0 && (searchError || searchCompleted) && (
              <div class="dictionary-content__search-dropdown-empty">
                {searchError ?? t('dictionaryContent.noResults', { query: searchQuery, module: tab.moduleName })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* While an entry is resolving, the loading line REPLACES the browse view.
          Rendering them side by side flashed a screen of Greek/Hebrew words for a
          frame before the definition landed. */}
      {entryLoading && <div class="dictionary-pane__loading">{t('dictionaryContent.loadingEntry')}</div>}

      {/* Alphabet bar */}
      {!entryLoading && browseLetters && browseLetters.length > 0 && (
        <div class="dictionary-content__alphabet">
          {browseLetters.map(l => (
            <button
              key={l.letter}
              class={`dictionary-content__alphabet-btn ${l.letter === browseLetter ? 'dictionary-content__alphabet-btn--active' : ''}`}
              onClick={() => dictionaryStore.loadBrowseEntries(tabId, l.letter)}
              title={`${l.letter} (${l.count})`}
            >
              {l.letter}
            </button>
          ))}
        </div>
      )}

      {!entryLoading && browseLoading && <div class="dictionary-pane__loading">{t('common.loading')}</div>}

      {!entryLoading && browseEntries.length > 0 && (
        <div class="dictionary-content__browse-list">
          {browseEntries.map(e => (
            <button
              key={e.entry_key}
              class="dictionary-content__browse-item"
              onClick={() => dictionaryStore.loadEntryInTab(tabId, e.entry_key)}
            >
              {e.word || e.entry_key}
            </button>
          ))}
          {browseOffset < browseTotal && !browseLoading && (
            <button
              class="dictionary-content__browse-more"
              onClick={() => dictionaryStore.loadMoreBrowseEntries(tabId)}
            >
              {t('dictionaryContent.loadMore', { count: browseTotal - browseOffset })}
            </button>
          )}
        </div>
      )}

      {!browseLoading && !entryLoading && browseEntries.length === 0 && !browseLetters && (
        <div class="dictionary-pane__placeholder">
          {t('dictionaryContent.browseEntriesIn')} {tab.moduleName}.
        </div>
      )}
    </div>
  );
}
