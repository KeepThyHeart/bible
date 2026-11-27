/** The downloads view in a dialog (a bottom sheet on a phone), opened by `downloadsDialog.open(module)`. */
import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@bible/ui';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { useEscapeKey } from '../../../hooks/useEscapeKey';
import { getWebDownloadsModel, downloadsDialog } from '../lib/downloads';
import { AudioDownloadsView } from './AudioDownloadsView';

export function AudioDownloadsDialog() {
  const { t } = useTranslation();
  const module = useStore(downloadsDialog, () => downloadsDialog.module);
  const layout = useStore(audioStore, () => audioStore.layout);
  const closeRef = useRef<HTMLButtonElement>(null);
  const model = module ? getWebDownloadsModel() : null;
  const close = () => downloadsDialog.close();
  useEscapeKey(!!module && layout !== 'phone', close);

  useEffect(() => {
    if (!module) return;
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { before?.focus?.(); };
  }, [module !== null]);

  if (!module || !model) return null;
  const title = <><i class="fa-solid fa-cloud-arrow-down" aria-hidden="true" /> {t('audio.downloads.title')}</>;
  const body = <AudioDownloadsView model={model} moduleAbbr={module} />;

  if (layout === 'phone') {
    return (
      <BottomSheet open onClose={close} title={title} labels={{ close: t('audio.downloads.close') }} maxHeight="85dvh" className="audio-gate-sheet">
        <div class="audio-gate audio-gate--sheet" data-testid="audio-downloads-dialog">{body}</div>
      </BottomSheet>
    );
  }
  return (
    <div class="settings-panel-overlay audio-gate-overlay" onClick={close}>
      <div class="audio-gate audio-downloads-dialog" role="dialog" aria-modal="true" aria-labelledby="audio-dl-title" data-testid="audio-downloads-dialog" onClick={e => e.stopPropagation()}>
        <div class="audio-downloads__head">
          <h3 id="audio-dl-title" class="audio-gate__title">{title}</h3>
          <button type="button" class="audio-settings__btn" ref={closeRef} onClick={close} data-testid="audio-dl-close">{t('audio.downloads.close')}</button>
        </div>
        {body}
      </div>
    </div>
  );
}
