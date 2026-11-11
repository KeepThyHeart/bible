import { describe, expect, it } from 'vitest';

import { INITIAL_NAV, navReduce, sameView } from '../src/ui/state';
import type { Flow, NavAction, NavState } from '../src/ui/state';

const run = (actions: NavAction[], from: NavState = INITIAL_NAV): NavState => actions.reduce(navReduce, from);
const started = (id: string, flow: Flow = { kind: 'verse', passageId: 1 }): NavAction => ({
  type: 'sessionStarted', sessionId: id, passageId: 1, rung: 'blanks', flow,
});

describe('navReduce: tabs and focused screens', () => {
  it('starts on Today', () => {
    expect(INITIAL_NAV.view).toEqual({ name: 'today' });
  });

  it('a tab sets returnTo to itself; My verses reuses the last filter', () => {
    let s = run([{ type: 'goVerses', list: 7 }]);
    expect(s.view).toEqual({ name: 'verses', list: 7, highlight: undefined });
    s = run([{ type: 'goTab', tab: 'progress' }, { type: 'goTab', tab: 'verses' }], s);
    expect(s.view).toEqual({ name: 'verses', list: 7 });
    expect(s.returnTo).toEqual({ name: 'verses', list: 7 });
  });

  it('settings and cards return to Today', () => {
    for (const type of ['goSettings', 'goCard'] as const) {
      const s = run([{ type: 'goTab', tab: 'progress' }, { type }]);
      expect(s.returnTo).toEqual({ name: 'today' });
    }
  });

  it('a verse page returns to My verses with the current filter', () => {
    const s = run([{ type: 'goVerses', list: 'all' }, { type: 'goVerse', passageId: 3 }]);
    expect(s.view).toEqual({ name: 'verse', passageId: 3 });
    expect(s.returnTo).toEqual({ name: 'verses', list: 'all' });
    const back = navReduce(s, { type: 'leaveVerse' });
    expect(back.view).toEqual({ name: 'verses', list: 'all' });
    expect(back.returnTo).toEqual({ name: 'verses', list: 'all' });
  });

  it('a verse page opened from Settings closes back to Settings, which then returns to Today', () => {
    const s = run([{ type: 'goSettings' }, { type: 'goVerse', passageId: 3 }]);
    expect(s.returnTo).toEqual({ name: 'settings' });
    const back = navReduce(s, { type: 'leaveVerse' });
    expect(back.view).toEqual({ name: 'settings' });
    expect(back.returnTo).toEqual({ name: 'today' });
  });

  it('a verse page opened from Today or Progress closes back there', () => {
    expect(navReduce(run([{ type: 'goVerse', passageId: 3 }]), { type: 'leaveVerse' }).view).toEqual({ name: 'today' });
    const s = run([{ type: 'goTab', tab: 'progress' }, { type: 'goVerse', passageId: 3 }]);
    expect(navReduce(s, { type: 'leaveVerse' }).view).toEqual({ name: 'progress' });
  });

  it('My verses with a highlight is returned to without it', () => {
    const s = run([{ type: 'goVerses', list: 2, highlight: 9 }, { type: 'goVerse', passageId: 9 }]);
    expect(s.returnTo).toEqual({ name: 'verses', list: 2 });
  });

  it('a verse opened from another verse page keeps the first origin', () => {
    const s = run([{ type: 'goSettings' }, { type: 'goVerse', passageId: 3 }, { type: 'goVerse', passageId: 4 }]);
    expect(s.view).toEqual({ name: 'verse', passageId: 4 });
    expect(s.returnTo).toEqual({ name: 'settings' });
  });

  it('a verse opened from a transient screen falls back to My verses', () => {
    const s = run([{ type: 'goCard' }, { type: 'goVerse', passageId: 3 }]);
    expect(s.returnTo).toEqual({ name: 'verses', list: 'focus' });
  });

  it('leaveVerse off a verse page changes nothing', () => {
    expect(navReduce(INITIAL_NAV, { type: 'leaveVerse' })).toBe(INITIAL_NAV);
  });
});

