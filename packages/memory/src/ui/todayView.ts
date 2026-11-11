/**
 * Today (task 0219): the landing screen. One queue, one button.
 *
 *   A1  verses to practice: counts, one Start/Continue button, "Up next"
 *   A2  done for today: upcoming reviews, "Learn a new verse", "Practice anyway"
 *   A3  first open: add a verse and start it, or begin with a starter set
 *   --  empty focus: the focused list has no verses yet
 *   A9  the "Added X. Practice now" row (a verse just added from the Bible)
 *
 * Returns the screen content only (no tab bar); the h1 is the focus target.
 * Nothing locked is displayed: the Match/Name the reference activities appear
 * in "Practice something else" only once some verse can use them
 * (`flows.ts#pickerFlows`), and an item for one of them hides its reference.
 */

import type { AddVersesOutcome } from '../core/api';
import type { PlanView, Rung } from '../core/types';
import { anywayOrder, todayQueue } from '../core/today';
import type { TodayItem, TodayQueue } from '../core/today';
import { button, el, focusQuietly, replace } from './dom';
import { attachMenuKeys, errorBanner } from './components';
import { reciteTileVisible, startReciteRun } from './activities';
import { calendarDaysBetween, formatShortDate, RUNG_LABEL } from './format';
import { nextFlowTarget, pickerFlows } from './flows';
import type { PickerFlow } from './flows';
import type { PanelHost } from './host';
import { tr } from './i18n';
import { setFocus } from './listActions';
import { extractReferenceCandidates } from './referenceInput';
import { renderStarterChips } from './starterSets';
import type { Flow } from './state';
import './styles/today.css';

/** How many "Up next" rows are listed before "N more". */
export const UP_NEXT_LIMIT = 4;

export interface TodayExtras {
  /**
   * A verse just added from the Bible: shows "Added X to Memory." (or "Restored" / "already in",
   * per the add's `outcome`; missing = 'added') with "Practice now".
   */
  justAdded?: { passageId: number; reference: string; outcome?: AddVersesOutcome } | null;
  /** Reminder cards waiting to be answered. */
  reminders?: { waiting: number } | null;
  /** Consecutive days practiced; shown on the done screen, hidden at 0. */
  streak?: number | null;
  /** Verses started today across ALL lists (the new-verse cap is global). */
  startedToday?: number;
}

