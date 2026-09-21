/**
 * PrivacySection.tsx
 *
 * "Privacy" tab of the Preferences dialog: the master "Allow web requests"
 * switch. Until this section existed, the ONLY way to reach the switch was
 * the native Privacy → Allow Web Requests menu item - two other messages in
 * the app already pointed users at "Preferences" for it
 * (`networkHandlers.ts`, `windowSecurity.ts`) even though nothing here
 * answered that.
 *
 * Bound to `useNetworkStore`, the same store the menu checkbox, first run and
 * the Module Manager's offline banner read - so this toggle can never
 * disagree with any of them.
 */

import React, { useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useNetworkStore } from '../../stores/useNetworkStore';

export const PrivacySection: React.FC = () => {
  const { t } = useI18n();
  const { allowWebRequests, requestAllow } = useNetworkStore();
  // Optimistic toggle state so the switch tracks the click immediately rather
  // than waiting on the native confirmation dialog's round trip; snapped back
  // to the store's value below if the user cancels that dialog.
  const [pending, setPending] = useState(false);

  const handleToggle = async (checked: boolean) => {
    if (!checked) {
      // Turning off is never gated - apply immediately.
      await requestAllow(false);
      return;
    }
    setPending(true);
    try {
      // Resolves to what the user actually decided at the native dialog, not
      // the request - a cancel comes back `false` and the checkbox must snap
      // back to unchecked, which it does here because `allowWebRequests`
      // (read from the store above) only changes when `requestAllow` sets it.
      await requestAllow(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allowWebRequests}
            disabled={pending}
            onChange={(e) => void handleToggle(e.target.checked)}
            className="w-4 h-4 rounded"
            style={{ accentColor: 'var(--theme-accent-primary)' }}
            data-testid="privacy-allow-web-requests-checkbox"
          />
          <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            {t('preferencesDialog.allowWebRequestsLabel')}
          </span>
        </label>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('preferencesDialog.allowWebRequestsDescription')}
        </p>
      </div>
    </div>
  );
};

export default PrivacySection;
