/**
 * Install / uninstall / enable / disable orchestration for `ExtensionHost`.
 *
 * This wraps the lower-level `ExtensionInstaller.ts` module (which only knows
 * how to copy directories and unpack zips) with the registry + logger
 * bookkeeping + consent flow the host needs.
 */

import { join } from 'path';
import log from 'electron-log';

import { Extensions } from '@bible/core';

import { loadManifest } from './ExtensionManifestLoader';
import {
  installFromDirectory,
  installFromZip,
  uninstallDirectory,
  type InstallFromDirectoryResult,
} from './ExtensionInstaller';
import type { ExtensionHostContext } from './ExtensionHostTypes';
import { mergeWithDefaults } from './ExtensionHostPermissions';
import { verifyExtensionSignature } from './ExtensionSignatureVerifier';
import { getTrustedPublisherKeys } from './TrustedPublishers';

type ExtensionPermission = Extensions.ExtensionPermission;
type InstallError = Extensions.InstallError;
type InstallResult = Extensions.InstallResult;

/**
 * Run the consent step for a source directory.
 *
 * Shared with the Developer Mode load path, which must not skip it: an
 * unpacked extension runs the same code with the same authority as a packed
 * one, so "the developer picked the folder themselves" is not a reason to
 * grant permissions without asking. The only difference there is that no copy
 * happens afterwards.
 */
export async function resolveConsent(
  ctx: ExtensionHostContext,
  manifest: Extensions.ExtensionManifest,
  sourcePath: string,
  preApproved?: { grantedPermissions: ExtensionPermission[] },
): Promise<
  | { ok: true; grantedPermissions: ExtensionPermission[] }
  | { ok: false; error: InstallError }
> {
  if (preApproved) {
    return { ok: true, grantedPermissions: preApproved.grantedPermissions };
  }
  if (!ctx.consentPrompter) {
    return {
      ok: false,
      error: {
        ok: false,
        code: 'ConsentRequired',
        message: 'Install requires consent but no consent prompter is wired.',
      },
    };
  }

  const requested = manifest.permissions ?? [];
  const networkHosts = (manifest.network?.allowedHosts ?? []).map((h) => ({
    host: h.host,
    purpose: h.purpose,
  }));

  // Classify provenance BEFORE prompting, so the dialog can warn
  // about untrusted code while the user can still say no. For a packed
  // install the authoritative verification still runs against the installed
  // copy afterwards - this pass reads the source directory purely to inform
  // the prompt.
  const sourceSignature = verifyExtensionSignature(sourcePath);
  const trustTier = Extensions.deriveTrustTier({
    signatureStatus: sourceSignature.status,
    ...(sourceSignature.publicKey !== undefined
      ? { signatureKey: sourceSignature.publicKey }
      : {}),
    trustedPublisherKeys: getTrustedPublisherKeys(),
  });

  const decision = await ctx.consentPrompter({
    manifest,
    requestedPermissions: requested,
    separatelyPrompted: requested.filter((p) =>
      (Extensions.SEPARATELY_PROMPTED_PERMISSIONS as readonly ExtensionPermission[]).includes(p),
    ),
    networkHosts,
    trustTier,
    ...(sourceSignature.publicKey !== undefined
      ? { signaturePublicKey: sourceSignature.publicKey }
      : {}),
  });
  if (!decision.granted) {
    return {
      ok: false,
      error: {
        ok: false,
        code: 'ConsentDenied',
        message: 'User declined the install consent prompt.',
      },
    };
  }
  return { ok: true, grantedPermissions: decision.grantedPermissions };
}

