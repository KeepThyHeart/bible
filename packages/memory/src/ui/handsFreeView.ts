/**
 * Hands-free recite ("car mode"): one large, high-contrast line saying what
 * is happening, and five big controls. Nothing else competes for attention.
 *
 * Like `reciteView.ts` this is a handle with a persistent live region; the
 * phase text doubles as the announcement so screen readers get it too.
 */

import type { LoopPhase, ReciteAction, ReciteStateView } from '../core/types';
import { button, el, replace } from './dom';
import { errorBanner } from './components';
import { formatScore } from './format';
import { progressText } from './reciteView';

export interface HandsFreeCallbacks {
  onControl(action: ReciteAction): void;
  onExit(): void;
}

export interface HandsFreeScreen {
  element: HTMLElement;
  update(state: ReciteStateView): void;
}

export type HandsFreeTone = 'light' | 'dark';

/** Night, by the clock: 19:00 to 05:59 local. */
export function isNightHour(hour: number): boolean {
  return hour >= 19 || hour < 6;
}

/**
 * Car mode is dark only when the app's own theme is dark or it is night by the
 * local clock; otherwise it follows the panel's light styling. With no host
 * theme mode (a bare browser) the OS colour scheme stands in for it.
 */
export function handsFreeTone(opts: { themeMode: string | null; prefersDark: boolean; hour: number }): HandsFreeTone {
  const mainDark = opts.themeMode === null ? opts.prefersDark : opts.themeMode === 'dark';
  return mainDark || isNightHour(opts.hour) ? 'dark' : 'light';
}

function currentTone(): HandsFreeTone {
  return handsFreeTone({
    themeMode: document.documentElement.getAttribute('data-theme-mode'),
    prefersDark: typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
    hour: new Date().getHours(),
  });
}

/** The big line of text for a phase. */
export function handsFreePhaseText(state: ReciteStateView): string {
  const base: Record<LoopPhase, string> = {
    announcing: 'Get ready',
    ready: 'Say it when ready',
    listening: 'Listening',
    hinting: 'Hint',
    scoring: 'Scoring',
    feedback: state.result ? `Scored ${formatScore(state.result.score)}` : 'Scored',
    paused: 'Paused',
    summary: 'All done',
    done: 'All done',
    error: state.error?.message ?? 'Something went wrong',
  };
  return base[state.phase];
}

export function createHandsFreeView(initial: ReciteStateView, cb: HandsFreeCallbacks): HandsFreeScreen {
  const live = el('div', { class: 'sm-sr-only', attrs: { 'aria-live': 'assertive', role: 'status' } });
  const body = el('div', { class: 'sm-handsfree-body' });
  const root = el('section', { class: 'sm-screen sm-handsfree', attrs: { 'data-phase': initial.phase, 'data-tone': currentTone() } }, [body, live]);
  let last = '';

  function draw(state: ReciteStateView): void {
    root.setAttribute('data-phase', state.phase);
    root.setAttribute('data-tone', currentTone());
    const finished = state.phase === 'summary' || state.phase === 'done' || state.phase === 'error';
    const paused = state.phase === 'paused';
    const big = (label: string, action: ReciteAction, extra = ''): HTMLButtonElement =>
      button(label, () => cb.onControl(action), {
        class: `sm-btn sm-btn-large sm-handsfree-btn ${extra}`.trim(),
        disabled: finished,
      });

    const text = handsFreePhaseText(state);
    replace(body, [
      el('p', { class: 'sm-handsfree-ref', text: state.reference }),
      el('p', { class: 'sm-handsfree-phase', text }),
      state.source === 'due' && state.passageId !== null
        ? el('p', { class: 'sm-handsfree-progress', text: progressText(state) })
        : null,
      state.phase === 'error' && state.error ? errorBanner(state.error.message) : null,
      el('div', { class: 'sm-handsfree-controls' }, [
        paused ? big('Resume', 'resume', 'sm-btn-primary') : big('Pause', 'pause', 'sm-btn-primary'),
        big('Hint', 'hint'),
        big('Repeat', 'repeat'),
        big('Skip', 'skip'),
        button('Stop', () => (finished ? cb.onExit() : cb.onControl('stop')), {
          class: 'sm-btn sm-btn-large sm-handsfree-btn sm-btn-danger',
        }),
      ]),
    ]);

    const say = state.message || text;
    if (say !== last) {
      live.textContent = say;
      last = say;
    }
  }

  draw(initial);
  // The tone depends on the clock and the app theme, neither of which is a recite state change, so re-check it
  // while the screen is mounted (a paused or waiting run would otherwise keep the old tone).
  const retone = setInterval(() => {
    if (!root.isConnected) {
      if (root.dataset.mounted === '1') clearInterval(retone);
      return;
    }
    root.dataset.mounted = '1';
    const tone = currentTone();
    if (root.getAttribute('data-tone') !== tone) root.setAttribute('data-tone', tone);
  }, 2000);
  return { element: root, update: draw };
}

export function renderHandsFree(state: ReciteStateView, cb: HandsFreeCallbacks): HTMLElement {
  return createHandsFreeView(state, cb).element;
}
