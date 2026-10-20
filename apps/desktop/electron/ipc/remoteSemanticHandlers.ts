/**
 * IPC for the online meaning search status and consent (task 0190).
 * The search itself is `search:semanticSearchEx` in `searchHandlers.ts`.
 * The renderer learns only whether a service is configured, never its URL/key.
 */
import { ipcHandler, IpcKnownError } from './handler-helper';
import { getRemoteSemanticService } from '../services/RemoteSemanticService';
import type { ConsentDecisionArg, RemoteSemanticStatus } from '../services/RemoteSemanticService';

const DECISIONS: readonly string[] = ['granted', 'declined', 'reset'];

export function registerRemoteSemanticHandlers(): void {
  ipcHandler<[], RemoteSemanticStatus>('remoteSemantic:getStatus', () =>
    getRemoteSemanticService().getStatus(),
  );

  ipcHandler<[unknown], RemoteSemanticStatus>('remoteSemantic:setConsent', decision => {
    if (typeof decision !== 'string' || !DECISIONS.includes(decision)) {
      throw new IpcKnownError('invalid_input', 'Consent must be "granted", "declined" or "reset".');
    }
    const service = getRemoteSemanticService();
    if (!service.isConfigured()) {
      throw new IpcKnownError('unavailable', 'Online meaning search is not configured in this build.');
    }
    return service.setConsent(decision as ConsentDecisionArg);
  });
}
