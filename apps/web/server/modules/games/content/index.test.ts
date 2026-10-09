import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ContentLibrary,
  closeContent,
  drawQuestions,
  translations,
  useContent,
  verseText,
} from './index.js';
import { makeTempDir, removeTempDir, writeFixtureModule } from './fixtures.js';
import { toVerseId } from '../../../../src/modules/games/shared/verseId.js';

let directory: string;
let moduleDir: string;
let contentPath: string;
let library: ContentLibrary;

function open(defaultTranslation = 'FIX'): ContentLibrary {
  return ContentLibrary.open({ moduleDir, contentPath, defaultTranslation });
}

beforeEach(() => {
  directory = makeTempDir('content-library-');
  // The content database is deliberately not in the modules directory: the
  // catalog opens everything it finds there.
  moduleDir = join(directory, 'modules');
  contentPath = join(directory, 'data', 'content.db');
  writeFixtureModule(join(moduleDir, 'fixture.db'), { abbreviation: 'FIX' });
  writeFixtureModule(join(moduleDir, 'other.db'), {
    abbreviation: 'ALT',
    verses: [{ id: toVerseId(43, 3, 16), text: 'A different rendering of the same verse.' }],
  });
  library = open();
});

afterEach(() => {
  library.close();
  removeTempDir(directory);
  expect(existsSync(directory)).toBe(false);
});

describe('translations', () => {
  it('lists what is installed', () => {
    expect(library.translations().map((entry) => entry.abbreviation)).toEqual(['ALT', 'FIX']);
    expect(library.hasTranslation('fix')).toBe(true);
  });

  it('serves the configured default when nothing is named', () => {
    expect(library.translation()?.info.abbreviation).toBe('FIX');
  });

  it('falls back to an installed module when the configured one is absent', () => {
    const fallback = ContentLibrary.open({ moduleDir, contentPath, defaultTranslation: 'NIV' });
    // Refusing to serve verses because the environment names a translation
    // nobody installed would help nobody.
    expect(fallback.translation()?.info.abbreviation).toBe('ALT');
    fallback.close();
  });

  it('has no translation at all when none is installed', () => {
    const empty = ContentLibrary.open({
      moduleDir: join(directory, 'none'),
      contentPath: join(directory, 'data', 'empty.db'),
    });
    expect(empty.translation()).toBeNull();
    expect(empty.verse(toVerseId(43, 3, 16))).toBeNull();
    expect(empty.chapter(1, 1)).toEqual([]);
    expect(empty.randomVerse()).toBeNull();
    empty.close();
  });
});

describe('verses', () => {
  it('reads through the default translation', () => {
    expect(library.verseText(toVerseId(43, 3, 16))).toContain('For God so loved');
    expect(library.chapter(1, 1)).toHaveLength(3);
    expect(library.range(toVerseId(1, 1, 1), toVerseId(1, 1, 2))).toHaveLength(2);
    expect(library.verses([toVerseId(66, 1, 1)])).toHaveLength(1);
  });

  it('reads through a named translation instead', () => {
    expect(library.verseText(toVerseId(43, 3, 16), 'ALT')).toContain('A different rendering');
    expect(library.verse(toVerseId(1, 1, 1), 'ALT')).toBeNull();
  });

  it('is silent about a translation nobody installed', () => {
    expect(library.translation('NIV')).toBeNull();
    expect(library.verseText(toVerseId(43, 3, 16), 'NIV')).toBeNull();
  });

  it('draws through the caller’s generator', () => {
    const fixed = (): number => 0.25;
    expect(library.randomVerse({}, fixed)?.id).toBe(library.randomVerse({}, fixed)?.id);
    expect(library.randomVerses(2, { sections: ['gospels'] })).toHaveLength(2);
  });
});

describe('authored content', () => {
  beforeEach(() => {
    library.db.putQuestion({
      id: 'q1',
      type: 'multiple-choice',
      prompt: 'Who was thrown into the lions den?',
      promptVerseId: null,
      answer: 'Daniel',
      accept: [],
      contextNote: null,
      difficulty: 2,
      audience: 'all',
      book: 27,
      section: 'majorProphets',
      tags: [],
      source: null,
      reviewedBy: null,
      distractors: ['Joseph', 'Jonah', 'Elijah'],
      clues: [],
    });
    library.db.putQuestionSet({
      id: 'set1',
      name: 'Opening round',
      description: null,
      difficulty: 2,
      audience: 'all',
      book: null,
      section: null,
      tags: [],
      questionIds: ['q1'],
    });
    library.db.putOrderedList({
      id: 'l1',
      title: 'Days of creation',
      instructions: null,
      difficulty: 1,
      audience: 'all',
      book: 1,
      section: 'law',
      tags: [],
      source: null,
      reviewedBy: null,
      items: [
        { label: 'Light', verseId: null, note: null },
        { label: 'Sky', verseId: null, note: null },
        { label: 'Dry land', verseId: null, note: null },
      ],
    });
    library.db.putPromptCard({
      id: 'c1',
      concept: 'Noah',
      category: 'person',
      forbidden: ['ark'],
      difficulty: 2,
      audience: 'all',
      book: 1,
      section: 'law',
      tags: [],
      source: null,
      reviewedBy: null,
    });
  });

  it('hands a game questions, sets, orderings and cards', () => {
    expect(library.question('q1')?.answer).toBe('Daniel');
    expect(library.questions({ books: [27] })).toHaveLength(1);
    expect(library.drawQuestions(1)).toHaveLength(1);
    expect(library.questionSets().map((set) => set.id)).toEqual(['set1']);
    expect(library.questionSet('set1')?.questionIds).toEqual(['q1']);
    expect(library.orderedLists()).toHaveLength(1);
    expect(library.orderedList('l1')?.items).toHaveLength(3);
    expect(library.promptCards({ category: 'person' })).toHaveLength(1);
    expect(library.drawPromptCards(1)).toHaveLength(1);
  });

  it('survives being reopened over the same file', () => {
    library.close();
    library = open();
    expect(library.question('q1')?.answer).toBe('Daniel');
  });
});

describe('the process-wide library', () => {
  afterEach(() => {
    // Whatever a test swapped in, the next one starts from nothing rather than
    // from a database somebody else closed.
    useContent(null);
  });

  it('lets the bare functions be pointed at a library of the caller’s choosing', () => {
    const previous = useContent(library);
    expect(previous).toBeNull();
    expect(translations().map((entry) => entry.abbreviation)).toEqual(['ALT', 'FIX']);
    expect(verseText(toVerseId(43, 11, 35))).toBe('Jesus wept.');
    expect(drawQuestions(5)).toEqual([]);
  });

  it('closing when nothing was ever opened is not an error', () => {
    expect(() => {
      closeContent();
    }).not.toThrow();
  });
});
