import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { dictionaryStore } from '../../stores/dictionaryStore';
import { offlineStore } from '../../stores/offlineStore';
import { useStore } from '../../hooks/useStore';
import { useVersePopup } from '../../hooks/useVersePopup';
import { processCommentaryLinks } from '../../../../../packages/core/src/Services/CommentaryLinkProcessor';
import { linkStrongsRefs } from '../../utils/strongsLinks';
import { sanitizeHtml } from '../../utils/sanitize';
import { newlinesToLineBreaks, resolveNewlineHandling } from '@bible/core/browser';
import type { IBibleDataProvider } from '../../providers/interfaces';

interface MobileDictionaryProps {
  bibleProvider?: IBibleDataProvider;
}

export function MobileDictionary({ bibleProvider }: MobileDictionaryProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useStore(dictionaryStore, () => dictionaryStore.homeSuggestions);
  const searchLoading = useStore(dictionaryStore, () => dictionaryStore.homeSearchLoading);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);

  // Track the current entry: module + key + data
  const [currentModule, setCurrentModule] = useState('');
  const [currentEntry, setCurrentEntry] = useState<any>(null);
  const [entryLoading, setEntryLoading] = useState(false);

  const { containerProps: versePopupProps, popupJsx: versePopupJsx } = useVersePopup(bibleProvider);

  // Handle clicks on Strong's cross-reference links within definitions
  const handleStrongsClick = useCallback((e: Event) => {
    const target = e.target as HTMLElement;
    const link = target.closest('.strongs-link') as HTMLAnchorElement | null;
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      const strongsNum = link.dataset.strongs;
      if (strongsNum) {
        dictionaryStore.openStrongs(strongsNum);
        // Load the entry directly in this mobile view
        const moduleAbbr = strongsNum.startsWith('H') ? 'strongshebrew' : 'strongsgreek';
        handleSelectEntry(strongsNum, moduleAbbr);
      }
    }
  }, []);

  // Auto-focus search on mount — only on desktop (mobile auto-focus opens keyboard)
  useEffect(() => {
    if (window.innerWidth > 768) inputRef.current?.focus();
  }, []);

  const handleInput = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    setSearchQuery(value);
    setShowSuggestions(true);
    dictionaryStore.setHomeSearchQuery(value);
  };

  const handleSelectEntry = async (entryKey: string, moduleAbbr: string) => {
    setShowSuggestions(false);
    setSearchQuery('');
    setEntryLoading(true);
    setCurrentModule(moduleAbbr);
    dictionaryStore.setHomeSearchQuery('');

    try {
      const baseUrl = (dictionaryStore as any).baseUrl || '';
      const res = await fetch(`${baseUrl}/api/dictionary/${moduleAbbr}/entry/${encodeURIComponent(entryKey)}`);
      if (res.ok) {
        setCurrentEntry(await res.json());
      }
    } catch { /* ignore */ }
    setEntryLoading(false);
  };

  const handleCancel = () => {
    setSearchQuery('');
    setShowSuggestions(false);
    dictionaryStore.setHomeSearchQuery('');
    inputRef.current?.blur();
  };

  const handleClear = () => {
    setSearchQuery('');
    setShowSuggestions(false);
    setCurrentEntry(null);
    setCurrentModule('');
    dictionaryStore.setHomeSearchQuery('');
    inputRef.current?.focus();
  };

  const handleFocus = () => {
    if (searchQuery) setShowSuggestions(true);
  };

  return (
    <div class="mobile-dictionary">
      {/* Search bar */}
      <div class="mobile-dictionary__search-bar">
        <i class="fa-solid fa-magnifying-glass mobile-dictionary__search-icon" />
        <input
          ref={inputRef}
          class="mobile-dictionary__search-input"
          type="text"
          placeholder={t('mobileDictionary.searchPlaceholder')}
          value={searchQuery}
          onInput={handleInput}
          onFocus={handleFocus}
        />
        {(searchQuery || currentEntry) && (
          <button
            class="mobile-dictionary__search-action"
            onClick={searchQuery ? handleCancel : handleClear}
            title={searchQuery ? t('mobileDictionary.cancel') : t('common.close')}
          >
            {searchQuery ? t('mobileDictionary.cancel') : <i class="fa-solid fa-xmark" />}
          </button>
        )}
      </div>

      {/* Suggestions */}
      {showSuggestions && searchQuery && (
        <div class="mobile-dictionary__suggestions">
          {searchLoading && (
            <div class="mobile-dictionary__loading">{t('mobileDictionary.searching')}</div>
          )}
          {!searchLoading && suggestions.length === 0 && searchQuery.length >= 2 && (
            <div class="mobile-dictionary__empty">{!isOnline ? t('mobileDictionary.offlineNotice') : t('mobileDictionary.noEntries')}</div>
          )}
          {suggestions.map((s) => (
            <button
              key={`${s.module_abbr}-${s.entry_key}`}
              class="mobile-dictionary__suggestion"
              onClick={() => handleSelectEntry(s.entry_key, s.module_abbr)}
            >
              <div class="mobile-dictionary__suggestion-word">
                {s.word}
                {s.transliteration && (
                  <span class="mobile-dictionary__suggestion-translit"> ({s.transliteration})</span>
                )}
              </div>
              <div class="mobile-dictionary__suggestion-meta">
                {s.part_of_speech && <span class="mobile-dictionary__suggestion-pos">{s.part_of_speech}</span>}
                <span class="mobile-dictionary__suggestion-module">{s.module_name}</span>
              </div>
              {s.definition && (
                <div class="mobile-dictionary__suggestion-def">
                  {s.definition.length > 100 ? s.definition.slice(0, 100) + '...' : s.definition}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Entry display */}
      {entryLoading && (
        <div class="mobile-dictionary__loading">{t('dictionaryContent.loadingEntry')}</div>
      )}
      {!showSuggestions && currentEntry && !entryLoading && (
        <div class="mobile-dictionary__entry">
          <div class="dictionary-pane__entry-header">
            <h3 class="dictionary-pane__entry-word">{currentEntry.word}</h3>
            {currentEntry.transliteration && (
              <span class="dictionary-pane__entry-translit">{currentEntry.transliteration}</span>
            )}
            {currentEntry.pronunciation && (
              <span class="dictionary-pane__entry-pron">[{currentEntry.pronunciation}]</span>
            )}
            {currentEntry.part_of_speech && (
              <span class="dictionary-pane__entry-pos">{currentEntry.part_of_speech}</span>
            )}
          </div>

          {currentEntry.definition && (() => {
            // See DictionaryContent for why the decision is taken on the raw
            // definition and only the breaks are applied afterwards.
            const breaks =
              resolveNewlineHandling(currentEntry.definition, currentEntry.newline_handling) === 'significant';
            let linkedDef = processCommentaryLinks(currentEntry.definition, { bookNumber: 1, chapter: 1 });
            linkedDef = linkStrongsRefs(linkedDef, currentModule);
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

          {currentEntry.etymology && (
            <div class="dictionary-pane__entry-section">
              <div class="dictionary-pane__entry-section-label">{t('dictionaryContent.etymology')}</div>
              <div>{currentEntry.etymology}</div>
            </div>
          )}

          {currentEntry.usage_notes && (
            <div class="dictionary-pane__entry-section">
              <div class="dictionary-pane__entry-section-label">{t('dictionaryContent.usage')}</div>
              <div>{currentEntry.usage_notes}</div>
            </div>
          )}
          {versePopupJsx}
        </div>
      )}

      {/* Empty state */}
      {!showSuggestions && !currentEntry && !entryLoading && (
        <div class="mobile-dictionary__empty-state">
          <i class="fa-solid fa-book-open" />
          <p>{t('mobileDictionary.searchPrompt')}</p>
        </div>
      )}
    </div>
  );
}
