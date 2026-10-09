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
  tabs,
  tierPips,
} from './components';
import { RUNG_BLURB, RUNG_LABEL, countLabel, formatDue, formatScore, inLadderOrder, isDue, suggestedRungFor } from './format';
import type { PanelHost } from './host';
import { startReciteRun } from './activities';
import { availabilityBanner, availabilityMessage, permissionSettingsButton } from './settingsView';

/** Tab/row label: recite is marked optional so nobody thinks it is required. */
export function rungTabLabel(rv: RungView): string {
  return rv.optional === true || rv.rung === 'recite' ? `${RUNG_LABEL[rv.rung]} (optional)` : RUNG_LABEL[rv.rung];
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
   * Which activity tab is showing: `state.ts#View`'s `rung`; `null` means the
   * suggested one (`suggestedRungFor`). Defaults to `null` for callers with no
   * view state.
   */
  viewRung: Rung | null = null,
  /** Speech availability (`SettingsView.speech`); omitted means unknown, which disables Recite. */
  speech: SpeechAvailability | null = null,
): HTMLElement {
  const now = host.now();
  const root = el('section', { class: 'sm-screen sm-screen-passage' });

  const settingsToggle = button('⚙', () => openSettingsModal(host, pv, defaultAnswerMode), {
    class: 'sm-btn sm-btn-quiet sm-btn-small sm-icon-btn',
    attrs: { 'aria-label': 'Passage settings', title: 'Passage settings' },
  });

  root.appendChild(
    breadcrumb({
      crumbs: [{ label: 'Home', onClick: () => host.go({ type: 'goPlan' }) }, { label: pv.passage.reference }],
      actions: [
        button('Show in Bible', () => host.openInBible(pv.passage.startVerseId), {
          class: 'sm-btn sm-btn-quiet sm-btn-small',
        }),
        settingsToggle,
      ],
    }),
  );

  root.appendChild(
    el('p', { class: 'sm-subhead' }, [
      el('span', { text: countLabel(pv.passage.verseCount, 'verse') }),
      pv.wellLearned
        ? el('span', { class: 'sm-badge sm-badge-learned', text: 'Well learned' })
        : null,
    ]),
  );

  const suggested = suggestedRungFor(pv.rungs, now);

  const practiceLink = renderPracticeLink(host, pv, suggested);
  if (practiceLink) root.appendChild(practiceLink);

  const applicable = inLadderOrder(pv.rungs).filter((rv) => rv.applicable);
  if (applicable.length > 0) {
    // An explicit tab wins; otherwise the suggested one. A stale `viewRung`
    // naming a rung that is no longer applicable falls back to the first tab.
    const active = applicable.find((rv) => rv.rung === (viewRung ?? suggested)) ?? applicable[0]!;

    root.appendChild(
      tabs({
        items: applicable.map((rv) => ({ value: rv.rung, label: rungTabLabel(rv) })),
        selected: active.rung,
        onSelect: (rung) => host.go({ type: 'goPassage', passageId: pv.passage.id, rung }),
        ariaLabel: 'Activity',
      }),
    );

    root.appendChild(el('div', { class: 'sm-activities' }, [renderActivityDetail(host, pv, active, suggested === active.rung, now, speech)]));
  }

  for (const rv of inLadderOrder(pv.rungs).filter((r) => !r.applicable)) {
    if (rv.rung === 'recite') {
      // Optional and hidden when unavailable; say why only when speech itself is the reason.
      const why = speech ? availabilityMessage(speech) : null;
      if (why) {
        root.appendChild(
          el('p', { class: 'sm-activity-blurb' }, [el('strong', { text: rungTabLabel(rv) }), `: ${why}`]),
        );
        const action = speech ? permissionSettingsButton(host, speech) : null;
        if (action) root.appendChild(action);
      }
      continue;
    }
    root.appendChild(
      el('p', { class: 'sm-activity-blurb' }, [
        el('strong', { text: RUNG_LABEL[rv.rung] }),
        `: ${inapplicabilityNote(rv.rung)}`,
      ]),
    );
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

  return button('Practice Passage', () => void host.startSession(pv.passage.id, suggested), {
    class: 'sm-btn sm-btn-quiet sm-passage-practice-link',
  });
}

// ---------------------------------------------------------------------------
// The selected activity's panel
// ---------------------------------------------------------------------------

/**
 * What the progress cell reads: nothing for an untried activity (the empty
 * level boxes already say so), `stepsDone/totalSteps` when paused, otherwise
 * the due date plus the last score when one exists.
 */
function progressText(rv: RungView, now: number): string {
  if (rv.resume) return `${rv.resume.stepsDone}/${rv.resume.totalSteps}`;
  if (rv.attempts === 0) return '';
  const parts = [formatDue(rv.dueAt, now)];
  if (rv.lastScore !== null) parts.push(`Last score ${formatScore(rv.lastScore)}`);
  return parts.join(' · ');
}

/**
 * The selected tab's activity: name, suggested badge, tier pips, level boxes,
 * progress text / schedule, and the Practice (or Restart + Resume) actions.
 * Only applicable activities get a tab; inapplicable ones are explained in
 * one line each below the panel.
 */
function renderActivityDetail(
  host: PanelHost,
  pv: PassageView,
  rv: RungView,
  isSuggested: boolean,
  now: number,
  speech: SpeechAvailability | null = null,
): HTMLElement {
  if (rv.rung === 'recite') return renderReciteDetail(host, pv, rv, now, speech);
  const due = isDue(rv, now);
  const classes = ['sm-activity-card'];
  if (due) classes.push('sm-activity-due');

  const header = el('div', { class: 'sm-activity-card-head' }, [
    isSuggested ? suggestedBadge() : null,
    tierPips(rv.tiersPassed, rv.tiers),
  ]);

  const level = el('div', { class: 'sm-activity-level-row' }, [
    levelBoxes(rv.level, { due }),
    rv.level === 0 ? null : el('span', { class: 'sm-activity-level-text', text: `${rv.level}/5` }),
  ]);

  const progress = progressText(rv, now);
  const actions = rv.resume
    ? el('div', { class: 'sm-activity-actions' }, [
        button('Restart', () => void host.startSession(pv.passage.id, rv.rung, true), {
          class: 'sm-btn sm-btn-small sm-btn-quiet',
        }),
        button('Resume', () => void host.startSession(pv.passage.id, rv.rung), {
          class: 'sm-btn sm-btn-small sm-btn-primary',
        }),
      ])
    : el('div', { class: 'sm-activity-actions' }, [
        button('Practice', () => void host.startSession(pv.passage.id, rv.rung), {
          class: 'sm-btn sm-btn-small sm-btn-primary',
        }),
      ]);

  return el('div', { class: classes.join(' ') }, [
    header,
    level,
    el('p', { class: 'sm-activity-row-progress', text: progress }),
    actions,
  ]);
}

/**
 * The recite tab: same header/level/progress as any activity, but the action
 * is a Recite button (tap mode; needs speech `ready`, else disabled with the
 * reason) and a toggle to include the passage in "Recite what's due".
 */
function renderReciteDetail(
  host: PanelHost,
  pv: PassageView,
  rv: RungView,
  now: number,
  speech: SpeechAvailability | null,
): HTMLElement {
  const ready = speech !== null && speech.state === 'ready';
  const why = ready ? null : speech ? availabilityMessage(speech) : 'Checking whether speech is available.';

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

  const progress = progressText(rv, now);
  const card = el('div', { class: 'sm-activity-card sm-activity-recite' }, [
    el('div', { class: 'sm-activity-level-row' }, [
      levelBoxes(rv.level, { due: isDue(rv, now) }),
      rv.level === 0 ? null : el('span', { class: 'sm-activity-level-text', text: `${rv.level}/5` }),
    ]),
    el('p', { class: 'sm-activity-blurb', text: RUNG_BLURB.recite }),
    el('p', { class: 'sm-activity-row-progress', text: progress }),
    el('div', { class: 'sm-activity-actions' }, [
      button('Recite', () => void startReciteRun(host, { kind: 'passage', passageId: pv.passage.id }, 'tap'), {
        class: 'sm-btn sm-btn-small sm-btn-primary',
        disabled: !ready,
      }),
    ]),
  ]);

  // Per-passage on purpose: reciting is optional and you may want it for some
  // passages and not others. Passages you have already recited join "Recite
  // what's due" on their own when due; this switch adds one you have not.
  const include = el('div', { class: 'sm-recite-include' }, [
    el('div', { class: 'sm-setting-row' }, [
      checkbox,
      el('label', { text: 'Add this passage to "Recite what\'s due"', attrs: { for: 'sm-recite-on' } }),
    ]),
    el('p', {
      class: 'sm-hint',
      id: 'sm-recite-on-hint',
      text: 'Reciting is optional and never holds back this passage. Once you have recited it, it comes up when due without this.',
    }),
  ]);

  const notice =
    why === null
      ? null
      : speech
        ? availabilityBanner(speech, host)
        : el('p', { class: 'sm-banner sm-banner-warn', text: why, attrs: { role: 'status' } });
  return el('div', { class: 'sm-activity-recite-wrap' }, [notice, card, include]);
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
    title: 'Passage settings',
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
    attrs: { 'aria-label': 'Answer with' },
  }) as HTMLSelectElement;

  const defaultLabel = defaultAnswerMode === 'fullWord' ? 'full word' : 'first letter';
  const options: { value: '' | AnswerMode; label: string }[] = [
    { value: '', label: `Default (${defaultLabel})` },
    { value: 'firstLetter', label: 'First letter' },
    { value: 'fullWord', label: 'Full word, exact spelling' },
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
    el('label', { class: 'sm-label-inline', text: 'Answer with', attrs: { for: 'sm-answer-mode' } }),
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
      button('Reset progress for this passage', showConfirm, {
        class: 'sm-btn sm-btn-small sm-btn-danger-quiet',
        attrs: { 'aria-label': `Reset all progress for ${pv.passage.reference}` },
      }),
    ]);
  };

  function showConfirm(): void {
    replace(slot, [
      el('span', { class: 'sm-remove-confirm', attrs: { role: 'alert' } }, [
        el('span', { class: 'sm-hint', text: 'Reset all progress on this passage? This cannot be undone.' }),
        button('Yes, reset', doReset, { class: 'sm-btn sm-btn-small sm-btn-danger' }),
        button('Cancel', showIdle, { class: 'sm-btn sm-btn-small sm-btn-quiet' }),
      ]),
    ]);
  }

  function doReset(): void {
    void host.request({ type: 'resetPassageProgress', passageId: pv.passage.id }).then((reply) => {
      if (!reply.ok) {
        replace(slot, [errorBanner(reply.error)]);
        return;
      }
      host.announce(`Reset progress for ${pv.passage.reference}.`);
      closeModal();
      host.reload();
    });
  }

  showIdle();
  return slot;
}
