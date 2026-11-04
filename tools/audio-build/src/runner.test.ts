import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateAudioIndex, validateChapterManifest, type ChapterManifest, type TranslationAudioIndex } from './core';
import { fakeDefinition, FakeEngine } from './testing/fakeEngine';
import { fakeModule } from './testing/fakeModule';
import { rebuildIndex, summarizeRecorded } from './indexBuilder';
import { manifestPath, indexPath } from './layout';
import { runBuild, RunError, type BuildOptions } from './runner';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'audio-build-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const base = (over: Partial<BuildOptions> = {}): BuildOptions => ({
  module: 'TST', engine: 'fake', voice: 'v1', rev: '1', out: dir, formats: ['opus', 'mp3'], rate: 1, jobs: 1, force: false, dryRun: false,
  cacheDir: join(dir, 'cache'), gapMs: 350, introGapMs: 700, quantization: 'q8', ffmpeg: 'ffmpeg', iHaveRights: false, ...over,
});

const john = () => fakeModule([
  { book: 43, chapters: { 1: ['In the beginning was the Word.', 'The same was in the beginning with God.'], 2: ['And the third day there was a marriage.'], 3: ['There was a man of the Pharisees.', 'The same came to Jesus by night.', 'Jesus answered.'] } },
  { book: 19, chapters: { 3: { 0: 'A Psalm of David.', 1: 'LORD, how are they increased that trouble me!', 2: 'Many there be which say of my soul.' } } },
]);

const quiet = { log: () => {} };
const readManifest = async (n: number, c: number, narrator = 'fake-v1'): Promise<ChapterManifest> =>
  JSON.parse(await readFile(manifestPath({ out: dir, module: 'TST', narrator, rev: '1' }, n, c), 'utf8'));
const readIndex = async (): Promise<TranslationAudioIndex> => JSON.parse(await readFile(indexPath(dir, 'TST'), 'utf8'));

