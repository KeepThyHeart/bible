import React, { useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { openModuleManager } from '../utils/openModuleManager';
import HelpPanel from './HelpPanel';

/**
 * In-canvas header affordances for Preferences, the Module Manager, and Help.
 *
 * These commands already exist in the native menu bar (`buildMenuSpec.ts`), but
 * a novice who never opens the menu bar had no way to reach them. Each button
 * fires the same `command:*` DOM event the menu and command palette dispatch, so
 * there is one code path for all three entry points and no behaviour to keep in
 * sync. The native menu items are intentionally left in place.
 */
const HeaderActions: React.FC = () => {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);

  const dispatch = (name: string) => window.dispatchEvent(new CustomEvent(name));

  const iconButton =
    'w-8 h-8 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-background-hover rounded transition-colors';

  return (
    <div className="flex items-center gap-1 ms-auto flex-shrink-0" role="group" aria-label={t('header.actionsLabel')}>
      {/* Module Manager */}
      <button
        type="button"
        className={iconButton}
        onClick={() => openModuleManager()}
        title={t('header.openModuleManager')}
        aria-label={t('header.openModuleManager')}
        data-testid="header-module-manager"
      >
        <svg className="w-5 h-5" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      </button>

      {/* Preferences */}
      <button
        type="button"
        className={iconButton}
        onClick={() => dispatch('command:app:openPreferences')}
        title={t('header.openPreferences')}
        aria-label={t('header.openPreferences')}
        data-testid="header-preferences"
      >
        <svg className="w-5 h-5" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Help - opens the panel, which is where the tour now lives among the
          documentation, the shortcuts and the docs site. */}
      <div className="relative">
        <button
          type="button"
          className={iconButton}
          onClick={() => setShowHelp(open => !open)}
          title={t('header.help')}
          aria-label={t('header.help')}
          aria-haspopup="menu"
          aria-expanded={showHelp}
          data-testid="header-help"
        >
          <svg className="w-5 h-5" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      </div>
    </div>
  );
};

export default HeaderActions;
