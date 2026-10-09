/**
 * Renderer side of the speech bridge (task 0151). Main forwards ISpeechApi calls as
 * `module:speech:event:call`; this answers each with `reply(callId, result)`. The engine
 * (`@bible/speech`: Whisper worker, mic, VAD) is imported dynamically on the first call, so nothing
 * of it loads at boot. Transcripts and audio are never logged.
 */
import type { ISpeechApi } from '@bible/core/speech';
import type { SpeechPrefs, SpeechPrefsStore } from '@bible/speech';
import type { SpeechBridgeCall, SpeechBridgeResult, SpeechModuleApi } from '../../../../electron/modules/speech/types';
import { SPEECH_CALL_EVENT } from '../../../../electron/modules/speech/types';
import { createModuleClient, type ModuleClient } from '../../services/moduleClient';
import { createDesktopModelFiles } from './desktopModelFiles';

/** What the renderer needs of the service: ISpeechApi plus the settings-UI extras. */
export type RendererSpeechService = ISpeechApi & {
  prepareModel(id: string, onProgress: (p: { loaded: number; total?: number }) => void, signal: AbortSignal): Promise<void>;
  removeModel(id: string): Promise<void>;
  chosen(): Promise<string | { model: string }>;
};

const PREFS_KEY = 'kth.speech.prefs';
const DEFAULT_PREFS: SpeechPrefs = { model: 'auto', device: 'auto' };

/** Prefs persisted in the renderer's localStorage (per device). */
export const speechPrefs: SpeechPrefsStore = {
  get() {
    try {
      const v = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<SpeechPrefs> | null;
      const model = v?.model === 'base' || v?.model === 'tiny' ? v.model : 'auto';
      const device = v?.device === 'webgpu' || v?.device === 'wasm' ? v.device : 'auto';
      return { model, device };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  },
  set(prefs) {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode: the choice lasts until reload only */
    }
  },
};

export interface ServiceDeps {
  /** Dynamic import seam, replaced in tests. */
  loadEngine?: () => Promise<typeof import('@bible/speech')>;
}

let servicePromise: Promise<RendererSpeechService> | null = null;

/** The one renderer speech service, created on first use. */
export function getSpeechService(deps: ServiceDeps = {}): Promise<RendererSpeechService> {
  servicePromise ??= (deps.loadEngine ?? (() => import('@bible/speech')))().then(
    (m) =>
      m.createSpeechService({
        files: createDesktopModelFiles(),
        // Absolute-from-root URL of the emitted/served ORT wasm (see scripts/ortWasmPlugin.mjs).
        ortBase: new URL('ort/', document.baseURI).href,
        prefs: speechPrefs,
      }) as unknown as RendererSpeechService,
    (err) => {
      servicePromise = null; // allow a retry
      throw err;
    },
  );
  return servicePromise;
}

/** Test seam. */
export function resetSpeechServiceForTests(): void {
  servicePromise = null;
}

const defaultClient = (): ModuleClient<SpeechModuleApi> => createModuleClient<SpeechModuleApi>('speech');
type EventBridge = { on(ns: string, event: string, cb: (...a: any[]) => void): () => void };
const defaultEvents = (): EventBridge => (window as unknown as { electron: { modules: EventBridge } }).electron.modules;

/** Run one forwarded call against the service. */
export async function answer(call: SpeechBridgeCall, getService: () => Promise<ISpeechApi> = getSpeechService): Promise<SpeechBridgeResult> {
  try {
    const service = (await getService()) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    const fn = service[call.method];
    if (typeof fn !== 'function') return { ok: false, error: `Unknown speech method: ${String(call.method)}` };
    return { ok: true, value: await fn.apply(service, call.args) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Subscribe to main's calls and announce readiness. Returns the unsubscribe function. */
export function installBridgeHost(
  client: Pick<SpeechModuleApi, 'reply' | 'ready'> = defaultClient(),
  events: EventBridge = defaultEvents(),
  getService: () => Promise<ISpeechApi> = getSpeechService,
): () => void {
  const off = events.on('speech', SPEECH_CALL_EVENT, (call: SpeechBridgeCall) => {
    void answer(call, getService).then((result) => client.reply(call.callId, result)).catch(() => undefined);
  });
  void Promise.resolve(client.ready()).catch(() => undefined);
  return off;
}
