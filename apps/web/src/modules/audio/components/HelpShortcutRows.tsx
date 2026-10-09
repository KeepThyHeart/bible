/** The audio keys in the Help dialog's shortcuts table (rows only; registered in `helpShortcutRows`). Shown while audio is available. */
import { useTranslation } from 'react-i18next';
import { useStore } from '../../../hooks/useStore';
import { audioStore } from '../audioStore';

export function HelpShortcutRows() {
  const { t } = useTranslation(['help', 'ui']);
  const enabled = useStore(audioStore, () => audioStore.enabled);
  if (!enabled) return null;
  return (
    <>
      <tr><td><kbd>Alt+P</kbd></td><td>{t('shortcuts.audioToggle')}</td></tr>
      <tr><td><kbd>Alt+←</kbd> <kbd>Alt+→</kbd></td><td>{t('shortcuts.audioVerse')}</td></tr>
      <tr><td><kbd>Alt+Shift+←</kbd> <kbd>Alt+Shift+→</kbd></td><td>{t('shortcuts.audioChapter')}</td></tr>
      <tr><td><kbd>Alt+Shift+P</kbd></td><td>{t('shortcuts.audioFocus')}</td></tr>
    </>
  );
}
