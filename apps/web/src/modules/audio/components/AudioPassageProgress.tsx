/** "2 of 3 · Rom 8:28-39" while a typed list plays; nothing for the default chapter list. */

import { useTranslation } from 'react-i18next';
import { audioStore } from '../audioStore';
import { useStore } from '../../../hooks/useStore';
import { usePassageLabel } from '../hooks/usePassageLabel';

export function AudioPassageProgress() {
  const { t } = useTranslation();
  const queue = useStore(audioStore, () => audioStore.queue);
  const status = useStore(audioStore, () => audioStore.status);
  const label = usePassageLabel();
  if (status === 'idle' || !queue || queue.kind !== 'list') return null;
  const p = queue.passages[queue.index];
  if (!p) return null;
  return (
    <span class="audio-passage-progress" data-testid="audio-passage-progress">
      {t('audio.passages.progress', { index: queue.index + 1, count: queue.passages.length, ref: label(p) })}
    </span>
  );
}
