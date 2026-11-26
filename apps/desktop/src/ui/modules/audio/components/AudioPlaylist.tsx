/**
 * The playlist of the pop-up player: what is being read (the current chapter, or a typed list of passages), an
 * editor to type a list ("Ps 23; Rom 8:28-39; Gen 1-2") with live chips and errors, the "Continue to the next
 * chapter" checkbox and the repeat control. Also exports the small pieces the bar and the gear popover reuse.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PassageLoop } from '@bible/audio';
import { audioStore, useAudio } from '../audioState';
import { useI18n } from '../../../contexts/useI18n';
import { useNowPlaying } from './useNowPlaying';
import { usePassageLabel } from './usePassageLabel';
import { parsePassageInput } from './passageParse';
import type { PassageParse } from './passageParse';
import { AudioIcon } from './AudioIcons';
import './audio.css';

const LOOPS: readonly PassageLoop[] = ['once', 'list', 'passage'];

/** Play once / loop the list / loop this passage. */
export const LoopControl: React.FC<{ testId: string }> = ({ testId }) => {
  const { t } = useI18n();
  const loop = useAudio((s) => s.prefs.passageLoop);
  const id = useId();
  return (
    <div className="audio-panel__row">
      <span className="audio-panel__label" id={`${id}-loop`}>{t('audio.loop.label')}</span>
      <div className="audio-segmented" role="radiogroup" aria-labelledby={`${id}-loop`} data-testid={testId}>
        {LOOPS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={loop === l}
            className={`audio-segmented__btn${loop === l ? ' audio-segmented__btn--active' : ''}`}
            data-testid={`${testId}-${l}`}
            onClick={() => audioStore.setPassageLoop(l)}
          >
            {t(`audio.loop.${l}`)}
          </button>
        ))}
      </div>
    </div>
  );
};

/** "Continue to the next chapter": the shared `continueAfterChapter` setting. */
export const ContinueCheckbox: React.FC<{ testId: string }> = ({ testId }) => {
  const { t } = useI18n();
  const on = useAudio((s) => s.prefs.continueAfterChapter === 'next-chapter');
  const typed = useAudio((s) => s.queue?.kind === 'list');
  const hintId = useId();
  return (
    <div className="audio-panel__row audio-continue">
      <label className="audio-check">
        <input type="checkbox" checked={on} data-testid={testId} aria-describedby={typed ? hintId : undefined} onChange={(e) => audioStore.setContinueAfterChapter(e.target.checked)} />
        <span>{t('audio.continue.label')}</span>
      </label>
      {typed && <span className="audio-hint" id={hintId} data-testid={`${testId}-hint`}>{t('audio.continue.listHint')}</span>}
    </div>
  );
};

/** "2 of 3 · Rom 8:28-39" while a typed list plays; nothing for the chapter list. */
export const AudioPassageProgress: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useI18n();
  const queue = useAudio((s) => s.queue);
  const status = useAudio((s) => s.status);
  const { label } = usePassageLabel();
  if (!queue || queue.kind !== 'list' || status === 'idle') return null;
  const passage = queue.passages[queue.index];
  if (!passage) return null;
  return (
    <span className={className ?? 'audio-passage-progress'} data-testid="audio-passage-progress">
      {t('audio.passages.progress', { index: queue.index + 1, count: queue.passages.length, ref: label(passage) })}
    </span>
  );
};

/** Shown while a repeat mode other than "play once" is on, so a loop is never a surprise. */
export const LoopIndicator: React.FC = () => {
  const { t } = useI18n();
  const loop = useAudio((s) => s.prefs.passageLoop);
  if (loop === 'once') return null;
  return <span className="audio-loop-indicator" data-testid="audio-loop-indicator" title={t(`audio.loop.${loop}`)}>{t(`audio.loop.${loop}`)}</span>;
};

