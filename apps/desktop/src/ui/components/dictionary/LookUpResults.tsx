import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useLookUpStore } from '../../stores/useLookUpStore';
import { useDictionaryStore } from '../../stores/useDictionaryStore';

/**
 * The Dictionary pane's "Look up" results: the word the reader asked about and every installed
 * dictionary's entries for it, grouped by dictionary (the Strong's lexicon first for a tagged word).
 * Picking an entry opens it in its dictionary below; Close dismisses the results.
 */
export const LookUpResults: React.FC<{ panelId: string }> = ({ panelId }) => {
  const { t } = useI18n();
  const query = useLookUpStore(s => s.query);
  const groups = useLookUpStore(s => s.groups);
  const loading = useLookUpStore(s => s.loading);
  const clear = useLookUpStore(s => s.clear);
  if (!query) return null;

  const openEntry = async (abbreviation: string, name: string, key: string) => {
    const store = useDictionaryStore.getState(); // allow-getstate: event handler - imperative navigation
    store.setStudyPaneActiveTab('dictionary');
    store.openDictionary(panelId, abbreviation, name);
    await store.lookupEntry(panelId, abbreviation, key);
    clear();
  };

  return (
    <section
      className="px-md py-sm border-b border-border bg-background-warm max-h-[45%] overflow-auto"
      aria-label={t('lookUp.resultsLabel', { word: query.text })}
      data-testid="lookup-results"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-text-heading">
          {t('lookUp.heading', { word: query.text })}
        </h3>
        <button
          type="button"
          onClick={clear}
          className="text-xs text-text-secondary hover:text-text-primary px-2 py-0.5 rounded"
          aria-label={t('lookUp.close')}
          data-testid="lookup-close"
        >
          {t('lookUp.close')}
        </button>
      </div>

      {loading && <div className="text-sm text-text-secondary">{t('lookUp.searching')}</div>}
      {!loading && groups.length === 0 && (
        <div className="text-sm text-text-secondary" data-testid="lookup-empty">
          {t('lookUp.noResults', { word: query.text })}
        </div>
      )}

      {groups.map(group => (
        <div key={`${group.providerId}:${group.sourceId}`} className="mb-2" data-testid="lookup-group">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-0.5">
            {group.sourceName}
          </div>
          <ul className="space-y-0.5">
            {group.entries.map(entry => (
              <li key={entry.key}>
                <button
                  type="button"
                  className="w-full text-start px-2 py-1 rounded hover:bg-background-hover"
                  onClick={() => { void openEntry(group.sourceId, group.sourceName, entry.key); }}
                  data-testid="lookup-entry"
                >
                  <span className="font-medium text-text-primary">{entry.title}</span>
                  {entry.transliteration && (
                    <span className="ms-2 text-xs text-text-secondary">{entry.transliteration}</span>
                  )}
                  {entry.snippet && (
                    <span className="block text-xs text-text-secondary truncate">{entry.snippet}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};
