import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { BookOneSvg } from '../common/inlineIcons';
import { dictionaryStore } from '../../stores/dictionaryStore';
import { useStore } from '../../hooks/useStore';

export function DictionaryHome() {
  const { t } = useTranslation();
  const homeSearchQuery = useStore(dictionaryStore, () => dictionaryStore.homeSearchQuery);
  const homeSuggestions = useStore(dictionaryStore, () => dictionaryStore.homeSuggestions);
  const homeSearchLoading = useStore(dictionaryStore, () => dictionaryStore.homeSearchLoading);
  const modules = useStore(dictionaryStore, () => dictionaryStore.modules);
  const starredModules = useStore(dictionaryStore, () => dictionaryStore.starredModules);


  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [homeSuggestions]);

  const handleSearchKeyDown = useCallback((e: KeyboardEvent) => {
    if (!homeSuggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(prev + 1, homeSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Same as the per-dictionary search: highlightedIndex resets to -1 on
      // every suggestion change, so gating on it made Enter a no-op unless the
      // user arrowed down first. Fall back to the best match.
      const index = highlightedIndex >= 0 && highlightedIndex < homeSuggestions.length
        ? highlightedIndex
        : 0;
      const s = homeSuggestions[index];
      dictionaryStore.openDictionaryEntry(s.entry_key, s.module_abbr, s.module_name);
    }
  }, [homeSuggestions, highlightedIndex]);

  // Sort: starred first, then alphabetical
  const sortedModules = [...modules].sort((a, b) => {
    const aStarred = starredModules.has(a.abbreviation) ? 0 : 1;
    const bStarred = starredModules.has(b.abbreviation) ? 0 : 1;
    if (aStarred !== bStarred) return aStarred - bStarred;
    return a.name.localeCompare(b.name);
  });

  return (
    <div class="dictionary-home">
      <input
        class="dictionary-home__search"
        type="text"
        placeholder={t('dictionaryHome.searchAll')}
        value={homeSearchQuery}
        onInput={(e) => dictionaryStore.setHomeSearchQuery((e.target as HTMLInputElement).value)}
        onKeyDown={handleSearchKeyDown}
      />

      {homeSearchLoading && <div class="dictionary-pane__loading">{t('dictionaryHome.searching')}</div>}

      {homeSuggestions.length > 0 && (
        <div class="dictionary-home__suggestions">
          {homeSuggestions.map((s, i) => (
            <button
              key={`${s.module_abbr}:${s.entry_key}`}
              class={`dictionary-home__suggestion ${i === highlightedIndex ? 'dictionary-home__suggestion--highlighted' : ''}`}
              onClick={() => dictionaryStore.openDictionaryEntry(s.entry_key, s.module_abbr, s.module_name)}
            >
              <span class="dictionary-home__suggestion-word">{s.word}</span>
              <span class="dictionary-home__suggestion-source">{s.module_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Dictionary cards (shown when not searching) */}
      {!homeSearchQuery && (
        <div class="dictionary-home__cards">
          {sortedModules.map(m => {
            const isStarred = starredModules.has(m.abbreviation);
            return (
              <div
                key={m.abbreviation}
                class={`dictionary-home__card ${isStarred ? 'dictionary-home__card--starred' : ''}`}
              >
                <button
                  class="dictionary-home__card-body"
                  onClick={() => dictionaryStore.openTemporaryTab(m.abbreviation, m.name)}
                >
                  <span class="dictionary-home__card-icon" dangerouslySetInnerHTML={{ __html: BookOneSvg }} />
                  <span class="dictionary-home__card-name">{m.name}</span>
                </button>
                <i
                  class={`fa-${isStarred ? 'solid' : 'regular'} fa-star dictionary-home__card-star ${isStarred ? 'dictionary-home__card-star--active' : ''}`}
                  title={isStarred ? t('dictionaryHome.unstar') : t('dictionaryHome.star')}
                  onClick={(e: MouseEvent) => { e.stopPropagation(); dictionaryStore.toggleStarred(m.abbreviation); }}
                />
              </div>
            );
          })}
          {modules.length === 0 && (
            <div class="dictionary-pane__placeholder">{t('dictionaryHome.noDictionaries')}</div>
          )}
        </div>
      )}
    </div>
  );
}
