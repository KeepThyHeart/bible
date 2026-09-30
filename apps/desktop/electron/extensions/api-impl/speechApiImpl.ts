/**
 * Host-side stub of `ISpeechApi` for one extension worker.
 *
 * The real engines (Whisper, microphone, TTS routing) are not wired in this build yet.
 * The namespace is still registered so the worker's generic proxy does not answer
 * `Unknown RPC method`:
 *
 *   - `speech.status` is ungated: it reports what the extension has been granted, and that
 *     listening and speaking are `unavailable`.
 *   - Every other method checks its permission first (`speech:speak` or `speech:listen`),
 *     then rejects with "Speech recognition is not available in this build yet".
 *   - `speech.stopListening` (needs `speech:listen`) and `speech.cancel` (ungated, so an
 *     extension can always clean up) are idempotent no-ops: there is nothing to stop.
 *
 * Transcripts and audio are never logged here.
 */

import { Extensions } from '@bible/core';

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
}

export class SpeechApiImpl {
  private readonly router: ExtensionRpcRouter;
  private readonly grant: ExtensionPermissionGrant;

  constructor(opts: SpeechApiImplOptions) {
    this.router = opts.router;
    this.grant = opts.grant;
  }

  attach(): void {
    this.router.registerNamespace('speech', {
      status: () => this.handleStatus(),
      speak: () => this.reject('speech:speak'),
      earcon: () => this.reject('speech:speak'),
      startListening: () => this.reject('speech:listen'),
      nextUtterance: () => this.reject('speech:listen'),
      stopListening: () => {
        requirePermission(this.grant, 'speech:listen');
        return undefined;
      },
      cancel: () => undefined,
    });
  }

  private handleStatus(): Extensions.SpeechStatusDto {
    return {
      granted: {
        listen: hasPermission(this.grant, 'speech:listen'),
        speak: hasPermission(this.grant, 'speech:speak'),
      },
      listen: 'unavailable',
      speak: 'unavailable',
      languages: [],
      engineLabel: '',
      onDevice: true,
    };
  }

  private reject(permission: 'speech:listen' | 'speech:speak'): never {
    requirePermission(this.grant, permission);
    throw new RpcProtocolError(SPEECH_UNAVAILABLE_MESSAGE);
  }
}
