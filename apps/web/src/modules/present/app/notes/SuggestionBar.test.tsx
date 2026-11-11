import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/preact';
import type { NotesSuggestion } from './types';

/** Tiny ICU stand-in: `{n, plural, one {...} other {...}}` with `#`, and `{name}`. */
function format(text: string, params: Record<string, unknown> = {}): string {
  return text
    .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_m, k, one, other) =>
      (Number(params[k]) === 1 ? one : other).replace('#', String(params[k])))
    .replace(/\{(\w+)\}/g, (_m, k) => String(params[k] ?? ''));
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, o?: Record<string, unknown>) => format(String(o?.defaultValue ?? _key), o) }),
}));

const fake = vi.hoisted(() => ({ store: null as any }));
vi.mock('./notesStore', async () => {
  const { Store } = await vi.importActual<typeof import('../../../../stores/Store')>('../../../../stores/Store');
  const suggestionKey = (list: NotesSuggestion[]) => list.map((x) => x.id).join('\n'); // as notesStore's
  class FakeNotes extends Store {
    detection: { items: unknown[]; suggestions: NotesSuggestion[] } = { items: [], suggestions: [] };
    dismissedSuggestions: string | null = null;
    acceptSuggestion = vi.fn();
    skipSuggestion = vi.fn();
    revealSuggestion = vi.fn();
    get suggestions() { return this.detection.suggestions; }
    get itemCount() { return this.detection.items.length; }
    get suggestionsDismissed() { return this.dismissedSuggestions === suggestionKey(this.suggestions); }
    dismissSuggestions() { this.dismissedSuggestions = suggestionKey(this.suggestions); this.notify(); }
    suggestionText(id: string) { return this.suggestions.find((s) => s.id === id)?.label ?? ''; }
    set(items: number, suggestions: NotesSuggestion[]) { this.detection = { items: Array(items).fill({}), suggestions }; this.notify(); }
  }
  fake.store = new FakeNotes();
  return { notesStore: fake.store };
});

import { SuggestionBar, truncate } from './SuggestionBar';

const hymn: NotesSuggestion = { id: 's1', blockId: 'b1', blockPos: 0, from: 9, to: 22, kind: 'hymn', label: 'Amazing Grace', item: { kind: 'hymn', hymnId: 'h1' } };
const quote: NotesSuggestion = { id: 's2', blockId: 'b2', blockPos: 30, from: 0, to: 40, kind: 'quote', label: '“Faith is taking the first step”', item: { kind: 'quote', text: 'Faith is taking the first step' } };

beforeEach(() => {
  fake.store.dismissedSuggestions = null;
  fake.store.set(0, []);
  vi.clearAllMocks();
});

describe('SuggestionBar', () => {
  it('shows nothing (but keeps the live region) without suggestions', () => {
    const { container } = render(<SuggestionBar />);
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
    expect(container.querySelector('button')).toBeNull();
  });

  it('counts items and lines to check, and lists each suggestion when opened', async () => {
    fake.store.set(5, [hymn, quote]);
    const { container, getByText } = render(<SuggestionBar />);
    expect(container.querySelector('[role="status"]')!.textContent).toBe('5 items found. 2 lines to check.');
    expect(container.querySelector('.pn-suggest__list')).toBeNull();
    await act(async () => { fireEvent.click(getByText('Review')); });
    const rows = container.querySelectorAll('.pn-suggest__row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.pn-suggest__accept')!.textContent).toBe('Hymn: Amazing Grace');
    expect(rows[1].querySelector('.pn-suggest__accept')!.textContent).toBe('Quote');
    fireEvent.click(rows[0].querySelector('.pn-suggest__accept')!);
    expect(fake.store.acceptSuggestion).toHaveBeenCalledWith('s1');
    fireEvent.click(rows[1].querySelector('.pn-suggest__skip')!);
    expect(fake.store.skipSuggestion).toHaveBeenCalledWith('s2');
    fireEvent.click(rows[0].querySelector('.pn-suggest__text')!);
    expect(fake.store.revealSuggestion).toHaveBeenCalledWith('s1');
  });

  it('uses singular wording for one', () => {
    fake.store.set(1, [hymn]);
    const { container } = render(<SuggestionBar />);
    expect(container.querySelector('[role="status"]')!.textContent).toBe('1 item found. 1 line to check.');
  });

  it('dismiss hides the bar until the set of suggestions changes', async () => {
    fake.store.set(2, [hymn]);
    const { container, getByText } = render(<SuggestionBar />);
    await act(async () => { fireEvent.click(getByText('Dismiss')); });
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
    await act(async () => { fake.store.set(3, [hymn]); }); // same set: still hidden
    expect(container.querySelector('button')).toBeNull();
    await act(async () => { fake.store.set(3, [hymn, quote]); });
    expect(container.querySelector('[role="status"]')!.textContent).toBe('3 items found. 2 lines to check.');
  });

  it('truncates long text with an ellipsis', () => {
    expect(truncate('a  b\nc')).toBe('a b c');
    expect(truncate('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
