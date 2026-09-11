/**
 * Install / uninstall the optional semantic-search feature pack.
 *
 * ## Why this is not `InstallationService`
 *
 * That service installs *modules*, and its conformance gate is entirely about
 * reference-space safety: `module_info`, a UUID, `canon`, `versification`, and
 * a shifted-canon check over `bible_verse`. An embedding index has none of
 * those tables and an ONNX weights file is not a database at all, so every pack
 * would be rejected. `Types.ts` already draws this line - `semantic_*.db` is
 * explicitly "outside the published module contract" - and this service is the
 * other side of it.
 *
 * ## Install shape
 *
 * Download every artifact into a staging directory, verify each digest, then
 * swap the staging directory into place as the pack root in one rename. The
 * app therefore only ever sees a complete pack or no pack: there is no window
 * in which `resolveSemanticIndexPath()` finds an index whose matching model is
 * still downloading, which would surface to the user as a search that fails
 * halfway with a model-load error.
 *
 * ## What is verified, and when
 *
 * `parseFeaturePack` (core) has already rejected unsafe paths, non-http URLs
 * and malformed digests before anything reaches here. This service adds the
 * checks that need the filesystem or the pack's semantics:
 *
 *   - the fixed in-pack layout (index at `semantic_index.db`, model files under
 *     `models/`), so a catalog cannot rearrange a pack into a shape the path
 *     resolvers would not find;
 *   - a resolved-path containment check before every write - belt and braces
 *     over the core validator, because this is the step that actually writes;
 *   - a hard byte ceiling enforced *during* transfer, so a server that ignores
 *     its own declared size cannot fill the disk;
 *   - SHA-256 over the bytes as served, before any decompression, so a
 *     zip-bomb-shaped payload is discarded while it is still opaque.
 *
 * ## Sideloading
 *
 * `installFromPackage` takes the same pack from a local folder or `.biblepack`
 * archive instead of a catalog. Everything after "get me the bytes" is the same
 * code - same layout contract, same containment check, same digest, same atomic
 * swap - because the only thing that differs is where the bytes came from.
 *
 * The digests still matter without a catalog to compare against: they catch a
 * truncated copy off a USB stick or a half-finished file transfer, which would
 * otherwise install an index that fails to open at query time. What they cannot
 * establish is provenance. Sideloading is an explicit act of trust in whoever
 * handed the user the file, and the UI says so.
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import type { Readable } from 'stream';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';

import log from 'electron-log';
// `unzipper` pulls a sizeable CommonJS tree that is required at main-
// process module-eval time purely to have it available for an operation the
// user has to ask for. Loaded on first use instead.
async function unzipperOpen(): Promise<typeof import('unzipper').Open> {
  return (await import('unzipper')).Open;
}
import {
  packagedFileName,
  parseLocalFeaturePack,
  FEATURE_PACK_ALLOWED_EXTENSIONS,
  FEATURE_PACK_MANIFEST_FILENAME,
  type FeaturePack,
  type FeaturePackArtifact,
  type LocalFeaturePack,
} from '@bible/core';

import { DownloadService } from './DownloadService';
import type { INetworkGateway } from './NetworkGateway';
import {
  getFeaturePackRoot,
  SEMANTIC_INDEX_FILENAME,
  SEMANTIC_MODELS_DIRNAME,
} from '../utils/appPaths';

const PACK_TYPE = 'semantic_search';
const MANIFEST_FILENAME = 'pack.json';

/**
 * File extensions a pack is allowed to contain - data, never code. The list
 * and the reasoning behind it live with the pack types in @bible/core, where
 * the pack build script enforces the same list.
 */
const ALLOWED_ARTIFACT_EXTENSIONS = FEATURE_PACK_ALLOWED_EXTENSIONS;

/**
 * Allowance over an artifact's declared size before the transfer is aborted.
 * Not zero, because a server may legitimately serve a slightly different
 * compression of the same content; not unbounded, because the declared size is
 * the only thing standing between a hostile catalog and the disk filling up.
 */
const SIZE_OVERRUN_FACTOR = 1.05;

/** Recorded at install time so uninstall removes exactly what was written. */
export interface InstalledPackManifest {
  packId: string;
  packType: string;
  name: string;
  version: string;
  license: string;
  installedAt: string;
  /** Paths relative to the pack root, as actually written. */
  files: string[];
  installedSizeBytes: number;
  metadata?: Record<string, unknown> | null;
}

