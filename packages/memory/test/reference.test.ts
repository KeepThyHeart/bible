/** `resolveReference` + candidate extraction: cross-chapter ranges and single-chapter books (B-022, B-026). */
import { describe, expect, it } from 'vitest';
import { resolveReference, ReferenceError } from '../src/core/reference';
import { extractReferenceCandidates } from '../src/ui/referenceInput';
import { disposeAll, startTestService } from './helpers/service';

const counts: Record<number, number[]> = {
  1: [31, 25, 24],
  43: [51, 25, 36],
  57: [25],
  65: [25],
};
const names: Record<string, number> = { gen: 1, genesis: 1, john: 43, philemon: 57, jude: 65 };

function api() {
  return {
    bible: {
      listChapters: async (book: number) =>
        (counts[book] ?? []).map((n, i) => ({
          bookNumber: book,
          chapter: i + 1,
          verseCount: n,
          firstVerseId: book * 1000000 + (i + 1) * 1000 + 1,
          lastVerseId: book * 1000000 + (i + 1) * 1000 + n,
        })),
      parseReference: async (input: string) => {
        const m = /^([A-Za-z]+)(?:\s+(\d+)(?::(\d+))?(?:-(?:(\d+):)?(\d+))?)?$/.exec(input.trim());
        if (!m) return null;
        const book = names[m[1]!.toLowerCase()];
        if (!book) return null;
        // Mirrors the host: a bare book name is not a reference.
        if (!m[2]) return null;
        const chapter = Number(m[2]);
        const dto: Record<string, unknown> = { bookNumber: book, chapter, input };
        const single = (counts[book] ?? []).length === 1;
        if (m[3]) {
          dto.startVerse = Number(m[3]);
          dto.startVerseId = book * 1e6 + chapter * 1000 + Number(m[3]);
        } else if (single) {
          dto.startVerse = chapter;
          dto.startVerseId = book * 1e6 + 1000 + chapter;
          dto.chapter = 1;
        }
        if (m[5]) {
          dto.endVerse = Number(m[5]);
          dto.endVerseId = book * 1e6 + Number(m[4] ?? chapter) * 1000 + Number(m[5]);
        }
        return dto;
      },
    },
  } as never;
}

describe('extractReferenceCandidates', () => {
  it('keeps a cross-chapter end whole', () => {
    expect(extractReferenceCandidates('Gen 1:1-2:3')).toEqual(['Gen 1:1-2:3']);
  });
});

describe('resolveReference', () => {
  it('counts a cross-chapter range by verses, not by id distance', async () => {
    const r = await resolveReference(api(), 'Gen 1:30-2:5');
    expect(r.verseCount).toBe(2 + 5);
  });

  it('gives the 25-verse limit message for Gen 1:1-2:3', async () => {
    await expect(resolveReference(api(), 'Gen 1:1-2:3')).rejects.toThrow(/34 verses/);
  });

  it('accepts a bare single-chapter book name as the whole book', async () => {
    const r = await resolveReference(api(), 'Jude');
    expect(r.verseCount).toBe(25);
  });

  it('reads "Philemon 1" as the chapter, but "Jude 5" stays a verse', async () => {
    expect((await resolveReference(api(), 'Philemon 1')).verseCount).toBe(25);
    expect((await resolveReference(api(), 'Jude 5')).verseCount).toBe(1);
  });

  it('still rejects a bare multi-chapter book name', async () => {
    await expect(resolveReference(api(), 'John')).rejects.toBeInstanceOf(ReferenceError);
  });
});

describe('addPassage twice (B-026)', () => {
  it('rejects a verse past the end of the chapter (B-038)', async () => {
    await expect(resolveReference(api(), 'John 3:999')).rejects.toThrow(/only has 36 verses/);
    await expect(resolveReference(api(), 'John 3:30-40')).rejects.toThrow(/only has 36 verses/);
    expect((await resolveReference(api(), 'John 3:36')).verseCount).toBe(1);
  });

  it('flags the second add as already in the list', async () => {
    try {
      const { svc } = await startTestService({
        bible: {
          parseReference: async () => ({ bookNumber: 43, chapter: 3, startVerse: 16, input: 'John 3:16', startVerseId: 43003016 }),
        },
      });
      const first = await svc.addPassage({ reference: 'John 3:16' });
      const second = await svc.addPassage({ reference: 'John 3:16' });
      expect(first.existed).toBeUndefined();
      expect(second.existed).toBe(true);
    } finally {
      disposeAll();
    }
  });
});
