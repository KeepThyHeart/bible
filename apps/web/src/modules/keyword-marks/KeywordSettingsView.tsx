/** The keyword fields under Settings > Theme: the generic form over the `keywords` group, with no heading (as it always was). */
import { SettingsGroupForm } from '../../components/Dialogs/ContributedSection';

export default function KeywordSettingsView() {
  return <SettingsGroupForm group="keywords" idPrefix="settings-keywords" />;
}
