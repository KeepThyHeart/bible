# IPC handler conventions

This folder contains IPC handlers that mediate between the React renderer and the Electron main process. There is **one** registration helper:

| Helper | Location | Reply shape |
|---|---|---|
| `ipcHandler` | `electron/ipc/handler-helper.ts` | `Result<T> = { ok, value } \| { ok: false, error: { code, message } }` |

## Why this helper?

- **Classified errors.** Throwing `new IpcKnownError('not_found', '...')` produces an envelope the renderer can branch on without parsing strings.
- **Severity-aware logging.** Known errors -> single-line `log.warn`. Unexpected errors -> `log.error` with the original Error object so electron-log captures the stack trace via its file transport.
- **One reply shape.** Every handler in this folder replies with the same envelope, so the renderer has exactly one shape to unwrap.

## Writing a new handler

```ts
import { ipcHandler, IpcKnownError } from '../ipc/handler-helper';

ipcHandler<[number], SerializedNote>('notes:get-by-id', async (noteId) => {
  const note = await repo.getById(noteId);
  if (!note) {
    throw new IpcKnownError('not_found', `Note ${noteId} not found`);
  }
  return serializeNote(note);
});
```

The `Args` tuple matches the renderer's `invoke(channel, ...args)` arguments positionally; the second generic is the success payload type.

## Calling from the renderer

```ts
import { unwrap, IpcResultError } from '@/services/ipcResult';

try {
  const note = await unwrap(
    window.electron.ipcRenderer.invoke('notes:get-by-id', id)
  );
  // use note
} catch (err) {
  if (err instanceof IpcResultError && err.code === 'not_found') {
    // expected - render empty state
  } else {
    throw err; // unexpected, let error boundary catch it
  }
}
```

## Standard error codes

Defined in `result.ts`:

| Code | Meaning |
|---|---|
| `not_found` | Entity does not exist (often handled in UI as empty state) |
| `invalid_input` | Caller passed bad arguments |
| `unauthorized` | Caller lacks permission |
| `conflict` | State conflict (e.g., duplicate insert) |
| `unavailable` | Required service or DB not initialised yet |
| `internal` | Unexpected error - DB failure, FS failure, bug |

The first five codes should be raised explicitly via `IpcKnownError`. Anything else falls through the catch and is reported as `internal` automatically.
