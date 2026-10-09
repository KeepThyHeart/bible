/** The Measures fields under Settings > Theme: a heading and the generic form over the `measures` group. */
import { useTranslation } from 'react-i18next';
import { SettingsGroupForm } from '../../components/Dialogs/ContributedSection';

export default function MeasuresSettingsView() {
  const { t } = useTranslation();
  return (
    <>
      <div class="settings-panel__section-header">
        <h4 class="settings-panel__section-title" style={{ marginTop: '16px' }}>{t('settings.measures.title')}</h4>
      </div>
      <SettingsGroupForm group="measures" idPrefix="settings-measures" />
    </>
  );
}
