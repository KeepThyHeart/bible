/**
 * The solo viewer's page: the projection viewer driven by a local session,
 * with a command box that appears only when asked for.
 *
 * The wall is the whole page. The `/` prompt is a translucent overlay that
 * floats over the text (it takes no layout space), opened with `/` or with the
 * small always-visible launcher at the bottom, and it fades three seconds
 * after the last command. Everything else -- arrow keys, `.`, clicker keys,
 * double-click highlighting -- works with the box hidden. There is no search
 * here; the box refuses it with a hint.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { ViewerApp } from '../ViewerApp';
import { CommandBox } from '../command';
import { resolveShortcutAction } from '../../study/usePresenterShortcuts';
import type { LocalSession } from './localSession';
import { useLocalSession } from './useLocalSession';

const AUTO_HIDE_MS = 3000;
const FADE_MS = 300;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function SoloApp(props: { session: LocalSession; defaultModule?: string }): preact.JSX.Element {
  const { session } = props;
  const { t } = useTranslation();
  const state = useLocalSession(session);

  const [open, setOpen] = useState(false);
  const [fading, setFading] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const timers = useRef<{ fade?: ReturnType<typeof setTimeout>; blur?: ReturnType<typeof setTimeout> }>({});
  const lastKey = useRef('');
  const stateRef = useRef(state);
  stateRef.current = state;

  const clearTimers = () => { clearTimeout(timers.current.fade); clearTimeout(timers.current.blur); };
  useEffect(() => clearTimers, []);

  const show = useCallback(() => {
    clearTimers();
    setFading(false);
    setOpen(true);
    setFocusSignal(n => n + 1);
  }, []);

  const hide = useCallback((immediately: boolean) => {
    clearTimers();
    if (immediately) { setOpen(false); setFading(false); return; }
    setFading(true);
    timers.current.fade = setTimeout(() => { setOpen(false); setFading(false); }, FADE_MS);
  }, []);

  // The wall's keyboard: `/` and Ctrl+K open the box; the clicker layer and
  // `.` reuse the presenter's own key mapping, minus its long-press sections
  // (those read a loaded chapter this page does not have).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;
      const ctrlK = (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k';
      if (ctrlK || (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey)) {
        event.preventDefault();
        show();
        return;
      }
      if (event.key === 'Escape' && open) { hide(true); return; }
      const action = resolveShortcutAction(event, { hasStaged: false, acceptClickerKeys: true, hasLive: !!stateRef.current.live });
      if (!action) return;
      const send = session.sink;
      if (action.type === 'next' || action.type === 'previous') send({ type: action.type });
      else if (action.type === 'toggleBlank') send({ type: stateRef.current.display.blanked ? 'unblank' : 'blank' });
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session, open, show, hide]);

  return (
    <>
      <ViewerApp localState={state} intentSink={session.sink} />
      <button
        type="button"
        class="pv-solo-launch"
        title={t('present.solo.launcherTooltip', {
          defaultValue: 'Brings up the command prompt for going to a verse (press / on the keyboard)',
        })}
        aria-label={t('present.solo.launcherLabel', { defaultValue: 'Open command prompt' })}
        onClick={show}
      >
        /
      </button>
      {open && (
        <div
          class={`pv-solo-cmd${fading ? ' pv-solo-cmd--fading' : ''}`}
          onKeyDownCapture={(e: KeyboardEvent) => { lastKey.current = e.key; }}
          // Clicking away leaves the box open only briefly: same clock as after a command.
          onFocusOut={() => { clearTimeout(timers.current.blur); timers.current.blur = setTimeout(() => hide(false), AUTO_HIDE_MS); }}
          onFocusIn={() => clearTimeout(timers.current.blur)}
        >
          <CommandBox
            variant="overlay"
            searchEnabled={false}
            sink={session.sink}
            state={state}
            defaultModule={props.defaultModule}
            autoFocus
            focusSignal={focusSignal}
            autoHideMs={AUTO_HIDE_MS}
            onDismiss={() => hide(lastKey.current === 'Escape')}
          />
        </div>
      )}
    </>
  );
}
