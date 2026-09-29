# Settings registry and feature flags

Task 0087. A feature declares its settings once and reads flags with one call; it no longer hand-wires a store field, a save/load line, a settings tab row and a `features.*` check.

## Pieces

| Where | What |
|---|---|
| `@bible/core/browser` `Settings/SettingsRegistry.ts` | `defineSettings([...])`: key, type (`boolean`, `string`, `enum`, `number`, `integer`, `string-array`), default, `scope` (`device` or `synced`), `group`, `order`, `labelKey`/`label`, `descriptionKey`/`description`, `dependsOn`, `flag`, `validate`. Validates (numbers clamp, the rest reject), sanitizes stored data per key, and builds the field model with `toFields(group, { translate, isEnabled, values })`. `mergeSettings(a, b)` combines feature registries. |
| `Settings/SettingsStore.ts` | `createSettingsStore(registry, port)`: `get`, `set` (returns `{ ok }`), `setMany` (all or nothing), `reset`, `reload`, `subscribe`/`getSnapshot` (a `ReadableStore`; a new frozen snapshot per change). |
| `SettingsStoragePort` | `read()` and `write(changes)` (each change carries its scope). The only thing an app supplies. Sync or async. |
| `Settings/settingsFields.ts` | The flat field model and helpers formerly in the desktop extension renderer (`extractFields`, `validateSettingValue`, ...). Desktop's `extensionSettingsSchema.ts` re-exports them. |
| `@bible/ui` `SettingsForm` | Renders fields. Used by the registry sections and the desktop extension settings. |
| `Settings/FeatureFlags.ts` | `FEATURE_FLAGS` (name, default, description, `requires`), `createFeatureFlags({ site, overrides })`, `isEnabled(name)`, `parseFlagOverrides`, `lazyFeature`. |

## Adding a setting

1. Add an entry to the app's registry (`apps/web/src/stores/settingsRegistry.ts`, `apps/desktop/src/ui/settings/desktopSettings.ts`), or your own `defineSettings` merged into it.
2. Render its group: `<SettingsForm fields={registry.toFields('mygroup', { translate, isEnabled, values })} values={values} onChange={(k, v) => store.set(k, v)} />`.
3. Read it: `store.get('key')`. Catalog keys for labels go in the app's catalogs as usual.

## Storage today

- Web: `webSettingsPort` shares the `localStorage` blob `bible-reader-settings` with the legacy `settingsStore` and merges only the keys it is given. When the web user-data store (0084) exists it implements the same port, routing `synced` settings there; only the `createSettingsStore` call changes.
- Desktop: `preferencesStoragePort` is a view over `usePreferencesStore` (session-persisted, per device). `synced` has no meaning on desktop yet.

## Feature flags

Resolution: dev override, then site value, then the flag's default; then `requires` (`genealogy` needs `tagGraph`).

- Server: `siteConfig.isEnabled('audio')`. Values come from `site-config.json` `features`; `BIBLE_FEATURE_FLAGS="audio,-pwa"` overrides them outside production. `/api/config` sends the resolved map as `features` (the older `showTagGraph`, `pwaEnabled`, ... keys are still sent).
- Web: `isEnabled('audio')` from `apps/web/src/utils/featureFlags.ts` (reads `/api/config`; dev override `localStorage['kth.flags']`, development builds only).
- Desktop: `isEnabled` from `apps/desktop/src/ui/settings/featureFlags.ts` (defaults plus the same dev override).
- Lazy features: `const loadAudio = lazyFeature(featureFlags, 'audio', () => import('./initAudio'))`; it imports once and returns `null` while the flag is off.
- New flag: one entry in `FEATURE_FLAGS`. `audio`, `timeline` and `genealogy` are already listed for tasks 0059, 0066 and 0067, so those branches only add their `site-config.schema.json` property.