describe('navReduce: sessions', () => {
  it.each([
    ['today', [] as NavAction[], { name: 'today' }],
    ['verses', [{ type: 'goVerses', list: 2 }] as NavAction[], { name: 'verses', list: 2 }],
    ['verse', [{ type: 'goVerse', passageId: 4 }] as NavAction[], { name: 'verse', passageId: 4 }],
    ['progress', [{ type: 'goTab', tab: 'progress' }] as NavAction[], { name: 'progress' }],
  ])('a session from %s returns there', (_n, pre, view) => {
    let s = run([...pre, started('s1')]);
    expect(s.view).toEqual({ name: 'practice', sessionId: 's1' });
    s = navReduce(s, { type: 'sessionEnded' });
    expect(s.view).toMatchObject(view);
  });

  it('Again / Continue keep the original return target and replace the flow', () => {
    const f2: Flow = { kind: 'today', skipped: [1] };
    let s = run([{ type: 'goVerse', passageId: 4 }, started('s1'), started('s2', f2)]);
    expect(s.flow).toEqual(f2);
    s = navReduce(s, { type: 'sessionEnded' });
    expect(s.view).toEqual({ name: 'verse', passageId: 4 });
  });

  it('Stop for today lands on Today', () => {
    const s = run([{ type: 'goVerses' }, started('s1'), { type: 'stopForToday' }]);
    expect(s.view).toEqual({ name: 'today' });
    expect(s.returnTo).toEqual({ name: 'today' });
  });

  it('sessionEnded and stopForToday outside practice change nothing', () => {
    expect(navReduce(INITIAL_NAV, { type: 'sessionEnded' })).toBe(INITIAL_NAV);
    expect(navReduce(INITIAL_NAV, { type: 'stopForToday' })).toBe(INITIAL_NAV);
  });
});

describe('navReduce: recite and removal', () => {
  it('recite returns to the launching verse page, Today otherwise', () => {
    let s = run([{ type: 'goVerse', passageId: 4 }, { type: 'reciteStarted', reciteId: 'a', mode: 'tap' }, { type: 'reciteEnded' }]);
    expect(s.view).toEqual({ name: 'verse', passageId: 4 });
    s = run([{ type: 'goTab', tab: 'progress' }, { type: 'reciteStarted', reciteId: 'a', mode: 'tap' }, { type: 'reciteEnded' }]);
    expect(s.view).toEqual({ name: 'today' });
  });

  it('a second recite keeps the return target', () => {
    const s = run([
      { type: 'reciteStarted', reciteId: 'a', mode: 'handsfree' },
      { type: 'reciteStarted', reciteId: 'b', mode: 'handsfree' },
      { type: 'reciteEnded' },
    ]);
    expect(s.view).toEqual({ name: 'today' });
  });

  it('removing the verse on screen goes back where it was opened from; other ids change nothing', () => {
    const on = run([{ type: 'goVerses', list: 2 }, { type: 'goVerse', passageId: 7 }]);
    expect(navReduce(on, { type: 'passageRemoved', passageId: 9 })).toBe(on);
    const s = navReduce(on, { type: 'passageRemoved', passageId: 7 });
    expect(s.view).toEqual({ name: 'verses', list: 2 });
    const fromSettings = run([{ type: 'goSettings' }, { type: 'goVerse', passageId: 7 }, { type: 'passageRemoved', passageId: 7 }]);
    expect(fromSettings.view).toEqual({ name: 'settings' });
    expect(fromSettings.returnTo).toEqual({ name: 'today' });
  });

  it('removing the verse behind a session repairs only the destination', () => {
    const s = navReduce(run([{ type: 'goVerse', passageId: 7 }, started('s1')]), { type: 'passageRemoved', passageId: 7 });
    expect(s.view).toEqual({ name: 'practice', sessionId: 's1' });
    expect(navReduce(s, { type: 'sessionEnded' }).view).toEqual({ name: 'verses', list: 'focus' });
  });

  it('removing the verse behind a recite repairs only the destination', () => {
    const s = run([{ type: 'goVerse', passageId: 7 }, { type: 'reciteStarted', reciteId: 'r1', mode: 'tap' }, { type: 'passageRemoved', passageId: 7 }]);
    expect(s.view.name).toBe('recite');
    expect(s.returnTo).toEqual({ name: 'verses', list: 'focus' });
  });

  it('closing a verse page after practice started from it goes to My verses, not nowhere', () => {
    const s = run([{ type: 'goTab', tab: 'today' }, { type: 'goVerse', passageId: 3 }, started('s1'), { type: 'sessionEnded' }]);
    expect(s.view).toEqual({ name: 'verse', passageId: 3 });
    expect(navReduce(s, { type: 'leaveVerse' }).view).toEqual({ name: 'verses', list: 'focus' });
  });
});

describe('sameView', () => {
  it('compares the fields that make a different screen', () => {
    expect(sameView({ name: 'today' }, { name: 'progress' })).toBe(false);
    expect(sameView({ name: 'verses', list: 1 }, { name: 'verses', list: 1, highlight: 4 })).toBe(true);
    expect(sameView({ name: 'verses', list: 1 }, { name: 'verses', list: 'all' })).toBe(false);
    expect(sameView({ name: 'verse', passageId: 1 }, { name: 'verse', passageId: 2 })).toBe(false);
    expect(sameView({ name: 'practice', sessionId: 'a' }, { name: 'practice', sessionId: 'b' })).toBe(false);
    expect(sameView({ name: 'recite', reciteId: 'a', mode: 'tap' }, { name: 'recite', reciteId: 'b', mode: 'tap' })).toBe(false);
  });
});
