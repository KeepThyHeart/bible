import type { IMicrophone, MicStream } from '@bible/core/speech';
import { PCM_WORKLET_NAME, PCM_WORKLET_URL } from './workletUrl';

/** Map a getUserMedia / AudioContext failure to a ListenOutcome error code. */
export function micErrorCode(err: unknown): 'mic-denied' | 'mic-busy' {
  const name = (err as { name?: string } | null)?.name;
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'mic-denied' : 'mic-busy';
}

function micError(err: unknown): Error {
  const name = (err as { name?: string } | null)?.name;
  const e = new Error(name === 'NotFoundError' ? 'No microphone found' : (err as Error)?.message || 'Microphone unavailable');
  e.name = micErrorCode(err);
  return e;
}

/** getUserMedia -> AudioContext -> AudioWorklet yielding 16 kHz mono 20 ms frames. Errors carry name 'mic-denied' | 'mic-busy'. */
export class WebMicrophone implements IMicrophone {
  private ctx: AudioContext | null = null;
  private loaded = false;

  async open(o: { echoCancellation: boolean; noiseSuppression: boolean }, signal: AbortSignal): Promise<MicStream> {
    if (signal.aborted) throw abortError();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: o.echoCancellation,
          noiseSuppression: o.noiseSuppression,
          autoGainControl: true,
        },
      });
    } catch (e) {
      throw micError(e);
    }
    let source: MediaStreamAudioSourceNode | null = null;
    let node: AudioWorkletNode | null = null;
    const stop = () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        source?.disconnect();
        node?.disconnect();
        if (node) node.port.onmessage = null;
      } catch {
        /* already disconnected */
      }
    };
    try {
      if (signal.aborted) throw abortError();
      if (!this.ctx || this.ctx.state === 'closed') {
        this.ctx = new AudioContext();
        this.loaded = false;
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      if (!this.loaded) {
        await this.ctx.audioWorklet.addModule(PCM_WORKLET_URL);
        this.loaded = true;
      }
      if (signal.aborted) throw abortError();
      source = this.ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(this.ctx, PCM_WORKLET_NAME);
      source.connect(node);
    } catch (e) {
      stop();
      if ((e as Error).name === 'AbortError' && signal.aborted) throw e;
      throw micError(e);
    }

    const subs = new Set<(f: Float32Array) => void>();
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => subs.forEach((cb) => cb(ev.data));
    let closed = false;
    const onAbort = () => close();
    const close = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', onAbort);
      subs.clear();
      stop();
    };
    signal.addEventListener('abort', onAbort);
    return {
      onFrame(cb) {
        subs.add(cb);
        return () => void subs.delete(cb);
      },
      close,
    };
  }
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}