describe('a run end to end (fake engine, real ffmpeg)', () => {
  it('writes opus and mp3 files, valid manifests with hashes, and an index', async () => {
    const engine = new FakeEngine();
    const s = await runBuild(base({ chapters: 'JHN.3,PSA.3' }), { moduleText: john(), engineDef: fakeDefinition, engine, ...quiet });
    expect(s).toMatchObject({ done: 2, skipped: 0, failed: 0, narrator: 'fake-v1' });

    const m = await readManifest(43, 3);
    expect(validateChapterManifest(m).ok).toBe(true);
    expect(m.files.map(f => f.path)).toEqual(['43/003.ogg', '43/003.mp3']);
    expect(m.files.map(f => f.mime)).toEqual(['audio/ogg; codecs=opus', 'audio/mpeg']);
    for (const f of m.files) {
      expect(f.bytes).toBeGreaterThan(100);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect((await stat(join(dir, 'v1/TST/fake-v1/1', f.path))).size).toBe(f.bytes);
    }
    expect(m.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.intro).toBeDefined();
    expect(m.verses.map(v => v[0])).toEqual([1, 2, 3]);
    expect(m.build).toMatchObject({ engine: 'fake', voice: 'v1', rate: 1, gapMs: 350, introGapMs: 700 });

    // The intro is spoken by core's TextPreparer, the same as live speech.
    expect(engine.calls.map(c => c.text)).toContain('John, chapter 3.');
    // Psalm 3: the title is verse 0 and comes after the intro.
    const psalm = await readManifest(19, 3);
    expect(psalm.verses[0][0]).toBe(0);
    expect(psalm.verses[0][1]).toBeGreaterThanOrEqual(psalm.intro![1]);
    expect(engine.calls.map(c => c.text)).toContain('Psalm 3.');
    expect(engine.calls.map(c => c.text)).toContain('Lord, how are they increased that trouble me!'); // small caps divine name rewritten

    const idx = await readIndex();
    expect(validateAudioIndex(idx).ok).toBe(true);
    expect(idx.narrators[0]).toMatchObject({ id: 'fake-v1', rev: '1', language: 'en', books: [19], chapters: { '43': [3] } });
    expect(idx.narrators[0].provenance?.voice.name).toBe('Fake voice');
    expect(idx.narrators[0].provenance?.text?.license).toBe('PD');
  });

  it('marks a book as fully recorded only when every chapter is', async () => {
    const run = (chapters: string) => runBuild(base({ chapters }), { moduleText: john(), engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });
    await run('JHN.1,JHN.2');
    expect((await readIndex()).narrators[0]).toMatchObject({ books: [], chapters: { '43': [1, 2] } });
    await run('JHN.3');
    const n = (await readIndex()).narrators[0];
    expect(n.books).toEqual([43]);
    expect(n.chapters).toBeUndefined();
  });

  it('skips up-to-date chapters on a re-run and renders them again with --force', async () => {
    const opts = base({ chapters: 'JHN.1' });
    const e1 = new FakeEngine();
    await runBuild(opts, { moduleText: john(), engineDef: fakeDefinition, engine: e1, ...quiet });
    const e2 = new FakeEngine();
    const again = await runBuild(opts, { moduleText: john(), engineDef: fakeDefinition, engine: e2, ...quiet });
    expect(again).toMatchObject({ done: 0, skipped: 1 });
    expect(e2.calls).toHaveLength(0);
    const e3 = new FakeEngine();
    const forced = await runBuild({ ...opts, force: true }, { moduleText: john(), engineDef: fakeDefinition, engine: e3, ...quiet });
    expect(forced).toMatchObject({ done: 1, skipped: 0 });
  });

  it('renders again when the text, the voice settings or the formats change', async () => {
    const opts = base({ chapters: 'JHN.2' });
    await runBuild(opts, { moduleText: john(), engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });
    const run = (o: BuildOptions, mod = john()) => runBuild(o, { moduleText: mod, engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });

    expect((await run({ ...opts, rate: 1.1 })).done).toBe(1); // speed is part of the build record
    expect((await run({ ...opts, rate: 1.1 })).skipped).toBe(1);
    expect((await run({ ...opts, rate: 1.1, gapMs: 500 })).done).toBe(1);
    expect((await run({ ...opts, rate: 1.1, gapMs: 500, formats: ['opus'] })).skipped).toBe(1); // fewer formats than on disk is fine
    expect((await run({ ...opts, rate: 1.1, gapMs: 500, formats: ['opus', 'mp3'] })).skipped).toBe(1);

    const edited = fakeModule([{ book: 43, chapters: { 2: ['And the third day there was a wedding.'] } }]);
    expect((await run({ ...opts, rate: 1.1, gapMs: 500 }, edited)).done).toBe(1); // text changed: new textHash
  });

  it('a different voice is a different narrator, and both stay in the index', async () => {
    const run = (voice: string) => runBuild(base({ chapters: 'JHN.1', voice }), { moduleText: john(), engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });
    await run('v1');
    await run('v2');
    const idx = await readIndex();
    expect(idx.narrators.map(n => n.id)).toEqual(['fake-v1', 'fake-v2']);
  });

  it('keeps other narrators untouched when it rebuilds the index', async () => {
    const other = { id: 'human-1', label: 'Human', language: 'en', rev: '7', books: [43], chapters: { '19': [1] } };
    await rebuildIndex({ out: dir, module: 'TST', built: [], chaptersOfBook: new Map() });
    await writeFile(indexPath(dir, 'TST'), JSON.stringify({ schema: 'kth-audio-index/1', module: 'TST', narrators: [other] }));
    await runBuild(base({ chapters: 'JHN.1' }), { moduleText: john(), engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });
    const idx = await readIndex();
    expect(idx.narrators[0]).toEqual(other);
    expect(idx.narrators[1].id).toBe('fake-v1');
  });

  it('continues after a failed chapter, reports it, and the others are written', async () => {
    const engine = new FakeEngine();
    engine.failOn = t => t.includes('third day');
    const s = await runBuild(base({ chapters: 'JHN.1,JHN.2,JHN.3' }), { moduleText: john(), engineDef: fakeDefinition, engine, ...quiet });
    expect(s).toMatchObject({ done: 2, failed: 1 });
    expect(s.failures[0].id).toEqual({ book: 43, chapter: 2 });
    expect((await readIndex()).narrators[0].chapters).toEqual({ '43': [1, 3] });
  });

  it('leaves no temp or half-written files when encoding fails', async () => {
    const s = await runBuild(base({ chapters: 'JHN.1', ffmpeg: '/nonexistent/ffmpeg' }), { moduleText: john(), engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });
    expect(s.failed).toBe(1);
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) { if (e.isDirectory()) await walk(join(d, e.name)); else files.push(join(d, e.name)); }
    };
    await walk(dir);
    expect(files.filter(f => /\.(tmp|ogg|mp3|json)/.test(f) && !f.endsWith('index.json'))).toEqual([]);
  });

  it('writes the manifest after the audio: a manifest on disk always has its files', async () => {
    await runBuild(base({ chapters: 'JHN.1' }), { moduleText: john(), engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });
    const m = await readManifest(43, 1);
    for (const f of m.files) await expect(stat(join(dir, 'v1/TST/fake-v1/1', f.path))).resolves.toBeTruthy();
    // A missing file invalidates resume.
    await rm(join(dir, 'v1/TST/fake-v1/1/43/001.mp3'));
    const s = await runBuild(base({ chapters: 'JHN.1' }), { moduleText: john(), engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });
    expect(s.done).toBe(1);
  });

  it('a dry run lists chapters and loads nothing', async () => {
    const engine = new FakeEngine();
    const s = await runBuild(base({ dryRun: true }), { moduleText: john(), engineDef: fakeDefinition, engine, ...quiet });
    expect(s.planned.map(p => `${p.id.book}.${p.id.chapter}`)).toEqual(['19.3', '43.1', '43.2', '43.3']);
    expect(s.estimatedAudioSeconds).toBeGreaterThan(5);
    expect(engine.calls).toHaveLength(0);
    await expect(stat(join(dir, 'v1'))).rejects.toThrow();
  });
});

