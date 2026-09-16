import { useMemo, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { presentStore } from '../../stores/presentStore';
import { formatPassageRef } from '../../constants';
import { scanReferences, type ScannedReference } from '../../present/referenceScan';
import type { PresentPassageItem } from '../../present/protocol';

/**
 * Paste a block of text -- a sermon outline, a service sheet -- and add
 * whatever Bible references it contains to the running order without
 * retyping them.
 *
 * The text itself is never saved anywhere: it lives only in this component's
 * state for as long as the box is open, purely as scratch space to scan. What
 * survives is the running order entries the presenter chose to add, exactly
 * as if they had been typed in one at a time.
 */

function label(ref: ScannedReference, bookName: string): string {
  const base = formatPassageRef(ref.book, ref.chapter, ref.verseStart ?? null, bookName);
  return ref.verseEnd ? `${base}-${ref.verseEnd}` : base;
}

function toItem(ref: ScannedReference, module: string): PresentPassageItem {
  const item: PresentPassageItem = { kind: 'passage', module, book: ref.book, chapter: ref.chapter };
  if (ref.verseStart !== undefined) item.verseStart = ref.verseStart;
  if (ref.verseEnd !== undefined) item.verseEnd = ref.verseEnd;
  return item;
}

export function PresentPasteReferences() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [added, setAdded] = useState<Set<number>>(new Set());

  const module = bibleStore.getActiveModule();
  const found = useMemo(() => scanReferences(text), [text]);

  if (!open) {
    return (
      <button type="button" class="present-plan__paste-toggle" onClick={() => setOpen(true)}>
        <i class="fa-solid fa-paste" aria-hidden="true" />
        {t('present.pasteReferences')}
      </button>
    );
  }

  const addOne = (ref: ScannedReference, index: number): void => {
    void presentStore.addToPlan(toItem(ref, module));
    setAdded(prev => new Set(prev).add(index));
  };

  const addAll = (): void => {
    found.forEach((ref, index) => { if (!added.has(index)) addOne(ref, index); });
  };

  const close = (): void => {
    setOpen(false);
    setText('');
    setAdded(new Set());
  };

  return (
    <div class="present-paste">
      <textarea
        class="present-paste__input"
        autoFocus
        rows={4}
        placeholder={t('present.pasteReferencesPlaceholder')}
        value={text}
        onInput={event => setText((event.target as HTMLTextAreaElement).value)}
      />

      {found.length > 0 && (
        <>
          <ul class="present-paste__list">
            {found.map((ref, index) => {
              const name = moduleStore.getBookName(ref.book);
              const isAdded = added.has(index);
              return (
                <li key={`${ref.book}-${ref.chapter}-${ref.verseStart ?? ''}-${ref.verseEnd ?? ''}`} class="present-paste__row">
                  <span class="present-paste__ref">{label(ref, name)}</span>
                  <button
                    type="button"
                    class="present-paste__add"
                    disabled={isAdded}
                    onClick={() => addOne(ref, index)}
                  >
                    {isAdded ? t('present.added') : t('present.addToPlanShort')}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" class="present-plan__add" onClick={addAll}>
            {t('present.addAllFound', { count: found.length })}
          </button>
        </>
      )}
      {text.trim() && found.length === 0 && (
        <p class="present-plan__note">{t('present.noReferencesFound')}</p>
      )}

      <button type="button" class="present-panel__button" onClick={close}>
        {t('common.close')}
      </button>
    </div>
  );
}
