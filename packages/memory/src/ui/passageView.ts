/**
 * One passage: its activities, laid out as an aligned table, each always
 * practisable.
 *
 * Task 0004 dropped every lock: there is no "not yet unlocked" and no
 * "replay - this will not count" qualifier left to draw, because every
 * attempt on every activity is a live one. What replaced the ladder's gating
 * is a single "Suggested" badge (`suggestedRungFor`) plus, on this screen, a
 * "Practice Passage" link that always starts it.
 *
 * T12 rebuilt this screen around a real grid (see `ui/styles.css`'s
 * "Passage overview" section) so every row's name, tier pips, level boxes,
 * schedule/progress note and play target line up across rows - the previous
 * flex-row cards did not guarantee that, since each row's own content
 * decided how wide its pieces were. Each row is a single `<button>`
 * spanning the grid (never a `<button>` nested inside a `<button>`), with
 * the play glyph as a decorative, `aria-hidden` `<span>` inside it: the
 * whole row is the click target, not just the glyph.
 *
 * Resume/Restart choices no longer live here - clicking a row always calls
 * `host.startSession` without `restart`, which resumes a paused activity on
 * its own; the activity/practice screen is where a deliberate restart lives
 * now. Removal moved to Manage Passages (T11) and is not offered here at
 * all. The per-passage answer-mode override and "Reset progress for this
 * passage" (T4's `resetPassageProgress`) live together behind the gear icon,
 * in one `components.ts#modal` rather than an inline reveal.
 */

import type { AnswerMode, PassageView, Rung, RungView, SpeechAvailability } from '../core/types';
import { button, el, replace } from './dom';
import {
  breadcrumb,
  errorBanner,
  inapplicabilityNote,
  levelBoxes,
  modal,
  suggestedBadge,
} from './components';
import { RUNG_BLURB, RUNG_LABEL, formatDue, formatLastPractised, formatScore, inLadderOrder, isDue, suggestedRungFor } from './format';
import type { PanelHost } from './host';
import { reciteEnabled } from '../core/features';
import { startReciteRun } from './activities';
import { availabilityBanner, availabilityMessage } from './settingsView';
import { tr } from './i18n';

/** Tab/row label: recite is marked optional so nobody thinks it is required. */
export function rungTabLabel(rv: RungView): string {
  return rv.optional === true || rv.rung === 'recite' ? tr('memory.ui.plan.rungOptional', '{rung} (optional)', { rung: RUNG_LABEL[rv.rung] }) : RUNG_LABEL[rv.rung];
}

/**
 * Named `renderPassageScreen` rather than `renderPassage`, deliberately: that
 * name is `scripture.ts#renderPassage`, which renders a run of verses as DOM
 * and is used throughout this file's sibling `practiceView.ts`. The two are
 * easy to reach for interchangeably by name alone, and only one of them
 * knows what a `PassageView` is.
 */
