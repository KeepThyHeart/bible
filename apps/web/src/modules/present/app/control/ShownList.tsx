import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../../../hooks/useStore';
import type { PresentItem } from '../../lib/protocol';
import { shownStore } from '../../stores/shownStore';
import { presenterShow } from '../presenterSink';
import './ShownList.css';

const VISIBLE = 6;

/** Things shown on the fly that are not in the notes yet, newest first. */
export function ShownList({ onAddToNotes }: { onAddToNotes?: (item: PresentItem, label?: string) => void }) {
  const { t } = useTranslation();
  const items = useStore(shownStore, () => shownStore.items);
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, VISIBLE);
  const more = items.length - VISIBLE;
  return (
    <section class="pz-shown" aria-label={t('present.shown.heading', { defaultValue: 'Shown, not in notes' })}>
      <div class="pz-shown__head">
        <span class="pz-shown__title">{t('present.shown.heading', { defaultValue: 'Shown, not in notes' })}</span>
        <button type="button" class="pz-btn" onClick={() => shownStore.clear()}
          aria-label={t('present.shown.clearAria', { defaultValue: 'Clear the list of shown items' })}>
          {t('present.shown.clear', { defaultValue: 'Clear' })}
        </button>
      </div>
      <ul class="pz-shown__list">
        {shown.map((entry) => (
          <li class="pz-shown__row" key={entry.id}>
            <span class="pz-shown__label" title={entry.label}>{entry.label}</span>
            <button type="button" class="pz-btn"
              aria-label={t('present.shown.showAria', { defaultValue: 'Show {label}', label: entry.label })}
              onClick={() => { void presenterShow(entry.item, entry.item.kind === 'passage' ? entry.item.verseStart : undefined); }}>
              {t('present.shown.show', { defaultValue: 'Show' })}
            </button>
            {onAddToNotes && (
              <button type="button" class="pz-btn"
                aria-label={t('present.shown.addAria', { defaultValue: 'Add {label} to notes', label: entry.label })}
                onClick={() => { onAddToNotes(entry.item, entry.label); shownStore.remove(entry.id); }}>
                {t('present.shown.add', { defaultValue: 'Add to notes' })}
              </button>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button type="button" class="pz-btn" onClick={() => setAll(!all)} aria-expanded={all}>
          {all
            ? t('present.shown.fewer', { defaultValue: 'Show fewer' })
            : t('present.shown.more', { defaultValue: '{count} more', count: more })}
        </button>
      )}
    </section>
  );
}