export type InstallPhase = 'idle' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';

export interface InstallProgress {
  packId: string;
  phase: InstallPhase;
  /** 0-100 across all artifacts, by bytes. */
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  /** Index of the artifact currently in flight, 1-based, for "file 3 of 7". */
  currentArtifact: number;
  artifactCount: number;
  speedBps: number;
  error?: string;
}

export interface SemanticPackStatus {
  /** True when a complete pack is present and usable. */
  installed: boolean;
  manifest: InstalledPackManifest | null;
  /** Live progress when an install is running, else null. */
  progress: InstallProgress | null;
}

export class SemanticPackInstallError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'busy'
      | 'invalid_layout'
      | 'download_failed'
      | 'checksum_mismatch'
      | 'too_large'
      | 'write_failed'
      | 'offline'
      | 'invalid_package'
  ) {
    super(message);
    this.name = 'SemanticPackInstallError';
  }
}

/**
 * A folder or archive the user picked, presented as "read the manifest, then
 * open files by name".
 *
 * Note what this interface does *not* offer: a way to enumerate what is in the
 * package and write it out. Files are only ever opened by a name derived from
 * the already-validated manifest, so an archive entry called `../../evil.exe`
 * is never looked up, never matched, and never written - it is simply ignored.
 * That makes zip-slip structurally impossible here rather than something a
 * check has to catch.
 */
interface PackageSource {
  readManifest(): Promise<string>;
  open(fileName: string): Promise<Readable>;
  close(): Promise<void>;
}

export class SemanticPackService {
  /**
   * A private `DownloadService` rather than the module manager's. Download
   * queue ids are a per-instance key space, and sharing one with the module
   * installer would mean a pack install and a module install could collide on
   * an id and silently cancel each other.
   */
  private readonly downloads: DownloadService;

  private current: InstallProgress | null = null;
  private activeQueueIds = new Set<number>();
  private cancelled = false;
  private nextQueueId = 1;

  /**
   * @param onInstalled Invoked after a pack is installed or removed, so the
   *   search handlers can drop their cached service and embedder. Without it
   *   the user would have to restart the app to use what they just installed.
   */
  constructor(
    private readonly onInstalled: () => void,
    gateway?: INetworkGateway
  ) {
    this.downloads = gateway ? new DownloadService(gateway) : new DownloadService();
  }

  // --- Status --------------------------------------------------------------

  getStatus(): SemanticPackStatus {
    const manifest = this.readManifest();
    return {
      installed: manifest !== null && this.packFilesPresent(manifest),
      manifest,
      progress: this.current,
    };
  }

  isInstalling(): boolean {
    return this.current !== null
      && this.current.phase !== 'done'
      && this.current.phase !== 'error';
  }

  // --- Install -------------------------------------------------------------