export function renderPassageScreen(
  host: PanelHost,
  pv: PassageView,
  defaultAnswerMode: AnswerMode,
  /**
   * Kept for the view state's sake (`state.ts#View`'s `rung`); the screen no
   * longer has activity tabs, so it is unused.
   */
  _viewRung: Rung | null = null,
  /** Speech availability (`SettingsView.speech`); omitted means unknown, which disables Recite. */
  speech: SpeechAvailability | null = null,
): HTMLElement {
  const now = host.now();
  const root = el('section', { class: 'sm-screen sm-screen-passage' });

  const settingsToggle = button('⚙', () => openSettingsModal(host, pv, defaultAnswerMode), {
    class: 'sm-btn sm-btn-quiet sm-btn-small sm-icon-btn',
    attrs: { 'aria-label': tr('memory.ui.plan.passageSettings', 'Passage settings'), title: tr('memory.ui.plan.passageSettings', 'Passage settings') },
  });

  root.appendChild(
    breadcrumb({
      crumbs: [{ label: tr('memory.ui.plan.home', 'Home'), onClick: () => host.go({ type: 'goPlan' }) }, { label: pv.passage.reference }],
      actions: [
        button(tr('memory.ui.plan.showInBible', 'Show in Bible'), () => host.openInBible(pv.passage.startVerseId), {
          class: 'sm-btn sm-btn-quiet sm-btn-small',
        }),
        settingsToggle,
      ],
    }),
  );

  root.appendChild(
    el('p', { class: 'sm-subhead' }, [
      el('span', { text: tr('memory.ui.plan.verseCount', '{count, plural, one {# verse} other {# verses}}', { count: pv.passage.verseCount }) }),
      pv.wellLearned
        ? el('span', { class: 'sm-badge sm-badge-learned', text: tr('memory.ui.plan.wellLearned', 'Well learned') })
        : null,
    ]),
  );

  const suggested = suggestedRungFor(pv.rungs, now);

  const practiceLink = renderPracticeLink(host, pv, suggested);
  if (practiceLink) root.appendChild(practiceLink);

  // One table for the whole passage: a row per practice type, so progress is
  // readable at a glance and every row starts that practice. (This replaced a
  // strip of one tab per activity, which hid all but one activity's progress.)
  const rungs = inLadderOrder(pv.rungs).filter((rv) => rv.rung !== 'recite' || reciteEnabled());
  if (rungs.length > 0) {
    root.appendChild(renderProgressTable(host, pv, rungs, suggested, now, speech));
    const recite = rungs.find((rv) => rv.rung === 'recite');
    if (recite) root.appendChild(renderReciteExtras(host, pv, speech));
  }

  return root;
}

// ---------------------------------------------------------------------------
// The primary action
// ---------------------------------------------------------------------------

/**
 * A plain text link, "Practice Passage", that always starts the activity
 * `suggestedRungFor` points at - the same rule the "Suggested" badge below
 * uses, so the link and the badge never disagree about what happens next.
 *
 * A second review round pushed back on the per-activity rows alone: "we
 * never want the user to not practice for lack of decisiveness on *what* to
 * practice." Deliberately chrome-free (a real `<button>` styled as a link,
 * not a bordered callout) to match the home screen's own "Practice" control
 * (`planView.ts`) at the scale of one passage - this screen's action is a
 * secondary path next to the table, not competing with it for weight.
 */
function renderPracticeLink(host: PanelHost, pv: PassageView, suggested: Rung | null): HTMLElement | null {
  if (suggested === null) return null; // No applicable activity at all - unreachable in practice.

  return button(tr('memory.ui.plan.practicePassage', 'Practice Passage'), () => void host.startSession(pv.passage.id, suggested), {
    class: 'sm-btn sm-btn-quiet sm-passage-practice-link',
  });
}

// ---------------------------------------------------------------------------
// The progress table
// ---------------------------------------------------------------------------

/**
 * What the progress cell says beside the level boxes: where a paused activity
 * stands, otherwise the last score.
 */
function progressText(rv: RungView): string {
  if (rv.resume) return tr('memory.ui.plan.pausedAt', 'Paused at {done}/{total}', { done: rv.resume.stepsDone, total: rv.resume.totalSteps });
  if (rv.attempts === 0 || rv.lastScore === null) return '';
  return tr('memory.ui.plan.lastScore', 'Last score {score}', { score: formatScore(rv.lastScore) });
}

/**
 * The passage's progress table: rows are the practice types, columns are
 * Progress (level boxes plus a short note), Last practised and Next due, and
 * each row ends in the button that starts that practice. Activities that do
 * not apply stay in the table, muted, with the reason in place of the buttons.
 */
function renderProgressTable(
  host: PanelHost,
  pv: PassageView,
  rungs: RungView[],
  suggested: Rung | null,
  now: number,
  speech: SpeechAvailability | null,
): HTMLElement {
  const head = el('tr', {}, [
    th(tr('memory.ui.plan.colPractice', 'Practice')),
    th(tr('memory.ui.plan.colProgress', 'Progress')),
    th(tr('memory.ui.plan.colLastPractised', 'Last practised')),
    th(tr('memory.ui.plan.colNextDue', 'Next due')),
    el('th', { class: 'kth-table__head', attrs: { scope: 'col' } }, [
      el('span', { class: 'kth-visually-hidden', text: tr('memory.ui.plan.colAction', 'Start') }),
    ]),
  ]);

  const body = rungs.map((rv) => renderProgressRow(host, pv, rv, rv.rung === suggested, now, speech));

  return el('div', { class: 'sm-progress-wrap' }, [
    el('table', { class: 'kth-table sm-progress-table' }, [
      el('caption', {
        class: 'kth-visually-hidden',
        text: tr('memory.ui.plan.progressCaption', 'Practice progress for {reference}', { reference: pv.passage.reference }),
      }),
      el('thead', {}, [head]),
      el('tbody', {}, body),
    ]),
  ]);
}

