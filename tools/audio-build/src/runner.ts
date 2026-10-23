/**
 * A whole run: licence gate, chapter selection, resume, rendering (in this thread or a pool),
 * the index rebuild and the summary.
 */

import { cpus } from 'node:os';
import { checkExisting } from './chapterFiles';
import type { ChapterResult, ChapterTask } from './chapterTask';
import { TextPreparer, type AudioBuildInfo, type AudioProvenance, type ITextPreparer, type ITtsEngine } from './core';
import { DEFAULT_ENCODE, type EncodeOptions } from './encode';
import type { EngineContext, EngineDefinition, Quantization } from './engines/types';
import { getEngine } from './engines/registry';
import { InProcessExecutor, WorkerPool, type Executor } from './executor';
import { rebuildIndex } from './indexBuilder';
import type { AudioFormat, LayoutRef } from './layout';
import type { ModuleText } from './moduleSource';
import { DEFAULT_RENDER, type RenderSettings } from './render';
import { decideRights } from './rights';
import { selectChapters, bookLabel, type ChapterId } from './selection';
import { prepareChapterText, type PreparedChapter } from './text';

export const TOOL_NAME = '@bible/audio-build 0.1.0';

export interface BuildOptions {
  module: string;
  engine: string;
  voice?: string;
  narrator?: string;
  rev: string;
  books?: string;
  chapters?: string;
  out: string;
  formats: AudioFormat[];
  rate: number;
  jobs: number;
  force: boolean;
  dryRun: boolean;
  cacheDir: string;
  gapMs: number;
  introGapMs: number;
  quantization: Quantization;
  ffmpeg: string;
  iHaveRights: boolean;
  /** Narrator label in the index; default "<engine label>, <voice label>". */
  label?: string;
  opusKbps?: number;
  mp3Kbps?: number;
}

export class RunError extends Error {}

export interface RunDeps {
  /** An already open module (tests); otherwise the caller opens one. */
  moduleText: ModuleText;
  /** Replace the registry lookup (tests use a fake engine). */
  engineDef?: EngineDefinition;
  /** In-process engine (tests); with it `jobs` is ignored and runs happen in this thread. */
  engine?: ITtsEngine;
  textPreparer?: ITextPreparer;
  log?: (message: string) => void;
  now?: () => number;
}

export interface PlanEntry { id: ChapterId; prepared: PreparedChapter; estimatedSeconds: number }

export interface RunSummary {
  done: number;
  skipped: number;
  failed: number;
  failures: Array<{ id: ChapterId; error: string }>;
  audioSeconds: number;
  synthSeconds: number;
  wallSeconds: number;
  /** Synthesis time over audio time (lower is faster; below 1 is faster than real time). */
  realTimeFactor: number;
  narrator: string;
  dryRun: boolean;
  planned: PlanEntry[];
  estimatedAudioSeconds: number;
}

/** Spoken English runs at roughly 15 characters a second; used only for estimates. */
const CHARS_PER_SECOND = 15;

export function estimateSeconds(p: PreparedChapter, gapMs: number, introGapMs: number): number {
  const chars = p.verses.reduce((n, v) => n + v.text.length, 0) + (p.intro?.length ?? 0);
  return chars / CHARS_PER_SECOND + (p.verses.length * gapMs + (p.intro ? introGapMs : 0)) / 1000;
}

export const safeNarrator = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

