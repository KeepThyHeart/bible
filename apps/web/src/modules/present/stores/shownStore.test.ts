import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PresentItem } from '../lib/protocol';

vi.mock('../study/usePresenter', () => ({
  describeItem: (item: PresentItem) => (item.kind === 'quote' ? `“${item.text}”` : item.kind === 'hymn' ? item.hymnId : 'ref'),
}));

import { shownStore } from './shownStore';

const q = (text: string): PresentItem => ({ kind: 'quote', text } as PresentItem);

beforeEach(() => shownStore.clear());

describe('shownStore', () => {
  it('records newest first and de-duplicates by item', () => {
    shownStore.record(q('a'));
    shownStore.record(q('b'));
    shownStore.record(q('a'));
    expect(shownStore.items.map((e) => e.label)).toEqual(['“a”', '“b”']);
  });
  it('caps at 20', () => {
    for (let i = 0; i < 25; i++) shownStore.record(q(String(i)));
    expect(shownStore.items).toHaveLength(20);
    expect(shownStore.items[0].item).toEqual(q('24'));
  });
  it('uses a given label, removes, clears, and notifies', () => {
    const fn = vi.fn();
    const off = shownStore.subscribe(fn);
    shownStore.record(q('a'), 'Mine');
    expect(shownStore.items[0].label).toBe('Mine');
    shownStore.remove(shownStore.items[0].id);
    expect(shownStore.items).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });
});
