import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encode, lineReader, parseLine, sessionDir, socketPath, tokenize } from '../src/protocol.ts';

describe('tokenize', () => {
  it('splits on whitespace', () => expect(tokenize('  a  b\tc ')).toEqual(['a', 'b', 'c']));
  it('handles single quotes literally', () => expect(tokenize(String.raw`'a \n "b"' c`)).toEqual([String.raw`a \n "b"`, 'c']));
  it('handles double quotes with escapes', () => expect(tokenize(String.raw`"a \"b\" \\ \n"`)).toEqual([String.raw`a "b" \ \n`]));
  it('backslash outside quotes escapes', () => expect(tokenize(String.raw`a\ b c\"`)).toEqual(['a b', 'c"']));
  it('empty quotes yield an empty token', () => expect(tokenize(`fill r1 ''  ""`)).toEqual(['fill', 'r1', '', '']));
  it('joins adjacent quoted and bare parts', () => expect(tokenize(`ab"cd"'ef'`)).toEqual(['abcdef']));
  it('throws on unterminated quotes', () => {
    expect(() => tokenize(`a "b`)).toThrow(/unterminated/);
    expect(() => tokenize(`a 'b`)).toThrow(/unterminated/);
  });
});

describe('parseLine', () => {
  it('blank -> []', () => expect(parseLine('   ')).toEqual([]));
  it('JSON array', () => expect(parseLine('["click","r1"]')).toEqual(['click', 'r1']));
  it('JSON object', () => expect(parseLine('{"argv":["snap"]}')).toEqual(['snap']));
  it('rejects non-string argv', () => expect(() => parseLine('[1]')).toThrow());
  it('shell-like otherwise', () => expect(parseLine('type r2 "hi there"')).toEqual(['type', 'r2', 'hi there']));
});

describe('paths', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it('sessionDir honours DRIVE_DIR, then session arg, then DRIVE_SESSION', () => {
    delete process.env.DRIVE_DIR;
    delete process.env.DRIVE_SESSION;
    expect(sessionDir()).toBe(join(tmpdir(), 'bible-ui-driver', 'default'));
    expect(sessionDir('x')).toBe(join(tmpdir(), 'bible-ui-driver', 'x'));
    process.env.DRIVE_SESSION = 's';
    expect(sessionDir()).toBe(join(tmpdir(), 'bible-ui-driver', 's'));
    process.env.DRIVE_DIR = '/d';
    expect(sessionDir('x')).toBe('/d');
  });
  it('socketPath is short-circuited for long dirs', () => {
    expect(socketPath('/a/b')).toBe('/a/b/drive.sock');
    const long = '/' + 'x'.repeat(120);
    const p = socketPath(long);
    expect(p).toMatch(/bud-[0-9a-f]{8}\.sock$/);
    expect(p.startsWith(tmpdir())).toBe(true);
    expect(socketPath(long)).toBe(p);
  });
});

describe('framing', () => {
  it('encode ends with newline', () => expect(encode({ a: 1 })).toBe('{"a":1}\n'));
  it('lineReader buffers across chunks', () => {
    const got: string[] = [];
    const feed = lineReader((l) => got.push(l));
    feed('ab');
    feed('c\nd');
    feed(Buffer.from('e\n\nf'));
    expect(got).toEqual(['abc', 'de', '']);
  });
});
