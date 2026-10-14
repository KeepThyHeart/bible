/**
 * Production wiring of the memory runtime (task 0114). Loaded lazily with
 * `runtime.ts` on the first memory call.
 */

import { getUserDataPath } from '../../utils/appPaths';
import { getSharedUserDb } from '../../services/sharedUserDb';
import { openHardenedExtensionDatabase } from '../../extensions/ExtensionSqlGuard';
import type { MainModuleDeps } from '../FeatureMainModule';
import type { IRemindersApi, MemoryPush } from '@bible/memory/core';
import { createDesktopBibleApi } from './desktopBible';
import { pickDefaultBible } from '../../ipc/defaultBible';
import { getSharedModuleMetadataRepo } from '../../services/sharedMainDb';
import { createDesktopSpeech } from './desktopSpeech';
import { memoryMainT } from './mainT';
import { legacyMemoryDbPath, startMemoryRuntime, type MemoryRuntime } from './runtime';

export function startDesktopMemory(
  deps: MainModuleDeps,
  emit: (push: MemoryPush) => void,
  extras: { reminders?: IRemindersApi } = {},
): Promise<MemoryRuntime> {
  return startMemoryRuntime({
    getUserDb: () => getSharedUserDb(),
    // The writable extension root main.ts gives `ExtensionDatabaseRegistry`.
    legacyDbPath: legacyMemoryDbPath(`${getUserDataPath()}/extensions`),
    // Read-only, `query_only`, `trusted_schema` off: the file was written by an extension.
    openReadOnly: (path) => openHardenedExtensionDatabase(path, { readonly: true }),
    bible: createDesktopBibleApi(deps.getWindows),
    // The reader's default translation (KJV when installed), not the first installed module.
    preferredModule: () =>
      pickDefaultBible(
        getSharedModuleMetadataRepo()
          .getByType('bible')
          .map((m) => ({ abbreviation: m.abbreviation || m.getAbbreviation() })),
      ),
    speech: createDesktopSpeech(),
    ...(extras.reminders ? { reminders: extras.reminders } : {}),
    ...(deps.getExtensions ? { getExtensions: deps.getExtensions } : {}),
    emit,
    t: memoryMainT,
    log: deps.log,
  });
}
