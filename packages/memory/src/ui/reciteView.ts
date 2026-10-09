/**
 * Recite aloud, tap-to-talk: the passage reference, one big Talk/Stop button,
 * the words heard so far, and after scoring a word-by-word diff.
 *
 * Colour is never the only cue. Every verdict that is not plain "correct"
 * carries a text label in the word itself ("(missed)", "(close)", ...), and
 * the diff list has an aria-label so a screen reader hears the same thing.
 *
 * Privacy: heard words are shown from `state.heard` (memory only) and never
 * stored or logged here.
 *
 * The screen is a handle (`element` plus `update`): the live region is created
 * once and kept across updates, because a live region inserted together with
 * its text is often not announced at all.
 */

import type { LoopPhase, ReciteAction, ReciteResultView, ReciteStateView, ReciteVerdict } from '../core/types';
import { type Child, button, el, focusQuietly, replace } from './dom';
import { breadcrumb, errorBanner } from './components';
import { formatDue, formatScore } from './format';
import { tr } from './i18n';

export interface ReciteCallbacks {
  /** Sends a `reciteControl` action. */
  onControl(action: ReciteAction): void;
  /** Leaves the screen (breadcrumb, and "Done" on the summary). */
  onExit(): void;
  /** Starts the same recitation again after an error (a new run, same source). Omitted: falls back to a `listen` control. */
  onRetry?(source: { kind: 'passage'; passageId: number } | { kind: 'due' }): void;
  /** Wall clock for "next due"; defaults to `Date.now`. */
  now?: () => number;
}

export interface ReciteScreen {
  element: HTMLElement;
  update(state: ReciteStateView): void;
}

/** Text a screen reader hears for a phase when the worker sent no message. */
export function phaseAnnouncement(state: ReciteStateView): string {
  if (state.message) return state.message;
  switch (state.phase) {
    case 'announcing': return tr('memory.ui.settings.getReady', 'Get ready');
    case 'ready': return tr('memory.ui.settings.ready', 'Ready');
    case 'listening': return tr('memory.ui.settings.listening', 'Listening');
    case 'hinting': return tr('memory.ui.settings.hereIsHint', 'Here is a hint');
    case 'scoring': return tr('memory.ui.settings.scoring', 'Scoring');
    case 'feedback': return state.result ? tr('memory.ui.settings.scoredWith', 'Scored {score}', { score: formatScore(state.result.score) }) : tr('memory.ui.settings.scored', 'Scored');
    case 'paused': return tr('memory.ui.settings.paused', 'Paused');
    case 'summary': return tr('memory.ui.settings.allDone', 'All done');
    case 'done': return tr('memory.ui.settings.allDone', 'All done');
    case 'error': return state.error?.message ?? tr('memory.ui.settings.wentWrong', 'Something went wrong');
  }
}

/** Getters, so the labels follow the UI language at render time rather than at import. */
export const VERDICT_LABEL: Record<ReciteVerdict, string | null> = {
  correct: null,
  variant: null,
  get near() { return tr('memory.ui.settings.verdictNear', 'close'); },
  get swapped() { return tr('memory.ui.settings.verdictSwapped', 'swapped'); },
  get wrong() { return tr('memory.ui.settings.verdictWrong', 'wrong'); },
  get missed() { return tr('memory.ui.settings.verdictMissed', 'missed'); },
  get hinted() { return tr('memory.ui.settings.verdictHinted', 'hinted'); },
};

/** The reference passage's words, flattened in verse order (the worker's indexing). */
function expectedWords(state: ReciteStateView): string[] | null {
  if (!state.verses) return null;
  return state.verses.flatMap((v) => v.words);
}

