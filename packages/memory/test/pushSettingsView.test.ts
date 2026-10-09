/**
 * @vitest-environment jsdom
 *
 * Push-card settings section (task 0072).
 */
// Ported unchanged from the extension, whose tests were not type-checked; fixtures here
// predate later type changes. Behaviour is covered by vitest, not tsc.
// @ts-nocheck

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PushCardSettings, PushSettingsView } from '../src/core/pushTypes';
import type { PanelReply, PanelRequest, RequestMap } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import { WordMeasurer } from '../src/ui/measure';
import { renderPushSettings } from '../src/ui/pushSettingsView';
import { renderSettings } from '../src/ui/settingsView';

function baseSettings(over: Partial<PushCardSettings> = {}): PushCardSettings {
  return {
    enabled: true,
    plan: {
      slots: [{ id: 'slot-1', kind: 'fixed', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] }],
      quiet: { start: '21:30', end: '07:00' },
      maxPerDay: 3,
    },
    source: 'dueThenReview',
    pinnedPassageIds: [],
    prompt: 'reference',
    lockScreen: 'reference',
    ...over,
  };
}
function view(over: Partial<PushSettingsView> = {}, s: Partial<PushCardSettings> = {}): PushSettingsView {
  return {
    settings: baseSettings(s),
    status: { hostApi: true, permission: 'granted', whenClosed: 'fires', message: 'Notifications are on.' },
    passages: [{ id: 1, reference: 'John 3:16' }, { id: 2, reference: 'Psalm 23' }],
    ...over,
  };
}

class Host {
  requests: PanelRequest[] = [];
  announcements: string[] = [];
  reply: PushSettingsView | null = null;
  activeReference = null;
  measurer = new WordMeasurer(document);
  now(): number {
    return 0;
  }
  request<R extends PanelRequest>(r: R): Promise<PanelReply<RequestMap[R['type']]>> {
    this.requests.push(r);
    const data =
      this.reply ?? (r.type === 'setPushSettings' ? view({ settings: (r as { settings: PushCardSettings }).settings }) : view());
    return Promise.resolve({ ok: true, data } as PanelReply<RequestMap[R['type']]>);
  }
  go(): void {}
  reload(): void {}
  async startSession(): Promise<void> {}
  async startFlow(): Promise<void> {}
  openInBible(): void {}
  announce(m: string): void {
    this.announcements.push(m);
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
let host: Host;
let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  host = new Host();
});
afterEach(() => {
  document.body.innerHTML = '';
});

