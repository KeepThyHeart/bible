import { describe, expect, it } from 'vitest';

import { INITIAL_NAV, isTabRoot, navReduce, rootTab, sameView } from '../src/ui/state';
import type { Flow, NavAction, NavState } from '../src/ui/state';

const run = (actions: NavAction[], from: NavState = INITIAL_NAV): NavState => actions.reduce(navReduce, from);
const started = (id: string, flow: Flow = { kind: 'verse', passageId: 1 }): NavAction => ({
  type: 'sessionStarted', sessionId: id, passageId: 1, rung: 'blanks', flow,
});

describe('navReduce: tabs and opened screens', () => {
  it('starts on Home', () => {
    expect(INITIAL_NAV.view).toEqual({ name: 'home' });
    expect(INITIAL_NAV.tab).toBe('home');
  });

  it('each tab has its root view', () => {
    expect(run([{ type: 'goTab', tab: 'practice' }]).view).toEqual({ name: 'queue' });
    expect(run([{ type: 'goTab', tab: 'settings' }]).view).toEqual({ name: 'settings', listId: null });
    expect(run([{ type: 'goTab', tab: 'verses' }]).view).toEqual({ name: 'verses', list: 'all' });
    expect(run([{ type: 'goTab', tab: 'practice' }, { type: 'goTab', tab: 'home' }]).view).toEqual({ name: 'home' });
  });

  it('a tab sets returnTo to itself; My verses reuses the last filter', () => {
    let s = run([{ type: 'goVerses', list: 7 }]);
    expect(s.view).toEqual({ name: 'verses', list: 7, highlight: undefined });
    s = run([{ type: 'goTab', tab: 'practice' }, { type: 'goTab', tab: 'verses' }], s);
    expect(s.view).toEqual({ name: 'verses', list: 7 });
    expect(s.returnTo).toEqual({ name: 'verses', list: 7 });
  });

  it('Settings is a tab (returns to itself); its list selection is kept', () => {
    let s = run([{ type: 'goLists', listId: 4 }]);
    expect(s.view).toEqual({ name: 'settings', listId: 4 });
    expect(s.returnTo).toEqual({ name: 'settings', listId: 4 });
    expect(s.tab).toBe('settings');
    s = run([{ type: 'goTab', tab: 'home' }, { type: 'goTab', tab: 'settings' }], s);
    expect(s.view).toEqual({ name: 'settings', listId: 4 });
    expect(run([{ type: 'goSettings' }], s).view).toEqual({ name: 'settings', listId: 4 });
  });

  it('cards show under Home and return to Home', () => {
    const s = run([{ type: 'goTab', tab: 'verses' }, { type: 'goCard' }]);
    expect(s.returnTo).toEqual({ name: 'home' });
    expect(s.tab).toBe('home');
  });

  it('a verse page returns to My verses with the current filter', () => {
    const s = run([{ type: 'goVerses', list: 'all' }, { type: 'goVerse', passageId: 3 }]);
    expect(s.view).toEqual({ name: 'verse', passageId: 3 });
    expect(s.returnTo).toEqual({ name: 'verses', list: 'all' });
    expect(s.tab).toBe('verses');
    const back = navReduce(s, { type: 'leaveVerse' });
    expect(back.view).toEqual({ name: 'verses', list: 'all' });
    expect(back.returnTo).toEqual({ name: 'verses', list: 'all' });
  });

  it('a verse page opened from Settings shows under Settings and closes back there', () => {
    const s = run([{ type: 'goSettings' }, { type: 'goVerse', passageId: 3 }]);
    expect(s.returnTo).toEqual({ name: 'settings', listId: null });
    expect(s.tab).toBe('settings');
    const back = navReduce(s, { type: 'leaveVerse' });
    expect(back.view).toEqual({ name: 'settings', listId: null });
    expect(back.returnTo).toEqual({ name: 'settings', listId: null });
  });

  it('a verse page opened from Home or Practice closes back there', () => {
    expect(navReduce(run([{ type: 'goVerse', passageId: 3 }]), { type: 'leaveVerse' }).view).toEqual({ name: 'home' });
    const s = run([{ type: 'goTab', tab: 'practice' }, { type: 'goVerse', passageId: 3 }]);
    expect(s.tab).toBe('practice');
    expect(navReduce(s, { type: 'leaveVerse' }).view).toEqual({ name: 'queue' });
  });

  it('My verses with a highlight is returned to without it', () => {
    const s = run([{ type: 'goVerses', list: 2, highlight: 9 }, { type: 'goVerse', passageId: 9 }]);
    expect(s.returnTo).toEqual({ name: 'verses', list: 2 });
  });

  it('a verse opened from another verse page keeps the first origin', () => {
    const s = run([{ type: 'goSettings' }, { type: 'goVerse', passageId: 3 }, { type: 'goVerse', passageId: 4 }]);
    expect(s.view).toEqual({ name: 'verse', passageId: 4 });
    expect(s.returnTo).toEqual({ name: 'settings', listId: null });
  });

  it('a verse opened from a transient screen falls back to My verses', () => {
    const s = run([{ type: 'goCard' }, { type: 'goVerse', passageId: 3 }]);
    expect(s.returnTo).toEqual({ name: 'verses', list: 'all' });
  });

  it('leaveVerse off a verse page changes nothing', () => {
    expect(navReduce(INITIAL_NAV, { type: 'leaveVerse' })).toBe(INITIAL_NAV);
  });
});

