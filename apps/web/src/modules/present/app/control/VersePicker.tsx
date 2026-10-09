import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../../../hooks/useStore';
import { MAX_CHAPTERS } from '../../../../constants';
import { moduleStore } from '../../../../stores/moduleStore';
import { presentStore } from '../../stores/presentStore';
import { presenterShow } from '../presenterSink';
import { settingsStore } from '../../../../stores/settingsStore';
import type { PresentItem } from '../../lib/protocol';

/**
 * Pick a verse: translation, book, chapter and (optionally) verse. "Show now"
 * puts it on the screen; "Add to notes" hands the passage to the notes (or, until
 * the notes exist, to the running order).
 */
export function VersePicker(props: { onAddToNotes?: (item: PresentItem) => void; onDone: () => void }) {
  const { t } = useTranslation();
  const bibles = useStore(moduleStore, () => moduleStore.getBibleModules());
  const [module, setModule] = useState(() => settingsStore.getDefaultBible());
  const [book, setBook] = useState(43);
  const [chapter, setChapter] = useState(1);
  const [verse, setVerse] = useState('');

  const maxChapter = MAX_CHAPTERS[book] ?? 1;
  const chapterValue = Math.max(1, Math.min(maxChapter, chapter || 1));
  const verseNumber = verse === '' ? undefined : Math.max(1, Math.floor(Number(verse)) || 1);

  const item: PresentItem = { kind: 'passage', module, book, chapter: chapterValue };

  return (
    <div class="pz-picker">
      <div class="pz-picker__grid">
        <label class="pz-field">
          <span>{t('present.control.translation')}</span>
          <select value={module} onChange={event => setModule((event.target as HTMLSelectElement).value)}>
            {bibles.length === 0 && <option value={module}>{module}</option>}
            {bibles.map(b => <option key={b.abbreviation} value={b.abbreviation}>{b.abbreviation}</option>)}
          </select>
        </label>
        <label class="pz-field">
          <span>{t('present.control.book')}</span>
          <select
            value={String(book)}
            onChange={event => {
              const next = Number((event.target as HTMLSelectElement).value);
              setBook(next);
              setChapter(1);
            }}
          >
            {Array.from({ length: 66 }, (_, i) => i + 1).map(n => (
              <option key={n} value={String(n)}>{moduleStore.getBookName(n)}</option>
            ))}
          </select>
        </label>
        <label class="pz-field pz-field--narrow">
          <span>{t('present.control.chapter')}</span>
          <input
            type="number" min={1} max={maxChapter} value={chapterValue}
            onInput={event => setChapter(Number((event.target as HTMLInputElement).value))}
          />
        </label>
        <label class="pz-field pz-field--narrow">
          <span>{t('present.control.verse')}</span>
          <input
            type="number" min={1} value={verse} placeholder="1"
            onInput={event => setVerse((event.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="pz-picker__actions">
        <button
          type="button"
          class="pz-btn pz-btn--primary"
          onClick={() => { presenterShow(item, verseNumber ?? 1); props.onDone(); }}
        >
          {t('present.control.showNow')}
        </button>
        <button
          type="button"
          class="pz-btn"
          onClick={() => {
            if (props.onAddToNotes) props.onAddToNotes({ ...item, ...(verseNumber ? { verseStart: verseNumber } : {}) });
            else void presentStore.addToPlan(item);
            props.onDone();
          }}
        >
          {props.onAddToNotes ? t('present.control.addToNotes') : t('present.addToPlanShort')}
        </button>
      </div>
    </div>
  );
}