function mutedAttr(muted: boolean): Record<string, string> {
  return muted ? { 'data-muted': '' } : {};
}

function th(text: string): HTMLElement {
  return el('th', { class: 'kth-table__head', text, attrs: { scope: 'col' } });
}

function renderProgressRow(
  host: PanelHost,
  pv: PassageView,
  rv: RungView,
  isSuggested: boolean,
  now: number,
  speech: SpeechAvailability | null,
): HTMLElement {
  const due = isDue(rv, now);
  const muted = !rv.applicable && rv.rung !== 'recite';
  const label = rv.rung === 'recite' ? rungTabLabel(rv) : RUNG_LABEL[rv.rung];

  const name = el('td', { class: 'kth-table__cell sm-progress-name', attrs: mutedAttr(muted) }, [
    el('div', { class: 'sm-progress-title' }, [el('strong', { text: label }), isSuggested ? suggestedBadge() : null]),
    el('div', { class: 'sm-progress-blurb', text: RUNG_BLURB[rv.rung] }),
  ]);

  if (muted) {
    return el('tr', { class: 'sm-progress-row sm-progress-row-na' }, [
      name,
      el('td', { class: 'kth-table__cell', attrs: { colspan: '3', 'data-muted': '' }, text: inapplicabilityNote(rv.rung) }),
      el('td', { class: 'kth-table__cell' }),
    ]);
  }

  const note = progressText(rv);
  const progress = el('td', { class: 'kth-table__cell' }, [
    el('div', { class: 'sm-activity-level-row' }, [
      levelBoxes(rv.level, { due }),
      rv.level === 0 ? null : el('span', { class: 'sm-activity-level-text', text: `${rv.level}/5` }),
    ]),
    note === '' ? null : el('div', { class: 'sm-progress-note', text: note }),
  ]);

  const reciteReady = rv.rung !== 'recite' || (speech !== null && speech.state === 'ready');
  const startLabel = tr('memory.ui.plan.practice', 'Practice');
  const aria = (verb: string): Record<string, string> => ({ 'aria-label': `${verb}: ${label}` });

  let actions: HTMLElement;
  if (rv.rung === 'recite') {
    actions = el('div', { class: 'sm-activity-actions' }, [
      button(tr('memory.ui.plan.recite', 'Recite'), () => void startReciteRun(host, { kind: 'passage', passageId: pv.passage.id }, 'tap'), {
        class: 'sm-btn sm-btn-small',
        disabled: !reciteReady,
        attrs: aria(tr('memory.ui.plan.recite', 'Recite')),
      }),
    ]);
  } else if (rv.resume) {
    actions = el('div', { class: 'sm-activity-actions' }, [
      button(tr('memory.ui.plan.restart', 'Restart'), () => void host.startSession(pv.passage.id, rv.rung, true), {
        class: 'sm-btn sm-btn-small sm-btn-quiet',
        attrs: aria(tr('memory.ui.plan.restart', 'Restart')),
      }),
      button(tr('memory.ui.plan.resume', 'Resume'), () => void host.startSession(pv.passage.id, rv.rung), {
        class: 'sm-btn sm-btn-small sm-btn-primary',
        attrs: aria(tr('memory.ui.plan.resume', 'Resume')),
      }),
    ]);
  } else {
    actions = el('div', { class: 'sm-activity-actions' }, [
      button(startLabel, () => void host.startSession(pv.passage.id, rv.rung), {
        class: `sm-btn sm-btn-small${isSuggested || due ? ' sm-btn-primary' : ''}`,
        attrs: aria(startLabel),
      }),
    ]);
  }

  return el('tr', { class: `sm-progress-row${due ? ' sm-activity-due' : ''}` }, [
    name,
    progress,
    el('td', { class: 'kth-table__cell', attrs: mutedAttr(rv.attempts === 0), text: (rv.resume && rv.lastPractisedAt == null ? tr('memory.ui.plan.inProgress', 'In progress') : formatLastPractised(rv.lastPractisedAt, now)) }),
    el('td', { class: 'kth-table__cell', attrs: mutedAttr(rv.dueAt === null), text: formatDue(rv.dueAt, now) }),
    el('td', { class: 'kth-table__cell sm-progress-action' }, [actions]),
  ]);
}

