import { describe, expect, it } from 'vitest';
import { completeBook, describeCommand, parseCommand, type Command, type CommandContext } from '../command';

const BOOKS: Record<string, number> = {
  genesis: 1, gen: 1, job: 18, psalms: 19, psalm: 19, ps: 19, 'song of solomon': 22, song: 22,
  john: 43, jn: 43, romans: 45, rom: 45, '1 corinthians': 46, '1 cor': 46, '1corinthians': 46, '1cor': 46,
  '1 john': 62, '1john': 62, '1 jn': 62, jude: 65, habakkuk: 35, hab: 35, acts: 44,
};
const NAMES = [
  ['Genesis', 1], ['Job', 18], ['Psalms', 19], ['John', 43], ['Joel', 29], ['Jonah', 32], ['Joshua', 6],
  ['1 Corinthians', 46], ['1 John', 62],
] as const;

const ctx: CommandContext = {
  resolveBook: n => BOOKS[n.toLowerCase()] ?? null,
  fuzzyBook: n => (n.toLowerCase() === 'jonh' ? 43 : null),
  resolveModule: n => ({ kjv: 'kjv', esv: 'esv' } as Record<string, string>)[n.toLowerCase()] ?? null,
  bookName: b => NAMES.find(x => x[1] === b)?.[0] ?? `Book ${b}`,
  bookNames: () => NAMES.map(([name, book]) => ({ name, book })),
  formatRef: (b, c, vs, ve) => {
    const name = NAMES.find(x => x[1] === b)?.[0] ?? `Book ${b}`;
    const base = vs ? `${name} ${c}:${vs}` : `${name} ${c}`;
    return ve ? `${base}-${ve}` : base;
  },
  defaultModule: 'kjv',
  current: { book: 43, chapter: 3 },
};

const parse = (s: string): Command => parseCommand(s, ctx);

describe('parseCommand: passages', () => {
  it.each([
    ['John 3:16', { book: 43, chapter: 3, verseStart: 16 }],
    ['john 3:16', { book: 43, chapter: 3, verseStart: 16 }],
    ['jn 3 16', { book: 43, chapter: 3, verseStart: 16 }],
    ['jn 3.16', { book: 43, chapter: 3, verseStart: 16 }],
    ['john3:16', { book: 43, chapter: 3, verseStart: 16 }],
    ['john 3:16-18', { book: 43, chapter: 3, verseStart: 16, verseEnd: 18 }],
    ['john 3:16 - 18', { book: 43, chapter: 3, verseStart: 16, verseEnd: 18 }],
    ['john 3:16–18', { book: 43, chapter: 3, verseStart: 16, verseEnd: 18 }],
    ['john 3 16-18', { book: 43, chapter: 3, verseStart: 16, verseEnd: 18 }],
    ['john 3:16-16', { book: 43, chapter: 3, verseStart: 16 }],
    ['rom 8', { book: 45, chapter: 8 }],
    ['Ps. 23', { book: 19, chapter: 23 }],
    ['ps23', { book: 19, chapter: 23 }],
    ['1 cor 13', { book: 46, chapter: 13 }],
    ['1cor 13:4-7', { book: 46, chapter: 13, verseStart: 4, verseEnd: 7 }],
    ['1 john 4:8', { book: 62, chapter: 4, verseStart: 8 }],
    ['1john 4:8', { book: 62, chapter: 4, verseStart: 8 }],
    ['song of solomon 2:1', { book: 22, chapter: 2, verseStart: 1 }],
    ['song 2:1', { book: 22, chapter: 2, verseStart: 1 }],
    ['jude', { book: 65, chapter: 1 }],
    ['  John   3:16  ', { book: 43, chapter: 3, verseStart: 16 }],
  ])('%s', (text, expected) => {
    expect(parse(text)).toEqual({ type: 'passage', ...expected });
  });

  it('reads a trailing translation, case-insensitively', () => {
    expect(parse('ps 23 esv')).toEqual({ type: 'passage', book: 19, chapter: 23, module: 'esv' });
    expect(parse('John 3:16 KJV')).toEqual({ type: 'passage', book: 43, chapter: 3, verseStart: 16, module: 'kjv' });
    expect(parse('john esv')).toEqual({ type: 'passage', book: 43, chapter: 1, module: 'esv' });
  });

  it('corrects a book typo when a chapter follows, and says so', () => {
    expect(parse('jonh 3:16')).toEqual({ type: 'passage', book: 43, chapter: 3, verseStart: 16, fuzzy: true });
  });

  it('does not take a book name inside a sentence for a passage', () => {
    expect(parse('john the baptist')).toEqual({ type: 'search', query: 'john the baptist' });
    expect(parse('job loss')).toEqual({ type: 'search', query: 'job loss' });
  });

  it.each(['john 0', 'john 3:0', 'john 3:18-16', 'john 999', 'john 3:16-', 'john 3:16:2'])(
    'rejects out-of-range or malformed %s as a search',
    text => {
      expect(parse(text).type).toBe('search');
    },
  );
});

describe('parseCommand: bare verses', () => {
  it.each([
    ['18', { verseStart: 18 }],
    ['v18', { verseStart: 18 }],
    ['V18', { verseStart: 18 }],
    ['v. 18', { verseStart: 18 }],
    ['verse 18', { verseStart: 18 }],
    [':18', { verseStart: 18 }],
    ['18-20', { verseStart: 18, verseEnd: 20 }],
    ['v18-20', { verseStart: 18, verseEnd: 20 }],
    ['vv 18–20', { verseStart: 18, verseEnd: 20 }],
    ['18-18', { verseStart: 18 }],
  ])('%s', (text, expected) => {
    expect(parse(text)).toEqual({ type: 'verse', ...expected });
  });

  it('falls to search for impossible verses', () => {
    expect(parse('0').type).toBe('search');
    expect(parse('20-18').type).toBe('search');
    expect(parse('9999').type).toBe('search');
  });
});