  /**
   * Download and install `pack`, replacing any currently installed pack.
   *
   * Throws `SemanticPackInstallError` on any failure; the pack root is left
   * untouched unless the final swap succeeds.
   */
  async install(pack: FeaturePack): Promise<InstalledPackManifest> {
    if (this.isInstalling()) {
      throw new SemanticPackInstallError(
        'A semantic search install is already running.',
        'busy'
      );
    }

    this.assertSemanticLayout(pack);

    this.cancelled = false;
    const totalBytes = pack.artifacts.reduce((sum, a) => sum + a.download_size_bytes, 0);
    // Held as a local as well as on `this`: TypeScript cannot keep a field
    // narrowed across an `await`, and the two always reference the same object.
    const progress: InstallProgress = {
      packId: pack.pack_id,
      phase: 'downloading',
      percent: 0,
      bytesDownloaded: 0,
      totalBytes,
      currentArtifact: 0,
      artifactCount: pack.artifacts.length,
      speedBps: 0,
    };
    this.current = progress;

    // Staging lives beside the pack root, on the same filesystem, so the final
    // move is a rename rather than a cross-device copy of several hundred MB.
    const packRoot = getFeaturePackRoot(PACK_TYPE);
    const stagingRoot = `${packRoot}.incoming`;

    try {
      rmSync(stagingRoot, { recursive: true, force: true });
      mkdirSync(stagingRoot, { recursive: true });

      let completedBytes = 0;
      const written: string[] = [];

      for (let i = 0; i < pack.artifacts.length; i++) {
        if (this.cancelled) {
          throw new SemanticPackInstallError('Install cancelled.', 'download_failed');
        }

        const artifact = pack.artifacts[i];
        progress.currentArtifact = i + 1;
        progress.phase = 'downloading';

        const finalPath = this.safeJoin(stagingRoot, artifact.path);
        mkdirSync(dirname(finalPath), { recursive: true });

        // Gzipped payloads are verified in their transferred form, so they are
        // downloaded to a sidecar name and expanded only after the digest
        // matches.
        const downloadPath = artifact.gzipped ? `${finalPath}.gz` : finalPath;

        await this.downloadArtifact(artifact, downloadPath, completedBytes);

        if (artifact.gzipped) {
          progress.phase = 'installing';
          await this.gunzipFile(downloadPath, finalPath);
          rmSync(downloadPath, { force: true });
        }

        completedBytes += artifact.download_size_bytes;
        progress.bytesDownloaded = completedBytes;
        progress.percent = totalBytes > 0
          ? Math.min(100, Math.round((completedBytes / totalBytes) * 100))
          : 0;
        written.push(artifact.path);
      }

      if (this.cancelled) {
        throw new SemanticPackInstallError('Install cancelled.', 'download_failed');
      }

      return await this.completeInstall(pack, written, stagingRoot, packRoot, progress);
    } catch (error) {
      const message = (error as Error).message;
      if (this.current) {
        this.current.phase = 'error';
        this.current.error = message;
      }
      rmSync(stagingRoot, { recursive: true, force: true });
      log.error(`[SemanticPack] Install of ${pack.pack_id} failed: ${message}`);
      throw error instanceof SemanticPackInstallError
        ? error
        : new SemanticPackInstallError(message, 'download_failed');
    } finally {
      this.activeQueueIds.clear();
    }
  }

  /** Abort an in-flight install. Safe to call when nothing is running. */
  cancel(): void {
    if (!this.isInstalling()) return;
    this.cancelled = true;
    for (const queueId of this.activeQueueIds) {
      try {
        this.downloads.cancelDownload(queueId);
      } catch {
        /* the download may already have finished - nothing to cancel */
      }
    }
    log.info('[SemanticPack] Install cancelled by user');
  }

  // --- Sideload ------------------------------------------------------------

  /**
   * Install from a local package - either a `.biblepack`/`.zip` archive or the
   * folder it would have been zipped from.
   *
   * Both forms are supported because a pack is large enough that zipping it is
   * not free: Windows' built-in `Compress-Archive` gives up around 2 GB, and a
   * publisher testing a build should not have to archive a gigabyte and a half
   * to find out whether the layout is right. The folder form is also the one
   * a sideload build emits directly.
   *
   * `sourcePath` must come from a native file dialog shown by the main process.
   * Nothing here treats the renderer as a source of paths.
   */
  async installFromPackage(sourcePath: string): Promise<InstalledPackManifest> {
    if (this.isInstalling()) {
      throw new SemanticPackInstallError(
        'A semantic search install is already running.',
        'busy'
      );
    }

    this.cancelled = false;

    const packRoot = getFeaturePackRoot(PACK_TYPE);
    const stagingRoot = `${packRoot}.incoming`;

    // Published before the package is even opened. The IPC call returns as soon
    // as the install starts, so `getStatus()` is the only route a failure has
    // back to the UI - including a failure to read the manifest, which happens
    // before there is a pack id to attribute it to.
    const progress: InstallProgress = {
      packId: '',
      phase: 'installing',
      percent: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      currentArtifact: 0,
      artifactCount: 0,
      speedBps: 0,
    };
    this.current = progress;

    let source: PackageSource | null = null;

    try {
      source = await this.openPackageSource(sourcePath);

      const pack = this.readPackageManifest(await source.readManifest());
      this.assertSemanticLayout(pack);

      progress.packId = pack.pack_id;
      progress.artifactCount = pack.artifacts.length;
      const totalBytes = pack.artifacts.reduce((sum, a) => sum + a.size_bytes, 0);
      progress.totalBytes = totalBytes;

      rmSync(stagingRoot, { recursive: true, force: true });
      mkdirSync(stagingRoot, { recursive: true });

      let copiedBytes = 0;
      const written: string[] = [];

      for (let i = 0; i < pack.artifacts.length; i++) {
        if (this.cancelled) {
          throw new SemanticPackInstallError('Install cancelled.', 'invalid_package');
        }

        const artifact = pack.artifacts[i];
        progress.currentArtifact = i + 1;

        const finalPath = this.safeJoin(stagingRoot, artifact.path);
        mkdirSync(dirname(finalPath), { recursive: true });

        // Same rule as the download path: a gzipped payload is verified in the
        // form it was packaged in, and expanded only once the digest matches.
        const packagedPath = artifact.gzipped ? `${finalPath}.gz` : finalPath;
        const entryName = packagedFileName(artifact);

        const stream = await source.open(entryName);
        await this.copyVerified(stream, packagedPath, artifact, entryName);

        if (artifact.gzipped) {
          await this.gunzipFile(packagedPath, finalPath);
          rmSync(packagedPath, { force: true });
        }

        copiedBytes += artifact.size_bytes;
        progress.bytesDownloaded = copiedBytes;
        progress.percent = totalBytes > 0
          ? Math.min(100, Math.round((copiedBytes / totalBytes) * 100))
          : 0;
        written.push(artifact.path);
      }

      if (this.cancelled) {
        throw new SemanticPackInstallError('Install cancelled.', 'invalid_package');
      }

      return await this.completeInstall(pack, written, stagingRoot, packRoot, progress);
    } catch (error) {
      const message = (error as Error).message;
      progress.phase = 'error';
      progress.error = message;
      rmSync(stagingRoot, { recursive: true, force: true });
      log.error(`[SemanticPack] Sideload from ${sourcePath} failed: ${message}`);
      throw error instanceof SemanticPackInstallError
        ? error
        : new SemanticPackInstallError(message, 'invalid_package');
    } finally {
      await source?.close();
    }
  }

