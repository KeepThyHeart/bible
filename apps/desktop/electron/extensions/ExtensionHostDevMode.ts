/**
 * Developer Mode: load an extension **unpacked**, run it in place, and reload
 * it when the developer rebuilds.
 *
 * -- How this differs from installing ----------------------------------------
 * `installExtension` copies a package into `data/extensions/<id>/` and the host
 * owns that copy from then on. That is the right behaviour for something a
 * user chose to keep, and it is exactly wrong for something being actively
 * developed: `npm run build` writes to the developer's `dist/`, which the
 * copy knows nothing about, so every iteration means re-installing.
 *
 * A dev load registers the developer's own directory as the install path. No
 * copy, no divergence, and a rebuild is picked up by `ExtensionDevWatcher`.
 *
 * -- What is *not* relaxed ---------------------------------------------------
 * The consent prompt still runs, with the same untrusted-tier warning. An
 * unpacked extension executes with exactly the authority a packed one does, so
 * "the developer picked this folder" is a statement about provenance, not
 * about permissions. Developer Mode buys a shorter loop, not a wider grant.
 *
 * The one thing it does relax is the *location* - and that is precisely why it
 * is gated on a main-process toggle rather than a renderer preference. See
 * `ExtensionDevConfig`.
 */

import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import log from 'electron-log';

import { Extensions } from '@bible/core';

import { loadManifest } from './ExtensionManifestLoader';
import { resolveConsent } from './ExtensionHostInstaller';
import { mergeWithDefaults } from './ExtensionHostPermissions';
import { verifyExtensionSignature } from './ExtensionSignatureVerifier';
import type { ExtensionHostContext } from './ExtensionHostTypes';

type InstallError = Extensions.InstallError;
type InstallResult = Extensions.InstallResult;

/**
 * Register a directory as an unpacked extension and start watching it.
 *
 * Deliberately does not activate. A dev load lands in the same state a fresh
 * install does - present, disabled, waiting for the user to turn it on - so
 * that pointing the app at a directory never puts code in-process before the
 * developer has seen the consent dialog resolve.
 */
export async function loadUnpackedExtension(
  ctx: ExtensionHostContext,
  opts: {
    sourcePath: string;
    consent?: { grantedPermissions: Extensions.ExtensionPermission[] };
  },
): Promise<InstallResult | InstallError> {
  if (!ctx.devConfig?.isDeveloperMode()) {
    return {
      ok: false,
      code: 'DeveloperModeDisabled',
      message:
        'Loading an unpacked extension requires Developer Mode, which is turned off.',
    };
  }

  const sourcePath = resolve(opts.sourcePath);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
    return {
      ok: false,
      code: 'source.not-directory',
      message: `Source path is not a directory: ${sourcePath}`,
    };
  }

  const manifestResult = loadManifest(sourcePath);
  if (!manifestResult.ok) {
    return {
      ok: false,
      code: 'ManifestInvalid',
      message: `Source manifest invalid (${manifestResult.errors.length} error${manifestResult.errors.length === 1 ? '' : 's'})`,
      detail: manifestResult.errors,
    };
  }
  const manifest = manifestResult.manifest;

  // Refuse to shadow a packed install. Silently taking over the id would leave
  // the user with two copies of one extension and no way to tell which is
  // running; making them uninstall first keeps that unambiguous.
  const existing = ctx.registry.get(manifest.id);
  if (existing && existing.devMode !== true) {
    return {
      ok: false,
      code: 'install.already-exists',
      message: `'${manifest.id}' is already installed from ${existing.installPath}. Uninstall it before loading an unpacked copy.`,
    };
  }

  const consent = await resolveConsent(ctx, manifest, sourcePath, opts.consent);
  if (!consent.ok) return consent.error;
  const grantedPermissions = mergeWithDefaults(consent.grantedPermissions);

  // Signature status is recorded for the same reason it is on a packed
  // install: the trust badge is derived from it, and an unpacked build is
  // almost always unsigned, which is exactly what the user should see.
  const signature = verifyExtensionSignature(sourcePath);

  const state = ctx.registry.upsert({
    manifest,
    installPath: sourcePath,
    grantedPermissions,
    enabled: existing?.enabled ?? false,
    signatureStatus: signature.status,
    ...(signature.publicKey !== undefined ? { signatureKey: signature.publicKey } : {}),
    devMode: true,
  });

  ctx.logger.appendLog(manifest.id, {
    ts: Date.now(),
    level: 'info',
    message: `Loaded unpacked ${manifest.id}@${manifest.version} from ${sourcePath}`,
  });

  watchIfDev(ctx, state);
  return { ok: true, state };
}

