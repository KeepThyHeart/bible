/** `bible-audio-build`: argument parsing, module lookup, progress and exit code. */

import { homedir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { listEngines, getEngine } from './engines/registry';
import type { AudioFormat } from './layout';
import { findModuleFile, openModuleText } from './moduleSource';
import { defaultJobs, fmtDuration, runBuild, RunError, type BuildOptions, type RunSummary } from './runner';
import { SelectionError } from './selection';

const HELP = `bible-audio-build: pre-render Bible chapter recordings with verse timings.

Usage:
  pnpm audio:build --module=KJV --engine=kokoro --voice=am_michael [options]

Options:
  --module=ABBR         translation to record (required); its module file is bible_<abbr>.db
  --engine=ID           kokoro | piper (default kokoro)
  --voice=ID            voice id (default: the engine's default for the translation's language)
  --narrator=ID         narrator id in the hosting layout (default <engine>-<voice>)
  --rev=N               audio build id (default 1)
  --books=JHN,PSA       books to record (USFM code, number or English name)
  --chapters=JHN.3,PSA.23-25   chapters to record (JHN alone is the whole book)
  --out=DIR             audio root (default $BIBLE_DATA_DIR/audio, as fetch:piper)
  --modules-dir=DIR     where bible_<abbr>.db lives (default $BIBLE_DATA_DIR/modules); or --module-file=PATH
  --formats=opus,mp3    output formats, first is preferred by players (default opus,mp3)
  --rate=1.0            speech speed
  --gap=350             silence between verses, ms        --intro-gap=700  silence after the chapter intro, ms
  --quantization=q8     Kokoro model: q8 (default) or fp32
  --jobs=N              parallel workers, each with its own model copy (default cores-1)
  --cache-dir=DIR       models and voices (default ~/.cache/bible-audio-build)
  --ffmpeg=PATH         ffmpeg binary (default $FFMPEG or ffmpeg)
  --label=TEXT          narrator label shown to readers
  --force               render again even when a chapter is up to date
  --dry-run             list what would be rendered, with an estimate; loads no model
  --i-have-rights       record a translation whose licence does not clearly allow audio derivatives
  --help
`;

export function parseCli(argv: string[], env: NodeJS.ProcessEnv = process.env): { options: BuildOptions; moduleFile?: string; modulesDir: string; help: boolean } {
  const { values: v } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      module: { type: 'string' }, engine: { type: 'string' }, voice: { type: 'string' }, narrator: { type: 'string' }, rev: { type: 'string' },
      books: { type: 'string' }, chapters: { type: 'string' }, out: { type: 'string' }, 'modules-dir': { type: 'string' }, 'module-file': { type: 'string' },
      formats: { type: 'string' }, rate: { type: 'string' }, gap: { type: 'string' }, 'intro-gap': { type: 'string' }, quantization: { type: 'string' },
      jobs: { type: 'string' }, 'cache-dir': { type: 'string' }, ffmpeg: { type: 'string' }, label: { type: 'string' },
      force: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'i-have-rights': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const num = (name: string, s: string | undefined, dflt: number, min: number, max: number): number => {
    if (s === undefined) return dflt;
    const n = Number(s);
    if (!Number.isFinite(n) || n < min || n > max) throw new SelectionError(`--${name} must be a number from ${min} to ${max}.`);
    return n;
  };
  // `pnpm audio:build` runs in the package directory; INIT_CWD is where the user typed the command.
  const cwd = env.INIT_CWD || process.cwd();
  const resolve = (...p: string[]): string => resolvePath(cwd, ...p);
  const dataDir = env.BIBLE_DATA_DIR ? resolve(env.BIBLE_DATA_DIR) : resolvePath(__dirname, '../../../data');
  const formats = (v.formats ?? 'opus,mp3').split(',').map(f => f.trim().toLowerCase()).filter(Boolean);
  for (const f of formats) if (f !== 'opus' && f !== 'mp3') throw new SelectionError(`--formats: "${f}" is not opus or mp3.`);
  if (formats.length === 0) throw new SelectionError('--formats is empty.');
  const q = v.quantization ?? 'q8';
  if (q !== 'q8' && q !== 'fp32') throw new SelectionError('--quantization must be q8 or fp32.');
  const rev = v.rev ?? '1';
  if (!/^[A-Za-z0-9._-]+$/.test(rev)) throw new SelectionError('--rev may hold letters, digits, dot, dash and underscore only.');
  if (v.help) return { options: undefined as never, modulesDir: '', help: true };
  if (!v.module) throw new SelectionError('--module is required (try --help).');
  return {
    help: false,
    moduleFile: v['module-file'] ? resolve(v['module-file']) : undefined,
    modulesDir: resolve(v['modules-dir'] ?? env.BIBLE_MODULES_DIR ?? join(dataDir, 'modules')),
    options: {
      module: v.module,
      engine: v.engine ?? 'kokoro',
      voice: v.voice,
      narrator: v.narrator,
      rev,
      books: v.books,
      chapters: v.chapters,
      out: resolve(v.out ?? join(dataDir, 'audio')),
      formats: formats as AudioFormat[],
      rate: num('rate', v.rate, 1, 0.5, 2),
      jobs: Math.round(num('jobs', v.jobs, defaultJobs(), 1, 64)),
      force: !!v.force,
      dryRun: !!v['dry-run'],
      cacheDir: resolve(v['cache-dir'] ?? join(homedir(), '.cache', 'bible-audio-build')),
      gapMs: num('gap', v.gap, 350, 0, 5000),
      introGapMs: num('intro-gap', v['intro-gap'], 700, 0, 5000),
      quantization: q,
      ffmpeg: v.ffmpeg ?? env.FFMPEG ?? 'ffmpeg',
      iHaveRights: !!v['i-have-rights'],
      label: v.label,
    },
  };
}

function printSummary(s: RunSummary, o: BuildOptions, memoryMb: number, out: (m: string) => void): void {
  if (s.dryRun) {
    out(`Dry run: ${s.planned.length} chapter(s) to render, ${s.skipped} up to date or empty.`);
    for (const e of s.planned) out(`  ${e.id.book}.${e.id.chapter}  ~${fmtDuration(e.estimatedSeconds)}  ${e.prepared.verses.length} verses`);
    out(`Estimated audio ${fmtDuration(s.estimatedAudioSeconds)}. Narrator "${s.narrator}". ${o.jobs} job(s) would use about ${memoryMb * o.jobs} MB of memory.`);
    out('Render time depends on the machine: see the real-time factor a real run prints.');
    return;
  }
  out(`Done: ${s.done} rendered, ${s.skipped} skipped, ${s.failed} failed.`);
  out(`Audio ${fmtDuration(s.audioSeconds)} in ${fmtDuration(s.wallSeconds)}; real-time factor ${s.realTimeFactor.toFixed(2)} (synthesis only, per job).`);
  for (const f of s.failures) out(`  failed ${f.id.book}.${f.id.chapter}: ${f.error}`);
}

export async function main(argv: string[], io: { out(m: string): void; err(m: string): void } = { out: m => console.log(m), err: m => console.error(m) }): Promise<number> {
  try {
    const parsed = parseCli(argv);
    if (parsed.help) { io.out(HELP); return 0; }
    const { options, moduleFile, modulesDir } = parsed;
    const file = moduleFile ?? findModuleFile(options.module, modulesDir);
    if (!file) throw new RunError(`No module file for "${options.module}" in ${modulesDir} (looked for bible_${options.module.toLowerCase()}.db). Use --modules-dir or --module-file.`);
    const moduleText = openModuleText(file);
    try {
      const def = getEngine(options.engine);
      const summary = await runBuild(options, { moduleText, log: io.out });
      printSummary(summary, options, def.memoryMbPerJob({ quantization: options.quantization }), io.out);
      return summary.failed > 0 ? 1 : 0;
    } finally {
      moduleText.close();
    }
  } catch (e) {
    if (e instanceof SelectionError || e instanceof RunError) { io.err(`error: ${e.message}`); return 2; }
    io.err(`error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    return 2;
  }
}

export { listEngines };
