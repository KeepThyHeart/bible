# 0.1.0-beta.1 profile fixtures

Used by the upgrade tests (`electron/__tests__/upgradeFromBeta1.test.ts`,
`electron/services/__tests__/BackupService.beta1.test.ts`,
`src/ui/services/AppInitService.beta1.test.ts`).

| File | Origin |
|---|---|
| `beta1-user.sql` | Generated. The user + extension database DDL and rows exactly as beta.1's own `initializeUserSchema` / `initializeExtensionSchema` wrote them (`user_version` 1). Statements are separated by a line holding `-- @@stmt@@`. |
| `beta1-backup.zip`, `beta1-backup.manifest.json` | Generated. A plain export made by beta.1's own `BackupService` (`formatVersion` 1.0, `userSchemaVersion` 1). |
| `beta1-session.json` | Hand-authored. The shape of beta.1's autosave `session_data` (its serializers need the renderer stores, so they are not run). Read by the generator to seed the autosave row, and by the session test. |

Regenerate (rarely: beta.1 is frozen) with

    node apps/desktop/scripts/fixtures/generate-beta1-profile.mjs [commit]

The commit defaults to `c0ba3b62`, the commit the annotated tag `v0.1.0-beta.1`
points at (an old local lightweight tag points at its parent, so the tag name is
not used). The script extracts that commit into the gitignored
`apps/desktop/.fixture-build/`, bundles beta.1's code with esbuild, and needs a
`better-sqlite3` built for the running Node.

The old Scripture Memory extension was not shipped in beta.1, so there is no
real beta.1 `memory.db`; the memory-import tests use a synthetic one.
