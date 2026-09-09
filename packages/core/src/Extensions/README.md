# `@bible/core` - Extensions namespace

This folder contains the **type contract** that third-party extensions speak
when integrating with the Bible desktop app. The types are the contract, and
each file's header comment carries the rationale for its own slice of it; this
README is the navigation aid.

> **Status:** the contract types live here; the host runtime, manifest loader,
> permission guard, IPC bridge, and all `api-impl/*` files live under
> `apps/desktop/electron/extensions/`, and the worker-side runtime under
> `apps/desktop/extension-runtime/`.

## Files in this folder

| File | Purpose |
|---|---|
| `RpcEnvelope.ts` | Request / response / event / subscribe / heartbeat envelope shapes shared by host, worker, and iframe. |
| `Permissions.ts` | Permission identifiers, default-grant set, separately-prompted set, and the `ORDER_*` render-order constants. |
| `ActivationEvents.ts` | Activation event identifiers and string-composition helpers. |
| `ExtensionApiTypes.ts` | The `BibleExtensionAPI` shape, every namespace interface, every DTO, and the `EXTENSION_API_VERSION` constant. |
| `ExtensionPointTypes.ts` | Payload and return types for the ~30 host-emitted extension points. |
| `ExtensionManifest.ts` | The TypeScript shape of `extension.json`. |
| `ExtensionManifestSchema.json` | JSON Schema (draft-07) the manifest loader validates against. The schema is the only validator. |

## Entry point resolution (`manifest.main`)

`manifest.main` MUST be a package-relative path (`"./main.js"`); the validator
rejects absolute paths with `path.absolute`. The worker therefore cannot load
it on its own - a bare relative specifier handed to `import()` resolves against
the *runtime bundle* in `out/main/extension-runtime/`, not against the
extension.

So `ExtensionInitPayload` carries `installPath`, and
`apps/desktop/extension-runtime/resolveEntry.ts` turns
`(installPath, manifest.main)` into a `file://` URL, rejecting anything that
resolves outside `installPath`. Two consequences for authors:

- Ship `main` as a path relative to the package root. Nested paths
  (`./dist/main.js`) are fine; `..` segments that escape the package are not.
- A `data:text/javascript,...` URL is also accepted (self-contained module, no
  base path). Other URL schemes - `file:`, `http(s):`, `node:` - are rejected.

## Known issue - extensions root is not user-writable when packaged

`main.ts` derives the extensions root from `getDataPath()`, which resolves to
`process.resourcesPath/data/extensions` in a packaged build. That is writable
under the current Windows NSIS config (`perMachine: false`), but it is
**read-only inside a Linux AppImage mount and inside a signed macOS `.app`**,
and it is **replaced on every app update** (the directory ships via
`extraResources`), which would silently delete user-installed extensions.

The correct root is `app.getPath('userData')` - `getUserDataPath()` in
`electron/utils/appPaths.ts` already implements exactly that policy (and is a
no-op change in development, where both helpers return
`apps/desktop/data`). Moving it requires migrating any existing installs
and re-pointing the `install_path` column of the `extensions` table, plus a
cross-platform packaged test pass, so it has not been done yet.

Mitigated for now: `ExtensionHost`'s constructor does not throw when the root
cannot be created. It must not - `initializeExtensionHostInBackground` swallows
what it throws, so a throw there takes down the whole extension subsystem
silently. `ExtensionLifecycleLogger` writes are best-effort for the same reason.

## Authoring an extension

`npx @bible/create-extension my-extension` scaffolds a complete, buildable
project - manifest, TypeScript config, bundler config, entry point and a passing
test. `packages/word-count-example/` is a worked reference extension to read
alongside it.

For the manifest itself, `ExtensionManifestSchema.json` in this folder is the
authority: it is the only validator the loader runs, so anything it accepts is
valid and anything it rejects will not load.

## Future enhancements (T3)

Headlines and one-line descriptions only - this list is a signpost, not a design
document.

> These are deliberately **not implemented** in 1.0.0. Designing them without
> a real consumer risks bloat and bad fits. The list exists so contributors
> working in this folder can see the deferred ideas, and so the additive-only
> versioning policy can plan around them.

1. **`ui.openExternal(url)` + `ui:open-external` permission.** Open a URL in the user's default browser. Host must be in `network.allowedHosts`.
2. **Generalized content decorators / hovers.** Today verse-only; extend the same pattern to dictionary entries, book sections, commentary entries, and notes via a `ContentTarget` discriminator.
3. **`ui.registerDataView` (TreeDataProvider pattern).** Host renders a native tree; extension provides a lazy data source via reverse-RPC.
4. **`IDevotionalApi` + reading-position pattern.** Date-keyed entries, day-of-year support, multi-slot per day, reusable reading-position primitive.
5. **`IRemindersApi`.** Persistent reminders that survive app restarts and trigger via `onReminder:<id>` activation events.
6. **`IDocumentApi` + `contributes.exporters`.** Block-structured document model and export pipeline (PDF / Word / Markdown / footnote-style sermon export).
7. **`IEditorApi`.** Rich-text editor extensibility for notes/documents - completion providers, snippet expansion, key handlers, content transforms.
8. **File importer contributions.** `contributes.fileImporters` - register handlers for OSIS, USFM, ePub, etc.
9. **Theme / font / icon contributions.** Defer until the host theme system is settled.
10. **Custom verse display modes (`ui.registerDisplayMode`).** Alternative renderer for the Bible pane (overlay or replace) - interlinear, color-coded grammar, paraphrase comparison.
11. **`IAiApi` host UI.** Where AI responses render, how streaming is shown, how prompts compose. Reserved namespace exists; surface needs a real provider implementation first.
12. **TTS / audio provider role.** Reserved as `ttsVoice`. Defer until the host's own TTS work is mature enough to know what to expose.
13. **Custom note types contribution.** Memory verse, prayer request, sermon outline - `contributes.noteTypes` with a JSON Schema for fields.
14. **Reading-progress signals.** Events when the user finishes today's reading, completes a chapter, etc.
15. **Webhook / external trigger receiver.** Localhost HTTP endpoint other apps POST to in order to trigger extension activation.
16. **Plugin marketplace + discovery UI.** Marketplace metadata fields are already reserved in the manifest.

### Deliberately NOT on this list (and why)

- **DRM / license enforcement primitives.** Paid extensions handle their own licensing via `storage:secrets` + `network`.
- **Free-form pub/sub event bus between extensions.** `extensions.call` is a narrow alternative; full pub/sub invites coupling chaos.
- **General-purpose scripting language / DSL.** Extensions are TypeScript/JavaScript modules.
- **Raw filesystem access.** User-mediated picker only.
- **Hot reload in production.** Restart on enable/disable only.
- **Telemetry SDK in the host.** Extensions wanting analytics call their own backend.
- **Custom URI scheme registration.** Security concerns; only `bible://` and `ext-ui://` are reserved.

### Adding a new T3 item

Add a headline and a one-line description to the list above. Do NOT add code or
types unless there's a real consumer ready to ship against it - a reserved type
with no implementation behind it is a promise the host has not made.