export function renderToday(host: PanelHost, plan: PlanView, extras: TodayExtras = {}): HTMLElement {
  const now = host.now();
  const queue = todayQueue(plan.passages, now, extras.startedToday !== undefined ? { startedToday: extras.startedToday } : {});

  const root = el('section', { class: 'sm-screen sm-today' });

  const offer = renderOfferRow(host, extras.justAdded ?? null);
  if (offer) root.appendChild(offer);
  const reminders = renderRemindersRow(host, extras.reminders?.waiting ?? 0);
  if (reminders) root.appendChild(reminders);

  if (queue.totalVerses === 0) {
    root.appendChild(plan.scope === 'all' ? renderFirstOpen(host, plan) : renderEmptyFocus(host, plan));
  } else if (queue.items.length > 0) {
    root.appendChild(renderQueue(host, plan, queue, now));
  } else {
    root.appendChild(renderDone(host, plan, queue, now, extras.streak ?? 0));
  }
  return root;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function heading(text: string, cls = 'sm-today-title'): HTMLElement {
  // tabindex -1: the shell moves focus here on arrival.
  return el('h1', { class: cls, text, attrs: { tabindex: '-1' } });
}

function renderOfferRow(host: PanelHost, added: TodayExtras['justAdded']): HTMLElement | null {
  if (!added) return null;
  const startBtn = button(
    tr('memory.ui.today.practiceNow', 'Practice now'),
    () => {
      startBtn.disabled = true;
      void host.startSession(added.passageId).finally(() => {
        startBtn.disabled = false;
      });
    },
    { class: 'sm-btn sm-btn-primary sm-btn-small' },
  );
  return el('div', { class: 'sm-today-offer', attrs: { role: 'status' } }, [
    el('span', {
      class: 'sm-today-offer-text',
      text: offerText(added),
    }),
    startBtn,
  ]);
}

function offerText(added: NonNullable<TodayExtras['justAdded']>): string {
  const params = { reference: added.reference };
  switch (added.outcome) {
    case 'revived':
      return tr('memory.ui.today.justRevived', 'Restored {reference} to Memory.', params);
    case 'exists':
      return tr('memory.ui.today.alreadyAdded', '{reference} is already in Memory.', params);
    default:
      return tr('memory.ui.today.justAdded', 'Added {reference} to Memory.', params);
  }
}

function renderRemindersRow(host: PanelHost, waiting: number): HTMLElement | null {
  if (!Number.isFinite(waiting) || waiting <= 0) return null;
  const label = tr('memory.ui.today.remindersWaiting', '{count, plural, one {# reminder waiting} other {# reminders waiting}}', { count: waiting });
  return el('div', { class: 'sm-today-reminders' }, [
    el('span', { class: 'sm-today-reminders-text', text: label }),
    button(
      tr('memory.ui.today.reviewReminders', 'Review'),
      () => host.go({ type: 'goCard' }),
      {
        class: 'sm-btn sm-btn-small',
        attrs: { 'aria-label': tr('memory.ui.today.reviewRemindersAria', '{label}. Review them.', { label }) },
      },
    ),
  ]);
}

/** Runs `host.startFlow`, keeping the button disabled while it starts. */
function runFlow(host: PanelHost, flow: Flow, btn: HTMLButtonElement): void {
  btn.disabled = true;
  void host.startFlow(flow).finally(() => {
    btn.disabled = false;
  });
}

/**
 * Starts one picker entry. Recite aloud and hands-free are not practice
 * sessions: they go to the recite runner (due verses first, else one verse).
 */
function startPickerEntry(host: PanelHost, plan: PlanView, entry: PickerFlow): void {
  if (entry.key !== 'recite' && entry.key !== 'handsfree') {
    void host.startFlow(entry.flow);
    return;
  }
  const mode = entry.key === 'handsfree' ? 'handsfree' : 'tap';
  if (plan.reciteDueCount > 0) {
    void startReciteRun(host, { kind: 'due' }, mode);
    return;
  }
  const target = nextFlowTarget(plan, entry.flow, host.now(), Math.random);
  if (!target) {
    host.announce(tr('memory.ui.settings.nothingElseToPractice', 'Nothing else to practice right now.'));
    return;
  }
  void startReciteRun(host, { kind: 'passage', passageId: target.passageId }, mode);
}

/** The quiet "Practice something else" link and the small menu it opens. */
function renderSomethingElse(host: PanelHost, plan: PlanView): HTMLElement | null {
  const reciteReady = reciteTileVisible(plan);
  const entries = pickerFlows(plan, host.now(), { reciteReady }).filter(
    (e) => e.key !== 'handsfree' || plan.speech.handsFree,
  );
  if (entries.length === 0) return null;

  const wrapper = el('div', { class: 'sm-today-else' });
  const panel = el('ul', {
    class: 'sm-today-else-panel',
    id: 'sm-today-else-panel',
    hidden: true,
    attrs: { role: 'menu', 'aria-label': tr('memory.ui.today.somethingElse', 'Practice something else') },
  });
  const trigger = button(tr('memory.ui.today.somethingElse', 'Practice something else'), () => (panel.hidden ? open() : close()), {
    class: 'sm-btn sm-btn-quiet sm-today-else-link',
    attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'sm-today-else-panel' },
  });

  const items = entries.map((entry) => {
    const b = button(
      entry.label,
      () => {
        close();
        focusQuietly(trigger);
        startPickerEntry(host, plan, entry);
      },
      { class: 'sm-today-else-item', attrs: { role: 'menuitem', tabindex: '-1' } },
    );
    panel.appendChild(el('li', { attrs: { role: 'none' } }, [b]));
    return b;
  });

  let outside: ((ev: PointerEvent) => void) | null = null;

  function setRoving(index: number): void {
    items.forEach((b, i) => {
      b.tabIndex = i === index ? 0 : -1;
    });
  }
  function close(): void {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (outside) {
      document.removeEventListener('pointerdown', outside, true);
      outside = null;
    }
  }
  function open(): void {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    setRoving(0);
    focusQuietly(items[0] ?? null);
    outside = (ev: PointerEvent) => {
      if (ev.target instanceof Node && wrapper.contains(ev.target)) return;
      close();
    };
    document.addEventListener('pointerdown', outside, true);
  }

  // Escape, Tab, Up/Down and Home/End: the shared menu keys.
  attachMenuKeys(panel, items, setRoving, () => {
    close();
    focusQuietly(trigger);
  });

  wrapper.appendChild(trigger);
  wrapper.appendChild(panel);
  return wrapper;
}

// ---------------------------------------------------------------------------
// A1: there is something to practice
// ---------------------------------------------------------------------------

function countsText(queue: TodayQueue): string {
  const review = queue.reviewCount;
  const fresh = queue.newCount;
  if (review > 0 && fresh > 0) {
    return tr('memory.ui.today.countsBoth', '{review} to review, {fresh} new', { review, fresh });
  }
  if (review > 0) return tr('memory.ui.today.countsReview', '{review} to review', { review });
  return tr('memory.ui.today.countsNew', '{fresh} new', { fresh });
}

function isReferenceRung(rung: Rung): boolean {
  return rung === 'refmatch' || rung === 'refprovide';
}