/** The word-by-word diff. Exported for the hands-free summary and tests. */
export function renderDiff(state: ReciteStateView, result: ReciteResultView): HTMLElement {
  const words = expectedWords(state);
  const extrasAfter = new Map<number, string[]>();
  for (const x of result.extras) {
    const list = extrasAfter.get(x.afterIndex) ?? [];
    list.push(x.heard);
    extrasAfter.set(x.afterIndex, list);
  }

  const items: Child[] = [];
  const pushExtras = (afterIndex: number): void => {
    for (const heard of extrasAfter.get(afterIndex) ?? []) {
      items.push(
        el('span', { class: 'sm-recite-word sm-recite-extra', attrs: { 'data-verdict': 'extra' } }, [
          `+${heard}`,
          el('span', { class: 'sm-sr-only', text: ` ${tr('memory.ui.settings.extra', '(extra)')}` }),
        ]),
        ' ',
      );
    }
  };

  pushExtras(-1);
  for (const w of result.words) {
    const text = words?.[w.index] ?? w.heard ?? '…';
    const label = VERDICT_LABEL[w.verdict];
    items.push(
      el('span', { class: `sm-recite-word sm-recite-${w.verdict}`, attrs: { 'data-verdict': w.verdict } }, [
        text,
        label ? ' ' : null,
        label ? el('span', { class: 'sm-recite-tag', text: `(${label})` }) : null,
        w.verdict === 'near' && w.heard ? el('span', { class: 'sm-sr-only', text: ` ${tr('memory.ui.settings.heardWord', 'heard {word}', { word: w.heard })}` }) : null,
      ]),
      ' ',
    );
    pushExtras(w.index);
  }

  return el('p', { class: 'sm-recite-diff', attrs: { 'aria-label': tr('memory.ui.settings.yourRecitation', 'Your recitation, word by word') } }, items);
}

function renderResult(state: ReciteStateView, result: ReciteResultView, cb: ReciteCallbacks): HTMLElement {
  const now = (cb.now ?? Date.now)();
  const hasNext = state.remaining > 0 || state.source === 'due';
  return el('div', { class: 'sm-recite-result' }, [
    el('p', { class: 'sm-recite-score' }, [
      el('span', { class: 'sm-recite-score-num', text: formatScore(result.score) }),
      el('span', { class: 'sm-recite-level', text: ` ${tr('memory.ui.settings.level', 'Level {level}', { level: result.level })}` }),
    ]),
    result.nextDueAt !== null ? el('p', { class: 'sm-hint', text: formatDue(result.nextDueAt, now) }) : null,
    result.passageWellLearned
      ? el('p', { class: 'sm-recite-learned', text: tr('memory.ui.settings.wellLearned', 'Well learned. This passage is solid.') })
      : null,
    renderDiff(state, result),
    result.missedQuote.length > 0
      ? el('p', { class: 'sm-hint', text: tr('memory.ui.settings.missedQuote', 'Missed: “{quote}”', { quote: result.missedQuote.join(' ') }) })
      : null,
    el('div', { class: 'sm-exercise-actions' }, [
      button(tr('memory.ui.settings.again', 'Again'), () => cb.onControl('again'), { class: 'sm-btn' }),
      button(hasNext ? tr('memory.ui.settings.next', 'Next') : tr('memory.ui.settings.done', 'Done'), () => (hasNext ? cb.onControl('next') : cb.onExit()), {
        class: 'sm-btn sm-btn-primary',
      }),
    ]),
  ]);
}

/** "Card 2 of 5" style progress for a due-queue run (never "0 done, 1 to go"). */
export function progressText(state: ReciteStateView): string {
  return tr('memory.ui.settings.cardProgress', 'Card {n} of {total}', { n: state.done + 1, total: state.done + state.remaining + 1 });
}

function talkButton(phase: LoopPhase, cb: ReciteCallbacks): HTMLButtonElement | null {
  if (phase === 'listening') {
    return button(tr('memory.ui.settings.stop', 'Stop'), () => cb.onControl('stop'), {
      class: 'sm-btn sm-btn-primary sm-btn-large sm-recite-talk sm-recite-talk-on',
      attrs: { 'aria-keyshortcuts': 'Space' },
    });
  }
  if (phase === 'ready' || phase === 'hinting' || phase === 'paused' || phase === 'announcing' || phase === 'scoring') {
    const enabled = phase === 'ready' || phase === 'hinting' || phase === 'paused';
    return button(tr('memory.ui.settings.talk', 'Talk'), () => cb.onControl('listen'), {
      class: 'sm-btn sm-btn-primary sm-btn-large sm-recite-talk',
      disabled: !enabled,
      attrs: { 'aria-keyshortcuts': 'Space' },
    });
  }
  return null;
}

