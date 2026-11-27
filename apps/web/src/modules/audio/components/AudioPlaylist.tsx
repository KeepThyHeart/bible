/**
 * Passages to read, behind the player's passages button. By default the player reads the current
 * chapter, and the panel opens straight into editing: one text box ("Ps 23; Rom 8:28-39"), Save
 * (which plays the list) and Cancel, and a plain message for any reference that is not understood.
 * While a typed list is set the panel shows it read-only with an edit (pencil) button, and
 * "Just John 3" goes back to reading the chapter.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { toPassages, MAX_PASSAGES } from '@bible/audio';
import { audioStore } from '../audioStore';
import { bibleStore } from '../../../stores/bibleStore';
import { moduleStore } from '../../../stores/moduleStore';
import { useStore } from '../../../hooks/useStore';
import { useNowPlaying } from '../hooks/useNowPlaying';
import { chapterCountOf, engineFor, rangeOf } from '../hooks/usePassageLabel';

const ERROR_KEY: Record<string, string> = {
  empty: 'empty', 'no-book': 'noBook', 'bad-numbers': 'badNumbers', 'out-of-range': 'outOfRange', 'too-many': 'tooMany',
};

/** The passages button (list icon) that shows and hides `AudioPlaylist`. */
export function PassagesButton({ open, onToggle, large }: { open: boolean; onToggle(): void; large?: boolean }) {
  const { t } = useTranslation();
  const typed = useStore(audioStore, () => audioStore.queue?.kind === 'list');
  return (
    <button
      type="button"
      class={`audio-btn audio-toggle${large ? ' audio-tool' : ''}${typed || open ? ' audio-toggle--on' : ''}`}
      aria-expanded={open}
      title={t('audio.passages.toggle')}
      aria-label={t('audio.passages.toggle')}
      data-testid="audio-playlist-toggle"
      onClick={onToggle}
    >
      <i class="fa-solid fa-list-ol" aria-hidden="true" />
      {large && <span class="audio-tool__caption">{t('audio.passages.short')}</span>}
    </button>
  );
}

export function AudioPlaylist({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language || 'en';
  const engine = useMemo(() => engineFor(lang), [lang]);
  const queue = useStore(audioStore, () => audioStore.queue);
  const activeId = useStore(bibleStore, () => bibleStore.activeTabId);
  const now = useNowPlaying();
  const typed = queue?.kind === 'list' ? queue.passages : null;
  const listText = typed ? typed.map(p => engine.format(rangeOf(p))).join('; ') : '';
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setText(listText);
    setErrors([]);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Opening with no typed list goes straight to the text box; with one, it shows the list first.
  useEffect(() => {
    if (!open) { setEditing(false); return; }
    if (!typed) startEditing();
  }, [open]);

  if (!open) return null;
  // With no typed list there is nothing to show read-only: the box is the panel.
  const showEditor = editing || !typed;

  const save = () => {
    const r = engine.parseList(text, { maxItems: MAX_PASSAGES });
    if (!r.ok) {
      setErrors(r.errors.map(e => t(`audio.passages.error.${ERROR_KEY[e.reason] ?? 'badNumbers'}`, {
        text: e.text, max: MAX_PASSAGES, book: e.book ? moduleStore.getBookName(e.book) : '',
      })));
      return;
    }
    // The pane picked on the Listen button wins; else the one playing; else the active pane.
    const target = audioStore.targetTabId ?? audioStore.playingTabId ?? activeId;
    if (!target) return;
    setEditing(false);
    onClose();
    void audioStore.playPassages(target, toPassages(r.items.map(i => i.range), chapterCountOf));
  };

  const cancel = () => {
    setEditing(false);
    setErrors([]);
    if (!typed) onClose();
  };

  // The chapter being read, else the open tab's.
  const tab = bibleStore.getActiveTab();
  const refBook = now.book ?? tab?.book ?? null;
  const refChapter = now.chapter ?? tab?.chapter ?? null;
  const chapterRef = refBook && refChapter ? `${moduleStore.getBookName(refBook)} ${refChapter}` : '';

  return (
    <section class="audio-playlist" aria-label={t('audio.passages.title')} data-testid="audio-playlist">
      {!showEditor && (
        <div class="audio-playlist__row">
          <span class="audio-playlist__current" data-testid="audio-playlist-current">{listText}</span>
          <button type="button" class="audio-btn" onClick={startEditing} title={t('audio.passages.edit')} aria-label={t('audio.passages.edit')} data-testid="audio-playlist-edit">
            <i class="fa-solid fa-pen" aria-hidden="true" />
          </button>
        </div>
      )}
      {showEditor && (
        <>
          <input
            ref={inputRef}
            type="text"
            class="audio-input"
            value={text}
            aria-label={t('audio.passages.input')}
            aria-invalid={errors.length > 0}
            placeholder={t('audio.passages.placeholder')}
            data-testid="audio-passages-input"
            onInput={e => { setText((e.target as HTMLInputElement).value); if (errors.length) setErrors([]); }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
            }}
          />
          {errors.length > 0 && (
            <ul class="audio-playlist__errors" role="alert" data-testid="audio-passages-error">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          <div class="audio-playlist__actions">
            <button type="button" class="audio-playlist__btn audio-playlist__btn--primary" disabled={!text.trim()} onClick={save} data-testid="audio-passages-play">
              {t('audio.passages.save')}
            </button>
            <button type="button" class="audio-playlist__btn" onClick={cancel} data-testid="audio-passages-cancel">
              {t('audio.action.cancel')}
            </button>
          </div>
        </>
      )}
      {typed && chapterRef && (
        <button
          type="button"
          class="audio-panel__more"
          data-testid="audio-playlist-chapter"
          onClick={() => { audioStore.useChapterList(); onClose(); }}
        >
          {t('audio.passages.useChapter', { ref: chapterRef })}
        </button>
      )}
    </section>
  );
}