export const AudioPlaylist: React.FC<{ startOpen?: boolean }> = ({ startOpen = false }) => {
  const { t } = useI18n();
  const status = useAudio((s) => s.status);
  const queue = useAudio((s) => s.queue);
  const style = useAudio((s) => s.prefs.playerStyle);
  const now = useNowPlaying();
  const labeler = usePassageLabel();
  const idle = status === 'idle';
  const typed = !!queue && queue.kind === 'list';
  const [editing, setEditing] = useState(startOpen || idle);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<PassageParse | null>(null);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errId = useId();

  // What the editor starts from: the typed list in play, else the chapter in hand.
  const currentText = useMemo(
    () => (typed && queue ? labeler.listText(queue.passages) : now.chapterLabel),
    [typed, queue, labeler, now.chapterLabel],
  );

  const openEditor = () => { setText(currentText); setTouched(false); setParsed(null); setEditing(true); };

  // Idle with the player open: the editor is the player. Prefill once the chapter is known.
  useEffect(() => {
    if (!editing || touched) return;
    setText(currentText);
  }, [editing, touched, currentText]);

  // The editor opens by itself while idle (and when asked to), and the input takes focus then.
  useEffect(() => { if (idle) setEditing(true); }, [idle]);
  useEffect(() => { if (editing && (idle || startOpen)) inputRef.current?.focus(); }, [editing, idle, startOpen]);

  // Live parse, 200 ms after the last keystroke.
  useEffect(() => {
    if (!editing || !touched) return;
    const timer = setTimeout(() => setParsed(text.trim() ? parsePassageInput(labeler.engine, text) : null), 200);
    return () => clearTimeout(timer);
  }, [editing, touched, text, labeler.engine]);
  // The first parse of the prefilled text (so Play is enabled without typing).
  useEffect(() => {
    if (!editing || touched) return;
    setParsed(text.trim() ? parsePassageInput(labeler.engine, text) : null);
  }, [editing, touched, text, labeler.engine]);

  const tabId = (!idle ? audioStore.playingTabId : null) ?? now.panelId;

  const play = () => {
    const fresh = parsePassageInput(labeler.engine, text);
    setParsed(fresh);
    if (!fresh.ok || !tabId) return;
    void audioStore.playPassages(tabId, fresh.items.map((i) => i.passage));
    setEditing(false);
    if (style === 'bar') audioStore.closePlayer();
  };

  const removeChip = (index: number) => {
    if (!parsed) return;
    const rest = parsed.items.filter((_, i) => i !== index);
    setTouched(true);
    setText(rest.map((i) => labeler.engine.format(i.range)).join('; '));
  };

  const chapterList = () => {
    audioStore.useChapterList();
    setTouched(false);
    setText(now.chapterLabel);
    if (!idle) setEditing(false);
  };

  const items = parsed?.items ?? [];
  const errors = parsed?.errors ?? [];
  const summary = typed && queue ? labeler.listText(queue.passages) : now.chapterLabel;

  return (
    <section className="audio-playlist" aria-label={t('audio.playlist.label')} data-testid="audio-playlist">
      {!editing && (
        <div className="audio-playlist__current">
          <span className="audio-playlist__summary" data-testid="audio-playlist-summary">{summary || t('audio.playlist.label')}</span>
          <LoopIndicator />
          <button type="button" className="audio-status__btn" data-testid="audio-playlist-edit" onClick={openEditor}>{t('audio.playlist.edit')}</button>
        </div>
      )}
      {editing && (
        <div className="audio-playlist__editor">
          <label className="audio-panel__label" htmlFor={`${errId}-input`}>{t('audio.passages.input')}</label>
          <input
            id={`${errId}-input`}
            ref={inputRef}
            type="text"
            className="audio-input"
            value={text}
            placeholder={t('audio.passages.placeholder')}
            data-testid="audio-passages-input"
            aria-invalid={errors.length > 0}
            aria-describedby={errors.length > 0 ? errId : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => { setTouched(true); setText(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); play(); } }}
          />
          {items.length > 0 && (
            <ul className="audio-chips" aria-label={t('audio.playlist.label')}>
              {items.map((it, i) => {
                const ref = labeler.engine.format(it.range);
                return (
                  <li key={`${i}-${ref}`} className="audio-chip" data-testid="audio-passage-chip">
                    <span>{ref}</span>
                    <button type="button" className="audio-chip__remove" aria-label={t('audio.passages.remove', { ref })} title={t('audio.passages.remove', { ref })} onClick={() => removeChip(i)}>
                      <AudioIcon name="close" size={10} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div id={errId} className="audio-playlist__errors" role="alert" data-testid="audio-passages-error" hidden={errors.length === 0}>
            {errors.map((e, i) => <div key={i}>{t(`audio.passages.error.${e.code}`, e.params)}</div>)}
          </div>
          <div className="audio-playlist__actions">
            <button type="button" className="audio-btn audio-btn--text audio-btn--primary" data-testid="audio-passages-play" disabled={!parsed?.ok || !tabId} onClick={play}>
              {t('audio.passages.play')}
            </button>
            <button type="button" className="audio-status__btn" data-testid="audio-playlist-chapter" onClick={chapterList}>{t('audio.playlist.chapter')}</button>
            {!idle && (
              <button type="button" className="audio-status__btn" onClick={() => setEditing(false)}>{t('audio.playlist.close')}</button>
            )}
          </div>
        </div>
      )}
      <ContinueCheckbox testId="audio-continue" />
      <LoopControl testId="audio-loop" />
    </section>
  );
};

export default AudioPlaylist;
