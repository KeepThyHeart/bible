/**
 * Extension-facing speech API (`api.speech`): JSON-only DTOs.
 *
 * Host semantics: utterances are queued from `startListening` on, so nothing
 * spoken between two `nextUtterance` pulls is lost. The microphone is gated while
 * `speak` or `earcon` plays (half duplex). The host returns transcripts only,
 * never audio, and never logs transcripts. Methods only (no events), so the API
 * surface contract holds.
 */

import type { SpeechBias, Transcript } from './types';

export type EarconKind = 'listen' | 'ok' | 'miss' | 'done';

export interface SpeechStatusDto {
  granted: { listen: boolean; speak: boolean };
  listen: 'ready' | 'needs-download' | 'unavailable';
  speak: 'ready' | 'needs-download' | 'unavailable';
  languages: string[];
  engineLabel: string;
  onDevice: boolean;
}

export interface StartListeningDto {
  language: string;
  bias?: SpeechBias;
  maxDurationMs: number;
  /** Default 1500: the pause that ends one utterance. */
  endSilenceMs?: number;
}

export type UtteranceOutcomeDto =
  | { kind: 'speech'; transcript: Transcript }
  | { kind: 'no-speech' }
  | { kind: 'ended'; reason: 'max-duration' | 'stopped' | 'aborted' }
  | { kind: 'error'; code: 'mic-denied' | 'mic-busy' | 'engine' | 'not-ready'; message: string };

export interface ISpeechApi {
  /** Ungated: reports what is granted. */
  status(): Promise<SpeechStatusDto>;
  /** Requires speech:speak. */
  speak(text: string, o?: { language?: string; rate?: number }): Promise<{ completed: boolean }>;
  /** Requires speech:speak. */
  earcon(kind: EarconKind): Promise<void>;
  /** Requires speech:listen. One listen app-wide. */
  startListening(o: StartListeningDto): Promise<{ listenId: string }>;
  /** Requires speech:listen. */
  nextUtterance(listenId: string, o: { noSpeechTimeoutMs: number }): Promise<UtteranceOutcomeDto>;
  /** Idempotent. */
  stopListening(listenId: string): Promise<void>;
  /** Stops this extension's speech output and listens; pending calls resolve (completed:false / ended). */
  cancel(): Promise<void>;
}
