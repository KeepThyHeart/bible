import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../../stores/bibleStore';
import { presentStore } from '../../stores/presentStore';
import { useStore } from '../../hooks/useStore';
import type { PresentState } from '../protocol';
import { completeBook, describeCommand, parseCommand, type Command } from './command';
import { buildCommandContext } from './commandContext';
import { executeCommand, type ExecuteFailure, type IntentSink } from './execute';
import { commandSearch } from './commandSearch';
import { searchHymns as defaultSearchHymns } from './searchProviders';
import {
  historyNewer, historyOlder, historyStart, loadHistory, pushHistory, saveHistory, type HistoryCursor,
} from './history';
import './command.css';

/**
 * The command box: one input that runs a reference, a hymn, a blank, a step or
 * a search. See `command.ts` for the grammar; this file is only the keyboard
 * and the pixels.
 *
 * Keys (input focused):
 *  - `.` in an empty box blanks at once, no Enter.
 *  - Arrows in an empty box step: Left/Up previous, Right/Down next.
 *  - Up recalls history, but only once something has been typed (so the arrow
 *    keys in an empty box always mean "move"). Down walks back.
 *  - With search results open, Up/Down choose a result, Enter shows it,
 *    Alt+Enter adds it to notes, Esc closes them.
 *  - Tab completes a book name (again to cycle). Enter runs. Esc clears, then blurs.
 */

export interface CommandBoxProps {
  /** `panel`: in the Control pane. `bar`: pinned to the bottom on phones. `overlay`: solo viewer, translucent, bottom-centred over the text. */
  variant: 'panel' | 'overlay' | 'bar';
  /** False in the solo viewer: a would-be search is refused with a hint instead. */
  searchEnabled: boolean;
  sink: IntentSink;
  /** The wall state: blanking and relative (bare-verse) commands read it. */
  state: PresentState | null;
  /** Fired when a search starts (query) or is dismissed (null). */
  onSearch?: (query: string | null) => void;
  onHelp?: () => void;
  /** Translation for passages that name none. Defaults to the wall's, then the Study tab's. */
  defaultModule?: string;
  /** Focus on mount. */
  autoFocus?: boolean;
  /** Bump to focus the box (e.g. after the host handled `/`). */
  focusSignal?: number;
  /** Esc in an already-empty box, or (overlay) the idle timeout: the host hides the box. */
  onDismiss?: () => void;
  /** Overlay only: call `onDismiss` this long after the last keystroke or command. */
  autoHideMs?: number;
}

const mounted: Array<() => void> = [];

/** Focus the most recently mounted command box. Returns false when none is mounted. */
export function focusCommandBox(): boolean {
  const focus = mounted[mounted.length - 1];
  if (!focus) return false;
  focus();
  return true;
}

const FAILURE_KEY: Record<ExecuteFailure, [string, string]> = {
  empty: ['present.command.error.empty', 'Type a reference, hymn or search'],
  noPassage: ['present.command.error.noPassage', 'Nothing on screen to pick a verse from'],
  noTranslation: ['present.command.error.noTranslation', 'No translation available'],
  hymnNotFound: ['present.command.error.hymnNotFound', 'Hymn not found'],
  hymnUnavailable: ['present.command.error.hymnUnavailable', 'Hymns unavailable'],
  searchDisabled: ['present.command.error.searchDisabled', 'Search is off here. Try a reference like John 3:16'],
};

