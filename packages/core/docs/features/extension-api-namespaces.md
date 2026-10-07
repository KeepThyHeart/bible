# Adding an extension API namespace

Every `api.*` namespace an extension can call is declared once, in
`src/Extensions/Declarations/namespaces/<name>.ts`, and registered once, in
`src/Extensions/Declarations/registry.ts`. Everything else that used to be a
hand-maintained table reads that registry. This page shows how to add one,
with a worked example. Read [Extensions & plugins](extensions-plugins.md) first
for the overall extension contract.

## What a declaration controls

A declaration is a `defineApiNamespace<IYourApi>()({...})` value
(`src/Extensions/Declarations/defineApiNamespace.ts` documents every field).

| Field | Derived from it |
|---|---|
| `name`, `optional`, the `IYourApi` type argument | `BibleExtensionAPI` (an optional namespace is an optional member), the worker proxy's namespaces (`apps/desktop/extension-runtime/apiProxy.ts`) |
| `permissions[]` (`id`, `grant`, `consent`) | `ExtensionPermission`, `DEFAULT_GRANTED_PERMISSIONS`, `SEPARATELY_PROMPTED_PERMISSIONS` (`src/Extensions/Permissions.ts`), the validator's allowlist, the install consent dialog's text (`apps/desktop/src/ui/components/extensions/ExtensionConsentDialog.tsx`), the schema's `Permission` enum |
| `methods` (one entry per interface member, enforced by the type) and `wire` | The desktop router's permission guard (`apps/desktop/electron/extensions/DeclaredApiGuard.ts`), the smoke harness's guarded methods (`packages/extension-testing/src/smoke/interceptors.ts`) |
| `methods[*].fake` | `createMockApi()` defaults in `packages/extension-testing/src/createMockApi.ts` |
| `availability.whenGranted` | Whether a host attaches the namespace at all for an extension |
| `activationEvents` | The activation-event vocabulary and firing set (`src/Extensions/ActivationEvents.ts`) |
| `contributes` | The manifest validator's `contributes` keys, their validation, the schema's `contributes` properties |
| `events` | Extension-point permission gates (`EXTENSION_POINT_PERMISSIONS` in `src/Extensions/ExtensionPointTypes.ts`) |

The declaration names no host. A host implements the namespace however it
likes and says which namespaces it serves (desktop: `DESKTOP_API_NAMESPACES`
in `DeclaredApiGuard.ts`), so a web host can plug into the same declarations.

## Steps

1. **Declare it.** Create `src/Extensions/Declarations/namespaces/<name>.ts`
   with the interface and the declaration. Import only `import type`s and
   values from `../defineApiNamespace` - `@bible/core` builds to CommonJS, and
   `Permissions.ts`, `ActivationEvents.ts` and the validator all read the
   registry, so any other value import risks an import cycle. A
   `contributes` validator that needs a core schema check may call pure core
   code that imports nothing from the Extensions folder. The registry is also
   bundled into the extension worker's QuickJS guest, so nothing reachable from
   a declaration may touch Node, the DOM or the Data layer.
2. **Register it.** Append it to `API_NAMESPACES` in
   `src/Extensions/Declarations/registry.ts`.
3. **Bump the version.** An addition bumps the patch segment of
   `EXTENSION_API_VERSION` (`0.2.0` -> `0.2.1`) and sets `since` on the new
   declaration; a breaking change bumps the middle segment. The rule and why
   it is patch on `0.x` are in the constant's doc comment in
   `src/Extensions/ExtensionApiTypes.ts`. Then refresh the generated files:

   ```bash
   UPDATE_EXTENSION_API=1 pnpm --filter @bible/core exec vitest run src/Extensions/Declarations/registrySync.test.ts
   ```

   This rewrites `src/Extensions/Declarations/apiSurface.lock.json` and the
   affected blocks of `src/Extensions/ExtensionManifestSchema.json`. It refuses
   to record a changed surface under an unchanged or lower version, or over a
   deleted lock. Two namespaces landing in parallel each bump the patch
   segment; whoever merges second re-bumps and re-runs this.
4. **Implement it on desktop.** Write the api-impl under
   `apps/desktop/electron/extensions/api-impl/`, attach it in `attachApiImpls`
   (`apps/desktop/electron/extensions/ExtensionHostRpc.ts`), and set the
   namespace to `true` in `DESKTOP_API_NAMESPACES`. The type requires an entry;
   `false` (not on desktop yet) is an explicit choice too, and the drift
   tests then skip it. Every RPC method the impl
   registers must be declared (as a typed method or under `wire`); the router
   refuses undeclared ones, and `DeclaredApiGuard.test.ts` checks both
   directions.

That is all an extension needs to get typings, consent text and a test fake.
Optional follow-ups:

- **Translations.** The consent dialog shows `consent.text` until the
  catalog has `consent.key`; add the key to `apps/desktop/locales/en/ui.json`
  (same text) and the other locales when ready.
  `DeclaredApiGuard.test.ts` checks that every key present in the English
  catalog matches its declaration.
- **A typed `contributes` member.** A declared key's validated value is
  stored on `ExtensionContributes` under its index signature; add a typed member
  to `ExtensionContributes` in `src/Extensions/ExtensionManifest.ts` if host code reads it.
