/**
 * SearchSection.tsx
 *
 * "Search" tab of the Preferences dialog (task 0190): the online meaning
 * search option. The tab only exists when the build configures a remote
 * service (`when: remoteSemanticConfigured`), and the body renders nothing
 * otherwise. Checked unless the user declined; unchecking withdraws consent,
 * re-checking clears the record so the next semantic search asks again.
 */

import React, { useEffect } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useSearchStore } from '../../stores/useSearchStore';

export const SearchSection: React.FC = () => {
  const { t, localizer } = useI18n();
  const status = useSearchStore((s) => s.remoteSemanticStatus);
  const refresh = useSearchStore((s) => s.refreshRemoteSemanticStatus);
  const setConsent = useSearchStore((s) => s.setRemoteSemanticConsent);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status?.configured) return null;

  const checked = status.consent !== 'declined';
  let statusLine: string;
  if (status.consent === 'granted') {
    const when = status.consentedAt ? new Date(status.consentedAt) : null;
    const date = when && !Number.isNaN(when.getTime()) ? localizer.formatDate(when, { dateStyle: 'medium' }) : '';
    statusLine = t('preferencesDialog.remoteSemanticGranted', { date });
  } else if (status.consent === 'declined') {
    statusLine = t('preferencesDialog.remoteSemanticDeclined');
  } else {
    statusLine = t('preferencesDialog.remoteSemanticUnset');
  }

  return (
    <div className="space-y-8">
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => void setConsent(e.target.checked ? 'reset' : 'declined')}
            className="w-4 h-4 rounded"
            style={{ accentColor: 'var(--theme-accent-primary)' }}
            data-testid="remote-semantic-toggle"
          />
          <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            {t('preferencesDialog.remoteSemanticLabel')}
          </span>
        </label>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }} data-testid="remote-semantic-status">
          {statusLine}
        </p>
      </div>
    </div>
  );
};

export default SearchSection;