describe('the licence gate', () => {
  const restricted = () => fakeModule([{ book: 43, chapters: { 1: ['In the beginning was the Word.'] } }], { licenseSpdx: 'CC-BY-NC-4.0', publicDomain: false });
  const run = (mod: ReturnType<typeof john>, over: Partial<BuildOptions> = {}) =>
    runBuild(base({ chapters: 'JHN.1', ...over }), { moduleText: mod, engineDef: fakeDefinition, engine: new FakeEngine(), ...quiet });

  it('refuses a module whose licence does not allow derivatives', async () => {
    await expect(run(restricted())).rejects.toThrow(RunError);
    await expect(run(restricted())).rejects.toThrow(/--i-have-rights/);
    await expect(stat(join(dir, 'v1'))).rejects.toThrow();
  });
  it('refuses a module with no licence at all', async () => {
    await expect(run(fakeModule([{ book: 43, chapters: { 1: ['x'] } }], { licenseSpdx: undefined, publicDomain: false }))).rejects.toThrow(/declares no licence/);
  });
  it('allows it with --i-have-rights', async () => {
    expect((await run(restricted(), { iHaveRights: true })).done).toBe(1);
  });
  it('allows public domain, CC-BY and GPL', async () => {
    for (const spdx of ['PD', 'CC0-1.0', 'CC-BY-4.0', 'GPL-2.0-or-later']) {
      expect((await run(fakeModule([{ book: 43, chapters: { 1: ['In the beginning.'] } }], { licenseSpdx: spdx, publicDomain: spdx === 'PD' }), { force: true })).done).toBe(1);
    }
  });
});

describe('summarizeRecorded', () => {
  const chapters = new Map([[43, [1, 2, 3]], [63, [1]]]);
  it('splits full books from partial ones', () => {
    expect(summarizeRecorded(new Map([[43, [1, 3]], [63, [1]]]), chapters)).toEqual({ books: [63], chapters: { '43': [1, 3] } });
    expect(summarizeRecorded(new Map([[43, [1, 2, 3]]]), chapters)).toEqual({ books: [43] });
  });
});
