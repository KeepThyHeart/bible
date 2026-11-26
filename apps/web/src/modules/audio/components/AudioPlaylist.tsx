/**
 * The playlist section of the player: what will be read (the current chapter, or a typed list of
 * passages as chips), an editor that parses "Ps 23; Rom 8:28-39; Gen 1-2" as you type, the
 * "continue to the next chapter" checkbox and the repeat control.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import type { ReferenceListResult } from '@bible/core/browser';
import { toPassages, MAX_PASSAGES } from '@bible/audio';
import type { AudioPassage, PassageQueue } from '@bible/audio';
import { audioStore } from '../audioStore';
import { bibleStore } from '../../../stores/bibleStore';
import { moduleStore } from '../../../stores/moduleStore';
import { useStore } from '../../../hooks/useStore';
import { chapterCountOf, engineFor, rangeOf } from '../hooks/usePassageLabel';
import { removeSpan } from '../lib/removeSpan';
import { PassageOptions } from './PassageOptions';

const ERROR_KEY: Record<string, string> = {
  empty: 'empty', 'no-book': 'noBook', 'bad-numbers': 'badNumbers', 'out-of-range': 'outOfRange', 'too-many': 'tooMany',
};

export function AudioPlaylist({ startExpanded }: { startExpanded?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language || 'en';
  const engine = useMemo(() => engineFor(lang), [lang]);
  const status = useStore(audioStore, () => audioStore.status);
  const playingTabId = useStore(audioStore, () => audioStore.playingTabId);
  const targetTabId = useStore(audioStore, () => audioStore.targetTabId);
  const liveQueue = useStore(audioStore, () => audioStore.queue);
  useStore(audioStore.bookmarksChanged, () => 0);
  const activeId = useStore(bibleStore, () => bibleStore.activeTabId);
  const idle = status === 'idle';
  const tabId = !idle && playingTabId ? playingTabId : (targetTabId ?? activeId);
  const tab = useStore(bibleStore, () => bibleStore.tabs.find(x => x.id === tabId));

  // The list in force: the live queue while playing, else the tab's saved one.
  const queue: PassageQueue | null = !idle ? liveQueue : (tabId ? audioStore.bookmarkFor(tabId)?.queue ?? null : null);
  const typed = queue?.kind === 'list' ? queue.passages : null;
  const fmt = (p: AudioPassage) => engine.format(rangeOf(p));
  const chapterLabel = tab?.book && tab.chapter ? `${moduleStore.getBookName(tab.book)} ${tab.chapter}` : '';
  const current = typed ? typed.map(fmt).join('; ') : chapterLabel;

  const [open, setOpen] = useState(!!startExpanded);
  const [text, setText] = useState(current);
  const [result, setResult] = useState<ReferenceListResult | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the list in force until the reader types.
  useEffect(() => { if (!dirty.current) setText(current); }, [current]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const parse = (s: string) => engine.parseList(s, { maxItems: MAX_PASSAGES });
  const onInput = (s: string) => {
    dirty.current = true;
    setText(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(parse(s)), 200);
  };

  const parsed = result ?? (open ? parse(text) : null);
  const play = () => {
    if (timer.current) clearTimeout(timer.current);
    const r = parse(text);
    setResult(r);
    // The pane picked on the Listen button wins; else the one playing; else the active pane.
    const target = audioStore.targetTabId ?? audioStore.playingTabId ?? activeId;
    if (!r.ok || !target) return;
    dirty.current = false;
    setOpen(false);
    void audioStore.playPassages(target, toPassages(r.items.map(i => i.range), chapterCountOf));
  };
  const remove = (index: number) => {
    const it = parsed?.items[index];
    if (it) onInput(removeSpan(text, it.start, it.end));
  };

  const errorText = (e: { reason: string; text: string; book?: number }) =>
    t(`audio.passages.error.${ERROR_KEY[e.reason] ?? 'badNumbers'}`, {
      text: e.text, max: MAX_PASSAGES, book: e.book ? moduleStore.getBookName(e.book) : '',
    });

  return (
    <section class="audio-playlist" aria-label={t('audio.playlist.label')} data-testid="audio-playlist">
      <div class="audio-playlist__head">
        <span class="audio-panel__label">{t('audio.playlist.label')}</span>
        {!open && (
          <span class="audio-playlist__current" data-testid="audio-playlist-current">
            {typed
              ? typed.map((p, i) => <span key={i} class="audio-passage-chip">{fmt(p)}</span>)
              : chapterLabel}
          </span>
        )}
        {!open && (
          <button type="button" class="audio-panel__more" data-testid="audio-playlist-edit" onClick={() => setOpen(true)}>
            {t('audio.playlist.edit')}
          </button>
        )}
      </div>
      {open && (
        <div class="audio-playlist__editor">
          <input
            type="text"
            class="audio-input"
            value={text}
            aria-label={t('audio.passages.input')}
            placeholder={t('audio.passages.placeholder')}
            data-testid="audio-passages-input"
            onInput={e => onInput((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); play(); } }}
          />
          {parsed && parsed.items.length > 0 && (
            <ul class="audio-playlist__chips">
              {parsed.items.map((item, i) => (
                <li key={`${i}-${item.text}`} class="audio-passage-chip" data-testid="audio-passage-chip">
                  {engine.format(item.range)}
                  <button
                    type="button"
                    class="audio-passage-chip__remove"
                    aria-label={t('audio.passages.remove', { ref: engine.format(item.range) })}
                    onClick={() => remove(i)}
                  >
                    <i class="fa-solid fa-xmark" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {parsed && parsed.errors.length > 0 && (
            <ul class="audio-playlist__errors" role="alert" data-testid="audio-passages-error">
              {parsed.errors.map((e, i) => <li key={i}>{errorText(e)}</li>)}
            </ul>
          )}
          <div class="audio-playlist__actions">
            <button type="button" class="audio-btn audio-btn--primary" disabled={!parsed?.ok || !tabId} onClick={play} data-testid="audio-passages-play">
              {t('audio.passages.play')}
            </button>
            <button
              type="button"
              class="audio-panel__more"
              data-testid="audio-playlist-chapter"
              onClick={() => { audioStore.useChapterList(); dirty.current = false; setOpen(false); setResult(null); }}
            >
              {t('audio.playlist.chapter')}
            </button>
          </div>
        </div>
      )}
      <PassageOptions prefix="audio" showHint />
    </section>
  );
}
