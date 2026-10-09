import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import type { PresentItem } from '../../lib/protocol';
import { PresentHymns } from '../../study/PresentHymns';
import { PresentQuote } from '../../study/PresentQuote';
import { VersePicker } from './VersePicker';

type Kind = 'verse' | 'hymn' | 'quote';

/**
 * The Verse / Hymn / Quote buttons and the picker each one opens below the row.
 * Every picker offers "Show now"; "Add to notes" calls `onAddToNotes` when the
 * notes provide it.
 */
export function AddRow(props: { disabled?: boolean; onAddToNotes?: (item: PresentItem) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Kind | null>(null);
  const toggle = (kind: Kind) => setOpen(current => (current === kind ? null : kind));
  const close = () => setOpen(null);

  const button = (kind: Kind, icon: string, label: string) => (
    <button
      type="button"
      class={`pz-btn pz-addrow__btn ${open === kind ? 'pz-btn--on' : ''}`}
      disabled={props.disabled}
      aria-expanded={open === kind}
      onClick={() => toggle(kind)}
    >
      <i class={`fa-solid ${icon}`} aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div class="pz-addrow">
      <div class="pz-addrow__buttons">
        {button('verse', 'fa-book-bible', t('present.control.verse'))}
        {button('hymn', 'fa-music', t('present.control.hymn'))}
        {button('quote', 'fa-quote-left', t('present.control.quote'))}
      </div>
      {open === 'verse' && <VersePicker onAddToNotes={props.onAddToNotes} onDone={close} />}
      {open === 'hymn' && <PresentHymns onAddToNotes={props.onAddToNotes} />}
      {open === 'quote' && <PresentQuote startOpen onAddToNotes={props.onAddToNotes} onDone={close} />}
    </div>
  );
}