describe('navReduce: starter sets', () => {
  it('opens under the current tab and goes back to where it was opened from', () => {
    let s = run([{ type: 'goTab', tab: 'settings' }, { type: 'goStarters' }]);
    expect(s.view).toEqual({ name: 'starters', key: null });
    expect(s.tab).toBe('settings');
    s = navReduce(s, { type: 'goStarters', key: 'psalm-23' });
    expect(s.view).toEqual({ name: 'starters', key: 'psalm-23' });
    expect(s.returnTo).toEqual({ name: 'settings', listId: null });
    s = navReduce(s, { type: 'leaveStarters' });
    expect(s.view).toEqual({ name: 'settings', listId: null });
  });

  it('from Home, Home stays selected', () => {
    const s = run([{ type: 'goStarters' }]);
    expect(s.tab).toBe('home');
    expect(navReduce(s, { type: 'leaveStarters' }).view).toEqual({ name: 'home' });
  });

  it('a verse opened from the starter sets returns to their origin', () => {
    const s = run([{ type: 'goTab', tab: 'verses' }, { type: 'goStarters' }, { type: 'goVerse', passageId: 2 }]);
    expect(s.returnTo).toEqual({ name: 'verses', list: 'all' });
  });

  it('leaveStarters elsewhere changes nothing', () => {
    expect(navReduce(INITIAL_NAV, { type: 'leaveStarters' })).toBe(INITIAL_NAV);
  });
});

describe('navReduce: sessions', () => {
  it.each([
    ['home', [] as NavAction[], { name: 'home' }, 'home'],
    ['practice', [{ type: 'goTab', tab: 'practice' }] as NavAction[], { name: 'queue' }, 'practice'],
    ['verses', [{ type: 'goVerses', list: 2 }] as NavAction[], { name: 'verses', list: 2 }, 'verses'],
    ['verse', [{ type: 'goVerses', list: 2 }, { type: 'goVerse', passageId: 4 }] as NavAction[], { name: 'verse', passageId: 4 }, 'verses'],
    ['settings', [{ type: 'goTab', tab: 'settings' }] as NavAction[], { name: 'settings', listId: null }, 'settings'],
  ])('a session from %s keeps that tab and returns there', (_n, pre, view, tab) => {
    let s = run([...pre, started('s1')]);
    expect(s.view).toEqual({ name: 'practice', sessionId: 's1' });
    expect(s.tab).toBe(tab);
    s = navReduce(s, { type: 'sessionEnded' });
    expect(s.view).toMatchObject(view);
    expect(s.tab).toBe(tab);
  });

  it('a session from the cards returns to Home', () => {
    const s = run([{ type: 'goCard' }, started('s1'), { type: 'sessionEnded' }]);
    expect(s.view).toEqual({ name: 'home' });
  });

  it('Again / Continue keep the original return target and replace the flow', () => {
    const f2: Flow = { kind: 'today', skipped: [1] };
    let s = run([{ type: 'goVerse', passageId: 4 }, started('s1'), started('s2', f2)]);
    expect(s.flow).toEqual(f2);
    s = navReduce(s, { type: 'sessionEnded' });
    expect(s.view).toEqual({ name: 'verse', passageId: 4 });
  });

  it('Stop for today goes back to where practice started', () => {
    const s = run([{ type: 'goVerses' }, started('s1'), { type: 'stopForToday' }]);
    expect(s.view).toEqual({ name: 'verses', list: 'all' });
    expect(s.returnTo).toEqual({ name: 'verses', list: 'all' });
  });

  it('a tab during a session leaves it for that tab', () => {
    const s = run([{ type: 'goTab', tab: 'practice' }, started('s1'), { type: 'goTab', tab: 'verses' }]);
    expect(s.view).toEqual({ name: 'verses', list: 'all' });
    expect(s.tab).toBe('verses');
  });

  it('sessionEnded and stopForToday outside practice change nothing', () => {
    expect(navReduce(INITIAL_NAV, { type: 'sessionEnded' })).toBe(INITIAL_NAV);
    expect(navReduce(INITIAL_NAV, { type: 'stopForToday' })).toBe(INITIAL_NAV);
  });
});

