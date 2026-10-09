import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appRegistry } from '../appHost';
import { evalAppWhen, evalVerseWhen } from '../verseActionWhen';
import { SlotOutlet, createSlot, decorateVerse } from '../slots';
import type { ReaderVerseContext, VerseDecorator } from '../slots';
import type { ComponentType } from 'preact';

afterEach(cleanup);

const ctx: ReaderVerseContext = {
  tabId: 't', moduleAbbr: 'KJV', book: 43, chapter: 3, verseId: 43003016, verse: 16, html: 'x', isActive: false,
};

describe('createSlot', () => {
  it('register / dispose / invalidate notify subscribers and bump the snapshot', () => {
    const slot = createSlot<string>();
    const fn = vi.fn();
    const off = slot.subscribe(fn);
    const v0 = slot.getSnapshot();
    const h = slot.register('a');
    expect(slot.list()).toEqual(['a']);
    expect(fn).toHaveBeenCalledTimes(1);
    slot.invalidate();
    expect(fn).toHaveBeenCalledTimes(2);
    h.dispose();
    h.dispose(); // idempotent
    expect(slot.list()).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(slot.getSnapshot()).toBe(v0 + 3);
    off();
    slot.register('b');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('decorateVerse', () => {
  it('returns undefined when nothing applies', () => {
    expect(decorateVerse([], ctx)).toBeUndefined();
    expect(decorateVerse([() => null, () => undefined, () => ({})], ctx)).toBeUndefined();
  });

  it('merges classes from all decorators; the first rail and text win', () => {
    const a: VerseDecorator = () => ({ classes: ['a1', 'a2'], rail: 'railA' });
    const b: VerseDecorator = () => ({ classes: ['b'], rail: 'railB', text: 'textB' });
    const c: VerseDecorator = () => ({ text: 'textC' });
    expect(decorateVerse([a, b, c], ctx)).toEqual({ classes: ['a1', 'a2', 'b'], rail: 'railA', text: 'textB' });
  });

  it('swallows a throwing decorator and keeps the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad: VerseDecorator = () => {
      throw new Error('boom');
    };
    const good: VerseDecorator = () => ({ classes: ['ok'] });
    expect(decorateVerse([bad, good], ctx)).toEqual({ classes: ['ok'], rail: undefined, text: undefined });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('SlotOutlet', () => {
  it('renders registered components and re-renders on register / dispose', () => {
    const slot = createSlot<ComponentType>();
    const A = () => <i data-testid="a">A</i>;
    const B = () => <i data-testid="b">B</i>;
    const { queryByTestId, container } = render(<SlotOutlet slot={slot} />);
    expect(container.innerHTML).toBe('');
    let ha!: { dispose(): void };
    act(() => {
      ha = slot.register(A);
    });
    expect(queryByTestId('a')).not.toBeNull();
    let hb!: { dispose(): void };
    act(() => {
      hb = slot.register(B);
    });
    expect(queryByTestId('b')).not.toBeNull();
    act(() => ha.dispose());
    expect(queryByTestId('a')).toBeNull();
    expect(queryByTestId('b')).not.toBeNull();
    act(() => hb.dispose());
    expect(container.innerHTML).toBe('');
  });
});

describe('when evaluators: generic <id>.live', () => {
  afterEach(() => {
    appRegistry.setBusy('present', false);
    appRegistry.setBusy('quiz', false);
  });

  it('<id>.live follows that app\'s busy flag for any app id', () => {
    appRegistry.register(
      { id: 'quiz', title: { key: 'q', fallback: 'Q' }, icon: { kind: 'builtin', name: 'x' }, lifecycle: { keepAlive: 'while-busy', restore: 'default' } },
      { kind: 'builtin', moduleId: 'quiz' },
    );
    expect(evalVerseWhen('quiz.live')).toBe(false);
    appRegistry.setBusy('quiz', true);
    expect(evalVerseWhen('quiz.live')).toBe(true);
    expect(evalVerseWhen('!quiz.live')).toBe(false);
  });

  it('an app that is not registered is never live; unknown keys: verse false, app true', () => {
    expect(evalVerseWhen('ghost.live')).toBe(false);
    expect(evalVerseWhen('whatever')).toBe(false);
    expect(evalAppWhen('whatever')).toBe(true);
  });
});