export function CommandBox(props: CommandBoxProps) {
  const { variant, searchEnabled, sink, state, onSearch, onHelp, onDismiss } = props;
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<string[]>(loadHistory());
  const cursorRef = useRef<HistoryCursor | null>(null);
  const completeRef = useRef<{ base: string; cycle: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const searchOpen = useStore(commandSearch, () => commandSearch.query !== null);
  const searchQuery = useStore(commandSearch, () => commandSearch.query);
  const activeModule = useStore(bibleStore, () => bibleStore.getActiveTab()?.moduleAbbr);

  const live = state?.live ?? null;
  const defaultModule = props.defaultModule
    ?? (live?.kind === 'passage' ? live.module : undefined)
    ?? activeModule;
  const current = live?.kind === 'passage' ? { book: live.book, chapter: live.chapter } : null;
  const ctx = useMemo(
    () => buildCommandContext({ defaultModule, current }),
    [defaultModule, current?.book, current?.chapter],
  );

  const tr = (key: string, params: Record<string, string | number>, fallback: string) =>
    t(key, { ...params, defaultValue: fallback });

  const command: Command = useMemo(() => parseCommand(value, ctx), [value, ctx]);
  let hint = describeCommand(command, ctx, tr);
  if (command.type === 'search' && !searchEnabled) {
    hint = t('present.command.hint.searchOff', { defaultValue: 'Not a command (search is off here)' });
  }

  // Focus plumbing: `/` and Ctrl+K reach us through `focusCommandBox`.
  useEffect(() => {
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); };
    mounted.push(focus);
    if (props.autoFocus) inputRef.current?.focus();
    return () => {
      const i = mounted.indexOf(focus);
      if (i >= 0) mounted.splice(i, 1);
    };
  }, []);
  useEffect(() => {
    if (props.focusSignal !== undefined) inputRef.current?.focus();
  }, [props.focusSignal]);

  // Overlay idle fade: the host owns visibility, we only say when it is time.
  const poke = () => {
    if (variant !== 'overlay' || !props.autoHideMs || !onDismiss) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(onDismiss, props.autoHideMs);
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // When the results close (chosen, Esc, or the host closed them), the searched
  // text has done its job: clear it, unless the user has already edited it.
  const prevSearch = useRef<string | null>(null);
  useEffect(() => {
    const was = prevSearch.current;
    prevSearch.current = searchQuery;
    if (was !== null && searchQuery === null && value.trim() === was) setText('');
  }, [searchQuery]);

  const closeSearch = () => {
    if (commandSearch.query !== null) {
      commandSearch.close();
      onSearch?.(null);
    }
  };

  const setText = (text: string) => {
    setValue(text);
    setError(null);
    completeRef.current = null;
  };

  const run = async () => {
    const cmd = parseCommand(value, ctx);
    if (cmd.type === 'none') return;
    const result = await executeCommand(cmd, {
      sink,
      state,
      defaultModule,
      searchHymns: defaultSearchHymns,
      rememberHymns: hymns => presentStore.rememberHymns(hymns),
      onHelp,
      onSearch: searchEnabled
        ? query => { commandSearch.open(query); onSearch?.(query); }
        : undefined,
    });
    poke();
    if (!result.ok) {
      const [key, fallback] = FAILURE_KEY[result.reason];
      setError(t(key, { defaultValue: fallback }));
      return;
    }
    historyRef.current = pushHistory(historyRef.current, value);
    saveHistory(historyRef.current);
    cursorRef.current = null;
    // A search keeps its text so the box and the results stay visibly linked;
    // anything else has been done, so the box is ready for the next thing.
    if (cmd.type !== 'search') {
      setText('');
      closeSearch();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    poke();
    const mod = e.ctrlKey || e.metaKey;
    const resultsLinked = searchOpen && value.trim() === searchQuery;

    if (e.key === '.' && value === '' && !mod && !e.altKey) {
      e.preventDefault();
      void executeCommand({ type: 'blank' }, { sink, state });
      return;
    }

    if (value === '' && !mod && !e.altKey && !e.shiftKey) {
      const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 'previous'
        : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 'next' : null;
      if (step) {
        e.preventDefault();
        sink({ type: step });
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (resultsLinked && commandSearch.items.length > 0) {
        commandSearch.activate(e.altKey ? 'notes' : 'show');
        return;
      }
      void run();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (searchOpen) { closeSearch(); return; }
      if (value !== '') { setText(''); cursorRef.current = null; return; }
      inputRef.current?.blur();
      onDismiss?.();
      return;
    }

    if (e.key === 'Tab' && !e.shiftKey) {
      const prev = completeRef.current;
      const base = prev ? prev.base : value;
      const cycle = prev ? prev.cycle + 1 : 0;
      const completion = completeBook(base, ctx, cycle);
      if (completion) {
        e.preventDefault();
        setValue(completion.text);
        completeRef.current = { base, cycle };
      }
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      if (resultsLinked) {
        e.preventDefault();
        commandSearch.move(dir);
        return;
      }
      // History only once there is something typed (or we are already walking it).
      if (value === '' && !cursorRef.current) return;
      e.preventDefault();
      const cur = cursorRef.current ?? historyStart(historyRef.current, value);
      const step = dir < 0 ? historyOlder(historyRef.current, cur) : historyNewer(historyRef.current, cur);
      cursorRef.current = step.cursor;
      setValue(step.text);
      setError(null);
    }
  };

  const onInput = (e: Event) => {
    const text = (e.target as HTMLInputElement).value;
    cursorRef.current = null;
    setText(text);
    // Editing away from the searched text drops the linked results.
    if (searchOpen && text.trim() !== searchQuery) closeSearch();
  };

  const placeholder = variant === 'overlay'
    ? t('present.command.placeholderOverlay', { defaultValue: 'Go to a verse: John 3:16, 18, . to blank' })
    : t('present.command.placeholder', { defaultValue: 'John 3:16 · 18 · hymn 23 · grace · .' });

  return (
    <div class={`present-cmd present-cmd--${variant}${error ? ' present-cmd--error' : ''}`}>
      <span class="present-cmd__prompt" aria-hidden="true">/</span>
      <input
        dir="auto"
        ref={inputRef}
        class="present-cmd__input"
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={t('present.command.label', { defaultValue: 'Command' })}
        title={t('present.command.tooltip', { defaultValue: 'Go to a verse or hymn. Press / to focus.' })}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        enterkeyhint="go"
        onInput={onInput}
        onKeyDown={onKeyDown}
      />
      {(error ?? hint) && (
        <span class="present-cmd__hint" role="status" aria-live="polite">{error ?? hint}</span>
      )}
    </div>
  );
}
