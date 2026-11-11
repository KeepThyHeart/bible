/**
 * The verse page (A7): one verse on a focused screen.
 *
 * Shows the verse text (when the host supplies it), its status and next review,
 * a primary "Practice now" button (flow `verse`) and a collapsed "Activities"
 * list with one simple bar per applicable activity. The "..." menu holds the
 * per-verse answer mode and "Reset progress" (same behaviour as the old
 * passage screen) plus the shared verse actions (`verseActions.ts`).
 */

import type { AnswerMode, ListSummary, PassageView, RungView, SpeechAvailability, VerseText } from '../core/types';
import { reciteEnabled } from '../core/features';
import { verseStatus } from '../core/today';
import { startReciteRun } from './activities';
import { errorBanner, menu, translationTag } from './components';
import type { MenuItem } from './components';
import { button, el, replace } from './dom';
import { RUNG_BLURB, RUNG_LABEL, inLadderOrder } from './format';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { renderPassage, plainWord } from './scripture';
import { availabilityBanner, availabilityMessage } from './settingsView';
import { focusedHeader } from './shell';
import { nextReviewText, statusChip, statusLabel } from './verseStatusUi';
import { showModal, verseMenuItems } from './verseActions';
import './styles/verse.css';

export interface VersePageExtras {
  /** The global answer mode, shown as "Default (...)" in the answer-mode picker. Default first letter. */
  defaultAnswerMode?: AnswerMode;
  /** Speech availability (`PlanView.speech`); omitted means unknown, which disables Recite aloud. */
  speech?: SpeechAvailability | null;
  /** The verse text; omitted or null shows no text block. */
  verses?: VerseText[] | null;
}

export function renderVersePage(
  host: PanelHost,
  pv: PassageView,
  lists: ListSummary[],
  extras: VersePageExtras = {},
): HTMLElement {
  const now = host.now();
  const info = verseStatus(pv, now);
  const ref = pv.passage.reference;
  const speech = extras.speech ?? null;
  const defaultAnswerMode = extras.defaultAnswerMode ?? 'firstLetter';

  const items = verseMenuItems(host, pv, lists, {
    before: [
      {
        label: tr('memory.ui.verse.answerMode', 'Answer with...'),
        onClick: () => openAnswerModeModal(host, pv, defaultAnswerMode),
      },
      { label: tr('memory.ui.verse.resetProgress', 'Reset progress'), onClick: () => openResetModal(host, pv) },
    ] satisfies MenuItem[],
    // removeVerse already dispatched `passageRemoved`, which leaves this page
    // for wherever it was opened from (state.ts); nothing more to do here.
    onRemoved: () => {},
  });

  const root = el('section', { class: 'sm-screen sm-verse-page' });
  root.appendChild(
    focusedHeader({
      title: ref,
      meta: translationTag(pv.passage.moduleId),
      onClose: () => host.go({ type: 'leaveVerse' }),
      menu: menu({ label: tr('memory.ui.verses.rowMenu', 'Actions for {reference}', { reference: ref }), items }),
    }),
  );

  if (extras.verses && extras.verses.length > 0) {
    root.appendChild(
      el('div', { class: 'sm-verse-text' }, renderPassage(extras.verses, () => ({ renderWord: plainWord }))),
    );
  }

  root.appendChild(
    el('div', { class: 'sm-verse-page-state' }, [
      statusChip(info.status),
      el('span', { class: 'sm-verse-page-next', text: nextReviewText(info, now) }),
    ]),
  );

  root.appendChild(
    button(tr('memory.ui.verses.practiceNow', 'Practice now'), () => void host.startSession(pv.passage.id), {
      class: 'sm-btn sm-btn-primary sm-verse-page-practice',
    }),
  );

  root.appendChild(renderActivities(host, pv, now, speech));
  return root;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

function renderActivities(
  host: PanelHost,
  pv: PassageView,
  now: number,
  speech: SpeechAvailability | null,
): HTMLElement {
  // A device that cannot recite at all (old host, unsupported) shows nothing, not a disabled row.
  const showRecite = reciteEnabled() && !(speech !== null && speech.state === 'host-too-old');
  const rungs = inLadderOrder(pv.rungs).filter((rv) => (rv.rung === 'recite' ? showRecite : rv.applicable));

  const body = el('ul', { class: 'sm-activity-list' }, rungs.map((rv) => renderActivityRow(host, pv, rv, now, speech)));
  const details = el('details', { class: 'sm-verse-activities' }, [
    el('summary', { text: tr('memory.ui.verse.activities', 'Activities') }),
    body,
    rungs.some((rv) => rv.rung === 'recite') ? renderReciteExtras(host, pv, speech) : null,
  ]);
  return details;
}

function renderActivityRow(
  host: PanelHost,
  pv: PassageView,
  rv: RungView,
  now: number,
  speech: SpeechAvailability | null,
): HTMLElement {
  const label = rv.rung === 'recite' ? RUNG_LABEL.recite : RUNG_LABEL[rv.rung];
  const next = nextReviewText({ status: rv.attempts === 0 ? 'new' : 'learning', nextReviewAt: rv.dueAt }, now);
  const status = rv.attempts === 0 ? statusLabel('new') : statusLabel('learning');
  const pct = Math.max(0, Math.min(100, Math.round((rv.level / 5) * 100)));

  const bar = el('span', { class: 'sm-activity-bar', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { class: 'sm-activity-bar-fill', attrs: { style: `inline-size:${pct}%` } }),
  ]);
  const row = el('li', { class: 'sm-verse-activity', attrs: { 'data-rung': rv.rung } }, [
    el('div', { class: 'sm-activity-line' }, [
      el('strong', { class: 'sm-activity-name', text: label, attrs: { 'aria-hidden': 'true' } }),
      el('span', {
        class: 'sm-sr-only',
        text: tr('memory.ui.verse.activityA11y', '{activity}, {status}, next review {when}', {
          activity: label,
          status,
          when: next,
        }),
      }),
      bar,
      el('span', { class: 'sm-activity-next', text: next, attrs: { 'aria-hidden': 'true' } }),
    ]),
    el('div', { class: 'sm-activity-blurb sm-hint', text: RUNG_BLURB[rv.rung] }),
  ]);

  if (rv.rung !== 'recite' && rv.applicable) {
    row.appendChild(
      el('div', { class: 'sm-activity-actions' }, [
        button(tr('memory.ui.verse.practiceActivity', 'Practice'), () => void host.startSession(pv.passage.id, rv.rung), {
          class: 'sm-btn sm-btn-small',
          attrs: { 'aria-label': tr('memory.ui.verse.practiceActivityA11y', 'Practice: {activity}', { activity: label }) },
        }),
      ]),
    );
  }

  if (rv.rung === 'recite') {
    const ready = speech !== null && speech.state === 'ready';
    const source = { kind: 'passage', passageId: pv.passage.id } as const;
    const aria = (verb: string): Record<string, string> => ({ 'aria-label': `${verb}: ${label}` });
    row.appendChild(
      el('div', { class: 'sm-activity-actions' }, [
        button(tr('memory.ui.plan.recite', 'Recite'), () => void startReciteRun(host, source, 'tap'), {
          class: 'sm-btn sm-btn-small',
          disabled: !ready,
          attrs: aria(tr('memory.ui.plan.recite', 'Recite')),
        }),
        button(tr('memory.ui.plan.reciteHandsFree', 'Hands-free'), () => void startReciteRun(host, source, 'handsfree'), {
          class: 'sm-btn sm-btn-small',
          disabled: !ready || !speech?.handsFree,
          attrs: {
            ...aria(tr('memory.ui.plan.reciteHandsFree', 'Hands-free')),
            'data-testid': 'recite-handsfree',
            title:
              !speech?.handsFree && ready
                ? tr('memory.ui.plan.reciteHandsFreeNoVoice', 'Hands-free needs the app to be able to speak, and no text-to-speech voice is available on this computer.')
                : tr('memory.ui.plan.reciteHandsFreeHint', 'Speak and listen without touching the screen'),
          },
        }),
      ]),
    );
  }
  return row;
}

