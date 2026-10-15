/**
 * Memory-card notification settings (task 0072), a section of the Settings
 * screen.
 *
 * The section owns a local copy of the settings. Every edit updates the copy
 * and sends the whole object with `setPushSettings`; the worker normalises it
 * and replies with a fresh view. Text-like inputs (times, numbers) are never
 * redrawn from the reply, so typing is not interrupted; only structural edits
 * (toggle, add/remove slot, source) redraw the section, and a reply only
 * refreshes the status paragraph and the permission button.
 */

import type {
  PushCardSettings,
  PushSettingsView,
  ReminderSlot,
  Weekday,
} from '../core/pushTypes';
import { button, el, replace } from './dom';
import { tr } from './i18n';
import type { PanelHost } from './host';

/** Resolved at render time so a language change takes effect. */
function dayLetters(): string[] {
  return [
    tr('memory.ui.settings.daySunLetter', 'S'),
    tr('memory.ui.settings.dayMonLetter', 'M'),
    tr('memory.ui.settings.dayTueLetter', 'T'),
    tr('memory.ui.settings.dayWedLetter', 'W'),
    tr('memory.ui.settings.dayThuLetter', 'T'),
    tr('memory.ui.settings.dayFriLetter', 'F'),
    tr('memory.ui.settings.daySatLetter', 'S'),
  ];
}
function dayNames(): string[] {
  return [
    tr('memory.ui.settings.daySun', 'Sunday'),
    tr('memory.ui.settings.dayMon', 'Monday'),
    tr('memory.ui.settings.dayTue', 'Tuesday'),
    tr('memory.ui.settings.dayWed', 'Wednesday'),
    tr('memory.ui.settings.dayThu', 'Thursday'),
    tr('memory.ui.settings.dayFri', 'Friday'),
    tr('memory.ui.settings.daySat', 'Saturday'),
  ];
}
const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

let uid = 0;
const nextId = (p: string): string => `${p}-${++uid}`;

