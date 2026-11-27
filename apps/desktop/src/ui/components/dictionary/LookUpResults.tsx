import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useLookUpStore } from '../../stores/useLookUpStore';

/**
 * The entries every installed dictionary has for the current look-up (`useLookUpStore`), grouped by
 * dictionary, the Strong's lexicon first for a tagged word. Rendered under the word search on the
 * Dictionary pane's Overview, which is where both that box and the verse menu's "Look up" land.
 * Picking an entry hands it to `onOpenEntry`, which opens it as a tab.
 */
export const LookUpResults: React.FC<{
  onOpenEntry: (abbreviation: string, name: string, key: string) => void;
}> = ({ onOpenEntry }) => {
  const { t } = useI18n();
  const query = useLookUpStore(s => s.query);
  const groups = useLookUpStore(s => s.groups);
  const loading = useLookUpStore(s => s.loading);
  if (!query) return null;

  return (
    <section
      className="mb-6"
      aria-label={t('lookUp.resultsLabel', { word: query.text })}
      aria-busy={loading}
      data-testid="lookup-results"
    >
      {loading && <div className="text-sm text-text-secondary px-1">{t('lookUp.searching')}</div>}
      {!loading && groups.length === 0 && (
        <div className="text-sm text-text-secondary px-1" data-testid="lookup-empty">
          {t('lookUp.noResults', { word: query.text })}
        </div>
      )}

      {groups.map(group => (
        <div key={`${group.providerId}:${group.sourceId}`} className="mb-3" data-testid="lookup-group">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1 px-1">
            {group.sourceName}
          </h3>
          <ul className="space-y-0.5">
            {group.entries.map(entry => (
              <li key={entry.key}>
                <button
                  type="button"
                  className="w-full text-start px-2 py-1 rounded hover:bg-background-hover"
                  onClick={() => onOpenEntry(group.sourceId, group.sourceName, entry.key)}
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