describe('parseCommand: hymns', () => {
  it.each([
    ['h amazing grace 1 2 5', { title: 'amazing grace', verses: ['1', '2', '5'] }],
    ['hymn amazing grace', { title: 'amazing grace', verses: [] }],
    ['Hymn: Amazing Grace', { title: 'Amazing Grace', verses: [] }],
    ['hymn - it is well v1-3', { title: 'it is well', verses: ['1', '2', '3'] }],
    ['hymn it is well 1,2,R', { title: 'it is well', verses: ['1', '2', 'R'] }],
    ['h it is well 1 r 2 r', { title: 'it is well', verses: ['1', 'R', '2', 'R'] }],
    ['hymn 23', { number: '23', verses: [] }],
    ['h 23 1 2', { number: '23', verses: ['1', '2'] }],
    ['hymns 460 v2', { number: '460', verses: ['2'] }],
    ['song amazing grace', { title: 'amazing grace', verses: [] }],
    ['hymn amazing grace,', { title: 'amazing grace', verses: [] }],
  ])('%s', (text, expected) => {
    expect(parse(text)).toEqual({ type: 'hymn', ...expected });
  });

  it('a hymn word with nothing after it is a search', () => {
    expect(parse('hymn')).toEqual({ type: 'search', query: 'hymn' });
    expect(parse('h')).toEqual({ type: 'search', query: 'h' });
  });

  it('never eats a book: hab and habakkuk stay passages', () => {
    expect(parse('hab 3:2')).toMatchObject({ type: 'passage', book: 35 });
  });

  it('keeps a hymn title that is only a number-like word as title text', () => {
    expect(parse('hymn 23 amazing')).toEqual({ type: 'hymn', title: '23 amazing', verses: [] });
  });
});

describe('parseCommand: simple commands', () => {
  it('blank, clear, help, none', () => {
    expect(parse('.')).toEqual({ type: 'blank' });
    expect(parse(' . ')).toEqual({ type: 'blank' });
    expect(parse('blank')).toEqual({ type: 'blank' });
    expect(parse('x')).toEqual({ type: 'clear' });
    expect(parse('CLEAR')).toEqual({ type: 'clear' });
    expect(parse('?')).toEqual({ type: 'help' });
    expect(parse('help')).toEqual({ type: 'help' });
    expect(parse('')).toEqual({ type: 'none' });
    expect(parse('   ')).toEqual({ type: 'none' });
  });

  it('anything else is a search, whitespace collapsed', () => {
    expect(parse('love  one another')).toEqual({ type: 'search', query: 'love one another' });
    expect(parse('grace')).toEqual({ type: 'search', query: 'grace' });
    expect(parse('xylophone')).toEqual({ type: 'search', query: 'xylophone' });
    expect(parse('1 3')).toEqual({ type: 'search', query: '1 3' });
  });
});

describe('describeCommand', () => {
  const d = (s: string, c: CommandContext = ctx) => describeCommand(parse(s), c);
  it('describes each command', () => {
    expect(d('')).toBeNull();
    expect(d('john 3:16')).toBe('Show John 3:16 (KJV)');
    expect(d('john 3:16-18 esv')).toBe('Show John 3:16-18 (ESV)');
    expect(d('rom 8')).toBe('Show Book 45 8 (KJV)'.replace('Book 45 8', 'Book 45 8'));
    expect(d('18')).toBe('Show John 3:18');
    expect(d('18', { ...ctx, current: null })).toBe('Go to verse 18');
    expect(d('18-20', { ...ctx, current: null })).toBe('Go to verse 18-20');
    expect(d('h amazing grace 1 2 5')).toBe("Show hymn 'amazing grace', verses 1, 2, 5");
    expect(d('hymn 23')).toBe('Show hymn 23');
    expect(d('.')).toBe('Blank or unblank the screen');
    expect(d('x')).toBe('Clear highlights');
    expect(d('?')).toBe('Show help');
    expect(d('grace')).toBe("Search for 'grace'");
  });

  it('omits the translation when none is known', () => {
    expect(d('john 3:16', { ...ctx, defaultModule: undefined })).toBe('Show John 3:16');
  });

  it('routes through a supplied translator', () => {
    const t = (key: string, params: Record<string, string | number>) => `${key}|${params.ref}`;
    expect(describeCommand(parse('john 3:16'), ctx, t)).toBe('present.command.hint.passage|John 3:16');
  });
});

describe('completeBook', () => {
  it('completes a unique prefix with a trailing space', () => {
    expect(completeBook('gen', ctx)?.text).toBe('Genesis ');
    expect(completeBook('1 co', ctx)?.text).toBe('1 Corinthians ');
    expect(completeBook('1co', ctx)?.text).toBe('1 Corinthians ');
  });

  it('lists every candidate and cycles', () => {
    const first = completeBook('jo', ctx, 0)!;
    expect(first.candidates).toEqual(['Job', 'John', 'Joel', 'Jonah', 'Joshua']);
    expect(first.text).toBe('Job ');
    expect(completeBook('jo', ctx, 1)?.text).toBe('John ');
    expect(completeBook('jo', ctx, 5)?.text).toBe('Job ');
  });

  it('does nothing once a chapter is typed, or for no match, or empty', () => {
    expect(completeBook('john 3', ctx)).toBeNull();
    expect(completeBook('zzz', ctx)).toBeNull();
    expect(completeBook('', ctx)).toBeNull();
    expect(completeBook('3:16', ctx)).toBeNull();
  });
});
