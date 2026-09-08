/**
 * Host-side implementation of the `fs:managed-folder` extension API.
 *
 * Provides scoped filesystem access to a user-chosen folder. All file
 * operations are gated on the `fs:managed-folder` permission and enforce
 * strict path containment:
 *   - Paths are resolved against the grant root via `path.resolve`.
 *   - Symlinks are resolved via `fs.realpathSync` to prevent escaping.
 *   - `..` segments that escape the root are rejected.
 *
 * Binary data crosses the RPC boundary as `Uint8Array` / `ArrayBuffer`
 * which the MessagePort structured clone algorithm handles natively.
 */

import * as fs from 'fs/promises';
import { existsSync, realpathSync, lstatSync } from 'fs';
import { resolve, relative, sep, basename, join, normalize } from 'path';

import { Extensions } from '@bible/core';

import type { ExtensionRpcRouter } from '../ExtensionRpcRouter';
import {
  type ExtensionPermissionGrant,
  requirePermission,
} from '../ExtensionPermissionGuard';
import type { IExtensionFolderBridge } from './IExtensionDataBridges';

const { RpcProtocolError, PermissionDeniedError } = Extensions;

export interface FolderStorageApiImplOptions {
  extensionId: string;
  router: ExtensionRpcRouter;
  grant: ExtensionPermissionGrant;
  bridge: IExtensionFolderBridge;
}

export class FolderStorageApiImpl {
  private readonly extensionId: string;
  private readonly router: ExtensionRpcRouter;
  private readonly grant: ExtensionPermissionGrant;
  private readonly bridge: IExtensionFolderBridge;
  private disposed = false;

  constructor(opts: FolderStorageApiImplOptions) {
    this.extensionId = opts.extensionId;
    this.router = opts.router;
    this.grant = opts.grant;
    this.bridge = opts.bridge;
  }

  attach(): void {
    // Register individual methods on the 'storage' namespace. The
    // StorageApiImpl already claims 'storage' via registerNamespace, so we
    // use registerMethod to add methods without colliding. The worker-side
    // proxy translates `api.storage.requestFolder(...)` -> RPC method
    // `storage.requestFolder`, which hits these handlers.
    const methods: Record<string, (args: unknown[]) => Promise<unknown>> = {
      requestFolder: (args) => this.handleRequestFolder(args),
      getFolderGrant: () => this.handleGetFolderGrant(),
      revokeFolderGrant: () => this.handleRevokeFolderGrant(),
      readFile: (args) => this.handleReadFile(args),
      writeFile: (args) => this.handleWriteFile(args),
      deleteFile: (args) => this.handleDeleteFile(args),
      listFiles: (args) => this.handleListFiles(args),
      statFile: (args) => this.handleStatFile(args),
      getFolderUsage: () => this.handleGetFolderUsage(),
    };
    for (const [name, handler] of Object.entries(methods)) {
      this.router.registerMethod(`storage.${name}`, handler);
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  // --- Handlers ---------------------------------------------------------

  private async handleRequestFolder(args: unknown[]): Promise<Extensions.FolderGrantHandle | null> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');

    if (typeof args[0] !== 'string' || args[0].length === 0) {
      throw new RpcProtocolError('storage.folder.requestFolder: purpose must be a non-empty string');
    }
    const purpose = args[0];

    const folderPath = await this.bridge.requestFolder(this.extensionId, purpose);
    if (folderPath === null) return null;

    // Persist the grant.
    await this.bridge.persistFolderGrant(this.extensionId, folderPath);
    const grant = await this.bridge.getFolderGrant(this.extensionId);
    if (!grant) {
      throw new RpcProtocolError('storage.folder.requestFolder: grant persist failed');
    }
    return { path: grant.path, grantedAt: grant.grantedAt };
  }

  private async handleGetFolderGrant(): Promise<Extensions.FolderGrantHandle | null> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');
    const grant = await this.bridge.getFolderGrant(this.extensionId);
    if (!grant) return null;
    return { path: grant.path, grantedAt: grant.grantedAt };
  }

