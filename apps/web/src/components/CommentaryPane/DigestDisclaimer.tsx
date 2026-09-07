import { useTranslation } from 'react-i18next';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';
import { getDigestDisclaimer, getModuleDisclaimer } from '../../moduleDescriptions';

interface ModuleDisclaimerProps {
  /** Module abbreviation to look up the disclaimer for */
  moduleAbbr?: string;
  /** Custom text for the collapsed restore button (defaults to "Notice") */
  collapsedLabel?: string;
}

/**
 * Reusable module disclaimer banner with dismiss/restore.
 * Shows the full disclaimer when not dismissed, and a small restore link when dismissed.
 * Works for any module that has a disclaimer in moduleDescriptions.
 * Falls back to the legacy Digest disclaimer for backwards compatibility.
 */
export function DigestDisclaimer({ moduleAbbr, collapsedLabel }: ModuleDisclaimerProps = {}) {
  const { t } = useTranslation();
  const key = moduleAbbr ?? 'SYNTHESIS';
  const dismissed = useStore(settingsStore, () =>
    settingsStore.isDisclaimerDismissed(key)
  );

  const disclaimerText = moduleAbbr
    ? getModuleDisclaimer(moduleAbbr)
    : getDigestDisclaimer();

  if (!disclaimerText) return null;

  const dismiss = () => {
    settingsStore.addDismissedDisclaimerModule(key);
  };

  const restore = () => {
    settingsStore.removeDismissedDisclaimerModule(key);
  };

  if (dismissed) {
    return (
      <button
        class="digest-disclaimer-restore"
        onClick={restore}
      >
        <i class="fa-solid fa-circle-info" /> {collapsedLabel || t('digestDisclaimer.notice')}
      </button>
    );
  }

  return (
    <div class="digest-disclaimer">
      <div class="digest-disclaimer__text">
        <i class="fa-solid fa-circle-info digest-disclaimer__icon" />
        {disclaimerText}
      </div>
      <button
        class="digest-disclaimer__dismiss"
        onClick={dismiss}
        title={t('digestDisclaimer.dismiss')}
      >
        <i class="fa-solid fa-xmark" />
      </button>
    </div>
  );
}