export function createReciteView(initial: ReciteStateView, cb: ReciteCallbacks): ReciteScreen {
  let state = initial;

  const live = el('div', {
    class: 'sm-sr-only sm-recite-live',
    attrs: { 'aria-live': 'polite', role: 'status' },
  });
  const crumb = el('div');
  const body = el('div', { class: 'sm-recite-body' });
  const root = el('section', {
    class: 'sm-screen sm-recite',
    attrs: { tabindex: '-1', 'data-phase': initial.phase },
  }, [crumb, body, live]);

  // Space toggles Talk/Stop, unless it is already acting on a focused control.
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== ' ' && ev.code !== 'Space') return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (state.phase === 'listening') {
      ev.preventDefault();
      cb.onControl('stop');
    } else if (state.phase === 'ready' || state.phase === 'hinting' || state.phase === 'paused') {
      ev.preventDefault();
      cb.onControl('listen');
    }
  });

  function retry(): void {
    if (!cb.onRetry) {
      cb.onControl('listen');
      return;
    }
    if (state.source === 'due') cb.onRetry({ kind: 'due' });
    else if (state.passageId !== null) cb.onRetry({ kind: 'passage', passageId: state.passageId });
    else cb.onExit();
  }

  let lastAnnounced = '';
  function draw(): void {
    root.setAttribute('data-phase', state.phase);
    replace(crumb, [
      breadcrumb({ crumbs: [{ label: tr('memory.ui.settings.home', 'Home'), onClick: () => cb.onExit() }, { label: tr('memory.ui.settings.reciteAloud', 'Recite aloud') }] }),
    ]);

    const talk = talkButton(state.phase, cb);
    const heardText = state.heard.join(' ');
    const showVerses = state.verses !== null && state.result === null;

    replace(body, [
      el('h2', { class: 'sm-recite-ref', text: state.reference }),
      state.source === 'due' && state.passageId !== null
        ? el('p', { class: 'sm-hint', text: progressText(state) })
        : null,
      state.error ? errorBanner(state.error.message) : null,
      state.phase === 'error' && !state.error ? errorBanner(tr('memory.ui.settings.wentWrongPeriod', 'Something went wrong.')) : null,
      showVerses
        ? el('p', { class: 'sm-recite-hint-text' }, [state.verses!.flatMap((v) => v.words).join(' ')])
        : null,
      talk
        ? el('div', { class: 'sm-recite-talk-row' }, [
            talk,
            state.phase === 'listening'
              ? el('span', { class: 'sm-recite-listening', text: tr('memory.ui.settings.listeningEllipsis', 'Listening…') })
              : null,
          ])
        : null,
      !state.result && (state.phase === 'listening' || state.phase === 'hinting' || heardText)
        ? el('p', { class: 'sm-recite-heard', attrs: { 'aria-label': tr('memory.ui.settings.wordsHeard', 'Words heard so far') } }, [
            heardText || (state.phase === 'listening' ? tr('memory.ui.settings.listeningEllipsis', 'Listening…') : ''),
          ])
        : null,
      state.phase === 'listening' || state.phase === 'ready'
        ? el('div', { class: 'sm-exercise-actions' }, [
            button(tr('memory.ui.settings.hint', 'Hint'), () => cb.onControl('hint'), { class: 'sm-btn sm-btn-small sm-btn-quiet' }),
          ])
        : null,
      state.result ? renderResult(state, state.result, cb) : null,
      state.phase === 'error'
        ? el('div', { class: 'sm-exercise-actions' }, [
            button(tr('memory.ui.settings.tryAgain', 'Try again'), () => retry(), { class: 'sm-btn' }),
            button(tr('memory.ui.settings.back', 'Back'), () => cb.onExit(), { class: 'sm-btn sm-btn-quiet' }),
          ])
        : null,
      state.phase === 'summary' || state.phase === 'done'
        ? el('div', { class: 'sm-exercise-actions' }, [
            button(tr('memory.ui.settings.done', 'Done'), () => cb.onExit(), { class: 'sm-btn sm-btn-primary' }),
          ])
        : null,
    ]);

    const say = phaseAnnouncement(state);
    if (say !== lastAnnounced) {
      live.textContent = say;
      lastAnnounced = say;
    }

    // Keep the keyboard on the main control so Space keeps working.
    const focusTarget = body.querySelector<HTMLElement>('.sm-recite-talk:not([disabled])');
    if (focusTarget) queueMicrotask(() => { if (root.isConnected && !root.contains(document.activeElement)) focusQuietly(focusTarget); });
  }

  draw();
  return {
    element: root,
    update(next) {
      state = next;
      draw();
    },
  };
}

/** Plain-function form for views that re-render wholesale. */
export function renderRecite(state: ReciteStateView, cb: ReciteCallbacks): HTMLElement {
  return createReciteView(state, cb).element;
}