export async function installExtension(
  ctx: ExtensionHostContext,
  opts: {
    sourcePath: string;
    consent?: { grantedPermissions: ExtensionPermission[] };
    activateNow?: boolean;
    /**
     * Catalog this install came from. Omitted for a sideload, which
     * is the common case. Recorded on the row so the trust tier can be derived
     * against the app's current default-catalog setting on every read.
     */
    sourceCatalogUrl?: string;
  },
): Promise<InstallResult | InstallError> {
  // We need the manifest before we can prompt the user, so do a dry-run
  // load against the source directory first. The installer will validate
  // again at the destination, so this is purely for the consent step.
  const sourceManifest = loadManifest(opts.sourcePath);
  if (!sourceManifest.ok) {
    return {
      ok: false,
      code: 'ManifestInvalid',
      message: `Source manifest invalid (${sourceManifest.errors.length} error${sourceManifest.errors.length === 1 ? '' : 's'})`,
      detail: sourceManifest.errors,
    };
  }
  const manifest = sourceManifest.manifest;

  // -- Resolve consent -----------------------------------------------
  const consent = await resolveConsent(ctx, manifest, opts.sourcePath, opts.consent);
  if (!consent.ok) return consent.error;

  // Default-granted permissions are added unconditionally.
  const grantedPermissions = mergeWithDefaults(consent.grantedPermissions);

  // -- Copy + persist ------------------------------------------------
  const installResult: InstallFromDirectoryResult = installFromDirectory({
    sourcePath: opts.sourcePath,
    extensionsRoot: ctx.extensionsRoot,
    overwrite: ctx.registry.has(manifest.id),
  });
  if (!installResult.ok) {
    return {
      ok: false,
      code: installResult.code,
      message: installResult.message,
      detail: installResult.detail,
    };
  }

  const sigResult = installResult.signatureResult;
  if (sigResult.status === 'unsigned') {
    ctx.logger.appendLog(manifest.id, {
      ts: Date.now(),
      level: 'warn',
      message: `Extension is unsigned — ${sigResult.message}`,
    });
  }

  // A freshly installed extension never auto-activates. It lands
  // disabled and waits for the user to turn it on deliberately.
  //
  // Consent covers *permissions*, not *execution* - approving "this extension
  // can read your notes" is not the same as asking for it to start running
  // this instant, and an install triggered from a file picker shouldn't put
  // untrusted code in-process before the user has seen what they installed.
  //
  // An in-place upgrade is different: the extension was already running with
  // the user's blessing, so silently disabling it on update would be a
  // regression. Preserve whatever state the existing row had.
  const existing = ctx.registry.get(manifest.id);
  const enabled = existing?.enabled ?? false;

  const stateInfo = ctx.registry.upsert({
    manifest: installResult.manifestResult.manifest,
    installPath: installResult.installPath,
    grantedPermissions,
    enabled,
    signatureStatus: sigResult.status,
    signatureKey: sigResult.publicKey,
    // Only passed when this install actually came from a catalog. Omitting it
    // preserves whatever provenance the row already had, so a sideloaded
    // upgrade over a marketplace install does not silently relabel it.
    ...(opts.sourceCatalogUrl !== undefined
      ? { sourceCatalogUrl: opts.sourceCatalogUrl }
      : {}),
  });
  ctx.logger.appendLog(manifest.id, {
    ts: Date.now(),
    level: 'info',
    message: `Installed ${manifest.id}@${manifest.version} (signature: ${sigResult.status})`,
  });

  if (opts.activateNow) {
    // Not wired yet. Surface the limitation rather than silently no-op.
    log.warn('[ExtensionHost] activateNow requested, but worker runtime is not implemented yet.');
  }

  return { ok: true, state: stateInfo };
}

/**
 * Install an extension from a `.zip` archive.
 *
 * Unzips into a temp directory, then runs the same install path as
 * `installExtension({ sourcePath })` so consent prompts and registry
 * updates work identically. The temp dir is cleaned up unconditionally.
 */
