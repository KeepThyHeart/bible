import { useTranslation } from 'react-i18next';
import { PresentHymns } from '../../study/PresentHymns';
import { PresentQuote } from '../../study/PresentQuote';
import type { PresentItem } from '../../lib/protocol';
import { VersePicker } from '../control/VersePicker';
import { Sheet } from './Sheet';

export type PickerKind = 'verse' | 'hymn' | 'quote';

/**
 * Verse / Hymn / Quote across the full width. Each opens its Control-pane
 * picker in a bottom sheet (so the frozen top stays small); whatever is chosen
 * goes to `onAdd`, which appends it to the plan and shows it.
 */
export function PhoneAddRow(props: {
  open: PickerKind | null;
  onOpen: (kind: PickerKind | null) => void;
  onAdd: (item: PresentItem, label?: string) => void;
}) {
  const { t } = useTranslation();
  const close = () => props.onOpen(null);
  const button = (kind: PickerKind, icon: string, label: string) => (
    <button
      type="button"
      class={`pzp-add ${props.open === kind ? 'pzp-add--on' : ''}`}
      aria-haspopup="dialog"
      onClick={() => props.onOpen(props.open === kind ? null : kind)}
    >
      <i class={`fa-solid ${icon}`} aria-hidden="true" />
      {label}
    </button>
  );
  const title = props.open === 'verse' ? t('present.control.verse') : props.open === 'hymn' ? t('present.control.hymn') : t('present.control.quote');

  return (
    <>
      <div class="pzp-addrow">
        {button('verse', 'fa-book-bible', t('present.control.verse'))}
        {button('hymn', 'fa-music', t('present.control.hymn'))}
        {button('quote', 'fa-quote-left', t('present.control.quote'))}
      </div>
      {props.open && (
        <Sheet title={title} onClose={close}>
          {props.open === 'verse' && <VersePicker onAddToNotes={item => props.onAdd(item)} onDone={close} />}
          {props.open === 'hymn' && <PresentHymns onAddToNotes={item => props.onAdd(item)} />}
          {props.open === 'quote' && <PresentQuote startOpen onAddToNotes={item => props.onAdd(item)} onDone={close} />}
        </Sheet>
      )}
    </>
  );
}
