import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { presentStore } from '../stores/presentStore';
import { presenterShow } from '../app/presenterSink';
import type { PresentItem, PresentQuoteItem } from '../lib/protocol';

/**
 * Put someone else's words on the wall, set apart from a presenter's own
 * text slide -- see `PresentQuoteItem` and `.pv-quote` in the viewer.
 *
 * Deliberately minimal: a quote is typed once and either sent immediately or
 * saved to the running order, the same two choices every other item in the
 * plan offers. There is nowhere this text is stored except the plan entry the
 * presenter chooses to keep.
 */
export function PresentQuote(props: { onAddToNotes?: (item: PresentItem) => void; startOpen?: boolean; onDone?: () => void; addLabel?: string }) {
  const { t } = useTranslation();
  const showLabel = String(t('present.rows.show', { defaultValue: 'Show' }));
  const addLabel = props.addLabel ?? String(t('present.rows.add', { defaultValue: 'Add to notes' }));
  const [open, setOpen] = useState(props.startOpen ?? false);
  const [text, setText] = useState('');
  const [attribution, setAttribution] = useState('');

  if (!open) {
    return (
      <button type="button" class="present-plan__paste-toggle" onClick={() => setOpen(true)}>
        <i class="fa-solid fa-quote-left" aria-hidden="true" />
        {t('present.addQuote')}
      </button>
    );
  }

  const buildItem = (): PresentQuoteItem | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const item: PresentQuoteItem = { kind: 'quote', text: trimmed };
    if (attribution.trim()) item.attribution = attribution.trim();
    return item;
  };

  const close = (): void => {
    setOpen(false);
    setText('');
    setAttribution('');
    props.onDone?.();
  };

  const item = buildItem();

  return (
    <div class="present-paste">
      <textarea
        class="present-paste__input"
        autoFocus
        rows={3}
        placeholder={t('present.quoteTextPlaceholder')}
        value={text}
        onInput={event => setText((event.target as HTMLTextAreaElement).value)}
      />
      <input
        class="present-paste__input"
        type="text"
        placeholder={t('present.quoteAttributionPlaceholder')}
        value={attribution}
        onInput={event => setAttribution((event.target as HTMLInputElement).value)}
      />

      <div class="present-plan__actions">
        <button
          type="button"
          class="present-plan__add present-rowbtn present-rowbtn--primary"
          disabled={!item}
          onClick={() => { if (item) { presenterShow(item); close(); } }}
        >
          {showLabel}
        </button>
        <button
          type="button"
          class="present-plan__add present-rowbtn"
          aria-label={addLabel}
          disabled={!item}
          onClick={() => {
            if (!item) return;
            if (props.onAddToNotes) props.onAddToNotes(item);
            else void presentStore.addToPlan(item);
            close();
          }}
        >
          {addLabel}
        </button>
      </div>

      <button type="button" class="present-panel__button" onClick={close}>
        {t('common.close')}
      </button>
    </div>
  );
}
