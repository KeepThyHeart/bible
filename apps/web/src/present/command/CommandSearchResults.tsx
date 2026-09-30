import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { presentStore } from '../../stores/presentStore';
import { useStore } from '../../hooks/useStore';
import type { PresentItem, PresentState } from '../protocol';
import type { HymnSummary } from '../hymns';
import { hymnItem, showPassage, type IntentSink } from './execute';
import { commandSearch, type SearchItem } from './commandSearch';
import { searchHymns as defaultSearchHymns, searchVerses as defaultSearchVerses, type VerseHit } from './searchProviders';
import './command.css';

/**
 * Search results for the command box, grouped Verses / Hymns. The host places
 * it (Control pane, or a page-wide banner) and mounts it whenever the Presenter
 * is showing; it renders nothing while no search is open.
 *
 * Selection is driven from the box (Up/Down/Enter/Alt+Enter, see CommandBox) and
 * by mouse here. Esc in the box closes; `onClose` tells the host it may hide
 * whatever container it put this in.
 */

export interface CommandSearchResultsProps {
  sink: IntentSink;
  state: PresentState | null;
  /** Translation whose text is searched. Defaults to the wall's, then nothing (server default). */
  defaultModule?: string;
  /** Provide to enable Alt+Enter and the "+" button; the host inserts the item into the notes. */
  onAddToNotes?: (item: PresentItem, label: string) => void;
  /** Called when the results close (a result was shown, or Esc). */
  onClose?: () => void;
  /** `panel`: fills the Control pane. `banner`: a page-wide strip with a capped height. */
  variant?: 'panel' | 'banner';
  /** Injection points, for tests. */
  searchVerses?: (query: string, module?: string) => Promise<VerseHit[]>;
  searchHymns?: (query: string) => Promise<HymnSummary[]>;
}

const MAX_HYMNS = 8;

function decodeVerseId(id: number): { book: number; chapter: number; verse: number } {
  return { book: Math.floor(id / 1_000_000), chapter: Math.floor((id % 1_000_000) / 1000), verse: id % 1000 };
}

/** The PresentItem a result stands for, for "add to notes". */
export function searchItemToPresentItem(item: SearchItem): PresentItem {
  if (item.kind === 'hymn') return hymnItem(item.hymn);
  const { book, chapter, verse } = decodeVerseId(item.verseId);
  return { kind: 'passage', module: item.module, book, chapter, verseStart: verse };
}