/**
 * Under the table: why Recite is unavailable (when speech is the reason) and
 * the per-passage switch to include it in "Recite what's due". Per-passage on
 * purpose: reciting is optional and you may want it for some passages only.
 */
function renderReciteExtras(host: PanelHost, pv: PassageView, speech: SpeechAvailability | null): HTMLElement {
  const ready = speech !== null && speech.state === 'ready';
  const why = ready ? null : speech ? availabilityMessage(speech) : tr('memory.ui.plan.checkingSpeech', 'Checking whether speech is available.');

  const checkbox = el('input', {
    id: 'sm-recite-on',
    attrs: { type: 'checkbox', 'aria-describedby': 'sm-recite-on-hint' },
  }) as HTMLInputElement;
  checkbox.checked = pv.passage.reciteOn;
  checkbox.addEventListener('change', () => {
    checkbox.disabled = true;
    void host.request({ type: 'setPassageRecite', passageId: pv.passage.id, on: checkbox.checked }).then((reply) => {
      checkbox.disabled = false;
      if (!reply.ok) {
        checkbox.checked = !checkbox.checked;
        host.announce(reply.error);
        return;
      }
      host.reload();
    });
  });

  const include = el('div', { class: 'sm-recite-include' }, [
    el('div', { class: 'sm-setting-row' }, [
      checkbox,
      el('label', { text: tr('memory.ui.plan.addToReciteDue', 'Add this passage to "Recite what\'s due"'), attrs: { for: 'sm-recite-on' } }),
    ]),
    el('p', {
      class: 'sm-hint',
      id: 'sm-recite-on-hint',
      text: tr('memory.ui.plan.recitingOptionalHint', 'Reciting is optional and never holds back this passage. Once you have recited it, it comes up when due without this.'),
    }),
  ]);

  const notice =
    why === null
      ? null
      : speech
        ? availabilityBanner(speech, host)
        : el('p', { class: 'sm-banner sm-banner-warn', text: why, attrs: { role: 'status' } });
  return el('div', { class: 'sm-activity-recite-wrap' }, [notice, include]);
}

// ---------------------------------------------------------------------------
// Settings modal: answer-mode override, reset progress
// ---------------------------------------------------------------------------

/**
 * The gear icon's target: a `components.ts#modal` holding the per-passage
 * answer-mode override and "Reset progress for this passage" together.
 *
 * Both actions end in `host.reload()`, which re-fetches and re-renders the
 * whole screen (`panel.ts` re-runs `getPassageView`) - so both close the
 * modal *first*. The modal's backdrop is appended to `document.body`, not to
 * this screen's own root, and a reload only replaces the panel's main
 * content; an open modal left unclosed would survive that swap as an orphan.
 */
function openSettingsModal(host: PanelHost, pv: PassageView, defaultAnswerMode: AnswerMode): void {
  const closeModal = (): void => handle.close();

  const answerRow = renderAnswerModeControl(host, pv, defaultAnswerMode, closeModal);
  const resetProgress = renderResetProgress(host, pv, closeModal);

  const handle = modal({
    title: tr('memory.ui.plan.passageSettings', 'Passage settings'),
    body: [answerRow, resetProgress],
    onClose: () => handle.element.remove(),
  });
  (host.overlayRoot ?? document.body).appendChild(handle.element);
  handle.open();
}

/**
 * "Answer with: Default (first letter) [v]" - the per-passage override of the
 * global answer-mode setting (task 0004 review, point 11), now always visible
 * inside the settings modal rather than behind its own inline reveal.
 */
