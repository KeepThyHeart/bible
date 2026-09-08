import React from 'react';
import { useI18n } from '../../contexts/useI18n';

interface PassageSettingsMenuProps {
  /**
   * Which pane's text settings the gear opens - the `open-preferences-fonts`
   * detail. Defaults to the Bible pane, which is where this started.
   */
  paneKey?: 'bible' | 'dictionary' | 'book' | 'commentary';
}

/**
 * A reading pane's gear: opens the Text Settings preferences directly.
 *
 * A two-item menu (text settings / pop out) would put both one click too
 * far: text settings is the only per-passage option there is, and pop-out is
 * already on the dockview pane tab. So the gear *is* the text settings
 * button, matching the web app's Bible toolbar.
 *
 * Every pane grew its own version of this - a bordered "Aa" box in Books, in
 * Dictionary, in the two single-module panels, in the commentary header. Same
 * event, same purpose, five different buttons. `paneKey` is all that ever
 * differed between them, so it is the only thing this takes.
 */
const PassageSettingsMenu: React.FC<PassageSettingsMenuProps> = ({ paneKey = 'bible' }) => {
  const { t } = useI18n();

  const openTextSettings = () => {
    window.dispatchEvent(new CustomEvent('open-preferences-fonts', { detail: paneKey }));
  };

  return (
    <div className="relative flex items-stretch">
      <button
        type="button"
        onClick={openTextSettings}
        className="flex items-center px-2.5 text-text-secondary hover:bg-background-active transition-colors"
        style={{ borderInlineStart: '2px solid var(--theme-border-primary)', borderRadius: 0 }}
        title={t('biblePane.textSettingsTitle')}
        aria-label={t('biblePane.textSettingsTitle')}
        data-testid="passage-settings"
      >
        <svg className="w-4 h-4" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </div>
  );
};

export default PassageSettingsMenu;