export function CommandSearchResults(props: CommandSearchResultsProps) {
  const { sink, state, onAddToNotes, onClose, variant = 'panel' } = props;
  const { t } = useTranslation();
  const query = useStore(commandSearch, () => commandSearch.query);
  const items = useStore(commandSearch, () => commandSearch.items);
  const selected = useStore(commandSearch, () => commandSearch.selected);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const runId = useRef(0);

  const live = state?.live ?? null;
  const module = props.defaultModule ?? (live?.kind === 'passage' ? live.module : undefined);
  const searchVerses = props.searchVerses ?? defaultSearchVerses;
  const searchHymns = props.searchHymns ?? defaultSearchHymns;

  useEffect(() => {
    if (query === null) { setLoading(false); setFailed(false); return; }
    const id = ++runId.current;
    setLoading(true);
    setFailed(false);
    Promise.allSettled([searchVerses(query, module), searchHymns(query)]).then(([verses, hymns]) => {
      if (id !== runId.current) return;
      const out: SearchItem[] = [];
      if (verses.status === 'fulfilled') {
        for (const v of verses.value) out.push({ kind: 'verse', key: `v${v.verseId}${v.module}`, ...v });
      }
      if (hymns.status === 'fulfilled') {
        presentStore.rememberHymns(hymns.value);
        for (const h of hymns.value.slice(0, MAX_HYMNS)) out.push({ kind: 'hymn', key: `h${h.id}`, hymn: h });
      }
      setFailed(verses.status === 'rejected' && hymns.status === 'rejected');
      setLoading(false);
      commandSearch.setItems(out);
    });
  }, [query, module]);

  // What "show" and "add to notes" mean is ours to say: we hold the sink.
  useEffect(() => {
    commandSearch.registerActions({
      show(item) {
        if (item.kind === 'hymn') {
          sink({ type: 'show', item: hymnItem(item.hymn), index: 0 });
        } else {
          const { book, chapter, verse } = decodeVerseId(item.verseId);
          showPassage(sink, state, { module: item.module, book, chapter, verseStart: verse });
        }
        commandSearch.close();
      },
      addToNotes: onAddToNotes
        ? item => {
            onAddToNotes(searchItemToPresentItem(item), item.kind === 'hymn' ? item.hymn.title : item.reference);
            commandSearch.close();
          }
        : undefined,
    });
    return () => commandSearch.registerActions(null);
  });

  // Closing from the box (Esc) also has to reach the host.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && query === null) onClose?.();
    wasOpen.current = query !== null;
  }, [query]);

  // Keep the chosen row in view.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, items]);

  if (query === null) return null;

  const verses = items.filter(i => i.kind === 'verse');
  const hymns = items.filter(i => i.kind === 'hymn');
  const indexOf = (item: SearchItem) => items.indexOf(item);

  const row = (item: SearchItem) => {
    const i = indexOf(item);
    return (
      <li
        key={item.key}
        class={`present-cmd-results__row${i === selected ? ' present-cmd-results__row--selected' : ''}`}
        role="option"
        aria-selected={i === selected}
      >
        <button
          type="button"
          class="present-cmd-results__pick"
          onMouseEnter={() => commandSearch.select(i)}
          onClick={() => commandSearch.activate('show', i)}
        >
          {item.kind === 'verse' ? (
            <>
              <span class="present-cmd-results__ref">{item.reference}</span>
              <span class="present-cmd-results__text" dangerouslySetInnerHTML={{ __html: sanitizeMarks(item.text) }} />
            </>
          ) : (
            <>
              <span class="present-cmd-results__ref">{item.hymn.title}</span>
              <span class="present-cmd-results__text">
                {item.hymn.firstLine}
                {item.hymn.hymnals.length > 0 ? ` · ${item.hymn.hymnals.map(r => r.number).join(', ')}` : ''}
              </span>
            </>
          )}
        </button>
        {onAddToNotes && (
          <button
            type="button"
            class="present-cmd-results__add"
            title={t('present.command.addToNotes', { defaultValue: 'Add to notes (Alt+Enter)' })}
            aria-label={t('present.command.addToNotes', { defaultValue: 'Add to notes (Alt+Enter)' })}
            onClick={() => commandSearch.activate('notes', i)}
          >
            <i class="fa-solid fa-plus" aria-hidden="true" />
          </button>
        )}
      </li>
    );
  };

  return (
    <section class={`present-cmd-results present-cmd-results--${variant}`} aria-label={t('present.command.results', { defaultValue: 'Search results' })}>
      <header class="present-cmd-results__head">
        <span>{t('present.command.resultsFor', { query, defaultValue: `Results for '${query}'` })}</span>
        <button
          type="button"
          class="present-cmd-results__close"
          title={t('present.command.closeResults', { defaultValue: 'Close (Esc)' })}
          aria-label={t('present.command.closeResults', { defaultValue: 'Close (Esc)' })}
          onClick={() => commandSearch.close()}
        >
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </header>
      <div class="present-cmd-results__body" ref={listRef} role="listbox">
        {loading && <p class="present-cmd-results__note">{t('present.command.searching', { defaultValue: 'Searching…' })}</p>}
        {!loading && failed && <p class="present-cmd-results__note">{t('present.command.searchFailed', { defaultValue: 'Search is unavailable.' })}</p>}
        {!loading && !failed && items.length === 0 && (
          <p class="present-cmd-results__note">{t('present.command.noResults', { defaultValue: 'No matches.' })}</p>
        )}
        {verses.length > 0 && (
          <>
            <h4 class="present-cmd-results__group">{t('present.command.groupVerses', { defaultValue: 'Verses' })}</h4>
            <ul class="present-cmd-results__list">{verses.map(row)}</ul>
          </>
        )}
        {hymns.length > 0 && (
          <>
            <h4 class="present-cmd-results__group">{t('present.command.groupHymns', { defaultValue: 'Hymns' })}</h4>
            <ul class="present-cmd-results__list">{hymns.map(row)}</ul>
          </>
        )}
      </div>
    </section>
  );
}

/** Search text arrives with `<mark>` around matches; keep only those, escape the rest. */
export function sanitizeMarks(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(mark|b|em)&gt;/gi, '<$1$2>');
}
