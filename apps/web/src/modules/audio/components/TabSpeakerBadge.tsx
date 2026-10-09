/** The tab being read to gets a small speaker mark (the reader may have switched to another tab). Registered in `readerTabBadges`. */
import { useTranslation } from 'react-i18next';
import type { ReaderTabBadgeProps } from '../../../host/slots';
import { useStore } from '../../../hooks/useStore';
import { audioStore } from '../audioStore';

export function TabSpeakerBadge({ tabId }: ReaderTabBadgeProps) {
  const { t } = useTranslation();
  const playing = useStore(audioStore, () => (audioStore.status === 'idle' ? null : audioStore.playingTabId));
  if (playing !== tabId) return null;
  return <i class="fa-solid fa-volume-high bible-tab-bar__audio" role="img" aria-label={t('audio.playingTab')} />;
}
