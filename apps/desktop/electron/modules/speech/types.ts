/**
 * Shared wire types between the speech main module (bridge) and the speech renderer module
 * (bridgeHost). The engine lives in the renderer; main forwards ISpeechApi calls to it.
 * Channel names: event `module:speech:event:call`, invokes `module:speech:reply` and `module:speech:ready`.
 */
import type { ISpeechApi } from '@bible/core/speech';

export type SpeechMethod = keyof ISpeechApi;

/** Main to renderer. */
export interface SpeechBridgeCall {
  callId: number;
  method: SpeechMethod;
  args: unknown[];
}

/** Renderer to main: the outcome of one call. Never carries log-worthy audio. */
export type SpeechBridgeResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** The module API the renderer reaches through window.electronAPI.modules.speech. */
export interface SpeechModuleApi {
  reply(callId: number, result: SpeechBridgeResult): Promise<void>;
  ready(): Promise<void>;
}

export const SPEECH_CALL_EVENT = 'call';

/** Event map for `createModuleClient<SpeechModuleApi, SpeechEvents>('speech')`. */
export interface SpeechEvents {
  call: [call: SpeechBridgeCall];
}
