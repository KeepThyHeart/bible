import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../../../utils/apiUrl';
import { presentStore } from '../stores/presentStore';
import { presenterShow } from '../app/presenterSink';
import type { HymnSearchResponse, HymnSummary } from '../lib/hymns';
import type { PresentItem } from '../lib/protocol';

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

export function PresentHymns(props: { onAddToNotes?: (item: PresentItem) => void; addLabel?: string }) {
  const { t } = useTranslation();
  const showLabel = String(t('present.rows.show', { defaultValue: 'Show' }));
  const addLabel = props.addLabel ?? String(t('present.rows.add', { defaultValue: 'Add to notes' }));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HymnSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The picker opens ready to type; and its announcement timer never outlives it.
  useEffect(() => {
    searchRef.current?.focus();
    return () => clearTimeout(addedTimer.current);
  }, []);

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
        ref={searchRef}
        type="search"
        value={query}
        placeholder={t('present.hymnSearchPlaceholder')}
        aria-label={t('present.hymnSearchPlaceholder')}
        onInput={event => setQuery((event.target as HTMLInputElement).value)}
      />

      {/* Always rendered, so a screen reader announces the text when it appears. */}
      <p class="present-panel__hint" role="status">{added ? `${t('present.added')}: ${added}` : ''}</p>

      {failed && <p class="present-panel__note">{t('present.hymnsUnavailable')}</p>}

      {!failed && results.length === 0 && (
        <p class="present-panel__note">
          {query ? t('present.hymnsNoMatch') : t('present.hymnsEmptyLibrary')}
        </p>
      )}

      <ul class="present-hymns__list">
        {results.map(hymn => (
          <li class="present-hymns__row" key={hymn.id}>
            <div class="present-hymns__body">
              <span class="present-hymns__title">{hymn.title}</span>
              <span class="present-hymns__detail">
                {hymn.firstLine}
                {hymn.author ? ` · ${hymn.author}` : ''}
                {/* The number is why it is here: it is how a hymn gets called for. */}
                {hymn.hymnals.length > 0 ? ` · ${hymn.hymnals.map(ref => ref.number).join(', ')}` : ''}
              </span>
            </div>
            <div class="present-rowbtns">
              <button
                type="button"
                class="present-hymns__pick present-rowbtn present-rowbtn--primary"
                onClick={() => presenterShow({ kind: 'hymn', hymnId: hymn.id })}
                aria-label={`${showLabel}: ${hymn.title}`}
              >
                {showLabel}
              </button>
              <button
                type="button"
                class="present-hymns__add present-rowbtn"
                onClick={() => {
                  const item: PresentItem = { kind: 'hymn', hymnId: hymn.id };
                  if (props.onAddToNotes) props.onAddToNotes(item);
                  else void presentStore.addToPlan(item);
                  setAdded(hymn.title);
                  clearTimeout(addedTimer.current);
                  addedTimer.current = setTimeout(() => setAdded(null), 3000);
                }}
                aria-label={`${addLabel}: ${hymn.title}`}
              >
                {addLabel}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {total > results.length && (
        <p class="present-panel__hint">{t('present.hymnsMore', { count: total - results.length })}</p>
      )}
    </div>
  );
}
