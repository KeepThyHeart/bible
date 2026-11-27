/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryApi } from '../src/core/api';
import { englishTranslate } from '../src/core/messages';
import { openAddToMemoryDialog } from '../src/ui/addToMemoryDialog';

const LISTS = [
  { id: 1, name: 'Default', passageCount: 0, verseCount: 0 },
  { id: 2, name: 'Romans', passageCount: 0, verseCount: 0 },
];

function makeApi(over: Record<string, unknown> = {}): { api: MemoryApi; addVerses: ReturnType<typeof vi.fn>; getAddTargets: ReturnType<typeof vi.fn> } {
  const getAddTargets = vi.fn().mockResolvedValue({ lists: LISTS, lastListId: 2, defaultListId: 1, reference: 'John 3:16', existingIn: [1], ...over });
  const addVerses = vi.fn().mockResolvedValue({ outcome: 'added', passageId: 9, reference: 'John 3:16', collectionId: 2, listName: 'Romans' });
  return { api: { getAddTargets, addVerses } as unknown as MemoryApi, addVerses, getAddTargets };
}

const select = () => document.querySelector('select') as HTMLSelectElement;
const btn = (label: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
const key = (target: Element, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('openAddToMemoryDialog', () => {
  it('shows the title, preselects the last chosen list and labels lists already holding the verse', async () => {
    const { api } = makeApi();
    const p = openAddToMemoryDialog({ api, verseIds: [43003016], t: englishTranslate });
    await vi.waitFor(() => expect(select()).toBeTruthy());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add John 3:16 to Memory');
    expect(select().value).toBe('2');
    expect(Array.from(select().options).map((o) => o.textContent)).toEqual(['Default (already there)', 'Romans', 'New list...']);
    btn('Cancel').click();
    expect(await p).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('falls back to the default list when none was chosen last, and Enter adds', async () => {
    const { api, addVerses } = makeApi({ lastListId: null });
    const p = openAddToMemoryDialog({ api, verseIds: [43003016], module: 'kjv', t: englishTranslate });
    await vi.waitFor(() => expect(select()).toBeTruthy());
    expect(select().value).toBe('1');
    key(select(), 'Enter');
    const r = await p;
    expect(addVerses).toHaveBeenCalledWith({ verseIds: [43003016], module: 'kjv', collectionId: 1 });
    expect(r?.passageId).toBe(9);
  });

  it('creates a new list on the spot and refuses an empty name', async () => {
    const { api, addVerses } = makeApi();
    const p = openAddToMemoryDialog({ api, verseIds: [1], t: englishTranslate });
    await vi.waitFor(() => expect(select()).toBeTruthy());
    select().value = 'new';
    select().dispatchEvent(new Event('change'));
    btn('Add').click();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Give the new list a name.');
    expect(addVerses).not.toHaveBeenCalled();
    const input = document.querySelector('input') as HTMLInputElement;
    input.value = '  Hope ';
    btn('Add').click();
    await p;
    expect(addVerses).toHaveBeenCalledWith({ verseIds: [1], module: undefined, newListName: 'Hope' });
  });

  it('Escape cancels', async () => {
    const { api, addVerses } = makeApi();
    const p = openAddToMemoryDialog({ api, verseIds: [1], t: englishTranslate });
    await vi.waitFor(() => expect(select()).toBeTruthy());
    key(select(), 'Escape');
    expect(await p).toBeNull();
    expect(addVerses).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and says the new list was kept when the add fails', async () => {
    const { api, addVerses, getAddTargets } = makeApi();
    addVerses.mockRejectedValueOnce(new Error('boom'));
    const p = openAddToMemoryDialog({ api, verseIds: [1], t: englishTranslate });
    await vi.waitFor(() => expect(select()).toBeTruthy());
    select().value = 'new';
    select().dispatchEvent(new Event('change'));
    (document.querySelector('input') as HTMLInputElement).value = 'Hope';
    getAddTargets.mockResolvedValueOnce({ lists: [...LISTS, { id: 3, name: 'Hope', passageCount: 0, verseCount: 0 }], lastListId: 2, defaultListId: 1, reference: 'x', existingIn: [] });
    btn('Add').click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('"Hope" was created'));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('boom');
    btn('Cancel').click();
    expect(await p).toBeNull();
  });
});
