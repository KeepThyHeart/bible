/**
 * `IAssetRegistryStore` for the module asset manager: one JSON document at
 * OPFS `modules/.registry.json` (task 0075). A device cache index, not user data.
 */

import { ASSET_REGISTRY_SCHEMA, AssetError } from '@bible/core/browser';
import type { AssetRegistrySnapshot, IAssetRegistryStore } from '@bible/core/browser';
import { opfsAvailable } from './OpfsModuleStore';

const FILE = '.registry.json';

export class OpfsRegistryStore implements IAssetRegistryStore {
  /** @throws AssetError('storage') when OPFS is unavailable and no `getRoot` is injected. */
  constructor(
    private readonly getRoot: () => Promise<FileSystemDirectoryHandle> = (() => {
      if (!opfsAvailable()) throw new AssetError('storage', 'The Origin Private File System is not available in this browser');
      return () => navigator.storage.getDirectory();
    })(),
  ) {}

  async load(): Promise<AssetRegistrySnapshot | null> {
    try {
      const modules = await (await this.getRoot()).getDirectoryHandle('modules');
      const file = await (await modules.getFileHandle(FILE)).getFile();
      const json = JSON.parse(await file.text()) as AssetRegistrySnapshot;
      return json && json.schema === ASSET_REGISTRY_SCHEMA && Array.isArray(json.assets) ? json : null;
    } catch {
      return null;
    }
  }

  async save(snapshot: AssetRegistrySnapshot): Promise<void> {
    try {
      const modules = await (await this.getRoot()).getDirectoryHandle('modules', { create: true });
      const h = await modules.getFileHandle(FILE, { create: true });
      const w = await h.createWritable();
      try {
        await w.write(JSON.stringify(snapshot));
        await w.close();
      } catch (e) {
        try { await w.abort(); } catch { /* ignore */ }
        throw e;
      }
    } catch (e) {
      if (e instanceof AssetError) throw e;
      throw new AssetError('storage', `save module registry: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
