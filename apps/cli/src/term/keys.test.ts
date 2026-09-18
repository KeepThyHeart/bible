/**
 * Key decoding.
 *
 * Every key named in the acceptance criteria has a case here, in the sequence
 * an actual terminal sends. The `pending` tests matter most: they are the ones
 * that stop a chunk boundary in the middle of an escape sequence from being
 * decoded as `escape` followed by garbage, which is the classic bug in
 * hand-rolled terminal input.
 */
import { describe, expect, test } from 'bun:test';

import { type Key, decodeKeys, describeKey, flushPending } from './keys';

const only = (input: string): Key => {
  const { keys, pending } = decodeKeys(input);
  expect(pending).toBe('');
  expect(keys).toHaveLength(1);
  return keys[0]!;
};

const named = (input: string): string => describeKey(only(input));

describe('arrows', () => {
  test('plain', () => {
    expect(named('\x1b[A')).toBe('up');
    expect(named('\x1b[B')).toBe('down');
    expect(named('\x1b[C')).toBe('right');
    expect(named('\x1b[D')).toBe('left');
  });

  test('application mode (SS3) — what many terminals send once in raw mode', () => {
    expect(named('\x1bOA')).toBe('up');
    expect(named('\x1bOB')).toBe('down');
  });

  test('shift+up / shift+down — the keys that extend a selection', () => {
    expect(named('\x1b[1;2A')).toBe('shift+up');
    expect(named('\x1b[1;2B')).toBe('shift+down');
  });

  test('ctrl and alt modifiers', () => {
    expect(named('\x1b[1;5A')).toBe('ctrl+up');
    expect(named('\x1b[1;3A')).toBe('alt+up');
    expect(named('\x1b[1;6A')).toBe('ctrl+shift+up');
    expect(named('\x1b[1;7A')).toBe('ctrl+alt+up');
  });
});

describe('paging and editing keys', () => {
  test('page up and page down', () => {
    expect(named('\x1b[5~')).toBe('pageup');
    expect(named('\x1b[6~')).toBe('pagedown');
  });

  test('ctrl+pgup / ctrl+pgdn — the fallback tab keys', () => {
    expect(named('\x1b[5;5~')).toBe('ctrl+pageup');
    expect(named('\x1b[6;5~')).toBe('ctrl+pagedown');
  });

  test('home, end, insert, delete', () => {
    expect(named('\x1b[H')).toBe('home');
    expect(named('\x1b[F')).toBe('end');
    expect(named('\x1b[2~')).toBe('insert');
    expect(named('\x1b[3~')).toBe('delete');
    expect(named('\x1bOH')).toBe('home');
  });
});

describe('function keys', () => {
  test('F1 and F2 via SS3', () => {
    expect(named('\x1bOP')).toBe('f1');
    expect(named('\x1bOQ')).toBe('f2');
  });

  test('F1 and F2 via CSI tilde', () => {
    expect(named('\x1b[11~')).toBe('f1');
    expect(named('\x1b[12~')).toBe('f2');
  });

  test('F5 through F12', () => {
    expect(named('\x1b[15~')).toBe('f5');
    expect(named('\x1b[24~')).toBe('f12');
  });

  test('Linux console spells F1 as ESC [ [ A', () => {
    expect(named('\x1b[[A')).toBe('f1');
    expect(named('\x1b[[E')).toBe('f5');
  });
});

describe('alt combinations', () => {
  test('alt+digit — the tab keys, where terminals disagree most', () => {
    expect(named('\x1b1')).toBe('alt+1');
    expect(named('\x1b9')).toBe('alt+9');
  });

  test('alt+letter', () => {
    expect(named('\x1bn')).toBe('alt+n');
    expect(named('\x1bw')).toBe('alt+w');
  });

  test('alt+enter', () => {
    expect(named('\x1b\r')).toBe('alt+enter');
  });
});

describe('plain keys', () => {
  test('enter, tab, backspace, space', () => {
    expect(named('\r')).toBe('enter');
    expect(named('\n')).toBe('enter');
    expect(named('\t')).toBe('tab');
    expect(named('\x7f')).toBe('backspace');
    expect(named(' ')).toBe('space');
  });

  test('shift+tab', () => {
    expect(named('\x1b[Z')).toBe('shift+backtab');
  });

  test('printable characters', () => {
    const k = only('a');
    expect(k.name).toBe('char');
    expect(k.char).toBe('a');
  });

  test('ctrl+letter', () => {
    expect(named('\x03')).toBe('ctrl+c');
    expect(named('\x01')).toBe('ctrl+a');
  });

  test('a non-ASCII character is kept as one key, not split into bytes', () => {
    const k = only('θ');
    expect(k.name).toBe('char');
    expect(k.char).toBe('θ');
  });

  test('an astral character is not split in half', () => {
    const k = only('𝕏');
    expect(k.char).toBe('𝕏');
  });
});

describe('typed input', () => {
  test('a run of characters decodes in order', () => {
    const { keys } = decodeKeys('jo 3:16');
    expect(keys.map((k) => k.char ?? k.name).join('')).toBe('jo 3:16');
    expect(keys[2]?.name).toBe('space');
  });
});

describe('incomplete sequences', () => {
  test('a lone ESC is held, not guessed', () => {
    const { keys, pending } = decodeKeys('\x1b');
    expect(keys).toHaveLength(0);
    expect(pending).toBe('\x1b');
  });

  test('a truncated CSI is held', () => {
    expect(decodeKeys('\x1b[').pending).toBe('\x1b[');
    expect(decodeKeys('\x1b[1;').pending).toBe('\x1b[1;');
    expect(decodeKeys('\x1b[1;2').pending).toBe('\x1b[1;2');
  });

  test('a sequence split across two reads decodes once rejoined', () => {
    const first = decodeKeys('\x1b[1');
    expect(first.keys).toHaveLength(0);
    const second = decodeKeys(first.pending + ';2A');
    expect(describeKey(second.keys[0]!)).toBe('shift+up');
  });

  test('keys before an incomplete tail are still delivered', () => {
    const { keys, pending } = decodeKeys('ab\x1b[');
    expect(keys.map((k) => k.char)).toEqual(['a', 'b']);
    expect(pending).toBe('\x1b[');
  });
});

describe('flushPending — the ESC ambiguity', () => {
  test('a lone ESC that never completed is the escape key', () => {
    expect(flushPending('\x1b').map(describeKey)).toEqual(['escape']);
  });

  test('ESC + character is alt+character', () => {
    expect(flushPending('\x1bn').map(describeKey)).toEqual(['alt+n']);
  });

  test('an unterminated CSI is reported, not dropped', () => {
    expect(flushPending('\x1b[1;').map((k) => k.name)).toEqual(['unknown']);
  });

  test('nothing pending yields nothing', () => {
    expect(flushPending('')).toEqual([]);
  });
});