- **Event channels** reached through `api.events.subscribe` still need their
  payload type in `ExtensionPointTypes.ts` and a firing site on the host. The
  declaration's `events` entry supplies the kind check and the permission gate.

## Worked example: `api.echo`

`echoNamespace` in `src/Extensions/Declarations/sampleNamespace.test.ts` is
this example verbatim. That test registers it next to the real namespaces and
checks the result.

```typescript
// src/Extensions/Declarations/namespaces/echo.ts
import { defineApiNamespace, eventChannel, fakeReturns } from '../defineApiNamespace';

/** `api.echo` - repeats text back. */
export interface IEchoApi {
  /** Repeat `text` back unchanged. Open to every extension. */
  say(text: string): Promise<string>;
  /** Repeat `text` back in capitals. Needs `echo:shout`. */
  shout(text: string): Promise<string>;
}

export const echoNamespace = defineApiNamespace<IEchoApi>()({
  name: 'echo',
  description: 'Repeats text back - the worked example for adding a namespace.',
  since: '0.1.1',
  optional: true, // new namespaces are optional: older hosts and web may lack them
  permissions: [
    {
      id: 'echo:shout',
      grant: 'prompt', // 'default' = never asked; 'separate' = highlighted as sensitive
      consent: {
        key: 'extensionConsent.permission.echoShout',
        text: 'Repeat things back to you in capitals.',
      },
      since: '0.1.1',
    },
  ],
  methods: {
    say: { permission: null, fake: fakeReturns('') },
    shout: { permission: 'echo:shout', fake: fakeReturns('') },
  },
  activationEvents: [
    { event: 'onEcho:', fired: false, description: 'Someone said the phrase after the colon.', since: '0.1.1' },
  ],
  contributes: [
    {
      key: 'echoes',
      description: 'Phrases the extension wants repeated.',
      since: '0.1.1',
      requiresPermission: 'echo:shout',
      validate: (value, path, ctx) => {
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && v.length > 0)) {
          ctx.error(path, 'type', 'expected an array of non-empty strings');
          return undefined;
        }
        return value as string[];
      },
      jsonSchema: { type: 'array', items: { type: 'string', minLength: 1 } },
    },
  ],
  events: {
    'echo.heard': eventChannel<{ text: string }>({
      kind: 'event',
      permission: 'echo:shout',
      description: 'The host repeated one of the contributed phrases.',
      since: '0.1.1',
    }),
  },
});
```

Then, in `registry.ts`:

```typescript
import { echoNamespace } from './namespaces/echo';
export const API_NAMESPACES = [/* ...existing... */, echoNamespace] as const;
```

The result:

- **Typings:** `api.echo` is `IEchoApi | undefined`, so an author writes
  `if (api.echo) await api.echo.shout('amen')`.
- **Consent:** an extension listing `"permissions": ["echo:shout"]` is
  shown "Repeat things back to you in capitals." at install.
- **Guard:** `echo.shout` without the grant is refused with
  `PermissionDeniedError` by the router before the impl runs; `echo.say` is open.
- **Manifest:** `"activationEvents": ["onEcho:hello"]` and
  `"contributes": { "echoes": ["hello"] }` validate; `echoes` without
  `echo:shout` is rejected.
- **Test fake:** `createMockApi().echo.shout('x')` resolves `''`, records its
  calls, and accepts overrides like any other namespace. A namespace that is not
  registered yet can still be faked with
  `createMockApi(undefined, { extraNamespaces: [echoNamespace] })`, or on its own
  with `createDeclaredNamespaceFake(echoNamespace)`.

## Across host versions

An extension built for a newer host must degrade on an older one, not fail
to load:

- **Unknown namespace:** the worker's proxy exposes only the namespaces the host
  serves (`ExtensionInitPayload.apiNamespaces`), so `api.echo` is
  `undefined` and the extension feature-detects it.
- **Unknown permission, `contributes` key or activation event**
  (well-formed, `onXxx` / `onXxx:arg`): the manifest validator drops it and
  returns a warning (`permission.unknown`, `contributes.unknown`,
  `activation.unknown`) instead of rejecting the manifest. The desktop loader
  logs the warnings. Malformed entries, duplicate permissions and the retired
  `onStartup` are still errors.
- **Unknown top-level manifest keys** are still errors. Add a new top-level
  key to the validator itself, as `userData` was.
- **`engines.bibleApp`** is still checked first. An extension that cannot work
  without a newer namespace says so with its range; one that merely uses it when
  present keeps the old range (see step 3).

## Tests

| Test | Checks |
|---|---|
| `src/Extensions/Declarations/registry.test.ts` | The registry reproduces the pre-0086 tables (namespaces, permissions, grant sets, activation vocabulary, extension-point gates), `BibleExtensionAPI` derivation, and that inconsistent declarations are rejected |
| `src/Extensions/Declarations/registrySync.test.ts` | Schema enum and `contributes` schemas, the surface lock and the version-bump rule, `since` never ahead of the version |
| `src/Extensions/Declarations/sampleNamespace.test.ts` | The worked example end to end in core |
| `apps/desktop/electron/extensions/__tests__/DeclaredApiGuard.test.ts` | Router guard, every registered method declared and every declared method registered, consent text equals the English catalog |
| `packages/extension-testing/src/__tests__/createMockApi.declared.test.ts` | Generated fakes, `extraNamespaces`, declared smoke guards |
