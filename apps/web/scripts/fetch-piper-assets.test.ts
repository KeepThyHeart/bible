import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs
import { PRONUNCIATION_REF, installPronunciation, pronunciationSource } from './fetch-piper-assets.mjs';

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'pron-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A source directory with an index.json for its files. */
function source(files: Record<string, string>, tamper?: (index: { files: Array<{ path: string; bytes: number; sha256: string }> }) => void): string {
  const src = tmp();
  const index = { format: 'kth-pron-index/1', files: [] as Array<{ path: string; bytes: number; sha256: string }> };
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(src, rel, '..'), { recursive: true });
    writeFileSync(join(src, rel), text);
    index.files.push({ path: rel, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
  }
  tamper?.(index);
  writeFileSync(join(src, 'index.json'), JSON.stringify(index));
  writeFileSync(join(src, 'README.md'), 'x');
  return src;
}

describe('installPronunciation', () => {
  it('installs what index.json lists, and removes files it no longer lists', async () => {
    const audio = tmp();
    mkdirSync(join(audio, 'pronunciation/en-us'), { recursive: true });
    writeFileSync(join(audio, 'pronunciation/en-us/OLD.json'), '{}');
    const src = source({ 'en-us/lexicon.json': '{"a":1}', 'en/KJV.json': '{"b":2}' });
    expect(await installPronunciation(src, audio)).toEqual(['pronunciation/en-us/lexicon.json', 'pronunciation/en/KJV.json']);
    expect(readFileSync(join(audio, 'pronunciation/en-us/lexicon.json'), 'utf8')).toBe('{"a":1}');
    expect(existsSync(join(audio, 'pronunciation/en-us/OLD.json'))).toBe(false);
    expect(existsSync(join(audio, 'pronunciation/README.md'))).toBe(false);
  });

  it('refuses a file that does not match the index, a broken file, or a path outside the tree, writing nothing', async () => {
    const audio = tmp();
    await expect(installPronunciation(source({ 'en-us/a.json': '{}' }, i => { i.files[0].sha256 = '0'.repeat(64); }), audio)).rejects.toThrow(/does not match/);
    await expect(installPronunciation(source({ 'en-us/a.json': '{broken' }), audio)).rejects.toThrow();
    await expect(installPronunciation(source({ 'en-us/a.json': '{}' }, i => { i.files[0].path = '../a.json'; }), audio)).rejects.toThrow(/bad path/);
    expect(existsSync(join(audio, 'pronunciation'))).toBe(false);
  });

  it('source: explicit, else a sibling bible-scripts checkout, else GitHub at the pinned commit', () => {
    expect(pronunciationSource('https://example.org/p', '/x')).toBe('https://example.org/p');
    const parent = tmp();
    mkdirSync(join(parent, 'bible'));
    expect(pronunciationSource(null, join(parent, 'bible'), 'abc')).toBe('https://raw.githubusercontent.com/KeepThyHeart/bible-scripts/abc/pronunciation');
    expect(pronunciationSource(null, join(parent, 'bible'))).toContain(PRONUNCIATION_REF);
    mkdirSync(join(parent, 'bible-scripts/pronunciation'), { recursive: true });
    writeFileSync(join(parent, 'bible-scripts/pronunciation/index.json'), '{}');
    expect(pronunciationSource(null, join(parent, 'bible'))).toBe(join(parent, 'bible-scripts/pronunciation'));
  });

  const sibling = join(__dirname, '../../../../bible-scripts/pronunciation');
  it.skipIf(!existsSync(join(sibling, 'index.json')))('the bible-scripts data installs', async () => {
    const copied = await installPronunciation(sibling, tmp());
    expect(copied).toEqual(expect.arrayContaining(['pronunciation/en-us/lexicon.json', 'pronunciation/en/KJV.json']));
  });
});