function renderAnswerModeControl(
  host: PanelHost,
  pv: PassageView,
  defaultAnswerMode: AnswerMode,
  closeModal: () => void,
): HTMLElement {
  const select = el('select', {
    class: 'sm-select',
    id: 'sm-answer-mode',
    attrs: { 'aria-label': tr('memory.ui.plan.answerWith', 'Answer with') },
  }) as HTMLSelectElement;

  const defaultLabel = defaultAnswerMode === 'fullWord' ? tr('memory.ui.plan.fullWordLower', 'full word') : tr('memory.ui.plan.firstLetterLower', 'first letter');
  const options: { value: '' | AnswerMode; label: string }[] = [
    { value: '', label: tr('memory.ui.plan.defaultAnswerMode', 'Default ({mode})', { mode: defaultLabel }) },
    { value: 'firstLetter', label: tr('memory.ui.plan.firstLetter', 'First letter') },
    { value: 'fullWord', label: tr('memory.ui.plan.fullWordExact', 'Full word, exact spelling') },
  ];

  for (const opt of options) {
    const optionEl = el('option', { value: opt.value, text: opt.label });
    if ((pv.passage.answerMode ?? '') === opt.value) optionEl.selected = true;
    select.appendChild(optionEl);
  }

  const errorSlot = el('div', { class: 'sm-answer-row-error' });

  select.addEventListener('change', () => {
    const mode = select.value === '' ? null : (select.value as AnswerMode);
    select.disabled = true;
    void host
      .request({ type: 'setPassageAnswerMode', passageId: pv.passage.id, mode })
      .then((reply) => {
        select.disabled = false;
        if (!reply.ok) {
          replace(errorSlot, [errorBanner(reply.error)]);
          return;
        }
        closeModal();
        host.reload();
      });
  });

  return el('div', { class: 'sm-answer-row' }, [
    el('label', { class: 'sm-label-inline', text: tr('memory.ui.plan.answerWith', 'Answer with'), attrs: { for: 'sm-answer-mode' } }),
    select,
    errorSlot,
  ]);
}

/**
 * "Reset progress for this passage" - the only way any displayed level goes
 * down (D1(a)), behind a confirmation step for the same reason the old
 * remove control had one: this throws away real history, and a `confirm()`
 * dialog can be silently suppressed in a sandboxed iframe (see
 * `components.ts#modal`'s own header). Dispatches T4's `resetPassageProgress`
 * request.
 */
function renderResetProgress(host: PanelHost, pv: PassageView, closeModal: () => void): HTMLElement {
  const slot = el('div', { class: 'sm-reset-progress' });

  const showIdle = (): void => {
    replace(slot, [
      button(tr('memory.ui.plan.resetProgress', 'Reset progress for this passage'), showConfirm, {
        class: 'sm-btn sm-btn-small sm-btn-danger-quiet',
        attrs: { 'aria-label': tr('memory.ui.plan.resetAllProgressFor', 'Reset all progress for {reference}', { reference: pv.passage.reference }) },
      }),
    ]);
  };

  function showConfirm(): void {
    replace(slot, [
      el('span', { class: 'sm-remove-confirm', attrs: { role: 'alert' } }, [
        el('span', { class: 'sm-hint', text: tr('memory.ui.plan.resetConfirm', 'Reset all progress on this passage? This cannot be undone.') }),
        button(tr('memory.ui.plan.yesReset', 'Yes, reset'), doReset, { class: 'sm-btn sm-btn-small sm-btn-danger' }),
        button(tr('memory.ui.plan.cancel', 'Cancel'), showIdle, { class: 'sm-btn sm-btn-small sm-btn-quiet' }),
      ]),
    ]);
  }

  function doReset(): void {
    void host.request({ type: 'resetPassageProgress', passageId: pv.passage.id }).then((reply) => {
      if (!reply.ok) {
        replace(slot, [errorBanner(reply.error)]);
        return;
      }
      host.announce(tr('memory.ui.plan.resetDone', 'Reset progress for {reference}.', { reference: pv.passage.reference }));
      closeModal();
      host.reload();
    });
  }

  showIdle();
  return slot;
}