  private async handleRevokeFolderGrant(): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');
    await this.bridge.revokeFolderGrant(this.extensionId);
  }

  private async handleReadFile(args: unknown[]): Promise<Uint8Array> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');
    const relPath = this.requireRelativePath(args[0], 'storage.folder.readFile');
    const grantRoot = await this.requireGrantRoot();
    const safePath = this.resolveSafePath(grantRoot, relPath, 'storage.folder.readFile');

    const buf = await fs.readFile(safePath);
    // Return as Uint8Array for RPC structured clone compatibility.
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private async handleWriteFile(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');
    const relPath = this.requireRelativePath(args[0], 'storage.folder.writeFile');
    const data = this.requireBinaryData(args[1], 'storage.folder.writeFile');
    const grantRoot = await this.requireGrantRoot();
    const safePath = this.resolveSafePath(grantRoot, relPath, 'storage.folder.writeFile');

    // Ensure parent directory exists.
    const dir = resolve(safePath, '..');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(safePath, data);
  }

  private async handleDeleteFile(args: unknown[]): Promise<void> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');
    const relPath = this.requireRelativePath(args[0], 'storage.folder.deleteFile');
    const grantRoot = await this.requireGrantRoot();
    const safePath = this.resolveSafePath(grantRoot, relPath, 'storage.folder.deleteFile');

    try {
      await fs.unlink(safePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // No-op if file does not exist.
    }
  }

  private async handleListFiles(args: unknown[]): Promise<Extensions.FileInfo[]> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');
    const grantRoot = await this.requireGrantRoot();

    let listDir = grantRoot;
    if (args[0] !== undefined && args[0] !== null) {
      if (typeof args[0] !== 'string') {
        throw new RpcProtocolError('storage.folder.listFiles: prefix must be a string');
      }
      listDir = this.resolveSafePath(grantRoot, args[0], 'storage.folder.listFiles');
    }

    // Check the directory exists.
    try {
      const stat = await fs.stat(listDir);
      if (!stat.isDirectory()) return [];
    } catch {
      return [];
    }

    const entries = await fs.readdir(listDir, { withFileTypes: true });
    const results: Extensions.FileInfo[] = [];

    for (const entry of entries) {
      const fullPath = join(listDir, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        results.push({
          name: entry.name,
          path: relative(grantRoot, fullPath).split(sep).join('/'),
          size: stat.size,
          isDirectory: stat.isDirectory(),
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // Skip entries that cannot be stat'd (broken symlinks, etc.).
      }
    }
    return results;
  }

  private async handleStatFile(args: unknown[]): Promise<Extensions.FileInfo | null> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');
    const relPath = this.requireRelativePath(args[0], 'storage.folder.statFile');
    const grantRoot = await this.requireGrantRoot();
    const safePath = this.resolveSafePath(grantRoot, relPath, 'storage.folder.statFile');

    try {
      const stat = await fs.stat(safePath);
      return {
        name: basename(safePath),
        path: relative(grantRoot, safePath).split(sep).join('/'),
        size: stat.size,
        isDirectory: stat.isDirectory(),
        modifiedAt: stat.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }

  private async handleGetFolderUsage(): Promise<Extensions.FolderUsageInfo> {
    this.assertActive();
    requirePermission(this.grant, 'fs:managed-folder');
    const grantRoot = await this.requireGrantRoot();

    let fileCount = 0;
    let totalBytes = 0;

    async function walk(dir: string): Promise<void> {
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else {
            const stat = await fs.stat(fullPath);
            fileCount++;
            totalBytes += stat.size;
          }
        } catch {
          // Skip inaccessible entries.
        }
      }
    }

    await walk(grantRoot);
    return { path: grantRoot, fileCount, totalBytes };
  }

  // --- Helpers ----------------------------------------------------------

  private assertActive(): void {
    if (this.disposed) {
      throw new Extensions.ExtensionNotActiveError(
        `folderStorageApiImpl for ${this.extensionId} is disposed`,
      );
    }
  }

  /**
   * Get the grant root path, throwing if no grant exists.
   */
  private async requireGrantRoot(): Promise<string> {
    const grant = await this.bridge.getFolderGrant(this.extensionId);
    if (!grant) {
      throw new PermissionDeniedError(
        `Extension '${this.extensionId}' has no active folder grant. Call requestFolder() first.`,
      );
    }
    return grant.path;
  }

  /**
   * Validate that `raw` is a non-empty string without path-traversal hazards.
   */
  private requireRelativePath(raw: unknown, methodName: string): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new RpcProtocolError(`${methodName}: path must be a non-empty string`);
    }
    // Reject absolute paths.
    const normalized = normalize(raw);
    if (resolve(raw) === normalized || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
      throw new RpcProtocolError(`${methodName}: path must be relative`);
    }
    return raw;
  }

  /**
   * Resolve a relative path against the grant root, enforcing containment.
   * Checks:
   *   1. `normalize + resolve` must stay within grantRoot.
   *   2. If the target exists and is a symlink, `realpathSync` must also
   *      resolve within grantRoot.
   */
  private resolveSafePath(grantRoot: string, relPath: string, methodName: string): string {
    const resolved = resolve(grantRoot, relPath);
    const normalizedRoot = resolve(grantRoot);
    const prefix = normalizedRoot + sep;

    // The resolved path must either BE the root or START WITH root + sep.
    if (resolved !== normalizedRoot && !resolved.startsWith(prefix)) {
      throw new PermissionDeniedError(
        `${methodName}: path '${relPath}' escapes the granted folder.`,
      );
    }

    // If the file/directory exists, verify symlinks resolve within the root.
    if (existsSync(resolved)) {
      try {
        const stat = lstatSync(resolved);
        if (stat.isSymbolicLink()) {
          const realTarget = realpathSync(resolved);
          if (realTarget !== normalizedRoot && !realTarget.startsWith(prefix)) {
            throw new PermissionDeniedError(
              `${methodName}: symlink at '${relPath}' resolves outside the granted folder.`,
            );
          }
        }
      } catch (err) {
        if (err instanceof PermissionDeniedError) throw err;
        // Cannot stat - let the actual fs operation surface the error.
      }
    }

    return resolved;
  }

  /**
   * Validate and convert binary data argument to a Buffer/Uint8Array.
   */
  private requireBinaryData(raw: unknown, methodName: string): Uint8Array {
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (Buffer.isBuffer(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    throw new RpcProtocolError(
      `${methodName}: data must be ArrayBuffer or Uint8Array`,
    );
  }
}
