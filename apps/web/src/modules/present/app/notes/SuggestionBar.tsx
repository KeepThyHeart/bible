import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../../../hooks/useStore';
import { notesStore } from './notesStore';
import type { NotesSuggestion } from './types';
import './suggest.css';

type T = (key: string, options?: Record<string, unknown>) => string;

/** Longest suggestion text shown in the list before it is cut with an ellipsis. */
const TEXT_MAX = 70;

export function truncate(text: string, max = TEXT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** What the accept button says: what the suggestion would become. */
export function acceptLabel(s: NotesSuggestion, t: T): string {
  if (s.kind === 'hymn') return t('present.notes.suggest.acceptHymn', { title: s.label, defaultValue: 'Hymn: {title}' });
  if (s.kind === 'quote') return t('present.notes.suggest.acceptQuote', { defaultValue: 'Quote' });
  return t('present.notes.suggest.acceptVerse', { label: s.label, defaultValue: '{label}' });
}

/**
 * Above the notes, after a paste (or whenever there is something to check):
 * "{n} items found. {m} lines to check.", with a list of the lines that look
 * like items but were not linked. Each one can be accepted (pinned to the
 * item it would become) or skipped (marked "not an item"); both are one undo
 * step. Dismiss hides the bar until the set of suggestions changes.
 *
 * The summary is a live region that stays mounted, so a paste is announced
 * without moving focus.
 */
export function SuggestionBar() {
  const { t } = useTranslation();
  useStore(notesStore, () => notesStore.detection);
  useStore(notesStore, () => notesStore.dismissedSuggestions);
  const [open, setOpen] = useState(false);

  const suggestions = notesStore.suggestions;
  const visible = suggestions.length > 0 && !notesStore.suggestionsDismissed;
  const summary = visible
    ? t('present.notes.suggest.summary', {
      items: notesStore.itemCount,
      count: suggestions.length,
      defaultValue: '{items, plural, one {# item found} other {# items found}}. {count, plural, one {# line to check} other {# lines to check}}.',
    })
    : '';
  const listId = 'pn-suggest-list';

  return (
    <div class={`pn-suggest${visible ? '' : ' pn-suggest--empty'}`}>
      <div class="pn-suggest__bar">
        <span class="pn-suggest__summary" role="status">{summary}</span>
        {visible && (
          <>
            <button
              type="button"
              class="pz-btn pn-suggest__toggle"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((o) => !o)}
            >
              {open
                ? t('present.notes.suggest.hide', { defaultValue: 'Hide' })
                : t('present.notes.suggest.review', { defaultValue: 'Review' })}
            </button>
            <button type="button" class="pz-btn pn-suggest__dismiss" onClick={() => notesStore.dismissSuggestions()}>
              {t('present.notes.suggest.dismiss', { defaultValue: 'Dismiss' })}
            </button>
          </>
        )}
      </div>
      {visible && open && (
        <ul class="pn-suggest__list" id={listId}>
          {suggestions.map((s) => {
            const text = notesStore.suggestionText(s.id) || s.label;
            return (
              <li key={s.id} class="pn-suggest__row">
                <button
                  type="button"
                  class="pn-suggest__text"
                  title={t('present.notes.suggest.reveal', { defaultValue: 'Select this text in the notes' })}
                  onClick={() => notesStore.revealSuggestion(s.id)}
                >
                  {truncate(text)}
                </button>
                <button type="button" class="pz-btn pz-btn--primary pn-suggest__accept" onClick={() => notesStore.acceptSuggestion(s.id)}>
                  {acceptLabel(s, t)}
                </button>
                <button type="button" class="pz-btn pn-suggest__skip" onClick={() => notesStore.skipSuggestion(s.id)}>
                  {t('present.notes.suggest.skip', { defaultValue: 'Skip' })}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