export function renderPushSettings(host: PanelHost, initial: PushSettingsView): HTMLElement {
  let view = initial;
  let settings: PushCardSettings = structuredCloneSafe(initial.settings);
  const root = el('section', { class: 'sm-block sm-push', attrs: { 'aria-labelledby': 'sm-push-title' } });
  const statusBox = el('div', { class: 'sm-push-status' });

  let seq = 0;

  function send(redraw: boolean): void {
    if (redraw) draw();
    const mine = ++seq;
    const sent = JSON.stringify(settings);
    void host.request({ type: 'setPushSettings', settings }).then((reply) => {
      if (mine !== seq) return; // a newer edit is in flight; ignore this stale reply
      if (!reply.ok) {
        host.announce(reply.error);
        return;
      }
      view = reply.data;
      if (JSON.stringify(reply.data.settings) !== sent) {
        // The worker normalised something; show what it actually saved.
        settings = structuredCloneSafe(reply.data.settings);
        draw();
      } else {
        drawStatus();
      }
    });
  }

  function update(change: (s: PushCardSettings) => void, redraw = false): void {
    change(settings);
    send(redraw);
  }

  function drawStatus(): void {
    const children: (Node | null)[] = [
      el('p', { class: 'sm-hint', text: view.status.message, attrs: { role: 'status' } }),
    ];
    if (view.status.hostApi && view.status.permission === 'prompt') {
      children.push(
        button(
          tr('memory.ui.settings.allowNotifications', 'Allow notifications'),
          () => {
            void host.request({ type: 'requestReminderPermission' }).then((reply) => {
              if (!reply.ok) {
                host.announce(reply.error);
                return;
              }
              view = reply.data;
              drawStatus();
            });
          },
          { class: 'sm-btn sm-btn-small' },
        ),
      );
    }
    replace(statusBox, children);
  }

  function draw(): void {
    const enabledId = nextId('sm-push-enabled');
    const enabled = el('input', { id: enabledId, type: 'checkbox' }) as HTMLInputElement;
    enabled.checked = settings.enabled;
    enabled.addEventListener('change', () => update((s) => (s.enabled = enabled.checked), true));

    const children: (Node | null)[] = [
      el('h2', { class: 'sm-block-title', id: 'sm-push-title', text: tr('memory.ui.settings.memoryCards', 'Memory cards') }),
      el('div', { class: 'sm-radio-row' }, [
        enabled,
        el('label', { attrs: { for: enabledId }, text: tr('memory.ui.settings.sendCards', 'Send me memory cards as notifications') }),
      ]),
      el('p', { class: 'sm-hint', text: tr('memory.ui.settings.cardsIntro', 'A short prompt to say a passage to yourself, then grade how it went.') }),
      statusBox,
    ];

    if (settings.enabled) {
      children.push(
        renderSlots(),
        renderQuiet(),
        renderMax(),
        renderSource(),
        radioGroup(tr('memory.ui.settings.cardPrompt', 'Card prompt (in the app)'), 'prompt', settings.prompt, [
          ['reference', tr('memory.ui.settings.referenceOnly', 'Reference only')],
          ['firstWords', tr('memory.ui.settings.referenceAndFirstWords', 'Reference and first words')],
        ], (v) => update((s) => (s.prompt = v as PushCardSettings['prompt']))),
        el('p', { class: 'sm-hint', text: tr('memory.ui.settings.notificationsOnlyReference', 'Notifications only ever show the reference, never the verse or its first words.') }),
        radioGroup(tr('memory.ui.settings.onLockScreen', 'On the lock screen'), 'lockScreen', settings.lockScreen, [
          ['reference', tr('memory.ui.settings.showReference', 'Show the reference')],
          ['generic', tr('memory.ui.settings.generic', 'Generic ("A memory card is ready.")')],
        ], (v) => update((s) => (s.lockScreen = v as PushCardSettings['lockScreen']))),
      );
    }
    replace(root, children);
    drawStatus();
  }

  // --- slots ----------------------------------------------------------------
  function renderSlots(): HTMLElement {
    const list = el(
      'ul',
      { class: 'sm-list sm-push-slots', attrs: { 'aria-label': tr('memory.ui.settings.reminderTimes', 'Reminder times') } },
      settings.plan.slots.map((slot, i) => slotRow(slot, i)),
    );
    return el('fieldset', { class: 'sm-push-group' }, [
      el('legend', { class: 'sm-push-legend', text: tr('memory.ui.settings.when', 'When') }),
      list,
      el('div', { class: 'sm-push-add' }, [
        button(tr('memory.ui.settings.addTime', 'Add a time'), () =>
          update((s) => s.plan.slots.push({ id: newSlotId(), kind: 'fixed', time: '12:00', days: [...ALL_DAYS] }), true),
          { class: 'sm-btn sm-btn-small' }),
        button(tr('memory.ui.settings.addWindow', 'Add a window'), () =>
          update(
            (s) => s.plan.slots.push({ id: newSlotId(), kind: 'window', start: '09:00', end: '17:00', count: 2, days: [...ALL_DAYS] }),
            true,
          ),
          { class: 'sm-btn sm-btn-small sm-btn-quiet' }),
      ]),
    ]);
  }

  function newSlotId(): string {
    const used = new Set(settings.plan.slots.map((s) => s.id));
    let n = settings.plan.slots.length + 1;
    while (used.has(`slot-${n}`)) n++;
    return `slot-${n}`;
  }

  function slotRow(slot: ReminderSlot, index: number): HTMLElement {
    const n = index + 1;
    const fixed = slot.kind === 'fixed';
    const removeLabel = fixed ? tr('memory.ui.settings.removeTime', 'Remove time {n}', { n }) : tr('memory.ui.settings.removeWindow', 'Remove window {n}', { n });
    const daysLabel = fixed ? tr('memory.ui.settings.daysForTime', 'Days for time {n}', { n }) : tr('memory.ui.settings.daysForWindow', 'Days for window {n}', { n });
    const inputs: Node[] = [];
    if (slot.kind === 'fixed') {
      inputs.push(timeInput(tr('memory.ui.settings.reminderTimeN', 'Reminder time {n}', { n }), slot.time, (v) => update(() => (slot.time = v))));
    } else {
      inputs.push(timeInput(tr('memory.ui.settings.windowStart', 'Window {n} start', { n }), slot.start, (v) => update(() => (slot.start = v))));
      inputs.push(el('span', { text: tr('memory.ui.settings.to', 'to'), attrs: { 'aria-hidden': 'true' } }));
      inputs.push(timeInput(tr('memory.ui.settings.windowEnd', 'Window {n} end', { n }), slot.end, (v) => update(() => (slot.end = v))));
      const count = numberInput(tr('memory.ui.settings.cardsInWindow', 'Cards in window {n}', { n }), slot.count, 1, 6, (n) => update(() => (slot.count = n)));
      inputs.push(count, el('span', { class: 'sm-hint', text: tr('memory.ui.settings.cards', 'cards') }));
    }
    return el('li', { class: 'sm-row sm-push-slot' }, [
      el('div', { class: 'sm-push-slot-times' }, inputs),
      dayPicker(daysLabel, slot),
      button(
        tr('memory.ui.settings.remove', 'Remove'),
        () => update((s) => (s.plan.slots = s.plan.slots.filter((x) => x.id !== slot.id)), true),
        { class: 'sm-btn sm-btn-small sm-btn-quiet', attrs: { 'aria-label': removeLabel } },
      ),
    ]);
  }

  function dayPicker(label: string, slot: ReminderSlot): HTMLElement {
    const names = dayNames();
    const letters = dayLetters();
    return el(
      'div',
      { class: 'sm-push-days', attrs: { role: 'group', 'aria-label': label } },
      ALL_DAYS.map((d) => {
        const id = nextId('sm-push-day');
        const box = el('input', { id, type: 'checkbox' }) as HTMLInputElement;
        box.checked = slot.days.includes(d);
        box.addEventListener('change', () =>
          update(() => {
            const days = new Set(slot.days);
            if (box.checked) days.add(d);
            else days.delete(d);
            slot.days = ALL_DAYS.filter((x) => days.has(x));
          }),
        );
        return el('span', { class: 'sm-push-day' }, [
          box,
          el('label', { attrs: { for: id, 'aria-label': names[d]! }, title: names[d]!, text: letters[d]! }),
        ]);
      }),
    );
  }

  // --- quiet hours / max ------------------------------------------------------
  function renderQuiet(): HTMLElement {
    const q = settings.plan.quiet ?? { start: '21:30', end: '07:00' };
    const apply = (): void => update((s) => (s.plan.quiet = { ...q }));
    return el('fieldset', { class: 'sm-push-group' }, [
      el('legend', { class: 'sm-push-legend', text: tr('memory.ui.settings.quietHours', 'Quiet hours') }),
      el('div', { class: 'sm-push-inline' }, [
        timeInput(tr('memory.ui.settings.quietStart', 'Quiet hours start'), q.start, (v) => { q.start = v; apply(); }),
        el('span', { text: tr('memory.ui.settings.to', 'to'), attrs: { 'aria-hidden': 'true' } }),
        timeInput(tr('memory.ui.settings.quietEnd', 'Quiet hours end'), q.end, (v) => { q.end = v; apply(); }),
      ]),
      el('p', { class: 'sm-hint', text: tr('memory.ui.settings.quietHint', 'Cards that would fire during quiet hours are skipped.') }),
    ]);
  }

  function renderMax(): HTMLElement {
    const id = nextId('sm-push-max');
    const input = numberInput(tr('memory.ui.settings.mostCardsPerDay', 'Most cards per day'), settings.plan.maxPerDay, 1, 12, (n) =>
      update((s) => (s.plan.maxPerDay = n)),
    );
    input.id = id;
    input.removeAttribute('aria-label');
    return el('div', { class: 'sm-push-inline' }, [
      el('label', { attrs: { for: id }, text: tr('memory.ui.settings.mostCardsPerDay', 'Most cards per day') }),
      input,
    ]);
  }

  // --- source ---------------------------------------------------------------
  function renderSource(): HTMLElement {
    const group = radioGroup(tr('memory.ui.settings.whichPassages', 'Which passages'), 'source', settings.source, [
      ['dueThenReview', tr('memory.ui.settings.dueThenReview', 'Due passages first, then review well-learned ones')],
      ['dueOnly', tr('memory.ui.settings.dueOnly', 'Due passages only')],
      ['pinned', tr('memory.ui.settings.onlyPinned', 'Only passages I pin')],
    ], (v) => update((s) => (s.source = v as PushCardSettings['source']), true));

    if (settings.source !== 'pinned') return group;
    const pinned = new Set(settings.pinnedPassageIds);
    const picker =
      view.passages.length === 0
        ? el('p', { class: 'sm-hint', text: tr('memory.ui.settings.addToPin', 'Add a passage to pin it.') })
        : el(
            'ul',
            { class: 'sm-list sm-push-pinned', attrs: { 'aria-label': tr('memory.ui.settings.pinnedPassages', 'Pinned passages') } },
            view.passages.map((p) => {
              const id = nextId('sm-push-pin');
              const box = el('input', { id, type: 'checkbox' }) as HTMLInputElement;
              box.checked = pinned.has(p.id);
              box.addEventListener('change', () =>
                update((s) => {
                  const set = new Set(s.pinnedPassageIds);
                  if (box.checked) set.add(p.id);
                  else set.delete(p.id);
                  s.pinnedPassageIds = [...set];
                }),
              );
              return el('li', { class: 'sm-radio-row' }, [box, el('label', { attrs: { for: id }, text: p.reference })]);
            }),
          );
    group.appendChild(picker);
    return group;
  }

  draw();
  return root;
}