export function defaultJobs(): number { return Math.max(1, cpus().length - 1); }

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : m > 0 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export async function runBuild(o: BuildOptions, deps: RunDeps): Promise<RunSummary> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const mod = deps.moduleText;
  const def = deps.engineDef ?? getEngine(o.engine);

  const decision = decideRights(mod.rights, o.iHaveRights);
  if (!decision.allowed) throw new RunError(decision.reason);
  if (decision.reason.startsWith('allowed by')) log(`Licence gate bypassed: ${decision.reason}.`);

  const voice = o.voice ?? def.defaultVoice(mod.language);
  if (!voice) throw new RunError(`No default ${def.id} voice for language "${mod.language}"; pass --voice.`);
  const badVoice = def.checkVoice(voice);
  if (badVoice) throw new RunError(badVoice);
  const langBase = mod.language.toLowerCase().split(/[-_]/)[0];
  if (!def.languages.includes(langBase)) throw new RunError(`${def.label} does not speak "${mod.language}".`);

  const narrator = safeNarrator(o.narrator ?? `${def.id}-${voice}`);
  if (!narrator) throw new RunError('The narrator id is empty.');
  const settings: RenderSettings = { rate: o.rate, gapMs: o.gapMs, introGapMs: o.introGapMs, trim: DEFAULT_RENDER.trim };
  const layout: LayoutRef = { out: o.out, module: o.module, narrator, rev: o.rev };
  const enc: EncodeOptions = { ffmpeg: o.ffmpeg, opusKbps: o.opusKbps ?? DEFAULT_ENCODE.opusKbps, mp3Kbps: o.mp3Kbps ?? DEFAULT_ENCODE.mp3Kbps };
  const build: AudioBuildInfo = {
    engine: def.id,
    voice,
    model: def.modelLabel({ quantization: o.quantization }),
    rate: o.rate,
    gapMs: o.gapMs,
    introGapMs: o.introGapMs,
    tool: TOOL_NAME,
  };

  const available = mod.chapters();
  const selected = selectChapters(available, { books: o.books, chapters: o.chapters });
  const prep = deps.textPreparer ?? new TextPreparer();

  // Plan: prepare every selected chapter's text (cheap), then decide render or skip.
  const planned: PlanEntry[] = [];
  const todo: PlanEntry[] = [];
  let skipped = 0;
  for (const id of selected) {
    const prepared = prepareChapterText(prep, {
      moduleAbbr: o.module,
      book: id.book,
      chapter: id.chapter,
      bookName: mod.bookName(id.book),
      language: mod.language,
      verses: mod.verses(id.book, id.chapter),
    });
    if (prepared.verses.length === 0) { log(`${bookLabel(id.book)} ${id.chapter}: no text, skipped.`); skipped++; continue; }
    const entry: PlanEntry = { id, prepared, estimatedSeconds: estimateSeconds(prepared, o.gapMs, o.introGapMs) };
    planned.push(entry);
    if (!o.force) {
      const existing = await checkExisting(layout, id, prepared.textHash, build, o.formats);
      if (existing.ok) { skipped++; continue; }
    }
    todo.push(entry);
  }
  const estimatedAudioSeconds = todo.reduce((n, e) => n + e.estimatedSeconds, 0);

  const summary: RunSummary = {
    done: 0, skipped, failed: 0, failures: [], audioSeconds: 0, synthSeconds: 0, wallSeconds: 0, realTimeFactor: 0,
    narrator, dryRun: o.dryRun, planned: todo, estimatedAudioSeconds,
  };
  if (o.dryRun) return summary;

  const credits = await def.credits(voice, { cacheDir: o.cacheDir, threads: 1, quantization: o.quantization, log });
  const provenance: AudioProvenance = { engine: credits.engine, model: credits.model, voice: credits.voice, text: decision.credit };

  if (todo.length > 0) {
    const jobs = deps.engine ? 1 : Math.max(1, Math.min(o.jobs, todo.length));
    const threads = Math.max(1, Math.floor(cpus().length / jobs));
    const ctx: Omit<EngineContext, 'log'> = { cacheDir: o.cacheDir, threads, quantization: o.quantization };
    let executor: Executor;
    if (deps.engine) {
      executor = new InProcessExecutor(deps.engine);
    } else if (jobs === 1) {
      const engine = def.create({ ...ctx, log });
      log(`Loading ${def.id} (${build.model}), voice ${voice}...`);
      await engine.prepare(voice, () => {}, new AbortController().signal);
      executor = new InProcessExecutor(engine);
    } else {
      log(`Starting ${jobs} workers (about ${def.memoryMbPerJob({ quantization: o.quantization })} MB each, ${threads} thread(s) each)...`);
      executor = await WorkerPool.start(jobs, { engineId: def.id, voice, ctx }, log);
    }

    let settled = 0;
    const runOne = async (entry: PlanEntry): Promise<void> => {
      const task: ChapterTask = {
        book: entry.id.book, chapter: entry.id.chapter, prepared: entry.prepared, voice, settings, layout, formats: o.formats, enc, build,
      };
      const r: ChapterResult = await executor.run(task);
      settled++;
      if (r.ok) {
        summary.done++;
        summary.audioSeconds += r.audioSeconds;
        summary.synthSeconds += r.synthSeconds;
      } else {
        summary.failed++;
        summary.failures.push({ id: entry.id, error: r.error ?? 'unknown error' });
      }
      const wall = (now() - t0) / 1000;
      const remainingEst = todo.filter((_, i) => i >= settled).reduce((n, e) => n + e.estimatedSeconds, 0);
      const perAudio = summary.audioSeconds > 0 ? wall / summary.audioSeconds : 0;
      const eta = perAudio > 0 ? (remainingEst * perAudio) : 0;
      log(r.ok
        ? `[${settled}/${todo.length}] ${bookLabel(entry.id.book)} ${entry.id.chapter}: ${fmtDuration(r.audioSeconds)} audio, RTF ${(r.synthSeconds / Math.max(r.audioSeconds, 0.001)).toFixed(2)}, ~${fmtDuration(eta)} left`
        : `[${settled}/${todo.length}] ${bookLabel(entry.id.book)} ${entry.id.chapter}: FAILED: ${r.error}`);
    };

    // Feed the executor; a worker pool runs `jobs` of them at once, the in-process one runs them in order.
    const queue = [...todo];
    const lanes = Array.from({ length: jobs }, async () => {
      for (let e = queue.shift(); e; e = queue.shift()) await runOne(e);
    });
    try { await Promise.all(lanes); } finally { await executor.close(); }
  }

  await rebuildIndex({
    out: o.out,
    module: o.module,
    built: [{ id: narrator, label: o.label ?? `${def.label.split(' (')[0]}, ${voice}`, language: mod.language, rev: o.rev, provenance }],
    chaptersOfBook: available,
  });

  summary.wallSeconds = (now() - t0) / 1000;
  summary.realTimeFactor = summary.audioSeconds > 0 ? summary.synthSeconds / summary.audioSeconds : 0;
  return summary;
}
