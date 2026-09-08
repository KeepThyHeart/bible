# Sessions

**Last verified:** 2026-09-08

Study session persistence with auto-save and restore. Captures the full UI state (open tabs, pane positions, scroll positions, etc.).

## Files

### State

| File | Description |
|---|---|
| `src/ui/stores/useSessionStore.ts` | Zustand store for session state; `useSessionAutoSave()` hook for periodic auto-saving on the `autoSaveIntervalMs` interval (30 seconds by default) |
| `src/ui/stores/helpers/sessionNotifier.ts` | Decoupled dirty-notification callback; stores call `markSessionDirty()` without importing useSessionStore |
| `src/ui/stores/helpers/sessionRegistry.ts` | Registry where stores register serializers; useSessionStore collects session data via the registry instead of direct imports. Exports `registerSessionSerializer()`, `registerSessionRestorer()`, `collectSessionData()` |

### Services

| File | Description |
|---|---|
| `src/ui/services/electronAPI.ts` | `sessionAPI` methods for session IPC calls (includes other IPC wrappers too); the single chokepoint that unwraps the handlers' result envelopes |
| `src/ui/services/AppInitService.ts` | `initializeApp()` loads the autosave session and drives the restore order; `registerSaveBeforeCloseHandler()` wires the main process's save-before-close request (flushing any in-progress note edit first) |
| `src/ui/services/stripTransientPanels.ts` | Drops panels that must not come back on the next launch (`newtab`) out of the serialized layout; called from `useLayoutStore.serializeLayout()` |

### IPC Handlers (Main Process)

| File | Description |
|---|---|
| `electron/ipc/sessionHandlers.ts` | IPC handlers for session CRUD, auto-save, and restore. Channels: `session:getAll`, `session:load`, `session:getOrCreateAutosave`, `session:create`, `session:update`, `session:delete`, `session:setAsDefault`, `session:getDefault`, `session:getRecent` |
| `electron/main.ts` | Sends `session:save-requested` to the renderer before the window closes and waits for `session:save-result`, capped by `SESSION_SAVE_SHUTDOWN_TIMEOUT_MS` (5 seconds, in `electron/config/constants.ts`) so a frozen renderer cannot block the quit |

### Core Model

| File | Description |
|---|---|
| `packages/core/src/Data/Models/User/Session.ts` | `SessionData` interface with `dockviewState` field for layout persistence, plus the `ui.preferences` / `ui.textSettings` / `ui.textSettingsCustomized` / `ui.notesPanels` sub-objects |
| `packages/core/src/Data/Repositories/SessionRepository.ts` | Reads/writes the `session` table in the user DB (interface: `ISessionRepository.ts`) |
| `packages/core/src/Services/SessionSerializationService.ts` | A platform-agnostic controller-registry alternative to the Zustand serializer registry. Exported from `@bible/core` but **unused** - the desktop path is `helpers/sessionRegistry.ts` above |

### Tests

| File | Description |
|---|---|
| `src/ui/stores/__tests__/sessionMigration.test.ts` | `stores/bible/sessionMigration.ts`: normalizing a saved Bible-pane payload without losing a passage, without crashing on an unexpected shape, and idempotently |
| `src/ui/stores/__tests__/notesPanelSession.test.ts` | `ui.notesPanels` serialize/restore/prune |
| `src/ui/stores/bible/slices/sessionSlice.test.ts` | Bible store session slice |
| `src/ui/stores/commentary/slices/sessionSlice.test.ts` | Commentary store session slice |
| `src/ui/stores/usePreferencesStore.sessionPersistence.test.ts` | Preferences under `ui.preferences`, with corrupt-data fallback |
| `src/ui/stores/useTextSettingsStore.sessionPersistence.test.ts` | Per-pane text settings under `ui.textSettings` / `ui.textSettingsCustomized` |

## Key Behaviors

- Auto-save runs periodically via the `useSessionAutoSave()` hook, and once more on `beforeunload`.
- On startup, the app loads the autosave session and restores all pane states.
- Each store registers a session serializer via `registerSessionSerializer()` in `helpers/sessionRegistry.ts`.
- Each store calls `markSessionDirty()` from `helpers/sessionNotifier.ts` instead of importing useSessionStore.
- Each store has a `restoreFromSession()` method that rehydrates from session data.
- Dockview layout is serialized via `useLayoutStore.serializeLayout()` into `SessionData.dockviewState`. That call runs the layout through `stripTransientPanels()` first, so a "New Tab" chooser left open is not restored on the next launch.
- On restore, the saved layout is passed to `DockviewLayout`, which calls `api.fromJSON()` to recreate the panel arrangement. A session with no `dockviewState`, or one dockview cannot read, falls back to the default layout.
- Theme, global font scale, UI control size, and typography (`usePreferencesStore`) live under `SessionData.ui.preferences`; per-pane font settings (`useTextSettingsStore`) live under `ui.textSettings`, with their `customized` flags in the sibling `ui.textSettingsCustomized` field. Both are restored synchronously and early in `AppInitService.initializeApp()` - before the async commentary/dictionary/bookmark loads - and both use the same registry pattern as other stores (`registerSessionSerializer()` in `helpers/sessionRegistry.ts`), but restoration is called directly from `AppInitService.ts` rather than through the (unused) `registerSessionRestorer()` half of that registry. See [settings-preferences.md](./settings-preferences.md#session-persistence) for the full contract, including per-field corrupt-data fallback.
- A saved session carrying no `ui.textSettingsCustomized` object, or only part of one, restores the panes it does not name as **not** customized, so they keep following the Typography section live.
- The Writing pane's *contents* are session state too: each notes panel's view, sidebar sub-tab, folder and open note ride under `SessionData.ui.notesPanels`, keyed by dockview panel id, via the `fileNotes` serializer. Restored (and pruned against the restored layout) in `AppInitService.initializeApp()`, and claimed panel-by-panel on mount - see [notes-writing.md](./notes-writing.md#the-writing-pane-reopens-where-you-left-it).