export async function installExtensionFromZip(
  ctx: ExtensionHostContext,
  opts: {
    zipPath: string;
    consent?: { grantedPermissions: ExtensionPermission[] };
    activateNow?: boolean;
    /** Catalog this bundle was downloaded from. */
    sourceCatalogUrl?: string;
  },
): Promise<InstallResult | InstallError> {
  // Step 1: extract the zip into a temp directory and validate manifest.
  // We don't copy into `extensionsRoot` yet - `installExtension` will do
  // that after consent so the registry/copy ordering matches the folder
  // path exactly.
  const extracted = await installFromZip({
    zipPath: opts.zipPath,
    // Use a throwaway "extensions root" inside tmpdir so the existence
    // check inside `installFromDirectory` doesn't think we're upgrading
    // an installed extension. We pass `overwrite: true` because the
    // throwaway directory might already have been used by a previous
    // upload of the same id.
    extensionsRoot: join(ctx.extensionsRoot, '__incoming__'),
    overwrite: true,
  });
  if (!extracted.ok) {
    return {
      ok: false,
      code: extracted.code,
      message: extracted.message,
      detail: extracted.detail,
    };
  }
  try {
    // Step 2: hand off to the normal install flow so the consent prompter
    // fires the same way it does for folder installs.
    const installOpts: Parameters<typeof installExtension>[1] = {
      sourcePath: extracted.installPath,
    };
    if (opts.consent !== undefined) installOpts.consent = opts.consent;
    if (opts.activateNow !== undefined) installOpts.activateNow = opts.activateNow;
    if (opts.sourceCatalogUrl !== undefined) {
      installOpts.sourceCatalogUrl = opts.sourceCatalogUrl;
    }
    return await installExtension(ctx, installOpts);
  } finally {
    // Clean up the staging copy. Errors here are non-fatal.
    try {
      const fs = await import('fs');
      fs.rmSync(extracted.installPath, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
}

export async function uninstallExtension(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<void> {
  const entry = ctx.registry.get(extensionId);
  if (!entry) return;

  // Tear down any running worker before removing files. `deactivate()`
  // is a no-op if the extension wasn't active.
  if (ctx.activeWorkers.has(extensionId)) {
    try {
      await ctx.deactivate(extensionId);
    } catch {
      /* best-effort - proceed with file cleanup either way */
    }
  }

  // Drop secrets + per-extension databases before nuking the install
  // directory. Both are best-effort; the user's intent is to
  // remove the extension regardless of whether the keychain or db files
  // are reachable right now.
  if (ctx.extensionDatabaseRegistry) {
    try {
      ctx.extensionDatabaseRegistry.removeAll(extensionId);
    } catch {
      /* swallow */
    }
  }
  if (ctx.secretsKeychain) {
    try {
      await ctx.secretsKeychain.deleteAll(extensionId);
    } catch {
      /* swallow */
    }
  }

  // An unpacked Developer Mode extension lives in the developer's own working
  // directory. "Uninstall" there means *stop running it* - deleting the files
  // would destroy the source they are actively editing.
  if (entry.devMode === true) {
    ctx.registry.remove(extensionId);
    ctx.logger.appendLog(extensionId, {
      ts: Date.now(),
      level: 'info',
      message: `Unloaded unpacked ${extensionId} (files at ${entry.installPath} left in place)`,
    });
    return;
  }

  uninstallDirectory(entry.installPath, ctx.extensionsRoot);
  ctx.registry.remove(extensionId);
  ctx.logger.appendLog(extensionId, {
    ts: Date.now(),
    level: 'info',
    message: `Uninstalled ${extensionId}`,
  });
}

export async function enableExtension(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<void> {
  if (!ctx.registry.has(extensionId)) return;
  ctx.registry.setEnabled(extensionId, true);
  ctx.logger.appendLog(extensionId, { ts: Date.now(), level: 'info', message: 'Enabled' });
}

export async function disableExtension(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<void> {
  if (!ctx.registry.has(extensionId)) return;
  if (ctx.activeWorkers.has(extensionId)) {
    try {
      await ctx.deactivate(extensionId);
    } catch {
      /* best-effort */
    }
  }
  ctx.registry.setEnabled(extensionId, false);
  ctx.logger.appendLog(extensionId, { ts: Date.now(), level: 'info', message: 'Disabled' });
}

export async function resetCrashState(
  ctx: ExtensionHostContext,
  extensionId: string,
): Promise<void> {
  if (!ctx.registry.has(extensionId)) return;
  ctx.registry.resetCrashState(extensionId);
  ctx.logger.appendLog(extensionId, {
    ts: Date.now(),
    level: 'info',
    message: 'Crash state reset',
  });
}
