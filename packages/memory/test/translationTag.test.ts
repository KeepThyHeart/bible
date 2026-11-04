/**
 * B-123: the Add field accepts a trailing translation tag ("Psalm 23:1-3 ASV"),
 * the tag is remembered as the last translation chosen in Memory, an unknown tag
 * is an error rather than silently ignored, and every passage knows its
 * translation (`moduleId`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MODULE_ESV } from '@bible/extension-testing';

import { disposeAll, startTestService, MODULE_KJV } from './helpers/service';

afterEach(disposeAll);

const MODULE_ASV = { ...MODULE_ESV, id: 'bible_asv', abbreviation: 'ASV', name: 'American Standard Version', version: '1901' };

function parseReference(input: string) {
  const m = /^John\s+(\d+):(\d+)(?:-(\d+))?$/i.exec(input.trim());
  if (!m) return null;
  const chapter = Number(m[1]);
  const start = Number(m[2]);
  const dto: Record<string, unknown> = {
    bookNumber: 43,
    chapter,
    startVerse: start,
    startVerseId: 43e6 + chapter * 1000 + start,
    input,
  };
  if (m[3]) {
    dto.endVerse = Number(m[3]);
    dto.endVerseId = 43e6 + chapter * 1000 + Number(m[3]);
  }
  return Promise.resolve(dto);
}

async function start(preferred?: string) {
  return startTestService({
    bible: { listModules: async () => [MODULE_KJV, MODULE_ASV], parseReference: async (i: string) => parseReference(i) },
    ...(preferred ? { preferredModule: () => preferred } : {}),
  });
}

describe('Memory Add field: translation tag (B-123)', () => {
  it('adds in the tagged translation, case-insensitively, without the tag in the reference', async () => {
    const { svc } = await start();
    const { passage } = await svc.addPassage({ reference: 'John 3:16-17 asv' });
    expect(passage.moduleId).toBe('ASV');
    expect(passage.reference).not.toMatch(/asv/i);
    expect(passage.startVerseId).toBe(43003016);
  });

  it('keeps the same reference in two translations as two passages', async () => {
    const { svc } = await start();
    const a = await svc.addPassage({ reference: 'John 3:16 KJV' });
    const b = await svc.addPassage({ reference: 'John 3:16 ASV' });
    expect(a.passage.id).not.toBe(b.passage.id);
    expect([a.passage.moduleId, b.passage.moduleId]).toEqual(['KJV', 'ASV']);
  });

  it('with no tag, uses the user default translation', async () => {
    const { svc } = await start('ASV');
    const { passage } = await svc.addPassage({ reference: 'John 3:16' });
    expect(passage.moduleId).toBe('ASV');
  });

  it('with no tag, uses the last translation explicitly chosen in Memory', async () => {
    const { svc } = await start('KJV');
    await svc.addPassage({ reference: 'John 3:16 ASV' });
    const { passage } = await svc.addPassage({ reference: 'John 3:17' });
    expect(passage.moduleId).toBe('ASV');
  });

  it('remembers the choice across a restart (persisted)', async () => {
    const first = await start('KJV');
    await first.svc.addPassage({ reference: 'John 3:16 ASV' });
    const second = await startTestService({
      db: first.db,
      bible: { listModules: async () => [MODULE_KJV, MODULE_ASV], parseReference: async (i: string) => parseReference(i) },
      preferredModule: () => 'KJV',
    });
    const { passage } = await second.svc.addPassage({ reference: 'John 3:18' });
    expect(passage.moduleId).toBe('ASV');
  });

  it('falls back to the default translation when the remembered one was uninstalled', async () => {
    const first = await start('KJV');
    await first.svc.addPassage({ reference: 'John 3:16 ASV' });
    const second = await startTestService({
      db: first.db,
      bible: { listModules: async () => [MODULE_KJV], parseReference: async (i: string) => parseReference(i) },
      preferredModule: () => 'KJV',
    });
    const { passage } = await second.svc.addPassage({ reference: 'John 3:18' });
    expect(passage.moduleId).toBe('KJV');
  });

  it('rejects an unknown tag with a clear message and adds nothing', async () => {
    const { svc } = await start();
    await expect(svc.addPassage({ reference: 'John 3:16 XYZ' })).rejects.toThrow(/"XYZ".*not an installed translation/);
    expect((await svc.getPlan()).passages).toHaveLength(0);
  });

  it('does not treat a book name as a tag', async () => {
    const { svc } = await start();
    // No digit before "John": the whole string is the reference, which the parser rejects as such.
    await expect(svc.addPassage({ reference: 'Gospel John' })).rejects.toThrow(/not a reference/);
  });
});
