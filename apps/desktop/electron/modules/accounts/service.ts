/**
 * Real wiring of the accounts module (task 0150 M3): builds a `DesktopSyncService` from the app's Electron pieces
 * (safeStorage, the user database, the network gateway, the Argon2 worker, dialogs). Loaded lazily by `./index.ts`
 * on the first call, so a launch that never uses accounts pays nothing.
 */
import { app, dialog, powerMonitor, safeStorage } from 'electron';
import { hostname } from 'os';
import { dirname, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import type { MainModuleDeps } from '../FeatureMainModule';
import { getFileNotesService } from '../../ipc/fileNotesHandlers';
import { isNetworkAllowed } from '../../ipc/networkHandlers';
import { getNetworkGateway } from '../../services/NetworkGateway';
import { getSharedModuleMetadataRepo } from '../../services/sharedMainDb';
import { getSharedUserDb } from '../../services/sharedUserDb';
import { createWorkerKdf } from '../../services/backup/workerKdf';
import { DesktopSyncService, type SaveTextFileRequest } from '../../services/sync/DesktopSyncService';
import { createGatewayFetch } from '../../services/sync/gatewayFetch';
import { createModuleRefResolver } from '../../services/sync/moduleRefResolver';
import { createDesktopScheduler } from '../../services/sync/scheduler';
import { createSyncSettingsStore } from '../../services/sync/syncSettings';

export { DesktopSyncService, toAccountsError } from '../../services/sync/DesktopSyncService';

async function saveTextFile(req: SaveTextFileRequest): Promise<{ path: string } | null> {
  const isCode = req.kind === 'recovery-code';
  const result = await dialog.showSaveDialog({
    title: isCode ? 'Save recovery code' : 'Save server data export',
    defaultPath: join(app.getPath('documents'), req.suggestedName),
    filters: isCode
      ? [{ name: 'Text', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'JSON', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const content = await req.content();
  mkdirSync(dirname(result.filePath), { recursive: true });
  writeFileSync(result.filePath, content, { encoding: 'utf8', mode: 0o600 });
  return { path: result.filePath };
}

export function createAccountsService(deps: MainModuleDeps): DesktopSyncService {
  const userData = deps.userDataPath;
  const resolver = createModuleRefResolver({ getAll: () => getSharedModuleMetadataRepo().getAll() });
  return new DesktopSyncService({
    getUserDb: () => getSharedUserDb(),
    secretDir: join(userData, 'secrets'),
    safeStorage,
    // The gateway is initialised at startup; look it up per request so the order does not matter.
    fetch: ((input, init) => createGatewayFetch(getNetworkGateway())(input, init)) as typeof fetch,
    kdf: createWorkerKdf(),
    moduleResolver: resolver,
    notesDir: () => getFileNotesService()?.getNotesDir() ?? join(app.getPath('documents'), 'BibleReader'),
    bnStateFile: join(userData, 'sync', 'bn-state.json'),
    settings: createSyncSettingsStore(join(userData, 'sync', 'accounts.json')),
    networkAllowed: () => isNetworkAllowed(),
    extKvSyncs: (id) => deps.getExtensions?.()?.kvSyncOptIn?.(id) ?? false,
    scheduler: createDesktopScheduler({ powerMonitor, isConnected: () => getNetworkGateway().isConnected() }),
    saveTextFile,
    deviceName: () => hostname() || 'Desktop',
    log: deps.log,
  });
}
