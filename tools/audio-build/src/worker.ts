/** Worker thread entry: owns one engine and runs the chapter tasks it is sent. */

import { parentPort, workerData } from 'node:worker_threads';
import { runChapterTask, type ChapterTask } from './chapterTask';
import { getEngine } from './engines/registry';
import type { WorkerInit } from './executor';

async function main(): Promise<void> {
  const port = parentPort!;
  const init = workerData as WorkerInit;
  const log = (message: string): void => port.postMessage({ type: 'log', message });
  const def = getEngine(init.engineId);
  const engine = def.create({ ...init.ctx, log });
  await engine.prepare(init.voice, () => {}, new AbortController().signal);
  const ctrl = new AbortController();
  port.on('message', (m: { type: string; task?: ChapterTask }) => {
    if (m.type !== 'task' || !m.task) return;
    void runChapterTask(engine, m.task, ctrl.signal).then(result => port.postMessage({ type: 'result', result }));
  });
  port.postMessage({ type: 'ready' });
}

main().catch(e => parentPort!.postMessage({ type: 'fatal', error: e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e) }));