describe('navReduce: recite and removal', () => {
  it('recite returns to the launching screen; from the cards, to Home', () => {
    let s = run([{ type: 'goVerse', passageId: 4 }, { type: 'reciteStarted', reciteId: 'a', mode: 'tap' }, { type: 'reciteEnded' }]);
    expect(s.view).toEqual({ name: 'verse', passageId: 4 });
    s = run([{ type: 'goTab', tab: 'practice' }, { type: 'reciteStarted', reciteId: 'a', mode: 'tap' }, { type: 'reciteEnded' }]);
    expect(s.view).toEqual({ name: 'queue' });
    s = run([{ type: 'goCard' }, { type: 'reciteStarted', reciteId: 'a', mode: 'tap' }, { type: 'reciteEnded' }]);
    expect(s.view).toEqual({ name: 'home' });
  });

  it('a second recite keeps the return target', () => {
    const s = run([
      { type: 'reciteStarted', reciteId: 'a', mode: 'handsfree' },
      { type: 'reciteStarted', reciteId: 'b', mode: 'handsfree' },
      { type: 'reciteEnded' },
    ]);
    expect(s.view).toEqual({ name: 'home' });
  });

  it('removing the verse on screen goes back where it was opened from; other ids change nothing', () => {
    const on = run([{ type: 'goVerses', list: 2 }, { type: 'goVerse', passageId: 7 }]);
    expect(navReduce(on, { type: 'passageRemoved', passageId: 9 })).toBe(on);
    const s = navReduce(on, { type: 'passageRemoved', passageId: 7 });
    expect(s.view).toEqual({ name: 'verses', list: 2 });
    const fromSettings = run([{ type: 'goSettings' }, { type: 'goVerse', passageId: 7 }, { type: 'passageRemoved', passageId: 7 }]);
    expect(fromSettings.view).toEqual({ name: 'settings', listId: null });
    expect(fromSettings.returnTo).toEqual({ name: 'settings', listId: null });
  });

  it('removing the verse behind a session repairs only the destination', () => {
    const s = navReduce(run([{ type: 'goVerse', passageId: 7 }, started('s1')]), { type: 'passageRemoved', passageId: 7 });
    expect(s.view).toEqual({ name: 'practice', sessionId: 's1' });
    expect(navReduce(s, { type: 'sessionEnded' }).view).toEqual({ name: 'verses', list: 'all' });
  });

  it('removing the verse behind a recite repairs only the destination', () => {
    const s = run([{ type: 'goVerse', passageId: 7 }, { type: 'reciteStarted', reciteId: 'r1', mode: 'tap' }, { type: 'passageRemoved', passageId: 7 }]);
    expect(s.view.name).toBe('recite');
    expect(s.returnTo).toEqual({ name: 'verses', list: 'all' });
  });

  it('closing a verse page after practice started from it goes to My verses, not nowhere', () => {
    const s = run([{ type: 'goTab', tab: 'practice' }, { type: 'goVerse', passageId: 3 }, started('s1'), { type: 'sessionEnded' }]);
    expect(s.view).toEqual({ name: 'verse', passageId: 3 });
    expect(navReduce(s, { type: 'leaveVerse' }).view).toEqual({ name: 'verses', list: 'all' });
  });
});

describe('rootTab / isTabRoot', () => {
  it('maps the tab roots and leaves opened screens to the selected tab', () => {
    expect(rootTab({ name: 'home' })).toBe('home');
    expect(rootTab({ name: 'card' })).toBe('home');
    expect(rootTab({ name: 'queue' })).toBe('practice');
    expect(rootTab({ name: 'verses', list: 'all' })).toBe('verses');
    expect(rootTab({ name: 'settings', listId: null })).toBe('settings');
    expect(rootTab({ name: 'verse', passageId: 1 })).toBeNull();
    expect(rootTab({ name: 'starters', key: null })).toBeNull();
    expect(isTabRoot({ name: 'queue' })).toBe(true);
    expect(isTabRoot({ name: 'card' })).toBe(false);
  });
});

describe('sameView', () => {
  it('compares the fields that make a different screen', () => {
    expect(sameView({ name: 'home' }, { name: 'queue' })).toBe(false);
    expect(sameView({ name: 'verses', list: 1 }, { name: 'verses', list: 1, highlight: 4 })).toBe(true);
    expect(sameView({ name: 'verses', list: 1 }, { name: 'verses', list: 'all' })).toBe(false);
    expect(sameView({ name: 'settings', listId: 1 }, { name: 'settings', listId: 2 })).toBe(false);
    expect(sameView({ name: 'starters', key: 'a' }, { name: 'starters', key: null })).toBe(false);
    expect(sameView({ name: 'verse', passageId: 1 }, { name: 'verse', passageId: 2 })).toBe(false);
    expect(sameView({ name: 'practice', sessionId: 'a' }, { name: 'practice', sessionId: 'b' })).toBe(false);
    expect(sameView({ name: 'recite', reciteId: 'a', mode: 'tap' }, { name: 'recite', reciteId: 'b', mode: 'tap' })).toBe(false);
  });
});