/**
 * Re-read an unpacked extension from disk and restart it if it was running.
 *
 * Called by the watcher after a rebuild, and by the Reload button. The order
 * matters: deactivate first so the old worker's `deactivate()` runs against
 * the code that registered the contributions, then re-read, then bring it back
 * only if it was up to begin with.
 */
export async function reloadUnpackedExtension(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<InstallResult | InstallError> {
  const existing = ctx.registry.get(extensionId);
  if (!existing) {
    return { ok: false, code: 'NotFound', message: `Unknown extension: ${extensionId}` };
  }
  if (existing.devMode !== true) {
    return {
      ok: false,
      code: 'NotDevMode',
      message: `'${extensionId}' is a packed install; reinstall it to pick up changes.`,
    };
  }

  const wasActive = ctx.isActive(extensionId);
  if (wasActive) {
    try {
      await ctx.deactivate(extensionId);
    } catch (err) {
      // A failed deactivate must not strand the extension in a state where it
      // can never be reloaded. Log it and continue - the worker is torn down
      // by the lifecycle path regardless.
      log.warn(`[extensions] deactivate during reload failed for ${extensionId}:`, err);
    }
  }

  const manifestResult = loadManifest(existing.installPath);
  if (!manifestResult.ok) {
    const message = `Reload failed: manifest invalid at ${existing.installPath}`;
    ctx.registry.setStatus(extensionId, 'failed', message);
    ctx.logger.appendLog(extensionId, { ts: Date.now(), level: 'error', message });
    return {
      ok: false,
      code: 'ManifestInvalid',
      message,
      detail: manifestResult.errors,
    };
  }

  const signature = verifyExtensionSignature(existing.installPath);
  const state = ctx.registry.upsert({
    manifest: manifestResult.manifest,
    installPath: existing.installPath,
    // Permissions are NOT re-prompted here. A rebuild that adds a permission
    // to the manifest does not get it: the granted set is what the user
    // approved, and widening it silently would make Developer Mode a way to
    // escalate without a dialog. The extension will hit a
    // PermissionDeniedError, which is the correct and visible outcome.
    grantedPermissions: existing.grantedPermissions,
    enabled: existing.enabled,
    signatureStatus: signature.status,
    ...(signature.publicKey !== undefined ? { signatureKey: signature.publicKey } : {}),
    devMode: true,
  });

  ctx.logger.appendLog(extensionId, {
    ts: Date.now(),
    level: 'info',
    message: `Reloaded unpacked ${extensionId}@${state.manifest.version}`,
  });

  // `main` may have moved, so rebind the watch to whatever the new manifest says.
  watchIfDev(ctx, state);

  if (wasActive) {
    try {
      await ctx.activate(extensionId);
    } catch (err) {
      log.warn(`[extensions] re-activate after reload failed for ${extensionId}:`, err);
    }
  }

  return { ok: true, state: ctx.registry.get(extensionId) ?? state };
}

/**
 * Establish watches for every unpacked extension already in the registry.
 * Called once after `loadAll`, so a dev extension registered in a previous
 * session starts watching again on boot.
 */
export function startDevWatches(ctx: ExtensionHostContext): void {
  if (!ctx.devWatcher) return;
  for (const state of ctx.registry.list()) {
    if (state.devMode === true) watchIfDev(ctx, state);
  }
}

function watchIfDev(ctx: ExtensionHostContext, state: Extensions.ExtensionStateInfo): void {
  if (!ctx.devWatcher || state.devMode !== true) return;
  // `main` is optional in the manifest schema (a contributions-only extension
  // has no entry point). Watching the manifest alone is still worth doing -
  // that is where such an extension's contributions are declared.
  ctx.devWatcher.watchExtension(
    state.manifest.id,
    state.installPath,
    state.manifest.main ?? '',
  );
}
