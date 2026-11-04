import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// A tiny i18n stand-in: a mutable string table plus the `on`/`off` events the real instance emits.
const table: Record<string, string> = {};
const bus = new EventEmitter();
vi.mock('../../i18n', () => ({
  default: {
    t: (k: string) => table[k] ?? k,
    on: (e: string, fn: () => void) => bus.on(e, fn),
    off: (e: string, fn: () => void) => bus.off(e, fn),
    language: 'en',
  },
}));
vi.mock('../../stores/bibleStore', () => ({ bibleStore: { navigateTo: vi.fn(), getVerseOfTheDay: vi.fn(async () => null) } }));

import { createWebReminderHost } from './webReminders';

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(table)) delete table[k];
});

describe('web reminder host locale refresh (W-049)', () => {
  it('republishes source labels when the catalog arrives after start', async () => {
    const host = createWebReminderHost();
    await host.start();
    const label = () => host.store.getSnapshot().sources.find((s) => s.id === 'app:verse-of-the-day')?.label;
    expect(label()).toBe('notifications.votd.label'); // catalog not loaded yet
    table['notifications.votd.label'] = 'Versículo del día';
    bus.emit('added');
    expect(label()).toBe('Versículo del día');
    table['notifications.votd.label'] = '每日经文';
    bus.emit('languageChanged');
    expect(label()).toBe('每日经文');
    host.stop();
    expect(bus.listenerCount('added')).toBe(0);
  });
});
