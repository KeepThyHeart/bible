/**
 * IPC for meaning-search settings: the online service's consent and the
 * Preferences source choice (online / offline / off). Task 0190.
 * The search itself is `search:semanticSearchEx` in `searchHandlers.ts`.
 * The renderer learns only whether a service is configured, never its URL/key.
 */
import { ipcHandler, IpcKnownError } from './handler-helper';
import { getRemoteSemanticService, SEMANTIC_SOURCES } from '../services/RemoteSemanticService';
import type { ConsentDecisionArg, RemoteSemanticStatus, SemanticSource } from '../services/RemoteSemanticService';

const DECISIONS: readonly string[] = ['granted', 'declined', 'reset'];

/** The status plus whether the offline pack is installed, for the Preferences hint. */
export type RemoteSemanticStatusReply = RemoteSemanticStatus & { localPackInstalled: boolean };

export interface RemoteSemanticHandlerDeps {
  /** True when the installed semantic pack can answer. */
  localAvailable?: () => boolean;
}

export function registerRemoteSemanticHandlers(deps: RemoteSemanticHandlerDeps = {}): void {
  const withLocal = (status: RemoteSemanticStatus): RemoteSemanticStatusReply => {
    let localPackInstalled = false;
    try {
      localPackInstalled = deps.localAvailable?.() ?? false;
    } catch {
      /* treat as not installed */
    }
    return { ...status, localPackInstalled };
  };

  ipcHandler<[], RemoteSemanticStatusReply>('remoteSemantic:getStatus', () =>
    withLocal(getRemoteSemanticService().getStatus()),
  );

  ipcHandler<[unknown], RemoteSemanticStatusReply>('remoteSemantic:setConsent', decision => {
    if (typeof decision !== 'string' || !DECISIONS.includes(decision)) {
      throw new IpcKnownError('invalid_input', 'Consent must be "granted", "declined" or "reset".');
    }
    const service = getRemoteSemanticService();
    if (!service.isConfigured()) {
      throw new IpcKnownError('unavailable', 'Online meaning search is not configured in this build.');
    }
    return withLocal(service.setConsent(decision as ConsentDecisionArg));
  });

  ipcHandler<[unknown], RemoteSemanticStatusReply>('remoteSemantic:setSource', source => {
    if (typeof source !== 'string' || !SEMANTIC_SOURCES.includes(source as SemanticSource)) {
      throw new IpcKnownError('invalid_input', 'Source must be "online", "offline" or "off".');
    }
    const service = getRemoteSemanticService();
    if (source === 'online' && !service.isConfigured()) {
      throw new IpcKnownError('unavailable', 'Online meaning search is not configured in this build.');
    }
    return withLocal(service.setSource(source as SemanticSource));
  });
}
