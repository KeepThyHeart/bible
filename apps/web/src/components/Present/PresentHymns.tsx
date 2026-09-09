import { useEffect, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../../utils/apiUrl';
import { presentStore } from '../../stores/presentStore';
import type { HymnSearchResponse, HymnSummary } from '../../present/hymns';

/**
 * Choosing a hymn.
 *
 * One box, searched four ways at once -- title, first line, alternative title,
 * and hymnal number -- because those are the four ways a person actually names
 * a hymn, and a presenter should not have to say which kind of thing they are
 * typing. Somebody calls out "460" from the back and it should just appear.
 *
 * Empty means browse. A picker that shows nothing until you type is useless to
 * the presenter who knows they want a hymn but not which one.
 */

const DEBOUNCE_MS = 180;

export function PresentHymns() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HymnSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Debounced: a presenter typing a hymn number should not put one request on
    // the wire per digit over venue wifi.
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/hymns?q=${encodeURIComponent(query)}`)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((body: HymnSearchResponse) => {
          if (cancelled) return;
          setResults(body.hymns);
          setTotal(body.total);
          setFailed(false);
          // Remember what these are called, so the control strip and the running
          // order can name a hymn rather than showing its id.
          presentStore.rememberHymns(body.hymns);
        })
        .catch(() => { if (!cancelled) setFailed(true); });
    }, query ? DEBOUNCE_MS : 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return (
    <div class="present-hymns">
      <input
        class="present-hymns__search"
        type="search"
        value={query}
        placeholder={t('present.hymnSearchPlaceholder')}
        aria-label={t('present.hymnSearchPlaceholder')}
        onInput={event => setQuery((event.target as HTMLInputElement).value)}
      />

      {failed && <p class="present-panel__note">{t('present.hymnsUnavailable')}</p>}

      {!failed && results.length === 0 && (
        <p class="present-panel__note">
          {query ? t('present.hymnsNoMatch') : t('present.hymnsEmptyLibrary')}
        </p>
      )}

      <ul class="present-hymns__list">
        {results.map(hymn => (
          <li class="present-hymns__row" key={hymn.id}>
            <button
              type="button"
              class="present-hymns__pick"
              onClick={() => void presentStore.show({ kind: 'hymn', hymnId: hymn.id })}
              title={t('present.hymnSend')}
            >
              <span class="present-hymns__title">{hymn.title}</span>
              <span class="present-hymns__detail">
                {hymn.firstLine}
                {hymn.author ? ` · ${hymn.author}` : ''}
                {/* The number is why it is here: it is how a hymn gets called for. */}
                {hymn.hymnals.length > 0 ? ` · ${hymn.hymnals.map(ref => ref.number).join(', ')}` : ''}
              </span>
            </button>
            <button
              type="button"
              class="present-plan__icon"
              onClick={() => void presentStore.addToPlan({ kind: 'hymn', hymnId: hymn.id })}
              title={t('present.hymnAddToPlan')}
              aria-label={t('present.hymnAddToPlan')}
            >
              <i class="fa-solid fa-plus" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      {total > results.length && (
        <p class="present-panel__hint">{t('present.hymnsMore', { count: total - results.length })}</p>
      )}
    </div>
  );
}