function renderQueue(host: PanelHost, plan: PlanView, queue: TodayQueue, _now: number): HTMLElement {
  const wrap = el('div', { class: 'sm-today-queue' });

  const startLabel = queue.doneToday > 0
    ? tr('memory.ui.today.continue', 'Continue')
    : tr('memory.ui.today.start', 'Start');
  const startBtn = button(startLabel, () => runFlow(host, { kind: 'today', skipped: [] }, startBtn), {
    class: 'sm-btn sm-btn-primary sm-today-start',
  });

  wrap.appendChild(
    el('div', { class: 'sm-today-hero' }, [
      heading(tr('memory.ui.today.title', 'Today')),
      el('p', { class: 'sm-today-counts', text: countsText(queue) }),
      queue.minutes > 0
        ? el('p', {
            class: 'sm-today-minutes',
            text: tr('memory.ui.today.minutes', '{minutes, plural, one {About # minute} other {About # minutes}}', { minutes: queue.minutes }),
          })
        : null,
      startBtn,
    ]),
  );

  const shown = queue.items.slice(0, UP_NEXT_LIMIT);
  const more = queue.items.length - shown.length;
  wrap.appendChild(
    el('section', { class: 'sm-today-upnext' }, [
      el('h2', { class: 'sm-today-upnext-title', text: tr('memory.ui.today.upNext', 'Up next') }),
      el('ul', { class: 'sm-today-list' }, shown.map(renderItem)),
      more > 0
        ? el('p', { class: 'sm-today-more', text: tr('memory.ui.today.more', '{count} more', { count: more }) })
        : null,
    ]),
  );

  const other = renderSomethingElse(host, plan);
  if (other) wrap.appendChild(other);
  return wrap;
}

function renderItem(item: TodayItem): HTMLElement {
  const kind = item.kind === 'new'
    ? tr('memory.ui.today.kindNew', 'New')
    : tr('memory.ui.today.kindReview', 'Review');
  // Activities that ask for the reference must not give it away in the list.
  const reference = isReferenceRung(item.rung)
    ? tr('memory.ui.today.referenceHidden', 'Reference hidden')
    : item.reference;
  return el('li', { class: `sm-today-item sm-today-item-${item.kind}` }, [
    el('span', { class: 'sm-today-dot', attrs: { 'aria-hidden': 'true' } }),
    el('span', { class: 'sm-today-ref', text: reference }),
    el('span', {
      class: 'sm-today-meta',
      text: tr('memory.ui.today.itemMeta', '{kind} · {activity}', { kind, activity: RUNG_LABEL[item.rung] }),
    }),
  ]);
}

// ---------------------------------------------------------------------------
// A2: done for today
// ---------------------------------------------------------------------------

function upcomingText(queue: TodayQueue, now: number): string | null {
  const up = queue.upcoming;
  if (!up) return null;
  if (calendarDaysBetween(now, up.day) <= 1) {
    return tr('memory.ui.today.upcomingTomorrow', '{count, plural, one {Next review tomorrow: # verse} other {Next review tomorrow: # verses}}', { count: up.count });
  }
  return tr('memory.ui.today.upcomingOn', '{count, plural, one {Next review {date}: # verse} other {Next review {date}: # verses}}', {
    count: up.count,
    date: formatShortDate(up.day, now),
  });
}

function renderDone(host: PanelHost, plan: PlanView, queue: TodayQueue, now: number, streak: number): HTMLElement {
  const wrap = el('div', { class: 'sm-today-done' });
  wrap.appendChild(el('span', { class: 'sm-today-check', text: '✓', attrs: { 'aria-hidden': 'true' } }));
  wrap.appendChild(heading(tr('memory.ui.today.doneTitle', 'Done for today'), 'sm-today-title sm-today-done-title'));

  const upcoming = upcomingText(queue, now);
  if (upcoming) wrap.appendChild(el('p', { class: 'sm-today-upcoming', text: upcoming }));
  if (streak > 0) {
    wrap.appendChild(el('p', {
      class: 'sm-today-streak',
      text: tr('memory.ui.today.streak', '{count, plural, one {# day streak} other {# day streak}}', { count: streak }),
    }));
  }

  const actions = el('div', { class: 'sm-today-actions' });
  if (queue.nextNewAvailable) {
    const learn = button(tr('memory.ui.today.learnNew', 'Learn a new verse'), () => {
      const next = queue.nextNewAvailable;
      if (!next) return;
      learn.disabled = true;
      // The verse is not in today's queue (the daily new-verse cap), so start it directly.
      void host.startSession(next.passageId, next.rung).finally(() => {
        learn.disabled = false;
      });
    }, { class: 'sm-btn sm-btn-primary sm-today-action' });
    actions.appendChild(learn);
  }
  // Hidden when there is nothing at all to practice (never a dead end).
  if (anywayOrder(plan.passages, now, new Set()).length > 0) {
    const anyway = button(tr('memory.ui.today.practiceAnyway', 'Practice anyway'), () => runFlow(host, { kind: 'anyway', visited: [] }, anyway), {
      class: queue.nextNewAvailable ? 'sm-btn sm-today-action' : 'sm-btn sm-btn-primary sm-today-action',
    });
    actions.appendChild(anyway);
  }
  wrap.appendChild(actions);

  const other = renderSomethingElse(host, plan);
  if (other) wrap.appendChild(other);
  return wrap;
}

