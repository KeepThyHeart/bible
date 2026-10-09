import { useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import type { ComponentChildren } from 'preact';

/** A bottom sheet over the phone layout: tap outside, Escape or the X closes it. */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  return (
    <div class="pzp-backdrop" onClick={props.onClose}>
      <div class="pzp-sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={event => event.stopPropagation()}>
        <div class="pzp-sheet__head">
          <h2>{props.title}</h2>
          <button type="button" class="pzp-icon" onClick={props.onClose} aria-label={t('common.close')}>
            <i class="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
        <div class="pzp-sheet__body">{props.children}</div>
      </div>
    </div>
  );
}