// ---------------------------------------------------------------------------
// Small form helpers
// ---------------------------------------------------------------------------

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function radioGroup(
  legend: string,
  name: string,
  current: string,
  options: [string, string][],
  onChange: (value: string) => void,
): HTMLElement {
  const group = nextId(`sm-push-${name}`);
  return el('fieldset', { class: 'sm-push-group sm-radio-group' }, [
    el('legend', { class: 'sm-push-legend', text: legend }),
    ...options.map(([value, label]) => {
      const id = `${group}-${value}`;
      const input = el('input', { id, type: 'radio', attrs: { name: group, value } }) as HTMLInputElement;
      input.checked = current === value;
      input.addEventListener('change', () => {
        if (input.checked) onChange(value);
      });
      return el('div', { class: 'sm-radio-row' }, [input, el('label', { attrs: { for: id }, text: label })]);
    }),
  ]);
}

function timeInput(label: string, value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = el('input', { type: 'time', class: 'sm-input sm-push-time', attrs: { 'aria-label': label } }) as HTMLInputElement;
  input.value = value;
  input.addEventListener('change', () => {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.value)) onChange(input.value);
  });
  return input;
}

function numberInput(
  label: string,
  value: number,
  min: number,
  max: number,
  onChange: (n: number) => void,
): HTMLInputElement {
  const input = el('input', {
    type: 'number',
    class: 'sm-input sm-push-number',
    attrs: { 'aria-label': label, min: String(min), max: String(max) },
  }) as HTMLInputElement;
  input.value = String(value);
  input.addEventListener('change', () => {
    const n = Math.round(Number(input.value));
    if (!Number.isFinite(n)) {
      input.value = String(value);
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    input.value = String(clamped);
    onChange(clamped);
  });
  return input;
}
