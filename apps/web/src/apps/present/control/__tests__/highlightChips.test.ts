import { describe, it, expect, vi } from 'vitest';

// The key mapping imports the shortcut hook's module, which reaches i18n.
vi.mock('../../../../i18n', () => ({ default: {} }));

import type { NoteHighlight } from '../../notes/types';
import { buildChips, nextChip } from '../highlightChips';
import { planTarget, resolvePresenterKey } from '../presenterKeys';

const hl = (id: string, blockPos: number, from: number, extra: Partial<NoteHighlight> = {}): NoteHighlight => ({
  id, blockPos, from, to: from + 3, text: id, itemId: 'i1',
  range: { verseIdStart: 43003016, textStart: from, textEnd: from + 1 }, status: 'ok', source: 'detected', ...extra,
});

describe('highlight chips', () => {
  const list = [hl('b', 4, 0), hl('a', 2, 5), hl('amber', 3, 0, { status: 'choose', range: null }), hl('c', 4, 9)];

  it('orders by document position', () => {
    expect(buildChips(list, []).map(c => c.id)).toEqual(['a', 'amber', 'b', 'c']);
  });

  it('reveals in order, skipping unrevealable and shown ones', () => {
    let on: NoteHighlight['range'][] = [];
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      const chip = nextChip(buildChips(list, on as any));
      if (!chip) break;
      order.push(chip.id);
      on = [...on, chip.range];
    }
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('marks chips already on the wall', () => {
    const chips = buildChips(list, [list[1].range!]);
    expect(chips.find(c => c.id === 'a')?.shown).toBe(true);
    expect(chips.find(c => c.id === 'b')?.shown).toBe(false);
  });
});

describe('presenter keys', () => {
  const key = (k: string, extra = {}) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false, ...extra });
  const ctx = { live: false, acceptClickerKeys: true, hasLive: true };

  it('maps the presenter keys', () => {
    expect(resolvePresenterKey(key('h'), ctx)).toEqual({ type: 'revealHighlight' });
    expect(resolvePresenterKey(key('X'), ctx)).toEqual({ type: 'clearHighlights' });
    expect(resolvePresenterKey(key('n'), ctx)).toEqual({ type: 'planItem', direction: 'next' });
    expect(resolvePresenterKey(key('N', { shiftKey: true }), ctx)).toEqual({ type: 'planItem', direction: 'previous' });
    expect(resolvePresenterKey(key('?', { shiftKey: true }), ctx)).toEqual({ type: 'help' });
  });

  it('answers the clicker keys only before going live', () => {
    expect(resolvePresenterKey(key('ArrowRight'), ctx)).toEqual({ type: 'step', direction: 'next' });
    expect(resolvePresenterKey(key('.'), ctx)).toEqual({ type: 'toggleBlank' });
    expect(resolvePresenterKey(key('ArrowRight'), { ...ctx, live: true })).toBeNull();
  });

  it('ignores modified keys', () => {
    expect(resolvePresenterKey(key('h', { ctrlKey: true }), ctx)).toBeNull();
  });

  it('plans the N / Shift+N target', () => {
    const ids = ['a', 'b', 'c'];
    expect(planTarget(ids, null, 'next')).toBe('a');
    expect(planTarget(ids, 'a', 'next')).toBe('b');
    expect(planTarget(ids, 'c', 'next')).toBeNull();
    expect(planTarget(ids, 'a', 'previous')).toBeNull();
    expect(planTarget([], 'a', 'next')).toBeNull();
  });
});