  // --- Uninstall -----------------------------------------------------------

  /**
   * Remove the installed pack and free the memory its embeddings occupy.
   *
   * The cache reset happens first for the same reason as in `install`: the
   * index is an open SQLite handle, and Windows will not delete an open file.
   */
  uninstall(): boolean {
    const packRoot = getFeaturePackRoot(PACK_TYPE);
    if (!existsSync(packRoot)) return false;

    this.onInstalled();

    try {
      rmSync(packRoot, { recursive: true, force: true });
      log.info('[SemanticPack] Uninstalled semantic search pack');
      return true;
    } catch (error) {
      log.error('[SemanticPack] Uninstall failed:', error);
      throw new SemanticPackInstallError(
        `Could not remove the semantic search pack: ${(error as Error).message}`,
        'write_failed'
      );
    }
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Write the install manifest, then swap the staged directory into place.
   *
   * Shared by both install routes so that "what counts as installed" is decided
   * once. The `onInstalled` calls bracket the swap: the first releases the open
   * SQLite handle on the old index - on Windows an open file cannot be renamed
   * or deleted, so the swap would fail with EBUSY - and the second makes the
   * next search open the new one.
   */
  private async completeInstall(
    pack: FeaturePack | LocalFeaturePack,
    written: string[],
    stagingRoot: string,
    packRoot: string,
    progress: InstallProgress
  ): Promise<InstalledPackManifest> {
    progress.phase = 'installing';

    const manifest: InstalledPackManifest = {
      packId: pack.pack_id,
      packType: pack.pack_type,
      name: pack.name,
      version: pack.version,
      license: pack.license,
      installedAt: new Date().toISOString(),
      files: written,
      installedSizeBytes: this.directorySize(stagingRoot),
      metadata: pack.metadata ?? null,
    };
    writeFileSync(
      join(stagingRoot, MANIFEST_FILENAME),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    this.onInstalled();
    await this.swapIntoPlace(stagingRoot, packRoot);
    this.onInstalled();

    progress.phase = 'done';
    progress.percent = 100;
    log.info(`[SemanticPack] Installed ${pack.pack_id}@${pack.version} (${written.length} files)`);
    return manifest;
  }

  /** Parse and validate a package's `feature-pack.json`. */
  private readPackageManifest(json: string): LocalFeaturePack {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (error) {
      throw new SemanticPackInstallError(
        `The package's ${FEATURE_PACK_MANIFEST_FILENAME} is not valid JSON: ${(error as Error).message}`,
        'invalid_package'
      );
    }

    const parsed = parseLocalFeaturePack(raw);
    if (!parsed.ok) {
      throw new SemanticPackInstallError(
        `The package's ${FEATURE_PACK_MANIFEST_FILENAME} is not a valid feature pack: ${parsed.errors.join(' ')}`,
        'invalid_package'
      );
    }
    return parsed.pack;
  }

  /**
   * Open a package folder or archive for reading.
   *
   * The archive branch resolves entries once, up front, from the central
   * directory. A package may be wrapped in a single top-level folder - which is
   * what every "zip this directory" tool produces, including Explorer's Send To
   * -> Compressed folder - so that wrapper is detected and stripped rather than
   * failed on.
   */
  private async openPackageSource(sourcePath: string): Promise<PackageSource> {
    if (!existsSync(sourcePath)) {
      throw new SemanticPackInstallError(
        `There is no file or folder at ${sourcePath}.`,
        'invalid_package'
      );
    }

    if (statSync(sourcePath).isDirectory()) {
      const root = resolve(sourcePath);
      return {
        readManifest: async () => {
          const manifestPath = join(root, FEATURE_PACK_MANIFEST_FILENAME);
          if (!existsSync(manifestPath)) {
            throw new SemanticPackInstallError(
              `That folder is not a feature pack — it has no ${FEATURE_PACK_MANIFEST_FILENAME}.`,
              'invalid_package'
            );
          }
          return readFileSync(manifestPath, 'utf-8');
        },
        open: async (fileName: string) => {
          // Joined through the same containment check as the write side: the
          // name is manifest-derived, and the manifest is untrusted input.
          const filePath = this.safeJoin(root, fileName);
          if (!existsSync(filePath)) {
            throw new SemanticPackInstallError(
              `The package is missing "${fileName}".`,
              'invalid_package'
            );
          }
          return createReadStream(filePath);
        },
        close: async () => { /* nothing held open */ },
      };
    }

    let entries: Map<string, { stream: () => Readable }>;
    try {
      const directory = await (await unzipperOpen()).file(sourcePath);
      entries = this.indexArchiveEntries(directory.files);
    } catch (error) {
      if (error instanceof SemanticPackInstallError) throw error;
      throw new SemanticPackInstallError(
        `That file could not be read as a feature pack archive: ${(error as Error).message}`,
        'invalid_package'
      );
    }

    return {
      readManifest: async () => {
        const entry = entries.get(FEATURE_PACK_MANIFEST_FILENAME);
        if (!entry) {
          throw new SemanticPackInstallError(
            `That archive is not a feature pack — it has no ${FEATURE_PACK_MANIFEST_FILENAME}.`,
            'invalid_package'
          );
        }
        const chunks: Buffer[] = [];
        for await (const chunk of entry.stream()) {
          chunks.push(chunk as Buffer);
          // The manifest is a few kilobytes; anything approaching a megabyte is
          // not one, and must not be buffered on the strength of its name.
          if (chunks.reduce((n, c) => n + c.length, 0) > 1024 * 1024) {
            throw new SemanticPackInstallError(
              `${FEATURE_PACK_MANIFEST_FILENAME} is implausibly large for a manifest.`,
              'invalid_package'
            );
          }
        }
        return Buffer.concat(chunks).toString('utf-8');
      },
      open: async (fileName: string) => {
        const entry = entries.get(fileName);
        if (!entry) {
          throw new SemanticPackInstallError(
            `The archive is missing "${fileName}".`,
            'invalid_package'
          );
        }
        return entry.stream();
      },
      close: async () => { /* unzipper closes its handle with the last stream */ },
    };
  }

  /**
   * Build the name -> entry map for an archive, stripping a single wrapping
   * directory if every entry shares one.
   *
   * Entry paths are used as *keys only*. Nothing is written to a path an
   * archive chose, so an entry named `../../evil` can never be more than a key
   * that no manifest asks for.
   */
  private indexArchiveEntries(
    files: Array<{ path: string; type: string; stream: () => Readable }>
  ): Map<string, { stream: () => Readable }> {
    const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
    const regular = files.filter(f => f.type === 'File');

    const manifestEntries = regular
      .map(f => normalize(f.path))
      .filter(p => p === FEATURE_PACK_MANIFEST_FILENAME || p.endsWith(`/${FEATURE_PACK_MANIFEST_FILENAME}`))
      .sort((a, b) => a.split('/').length - b.split('/').length);

    if (manifestEntries.length === 0) {
      throw new SemanticPackInstallError(
        `That archive is not a feature pack — it has no ${FEATURE_PACK_MANIFEST_FILENAME}.`,
        'invalid_package'
      );
    }

    const shallowest = manifestEntries[0];
    const depth = shallowest.split('/').length;
    if (depth > 2) {
      throw new SemanticPackInstallError(
        `${FEATURE_PACK_MANIFEST_FILENAME} must be at the root of the archive, or inside a single folder.`,
        'invalid_package'
      );
    }
    if (manifestEntries.filter(p => p.split('/').length === depth).length > 1) {
      // Two candidate manifests at the same depth: there is no principled way to
      // choose, and guessing would mean installing something other than what the
      // user thinks they picked.
      throw new SemanticPackInstallError(
        'That archive contains more than one feature pack. Extract the one you want and install the folder.',
        'invalid_package'
      );
    }

    const prefix = depth === 1 ? '' : `${shallowest.split('/')[0]}/`;
    const map = new Map<string, { stream: () => Readable }>();
    for (const file of regular) {
      const path = normalize(file.path);
      if (prefix && !path.startsWith(prefix)) continue;
      map.set(path.slice(prefix.length), file);
    }
    return map;
  }

  /**
   * Copy one packaged file into staging, checking its size and digest as the
   * bytes go past.
   *
   * Hashing happens in the same pass as the write rather than by re-reading the
   * file afterwards: at a gigabyte and a half, a second pass is a second
   * gigabyte and a half of I/O for no additional guarantee. The size cap is
   * checked *during* the copy so a package that lies about a file's size - the
   * decompression-bomb shape - is cut off rather than filling the disk first.
   */
  private async copyVerified(
    source: Readable,
    destination: string,
    artifact: { size_bytes: number; sha256: string },
    label: string
  ): Promise<void> {
    const hash = createHash('sha256');
    const limit = artifact.size_bytes;
    let seen = 0;

    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            seen += chunk.length;
            if (seen > limit) {
              throw new SemanticPackInstallError(
                `"${label}" is larger than the package manifest declares.`,
                'too_large'
              );
            }
            hash.update(chunk);
            yield chunk;
          }
        },
        createWriteStream(destination)
      );
    } catch (error) {
      if (error instanceof SemanticPackInstallError) throw error;
      throw new SemanticPackInstallError(
        `Could not read "${label}" from the package: ${(error as Error).message}`,
        'write_failed'
      );
    }

    if (seen !== limit) {
      throw new SemanticPackInstallError(
        `"${label}" is truncated — ${seen} bytes where the manifest declares ${limit}.`,
        'invalid_package'
      );
    }

    if (hash.digest('hex') !== artifact.sha256) {
      // Terminal by design, exactly as for a download: the app cannot tell a
      // damaged copy from a substituted one, so there is no "install anyway".
      throw new SemanticPackInstallError(
        `"${label}" does not match the checksum in the package manifest, so it was discarded.`,
        'checksum_mismatch'
      );
    }
  }

  /**
   * Enforce the fixed in-pack layout.
   *
   * The core validator guarantees each path is *safe*; this guarantees the pack
   * is the *shape this app installs*. Without it a catalog could put the index
   * at `data/index.db` - perfectly safe, and perfectly invisible to
   * `resolveSemanticIndexPath()`, producing an install that reports success and
   * changes nothing.
   */
  private assertSemanticLayout(
    pack: { pack_type: string; artifacts: Array<{ kind: string; path: string }> }
  ): void {
    if (pack.pack_type !== PACK_TYPE) {
      throw new SemanticPackInstallError(
        `Expected a ${PACK_TYPE} pack, got ${pack.pack_type}.`,
        'invalid_layout'
      );
    }

    // Data-only check runs FIRST, before any other layout reasoning and - on the
    // download path - before a single byte of egress. A pack that tries to ship
    // executable code is rejected on the strength of its manifest alone; we
    // never fetch it to find out what it is.
    this.assertNoExecutableArtifacts(pack.artifacts);

    const indexArtifacts = pack.artifacts.filter(a => a.kind === 'index');
    if (indexArtifacts.length !== 1 || indexArtifacts[0].path !== SEMANTIC_INDEX_FILENAME) {
      throw new SemanticPackInstallError(
        `A semantic search pack must contain exactly one index artifact at "${SEMANTIC_INDEX_FILENAME}".`,
        'invalid_layout'
      );
    }

    const modelPrefix = `${SEMANTIC_MODELS_DIRNAME}/`;
    const strayModel = pack.artifacts.find(
      a => a.kind === 'model' && !a.path.startsWith(modelPrefix)
    );
    if (strayModel) {
      throw new SemanticPackInstallError(
        `Model artifact "${strayModel.path}" must live under "${modelPrefix}".`,
        'invalid_layout'
      );
    }
    if (!pack.artifacts.some(a => a.kind === 'model')) {
      throw new SemanticPackInstallError(
        'A semantic search pack must contain at least one model artifact.',
        'invalid_layout'
      );
    }
  }

  /**
   * Enforce the data-only invariant: reject any artifact whose file extension is
   * not on `ALLOWED_ARTIFACT_EXTENSIONS`.
   *
   * Paths are treated as POSIX manifest paths (`models/onnx/model.onnx`), not OS
   * paths, because that is what they are - the manifest declares them and
   * `safeJoin` is what maps them onto the filesystem. Splitting on `/` rather
   * than using `basename` keeps this check identical on Windows and Linux; a
   * platform-dependent security check is a bug waiting for one platform's users.
   *
   * A path with no extension is rejected rather than allowed: on Linux an
   * executable usually has no extension at all, so "no extension" is the single
   * most likely shape for smuggled code.
   */
  private assertNoExecutableArtifacts(artifacts: Array<{ path: string }>): void {
    for (const artifact of artifacts) {
      const segments = artifact.path.split('/');
      const fileName = segments[segments.length - 1] ?? '';
      const dotIndex = fileName.lastIndexOf('.');

      // `dotIndex <= 0` covers both "no dot at all" and a leading-dot dotfile
      // like `.bashrc`, which has no extension in the sense meant here.
      const extension = dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : '';

      if (!ALLOWED_ARTIFACT_EXTENSIONS.has(extension)) {
        const described = extension === '' ? 'no file extension' : `extension "${extension}"`;
        throw new SemanticPackInstallError(
          `Refusing artifact "${artifact.path}": ${described}. Packs carry data only — ` +
            `allowed extensions are ${[...ALLOWED_ARTIFACT_EXTENSIONS].join(', ')}. ` +
            `Executable code ships in the installer, never in a pack.`,
          'invalid_layout'
        );
      }
    }
  }

  /**
   * Join a validated relative path onto a root and confirm the *resolved*
   * result is still inside it.
   *
   * The core validator should already make this impossible. It is repeated here
   * because this is the last line before a real write, and a containment check
   * on the resolved path catches anything the textual validator did not
   * anticipate (symlinked staging directory, platform-specific normalisation).
   */
  private safeJoin(root: string, relativePath: string): string {
    const resolvedRoot = resolve(root);
    const target = resolve(resolvedRoot, relativePath);
    const rel = relative(resolvedRoot, target);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new SemanticPackInstallError(
        `Refusing to write outside the pack directory: ${relativePath}`,
        'invalid_layout'
      );
    }
    return target;
  }

  private async downloadArtifact(
    artifact: FeaturePackArtifact,
    destination: string,
    bytesBefore: number
  ): Promise<void> {
    const queueId = this.nextQueueId++;
    this.activeQueueIds.add(queueId);

    const cap = Math.ceil(artifact.download_size_bytes * SIZE_OVERRUN_FACTOR);
    let overran = false;

    const onProgress = (progress: { queueId: number; progressBytes: number; speedBps?: number }): void => {
      if (progress.queueId !== queueId) return;
      if (this.current) {
        this.current.bytesDownloaded = bytesBefore + progress.progressBytes;
        this.current.speedBps = progress.speedBps ?? 0;
        this.current.percent = this.current.totalBytes > 0
          ? Math.min(100, Math.round((this.current.bytesDownloaded / this.current.totalBytes) * 100))
          : 0;
      }
      // A server is free to ignore the size it published. Abort rather than
      // let an unbounded response run the disk out of space.
      if (progress.progressBytes > cap && !overran) {
        overran = true;
        try {
          this.downloads.cancelDownload(queueId);
        } catch {
          /* already gone */
        }
      }
    };

    this.downloads.onProgress(onProgress);

    try {
      // Any stale partial from a previous attempt must go: DownloadService
      // treats an existing file as a resume point and would issue a Range
      // request against bytes whose provenance we no longer trust.
      rmSync(destination, { force: true });

      await this.downloads.startDownload(
        queueId,
        artifact.download_url,
        destination,
        artifact.sha256
      );
    } catch (error) {
      const message = (error as Error).message;
      if (overran) {
        throw new SemanticPackInstallError(
          `"${artifact.path}" is larger than the catalog declared, so the download was stopped.`,
          'too_large'
        );
      }
      if (/checksum/i.test(message)) {
        // Terminal by design, exactly as in the extension catalog installer:
        // the app cannot tell a corrupted transfer from a substituted payload,
        // so there is no "install anyway".
        throw new SemanticPackInstallError(
          `The downloaded file "${artifact.path}" did not match the checksum published by the catalog, so it was discarded.`,
          'checksum_mismatch'
        );
      }
      if (/offline/i.test(message)) {
        throw new SemanticPackInstallError(
          'The app is in offline mode, so the semantic search pack cannot be downloaded.',
          'offline'
        );
      }
      throw new SemanticPackInstallError(
        `Download of "${artifact.path}" failed: ${message}`,
        'download_failed'
      );
    } finally {
      this.activeQueueIds.delete(queueId);
      this.downloads.offProgress(onProgress);
    }

    if (!existsSync(destination)) {
      throw new SemanticPackInstallError(
        `Download of "${artifact.path}" produced no file.`,
        'download_failed'
      );
    }
  }

  /**
   * Replace the pack root with the staged directory, retrying briefly on the
   * transient sharing violations Windows is prone to.
   *
   * The cache reset above releases *our* handle on the index, but two other
   * things can still hold the old directory for a moment: a search that raced
   * in and re-opened the index between the reset and the swap, and the
   * antivirus / Search Indexer scan that a few hundred megabytes of freshly
   * written files reliably provokes. Both clear in well under a second, so a
   * short backoff turns what would surface as "install failed, try again" into
   * an install that simply works.
   *
   * Only lock-shaped errors are retried; anything else (a full disk, a
   * permission problem) fails immediately rather than being retried three times
   * on its way to the same outcome.
   */
  private async swapIntoPlace(stagingRoot: string, packRoot: string): Promise<void> {
    const RETRYABLE = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
    const DELAYS_MS = [100, 300, 700];

    mkdirSync(dirname(packRoot), { recursive: true });

    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(packRoot, { recursive: true, force: true });
        renameSync(stagingRoot, packRoot);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (!RETRYABLE.has(code) || attempt >= DELAYS_MS.length) {
          throw new SemanticPackInstallError(
            `Could not put the downloaded pack in place: ${(error as Error).message}`,
            'write_failed'
          );
        }
        log.warn(`[SemanticPack] Swap attempt ${attempt + 1} hit ${code}; retrying`);
        await new Promise(resolve => setTimeout(resolve, DELAYS_MS[attempt]));
      }
    }
  }

  private async gunzipFile(source: string, destination: string): Promise<void> {
    try {
      await pipeline(createReadStream(source), createGunzip(), createWriteStream(destination));
    } catch (error) {
      throw new SemanticPackInstallError(
        `Could not expand "${source}": ${(error as Error).message}`,
        'write_failed'
      );
    }
  }

  private readManifest(): InstalledPackManifest | null {
    const manifestPath = join(getFeaturePackRoot(PACK_TYPE), MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as InstalledPackManifest;
      if (typeof parsed?.packId !== 'string' || !Array.isArray(parsed?.files)) return null;
      return parsed;
    } catch (error) {
      log.warn('[SemanticPack] Could not read pack manifest:', error);
      return null;
    }
  }

  /**
   * A manifest alone does not mean the pack works - a half-deleted directory
   * would still report installed and then fail at search time. Confirm the two
   * files the runtime actually opens are on disk.
   */
  private packFilesPresent(manifest: InstalledPackManifest): boolean {
    const root = getFeaturePackRoot(PACK_TYPE);
    if (!existsSync(join(root, SEMANTIC_INDEX_FILENAME))) return false;
    return manifest.files
      .filter(f => f.startsWith(`${SEMANTIC_MODELS_DIRNAME}/`))
      .every(f => existsSync(join(root, f)));
  }

  private directorySize(dir: string): number {
    let total = 0;
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) total += statSync(full).size;
      }
    };
    try {
      walk(dir);
    } catch {
      /* best-effort - a size we cannot compute is not worth failing an install */
    }
    return total;
  }
}

// --- Singleton -------------------------------------------------------------

let singleton: SemanticPackService | null = null;

export function getSemanticPackService(onInstalled: () => void): SemanticPackService {
  if (!singleton) {
    singleton = new SemanticPackService(onInstalled);
  }
  return singleton;
}

