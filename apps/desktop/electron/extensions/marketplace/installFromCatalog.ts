/**
 * Install an extension from a catalog listing.
 *
 * ## Where this sits
 *
 * Everything below the download is existing, tested machinery:
 * `installExtensionFromZip` unpacks, validates the manifest, runs the same
 * consent prompt a sideload gets, verifies the Ed25519 signature, and writes
 * the registry row. This module adds exactly two things - fetching the bytes
 * through the app's single `NetworkGateway`, and refusing to hand those bytes
 * onward unless they hash to what the catalog promised.
 *
 * ## Why the hash check happens before anything is unpacked
 *
 * Unzipping is the first point where attacker-controlled data reaches code
 * that walks paths and writes files. Checking the digest first means a
 * catalog that lies about a bundle - or a transport that was tampered with -
 * fails while the payload is still an opaque buffer. This is the reason the
 * check is not folded into the existing zip installer: by the time that code
 * runs, the decision has already been made.
 *
 * The hash is not a *trust* control. It proves the bytes match the listing;
 * it says nothing about whether the listing should be believed. Provenance is
 * decided separately, after install, from the signature inside the package and
 * whether the source was the app's configured default catalog.
 *
 * ## What install does NOT do
 *
 * It does not enable the extension. A catalog install lands disabled exactly
 * like a sideload - consent covers *permissions*, not *execution* - so
 * browsing a marketplace can never put running code on the machine in one
 * click.
 */

import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import log from 'electron-log/main';
import type { Extensions } from '@bible/core';

import { installExtensionFromZip } from '../ExtensionHostInstaller';
import type { ExtensionHostContext } from '../ExtensionHostTypes';
import {
  getNetworkGateway,
  NetworkBlockedError,
  type INetworkGateway,
} from '../../services/NetworkGateway';
import type { ExtensionCatalogService, CatalogListing } from './ExtensionCatalogService';

type InstallError = Extensions.InstallError;
type InstallResult = Extensions.InstallResult;
type ExtensionPermission = Extensions.ExtensionPermission;

/**
 * Hard ceiling on a downloaded bundle, independent of what the catalog claims
 * in `sizeBytes`. A listing that under-reports its size must not be able to
 * talk the app into buffering an arbitrary amount of memory.
 */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/** Timeout for a bundle download. Generous - bundles are bigger than JSON. */
export const BUNDLE_DOWNLOAD_TIMEOUT_MS = 120_000;

export async function installExtensionFromCatalog(
  ctx: ExtensionHostContext,
  opts: {
    /** Extension id as listed in the catalog. */
    extensionId: string;
    /** Restrict to one catalog. Omit to take the first listing found. */
    sourceUrl?: string;
    catalogService: ExtensionCatalogService;
    consent?: { grantedPermissions: ExtensionPermission[] };
    /** Override egress for tests. Defaults to the app-wide gateway. */
    gateway?: INetworkGateway;
  },
): Promise<InstallResult | InstallError> {
  const listing = opts.catalogService.findListing(opts.extensionId, opts.sourceUrl);
  if (!listing) {
    return {
      ok: false,
      code: 'NotListed',
      message: `No catalog listing for ${opts.extensionId}. Refresh the catalog and try again.`,
    };
  }

  const downloaded = await downloadBundle(listing, opts.gateway ?? getNetworkGateway());
  if (!downloaded.ok) return downloaded;

  // Stage the verified bytes as a real file, because the zip installer works
  // from a path. The temp directory is removed unconditionally below -
  // including on the failure paths, which is why it is created before the
  // try rather than inside it.
  const stagingDir = mkdtempSync(join(tmpdir(), 'bible-ext-dl-'));
  const zipPath = join(stagingDir, `${sanitizeForFilename(listing.id)}.zip`);
  try {
    writeFileSync(zipPath, downloaded.bytes);
    const installOpts: Parameters<typeof installExtensionFromZip>[1] = {
      zipPath,
      // Provenance is recorded from the *source we fetched from*, never from
      // anything the bundle claims about itself.
      sourceCatalogUrl: listing.sourceUrl,
    };
    if (opts.consent !== undefined) installOpts.consent = opts.consent;

    const result = await installExtensionFromZip(ctx, installOpts);
    if (result.ok) {
      log.info(
        `[ExtensionCatalog] Installed ${listing.id}@${listing.version} from ${listing.sourceUrl} (tier: ${result.state.trustTier ?? 'unknown'})`,
      );
    }
    return result;
  } finally {
    try {
      rmSync(stagingDir, { recursive: true, force: true });
    } catch {
      /* swallow - a leftover temp dir is not worth failing an install over */
    }
  }
}

// --- Download + integrity --------------------------------------------------

type DownloadOutcome = { ok: true; bytes: Buffer } | InstallError;

async function downloadBundle(
  listing: CatalogListing,
  gateway: INetworkGateway,
): Promise<DownloadOutcome> {
  // Trust the catalog's `sizeBytes` only as a *lower* bound on what to allow;
  // the absolute cap always wins.
  const cap =
    listing.sizeBytes !== undefined
      ? Math.min(Math.max(listing.sizeBytes * 2, 1024), MAX_BUNDLE_BYTES)
      : MAX_BUNDLE_BYTES;

  let body: Buffer;
  try {
    const response = await gateway.fetchBuffered({
      url: listing.downloadUrl,
      method: 'GET',
      maxResponseBytes: cap,
      timeoutMs: BUNDLE_DOWNLOAD_TIMEOUT_MS,
      context: `extension bundle ${listing.id}`,
    });
    if (response.status !== 200) {
      return {
        ok: false,
        code: 'DownloadFailed',
        message: `Bundle download failed: HTTP ${response.status}`,
      };
    }
    body = response.body;
  } catch (err) {
    if (err instanceof NetworkBlockedError) {
      return {
        ok: false,
        code: 'Offline',
        message: 'The app is in offline mode, so extensions cannot be downloaded.',
      };
    }
    return {
      ok: false,
      code: 'DownloadFailed',
      message: `Bundle download failed: ${(err as Error).message}`,
    };
  }

  const digest = createHash('sha256').update(body).digest('hex');
  if (digest !== listing.sha256) {
    // Deliberately terminal: no retry, no "install anyway". A mismatch means
    // the bytes are not the bytes the catalog described, and the app has no
    // way to tell a corrupted download from a substituted payload.
    log.error(
      `[ExtensionCatalog] Hash mismatch for ${listing.id} from ${listing.sourceUrl}: expected ${listing.sha256}, got ${digest}`,
    );
    return {
      ok: false,
      code: 'HashMismatch',
      message:
        'The downloaded file does not match the checksum published by the catalog, so it was discarded.',
      detail: { expected: listing.sha256, actual: digest },
    };
  }

  return { ok: true, bytes: body };
}

/**
 * Reduce an extension id to something safe to use as a filename.
 *
 * The id is already constrained by the manifest validator, but this path
 * writes to a real filesystem using a value that ultimately arrived over the
 * network, so it is filtered here rather than assumed clean.
 */
function sanitizeForFilename(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'extension';
}