/**
 * Under the activities: why Recite aloud is unavailable (when speech is the
 * reason) and the per-verse switch to include it in "Recite what's due".
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
      el('label', { text: tr('memory.ui.verse.addToReciteDue', 'Add this verse to "Recite what\'s due"'), attrs: { for: 'sm-recite-on' } }),
    ]),
    el('p', {
      class: 'sm-hint',
      id: 'sm-recite-on-hint',
      text: tr('memory.ui.verse.recitingOptionalHint', 'Reciting is optional and never holds back this verse. Once you have recited it, it comes up when due without this.'),
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
// Menu modals: answer mode, reset progress
// ---------------------------------------------------------------------------

/** Per-verse override of the global answer mode. Closes the modal before reloading (the modal lives outside the screen). */
function openAnswerModeModal(host: PanelHost, pv: PassageView, defaultAnswerMode: AnswerMode): void {
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
    void host.request({ type: 'setPassageAnswerMode', passageId: pv.passage.id, mode }).then((reply) => {
      select.disabled = false;
      if (!reply.ok) {
        replace(errorSlot, [errorBanner(reply.error)]);
        return;
      }
      handle.close();
      host.reload();
    });
  });

  const handle = showModal(host, {
    title: tr('memory.ui.plan.answerWith', 'Answer with'),
    body: [
      el('div', { class: 'sm-answer-row' }, [
        el('label', { class: 'sm-label-inline', text: tr('memory.ui.plan.answerWith', 'Answer with'), attrs: { for: 'sm-answer-mode' } }),
        select,
        errorSlot,
      ]),
    ],
  });
}

/** "Reset progress" behind a confirmation step (a `confirm()` can be suppressed in a sandboxed iframe). */
function openResetModal(host: PanelHost, pv: PassageView): void {
  const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });
  const yes = button(
    tr('memory.ui.plan.yesReset', 'Yes, reset'),
    () => {
      yes.disabled = true;
      void host.request({ type: 'resetPassageProgress', passageId: pv.passage.id }).then((reply) => {
        if (!reply.ok) {
          yes.disabled = false;
          replace(errorSlot, [errorBanner(reply.error)]);
          return;
        }
        host.announce(tr('memory.ui.plan.resetDone', 'Reset progress for {reference}.', { reference: pv.passage.reference }));
        handle.close();
        host.reload();
      });
    },
    { class: 'sm-btn sm-btn-danger' },
  );
  const cancel = button(tr('memory.ui.plan.cancel', 'Cancel'), () => handle.close(), { class: 'sm-btn sm-btn-quiet' });

  const handle = showModal(host, {
    title: tr('memory.ui.verse.resetTitle', 'Reset progress for {reference}?', { reference: pv.passage.reference }),
    body: [
      el('p', {
        class: 'sm-hint',
        attrs: { role: 'alert' },
        text: tr('memory.ui.plan.resetConfirm', 'Reset all progress on this verse? This cannot be undone.'),
      }),
      errorSlot,
    ],
    actions: [cancel, yes],
  });
}