function mount(v: PushSettingsView): HTMLElement {
  const root = renderPushSettings(host as unknown as PanelHost, v);
  container.appendChild(root);
  return root;
}
const lastSent = (): PushCardSettings => {
  const reqs = host.requests.filter((r) => r.type === 'setPushSettings') as { settings: PushCardSettings }[];
  return reqs[reqs.length - 1]!.settings;
};
const btn = (root: HTMLElement, label: string): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const change = (input: HTMLInputElement, value?: string): void => {
  if (value !== undefined) input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('push settings', () => {
  it('shows the status message and labelled controls', () => {
    const root = mount(view());
    expect(root.querySelector('[role="status"]')!.textContent).toBe('Notifications are on.');
    expect(root.querySelector('input[aria-label="Reminder time 1"]')).not.toBeNull();
    expect(root.querySelector('input[aria-label="Quiet hours start"]')).not.toBeNull();
    expect(root.querySelector('label[aria-label="Monday"]')).not.toBeNull();
  });

  it('hides details when disabled and sends on enabling', async () => {
    const root = mount(view({}, { enabled: false }));
    expect(root.querySelector('input[aria-label="Reminder time 1"]')).toBeNull();
    const toggle = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    toggle.checked = true;
    change(toggle);
    await settle();
    expect(lastSent().enabled).toBe(true);
    expect(root.querySelector('input[aria-label="Reminder time 1"]')).not.toBeNull();
  });

  it('edits a time, a day and the quiet hours', () => {
    const root = mount(view());
    change(root.querySelector('input[aria-label="Reminder time 1"]')!, '09:15');
    expect((lastSent().plan.slots[0] as { time: string }).time).toBe('09:15');

    const sunday = root.querySelector<HTMLInputElement>('#' + root.querySelector('label[aria-label="Sunday"]')!.getAttribute('for'))!;
    sunday.checked = false;
    change(sunday);
    expect(lastSent().plan.slots[0]!.days).toEqual([1, 2, 3, 4, 5, 6]);

    change(root.querySelector('input[aria-label="Quiet hours end"]')!, '06:00');
    expect(lastSent().plan.quiet).toEqual({ start: '21:30', end: '06:00' });
  });

  it('ignores an invalid time', () => {
    const root = mount(view());
    change(root.querySelector('input[aria-label="Reminder time 1"]')!, '');
    expect(host.requests).toHaveLength(0);
  });

  it('adds and removes times and windows', async () => {
    const root = mount(view());
    btn(root, 'Add a time').click();
    btn(root, 'Add a window').click();
    await settle();
    expect(lastSent().plan.slots.map((s) => s.kind)).toEqual(['fixed', 'fixed', 'window']);
    expect(new Set(lastSent().plan.slots.map((s) => s.id)).size).toBe(3);
    expect(root.querySelector('input[aria-label="Window 3 start"]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('button[aria-label="Remove time 1"]')!.click();
    expect(lastSent().plan.slots).toHaveLength(2);
  });

  it('clamps max per day', () => {
    const root = mount(view());
    const input = root.querySelector<HTMLInputElement>('input[aria-label="Most cards per day"], #' + root.querySelector('label')!.getAttribute('for'))!;
    const max = [...root.querySelectorAll<HTMLInputElement>('input[type="number"]')][0]!;
    void input;
    change(max, '99');
    expect(lastSent().plan.maxPerDay).toBe(12);
    expect(max.value).toBe('12');
  });

  it('switches source and shows the pinned picker', () => {
    const root = mount(view());
    expect(root.textContent).not.toContain('Psalm 23');
    const pinned = root.querySelector<HTMLInputElement>('input[type="radio"][value="pinned"]')!;
    pinned.checked = true;
    change(pinned);
    expect(lastSent().source).toBe('pinned');
    const box = [...root.querySelectorAll<HTMLInputElement>('.sm-push-pinned input')][1]!;
    box.checked = true;
    change(box);
    expect(lastSent().pinnedPassageIds).toEqual([2]);
  });

  it('sets prompt and lock-screen choices', () => {
    const root = mount(view());
    const fw = root.querySelector<HTMLInputElement>('input[type="radio"][value="firstWords"]')!;
    fw.checked = true;
    change(fw);
    expect(lastSent().prompt).toBe('firstWords');
    const generic = root.querySelector<HTMLInputElement>('input[type="radio"][value="generic"]')!;
    generic.checked = true;
    change(generic);
    expect(lastSent().lockScreen).toBe('generic');
  });

  it('offers the permission button only when the host can prompt', async () => {
    expect(btn(mount(view()), 'Allow notifications')).toBeUndefined();
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    const prompt = view({ status: { hostApi: true, permission: 'prompt', whenClosed: null, message: 'Needs permission.' } });
    const root = mount(prompt);
    host.reply = view();
    btn(root, 'Allow notifications').click();
    await settle();
    expect(host.requests[0]).toEqual({ type: 'requestReminderPermission' });
    expect(root.querySelector('[role="status"]')!.textContent).toBe('Notifications are on.');
    expect(btn(root, 'Allow notifications')).toBeUndefined();

    const noHost = view({ status: { hostApi: false, permission: null, whenClosed: null, message: 'In-panel only.' } });
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    expect(btn(mount(noHost), 'Allow notifications')).toBeUndefined();
  });

  it('appears in the settings screen only when given', () => {
    const plan = { passages: [] } as never;
    const without = renderSettings(host as unknown as PanelHost, { defaultAnswerMode: 'firstLetter' }, plan);
    expect(without.textContent).not.toContain('Memory cards');
    const withIt = renderSettings(host as unknown as PanelHost, { defaultAnswerMode: 'firstLetter' }, plan, view());
    expect(withIt.textContent).toContain('Memory cards');
  });
});
