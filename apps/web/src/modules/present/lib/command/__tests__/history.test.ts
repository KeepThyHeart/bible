import { describe, expect, it } from 'vitest';
import { historyNewer, historyOlder, historyStart, pushHistory } from '../history';
import { commandSearch, type SearchItem } from '../commandSearch';

describe('pushHistory', () => {
  it('appends, de-duplicates to the end, ignores blanks and caps', () => {
    expect(pushHistory(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(pushHistory(['a', 'b'], 'a')).toEqual(['b', 'a']);
    expect(pushHistory(['a'], '  ')).toEqual(['a']);
    expect(pushHistory(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });
});

describe('history cursor', () => {
  const list = ['one', 'two', 'three'];
  it('walks back and returns to the draft', () => {
    let cur = historyStart(list, 'dra');
    let step = historyOlder(list, cur);
    expect(step.text).toBe('three');
    step = historyOlder(list, step.cursor);
    expect(step.text).toBe('two');
    step = historyOlder(list, historyOlder(list, step.cursor).cursor);
    expect(step.text).toBe('one');
    step = historyNewer(list, step.cursor);
    expect(step.text).toBe('two');
    step = historyNewer(list, historyNewer(list, step.cursor).cursor);
    expect(step.text).toBe('dra');
    cur = step.cursor;
    expect(historyNewer(list, cur).text).toBe('dra');
  });
});

describe('commandSearch store', () => {
  const items: SearchItem[] = [
    { kind: 'verse', key: 'a', verseId: 43003016, module: 'kjv', reference: 'John 3:16', text: 'x' },
    { kind: 'verse', key: 'b', verseId: 43003017, module: 'kjv', reference: 'John 3:17', text: 'y' },
  ];
  it('opens, selects with wraparound, activates through registered actions, closes', () => {
    const shown: string[] = [];
    commandSearch.registerActions({ show: i => shown.push(i.key) });
    commandSearch.open('grace');
    expect(commandSearch.query).toBe('grace');
    commandSearch.setItems(items);
    commandSearch.move(1);
    expect(commandSearch.selected).toBe(1);
    commandSearch.move(1);
    expect(commandSearch.selected).toBe(0);
    commandSearch.move(-1);
    expect(commandSearch.selected).toBe(1);
    expect(commandSearch.activate('show')).toBe(true);
    expect(shown).toEqual(['b']);
    expect(commandSearch.activate('notes')).toBe(false);
    commandSearch.close();
    expect(commandSearch.query).toBeNull();
    expect(commandSearch.items).toEqual([]);
    commandSearch.registerActions(null);
  });
});