// ---------------------------------------------------------------------------
// A3 and empty focus: nothing to practice yet
// ---------------------------------------------------------------------------

/**
 * The reference field with "Add and start": adds the verse, then starts it.
 * Keeps the id `sm-add-reference` so the shell can refresh the placeholder when
 * the Bible pane moves to another verse.
 */
function renderAddAndStart(host: PanelHost): HTMLElement {
  const input = el('input', {
    class: 'sm-input',
    id: 'sm-add-reference',
    type: 'text',
    placeholder: host.activeReference ?? tr('memory.ui.today.addPlaceholder', 'John 3:16 or Psalm 23'),
    attrs: {
      autocomplete: 'off',
      autocapitalize: 'words',
      spellcheck: 'false',
      enterkeyhint: 'go',
      'aria-label': tr('memory.ui.today.addLabel', 'Verse to memorize'),
    },
  }) as HTMLInputElement;
  const errorSlot = el('div', { class: 'sm-error-slot', attrs: { 'aria-live': 'polite' } });
  const submit = el('button', {
    class: 'sm-btn sm-btn-primary',
    text: tr('memory.ui.today.addAndStart', 'Add and start'),
  }) as HTMLButtonElement;
  submit.type = 'submit';

  const form = el('form', { class: 'sm-today-add' }, [
    el('div', { class: 'sm-today-add-row' }, [input, submit]),
    errorSlot,
  ]) as HTMLFormElement;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const typed = extractReferenceCandidates(input.value);
    const refs = typed.length > 0 ? typed : host.activeReference ? [host.activeReference.trim()] : [];
    if (refs.length === 0) {
      replace(errorSlot, [errorBanner(tr('memory.ui.today.typeReferenceFirst', 'Type a reference first, for example "John 3:16-18".'))]);
      focusQuietly(input);
      return;
    }
    void (async () => {
      submit.disabled = true;
      input.disabled = true;
      replace(errorSlot, []);
      let firstId: number | null = null;
      const failures: string[] = [];
      for (const reference of refs) {
        const reply = await host.request({ type: 'addPassage', reference });
        if (reply.ok) {
          if (firstId === null) firstId = reply.data.passage.id;
        } else {
          failures.push(refs.length > 1 ? `${reference}: ${reply.error}` : reply.error);
        }
      }
      submit.disabled = false;
      input.disabled = false;
      if (failures.length > 0) {
        replace(errorSlot, failures.map((f) => errorBanner(f)));
        focusQuietly(input);
      }
      if (firstId !== null) {
        input.value = '';
        await host.startSession(firstId);
      }
    })();
  });
  return form;
}

function renderFirstOpen(host: PanelHost, plan: PlanView): HTMLElement {
  return el('div', { class: 'sm-today-first' }, [
    heading(tr('memory.ui.today.welcomeTitle', 'Learn Scripture by heart')),
    renderAddAndStart(host),
    el('h2', { class: 'sm-today-sub', text: tr('memory.ui.today.orSet', 'Or start with a set:') }),
    renderStarterChips(host, plan),
    el('p', {
      class: 'sm-hint sm-today-tip',
      text: tr('memory.ui.today.memorizeTip', 'Or right-click any verse in the Bible and choose Memorize.'),
    }),
  ]);
}

function renderEmptyFocus(host: PanelHost, plan: PlanView): HTMLElement {
  const name = plan.lists.find((l) => l.id === plan.scope)?.name ?? plan.collectionName;
  const showAll = button(
    tr('memory.ui.today.showAllLists', 'Practice from all lists'),
    () => {
      showAll.disabled = true;
      void setFocus(host, null).finally(() => (showAll.disabled = false));
    },
    { class: 'sm-btn' },
  );
  return el('div', { class: 'sm-today-first sm-today-empty-focus' }, [
    heading(tr('memory.ui.today.emptyFocus', 'No verses in {name} yet', { name })),
    el('p', {
      class: 'sm-hint',
      text: tr('memory.ui.today.emptyFocusHint', 'Add a verse to this list, or practice from all of your lists.'),
    }),
    renderAddAndStart(host),
    el('div', { class: 'sm-today-actions' }, [showAll]),
  ]);
}
