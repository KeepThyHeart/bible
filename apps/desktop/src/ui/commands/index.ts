/**
 * Bootstrap entry-point that registers every built-in command module against
 * an `ICommandRegistry`. Called once at app startup from `main.tsx` (or
 * wherever the renderer initializes the services).
 *
 * Returns a single disposable that, when disposed, unregisters every command
 * registered by every module - used by tests to start from a clean slate.
 */

import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IDisposable } from '../types/Command';

import { registerBibleCommands } from './bibleCommands';
import { registerCommentaryCommands } from './commentaryCommands';
import { registerBookCommands } from './bookCommands';
import { registerDictionaryCommands } from './dictionaryCommands';
import { registerNotesCommands } from './notesCommands';
import { registerBookmarkCommands } from './bookmarkCommands';
import { registerPrayerCommands } from './prayerCommands';
import { registerStudyCommands } from './studyCommands';
import { registerTopicsCommands } from './topicsCommands';
import { registerSearchCommands } from './searchCommands';
import { registerViewCommands } from './viewCommands';
import { registerLayoutCommands } from './layoutCommands';
import { registerSessionCommands } from './sessionCommands';
import { registerModuleCommands } from './moduleCommands';
import { registerAppCommands } from './appCommands';
import { registerSearchBarCommands } from './searchBarCommands';
import { registerDiagnosticsCommands } from './diagnosticsCommands';
import { registerNetworkCommands } from './networkCommands';

export function registerBuiltinCommands(registry: ICommandRegistry): IDisposable {
  const all: IDisposable[] = [
    ...registerBibleCommands(registry),
    ...registerCommentaryCommands(registry),
    ...registerBookCommands(registry),
    ...registerDictionaryCommands(registry),
    ...registerNotesCommands(registry),
    ...registerBookmarkCommands(registry),
    ...registerPrayerCommands(registry),
    ...registerStudyCommands(registry),
    ...registerTopicsCommands(registry),
    ...registerSearchCommands(registry),
    ...registerViewCommands(registry),
    ...registerLayoutCommands(registry),
    ...registerSessionCommands(registry),
    ...registerModuleCommands(registry),
    ...registerAppCommands(registry),
    ...registerSearchBarCommands(registry),
    ...registerDiagnosticsCommands(registry),
    ...registerNetworkCommands(registry),
  ];
  return {
    dispose: () => {
      for (const d of all) d.dispose();
    },
  };
}
