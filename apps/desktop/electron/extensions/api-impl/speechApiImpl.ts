/**
 * Host side of `api.speech` for one extension worker.
 *
 * The engine runs in the renderer; main reaches it through the speech hub (`speech` option, a
 * scoped view per extension). When the hub has none (`recite` flag off, module not loaded):
 *
 *   - `speech.status` is ungated and reports what the extension has been granted, with listening
 *     and speaking `unavailable`.
 *   - Every other method checks its permission first (`speech:speak` or `speech:listen`), then
 *     rejects with "Speech recognition is not available in this build yet".
 *   - `speech.stopListening` and `speech.cancel` are idempotent no-ops.
 *
 * `cancel` is ungated (an extension can always clean up) and stops only this extension's own
 * listens and speech. Transcripts and audio are never logged here.
 */

import { Extensions } from '@bible/core';
import type { ISpeechApi } from '@bible/core/speech';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  hasPermission,
  requirePermission,
} from '../ExtensionPermissionGuard';

const { RpcProtocolError } = Extensions;

export const SPEECH_UNAVAILABLE_MESSAGE = 'Speech recognition is not available in this build yet';

export interface SpeechApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  grant: ExtensionPermissionGrant;
  /** This extension's scoped view of the shared speech service; null/absent when unavailable. */
  speech?: () => ISpeechApi | null;
}

export class SpeechApiImpl {
  private readonly router: ExtensionRpcRouter;
  private readonly grant: ExtensionPermissionGrant;
  private readonly speech: () => ISpeechApi | null;

  constructor(opts: SpeechApiImplOptions) {
    this.router = opts.router;
    this.grant = opts.grant;
    this.speech = opts.speech ?? (() => null);
  }

  attach(): void {
    this.router.registerNamespace('speech', {
      status: () => this.handleStatus(),
      speak: (args: unknown[]) => {
        const [text, o] = args as Parameters<ISpeechApi['speak']>;
        return this.use('speech:speak', (s) => s.speak(text, o));
      },
      earcon: (args: unknown[]) => {
        const [kind] = args as Parameters<ISpeechApi['earcon']>;
        return this.use('speech:speak', (s) => s.earcon(kind));
      },
      startListening: (args: unknown[]) => {
        const [o] = args as Parameters<ISpeechApi['startListening']>;
        return this.use('speech:listen', (s) => s.startListening(o));
      },
      nextUtterance: (args: unknown[]) => {
        const [id, o] = args as Parameters<ISpeechApi['nextUtterance']>;
        return this.use('speech:listen', (s) => s.nextUtterance(id, o));
      },
      stopListening: (args: unknown[]) => {
        requirePermission(this.grant, 'speech:listen');
        const [id] = args as Parameters<ISpeechApi['stopListening']>;
        return this.speech()?.stopListening(id);
      },
      cancel: () => this.speech()?.cancel(),
    });
  }

  private async handleStatus(): Promise<Extensions.SpeechStatusDto> {
    const granted = {
      listen: hasPermission(this.grant, 'speech:listen'),
      speak: hasPermission(this.grant, 'speech:speak'),
    };
    const base = await this.speech()?.status();
    if (!base) {
      return { granted, listen: 'unavailable', speak: 'unavailable', languages: [], engineLabel: '', onDevice: true };
    }
    return { ...base, granted };
  }

  private use<T>(permission: 'speech:listen' | 'speech:speak', fn: (s: ISpeechApi) => Promise<T>): Promise<T> {
    requirePermission(this.grant, permission);
    const s = this.speech();
    if (!s) throw new RpcProtocolError(SPEECH_UNAVAILABLE_MESSAGE);
    return fn(s);
  }
}
