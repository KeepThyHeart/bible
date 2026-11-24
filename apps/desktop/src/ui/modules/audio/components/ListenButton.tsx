/**
 * The Bible toolbar's Listen button (registered in the host's `readerToolbarItems` slot). The audio "tab" is
 * the Bible pane (its panel id). Enabled only when pressing it can work; says why when it cannot.
 */
import React from 'react';
import { audioStore, useAudio } from '../audioState';
import { useBiblePaneContext } from '../../../components/BiblePaneContext';
import { useI18n } from '../../../contexts/useI18n';
import { AudioIcon } from './AudioIcons';
import { markAudioRequestedPane } from './paneRequest';
import './audio.css';

export const ListenButton: React.FC<{ tabId: string }> = () => {
  const { t } = useI18n();
  const { panelId, activeTab, currentVerses, isLoading } = useBiblePaneContext();
  const enabled = useAudio((s) => s.enabled);
  const active = useAudio((s) => s.isPlayingTab(panelId));
  const status = useAudio((s) => s.status);
  const moduleAbbr = activeTab?.abbreviation ?? '';
  const availability = useAudio((s) => (s.enabled && moduleAbbr ? s.availability(moduleAbbr) : 'none'));
  if (!enabled) return null;

  const playing = active && (status === 'playing' || status === 'preparing' || status === 'buffering' || status === 'resolving');
  const paused = active && status === 'paused';
  const loaded = !isLoading && currentVerses.length > 0;
  const canPlay = loaded && availability === 'ok';
  const disabled = !active && !canPlay;

  const label = playing ? t('audio.pause') : paused ? t('audio.action.resume') : t('audio.listen');
  const title = disabled
    ? (availability === 'none' ? t('audio.notice.noAudio') : t('audio.listenTooltip'))
    : playing ? t('audio.pause') : paused ? t('audio.action.resume') : t('audio.listenTooltip');

  return (
    <button
      type="button"
      className="audio-toolbar-btn"
      onClick={() => { markAudioRequestedPane(panelId); audioStore.togglePlay(panelId); }}
      onMouseDown={(e) => e.stopPropagation()}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={playing}
      data-testid="audio-listen"
    >
      <AudioIcon name={playing ? 'pause' : 'play'} />
      <span>{t('audio.listen')}</span>
      {active && (
        <span className="audio-toolbar-btn__badge" data-testid="audio-speaker-badge" title={t('audio.playingTab')}>
          <AudioIcon name="speaker" size={14} />
        </span>
      )}
    </button>
  );
};

export default ListenButton;
