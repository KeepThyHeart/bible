import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { presentStore } from '../../stores/presentStore';
import type { PresentQuoteItem } from '../../present/protocol';

/**
 * Put someone else's words on the wall, set apart from a presenter's own
 * text slide -- see `PresentQuoteItem` and `.pv-quote` in the viewer.
 *
 * Deliberately minimal: a quote is typed once and either sent immediately or
 * saved to the running order, the same two choices every other item in the
 * plan offers. There is nowhere this text is stored except the plan entry the
 * presenter chooses to keep.
 */
export function PresentQuote() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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
          class="present-plan__add"
          disabled={!item}
          onClick={() => { if (item) { void presentStore.show(item); close(); } }}
        >
          {t('present.showQuote')}
        </button>
        <button
          type="button"
          class="present-plan__add"
          disabled={!item}
          onClick={() => { if (item) { void presentStore.addToPlan(item); close(); } }}
        >
          {t('present.addQuoteToPlan')}
        </button>
      </div>

      <button type="button" class="present-panel__button" onClick={close}>
        {t('common.close')}
      </button>
    </div>
  );
}
