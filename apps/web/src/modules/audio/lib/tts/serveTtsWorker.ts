/**
 * Worker-side half of the TTS worker protocol.
 *
 * An engine's worker entry point calls `serveTtsWorker(self, handlers)` and
 * nothing else. This function owns the plumbing every engine would otherwise
 * repeat: it runs requests one at a time (message handlers interleave at their
 * awaits, and a single-threaded WASM engine must not be re-entered), keeps an
 * AbortController per request so `cancel` can stop what can be stopped, turns
 * thrown values into `AudioError`s, and transfers PCM buffers instead of copying.
 *
 * It takes the worker scope as a parameter (rather than using `self`) so it can
 * be exercised in a test with a fake scope.
 */

import type { LoadProgress } from '@bible/core/browser';
import { toTtsError } from './ttsErrors';
import type { SynthesizeValue, TtsWorkerHandlers, TtsWorkerReply, TtsWorkerRequest } from './ttsWorkerProtocol';

export interface WorkerScopeLike {
  postMessage(message: TtsWorkerReply, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (e: { data: TtsWorkerRequest }) => void): void;
}

export function serveTtsWorker(scope: WorkerScopeLike, handlers: TtsWorkerHandlers): void {
  const controllers = new Map<number, AbortController>();
  const cancelled = new Set<number>();
  let chain: Promise<void> = Promise.resolve();

  const reply = (msg: TtsWorkerReply, transfer?: Transferable[]) => scope.postMessage(msg, transfer);

  async function handle(msg: TtsWorkerRequest): Promise<void> {
    const ctrl = new AbortController();
    controllers.set(msg.id, ctrl);
    try {
      // Cancelled while it waited in the queue: never start it.
      if (cancelled.has(msg.id)) return;
      // Tell the page this request has started, so that a request which had to
      // wait in the queue is timed from now, not from when it was sent.
      if (msg.op === 'synthesize') reply({ id: msg.id, kind: 'progress', p: { phase: 'synthesis', loaded: 0 } });
      if (msg.op === 'prepare') reply({ id: msg.id, kind: 'progress', p: { phase: 'voice', loaded: 0 } });
      switch (msg.op) {
        case 'init':
          await handlers.init(msg.payload);
          reply({ id: msg.id, kind: 'ok' });
          break;
        case 'prepare':
          await handlers.prepare(msg.voiceId, msg.payload, (p: LoadProgress) => reply({ id: msg.id, kind: 'progress', p }), ctrl.signal);
          reply({ id: msg.id, kind: 'ok' });
          break;
        case 'synthesize': {
          // Handlers must return PCM they own: the buffer is transferred, so a
          // view onto WASM memory or a SharedArrayBuffer would fail here.
          const value: SynthesizeValue = await handlers.synthesize(msg.req, ctrl.signal);
          reply({ id: msg.id, kind: 'ok', value }, [value.pcm.buffer as ArrayBuffer]);
          break;
        }
        case 'evict':
          await handlers.evict(msg.voiceId);
          reply({ id: msg.id, kind: 'ok' });
          break;
        case 'dispose':
          reply({ id: msg.id, kind: 'ok' });
          break;
        case 'cancel':
          break; // handled synchronously below; never reaches here
      }
    } catch (e) {
      reply({ id: msg.id, kind: 'error', error: toTtsError(e) });
    } finally {
      controllers.delete(msg.id);
      cancelled.delete(msg.id);
    }
  }

  scope.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.op === 'cancel') {
      // Immediate, not queued: abort it if it is running, or remember to skip it.
      const running = controllers.get(msg.target);
      if (running) running.abort();
      else cancelled.add(msg.target);
      return;
    }
    // `handle` reports its own errors; the catch keeps one throwing `postMessage`
    // from breaking the chain and silently dropping every later request.
    chain = chain.then(() => handle(msg)).catch(() => {});
  });
}
