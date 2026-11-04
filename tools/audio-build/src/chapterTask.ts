/** One chapter, start to finish: synthesize, join, encode, write. Runs in the main thread or a worker. */

import type { AudioBuildInfo, ITtsEngine } from './core';
import { writeChapter } from './chapterFiles';
import type { EncodeOptions } from './encode';
import type { AudioFormat, LayoutRef } from './layout';
import { renderChapter, type RenderSettings } from './render';
import type { PreparedChapter } from './text';

export interface ChapterTask {
  book: number;
  chapter: number;
  prepared: PreparedChapter;
  voice: string;
  settings: RenderSettings;
  layout: LayoutRef;
  formats: AudioFormat[];
  enc: EncodeOptions;
  build: AudioBuildInfo;
}

export interface ChapterResult {
  book: number;
  chapter: number;
  ok: boolean;
  error?: string;
  /** Seconds of audio produced. */
  audioSeconds: number;
  /** Wall seconds spent synthesizing (the real-time factor is this over `audioSeconds`). */
  synthSeconds: number;
  /** Wall seconds spent encoding and writing. */
  encodeSeconds: number;
  bytes: number;
}

export async function runChapterTask(engine: ITtsEngine, task: ChapterTask, signal: AbortSignal): Promise<ChapterResult> {
  const base = { book: task.book, chapter: task.chapter, audioSeconds: 0, synthSeconds: 0, encodeSeconds: 0, bytes: 0 };
  try {
    const t0 = performance.now();
    const rendered = await renderChapter(engine, task.voice, task.prepared, task.settings, signal);
    const t1 = performance.now();
    const manifest = await writeChapter(task.layout, task, rendered, task.prepared.textHash, task.build, task.formats, task.enc);
    const t2 = performance.now();
    return {
      ...base,
      ok: true,
      audioSeconds: rendered.duration,
      synthSeconds: (t1 - t0) / 1000,
      encodeSeconds: (t2 - t1) / 1000,
      bytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
    };
  } catch (e) {
    return { ...base, ok: false, error: e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e) };
  }
}
