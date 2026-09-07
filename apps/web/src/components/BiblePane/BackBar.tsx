import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { bibleStore } from '../../stores/bibleStore';
import { useStore } from '../../hooks/useStore';
import { useTranslation } from 'react-i18next';

export function BackBar() {
  const { t } = useTranslation();
  const showBackBar = useStore(bibleStore, () => bibleStore.getActiveTab()?.showBackBar ?? false);
  const backLabel = useStore(bibleStore, () => bibleStore.getBackLabel());
  const [fading, setFading] = useState(false);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    if (!showBackBar) return;
    setFading(false);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setFading(true);
      window.setTimeout(() => bibleStore.dismissBackBar(), 500);
    }, 30000);
    return () => window.clearTimeout(timerRef.current);
  }, [showBackBar]);

  const handleBack = useCallback(() => {
    window.clearTimeout(timerRef.current);
    bibleStore.goBack();
  }, []);

  const handleDismiss = useCallback(() => {
    window.clearTimeout(timerRef.current);
    bibleStore.dismissBackBar();
  }, []);

  if (!showBackBar || !backLabel) return null;

  return (
    <div class={`bible-back-bar${fading ? ' bible-back-bar--fading' : ''}`}>
      <button class="bible-back-bar__btn" onClick={handleBack}>
        <i class="fa-solid fa-arrow-left" /> Back to {backLabel}
      </button>
      <button class="bible-back-bar__dismiss" onClick={handleDismiss} title={t('backBar.dismiss')}>
        <i class="fa-solid fa-xmark" />
      </button>
    </div>
  );
}
