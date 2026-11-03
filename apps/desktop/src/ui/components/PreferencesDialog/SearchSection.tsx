/**
 * SearchSection.tsx
 *
 * "Search" tab of the Preferences dialog: where meaning (semantic) search runs.
 *
 *  - Online: the hosted service (task 0190). Shown only when the build
 *    configures one. Choosing it never grants consent by itself; the notice is
 *    shown on the next meaning search if the user has not agreed yet.
 *  - On this computer: the installed meaning-search pack. Always offered, even
 *    before the pack is installed, with a link to Module Manager > Feature
 *    packs to get it.
 *  - Off: keyword search only.
 *
 * The main process enforces the choice (`remoteSemantic:setSource`); this only
 * shows and records it.
 */

import React, { useEffect } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useSearchStore } from '../../stores/useSearchStore';
import { openModuleManager } from '../../utils/openModuleManager';
import type { SemanticSource } from '../../services/electronAPI';

export const SearchSection: React.FC = () => {
  const { t, localizer } = useI18n();
  const status = useSearchStore((s) => s.remoteSemanticStatus);
  const refresh = useSearchStore((s) => s.refreshRemoteSemanticStatus);
  const setSource = useSearchStore((s) => s.setSemanticSource);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status) return null;

  const configured = status.configured === true;
  const current: SemanticSource = status.source ?? (configured ? 'online' : 'offline');
  const packInstalled = status.localPackInstalled === true;

  let onlineStatus = '';
  if (configured && current === 'online') {
    if (status.consent === 'granted') {
      const when = status.consentedAt ? new Date(status.consentedAt) : null;
      const date = when && !Number.isNaN(when.getTime()) ? localizer.formatDate(when, { dateStyle: 'medium' }) : '';
      onlineStatus = t('preferencesDialog.remoteSemanticGranted', { date });
    } else {
      onlineStatus = t('preferencesDialog.remoteSemanticUnset');
    }
  }

  const option = (value: SemanticSource, label: string, help: string, extra?: React.ReactNode) => (
    <label className="flex items-start gap-2 cursor-pointer" data-testid={`semantic-source-${value}-row`}>
      <input
        type="radio"
        name="semantic-source"
        value={value}
        checked={current === value}
        onChange={() => void setSource(value)}
        className="w-4 h-4 mt-0.5"
        style={{ accentColor: 'var(--theme-accent-primary)' }}
        data-testid={`semantic-source-${value}`}
      />
      <span>
        <span className="block text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
          {label}
        </span>
        <span className="block text-xs mt-0.5" style={{ color: 'var(--theme-text-secondary)' }}>
          {help}
        </span>
        {extra}
      </span>
    </label>
  );

  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="text-sm font-semibold mb-1" style={{ color: 'var(--theme-text-primary)' }}>
          {t('preferencesDialog.semanticHeading')}
        </legend>
        <p className="text-xs mb-3" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('preferencesDialog.semanticIntro')}
        </p>
        <div className="space-y-3" role="radiogroup" aria-label={t('preferencesDialog.semanticHeading')}>
          {configured &&
            option(
              'online',
              t('preferencesDialog.semanticOnline'),
              t('preferencesDialog.semanticOnlineHelp'),
              onlineStatus ? (
                <span
                  className="block text-xs mt-0.5"
                  style={{ color: 'var(--theme-text-secondary)' }}
                  data-testid="remote-semantic-status"
                >
                  {onlineStatus}
                </span>
              ) : null,
            )}
          {option(
            'offline',
            t('preferencesDialog.semanticOffline'),
            t('preferencesDialog.semanticOfflineHelp'),
            packInstalled ? null : (
              <span className="block text-xs mt-0.5" style={{ color: 'var(--theme-text-secondary)' }} data-testid="semantic-pack-missing">
                {t('preferencesDialog.semanticOfflineMissing')}{' '}
                <button
                  type="button"
                  className="underline"
                  style={{ color: 'var(--theme-accent-primary)' }}
                  onClick={(e) => {
                    e.preventDefault();
                    openModuleManager('features');
                  }}
                  data-testid="semantic-pack-install"
                >
                  {t('preferencesDialog.semanticOfflineInstall')}
                </button>
              </span>
            ),
          )}
          {option('off', t('preferencesDialog.semanticOff'), t('preferencesDialog.semanticOffHelp'))}
        </div>
      </fieldset>
    </div>
  );
};

export default SearchSection;
