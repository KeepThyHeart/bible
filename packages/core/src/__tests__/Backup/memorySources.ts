/** In-memory FileSource / extension source for backup tests. */
import type { FileSource, ExtensionDataSource } from '../../Backup/Payload';
import type { ExtensionBackupDecl } from '../../Backup/ExtensionData';

export class MemoryFiles implements FileSource {
  constructor(public files: Map<string, Uint8Array> = new Map()) {}
  static of(obj: Record<string, string | Uint8Array>): MemoryFiles {
    return new MemoryFiles(new Map(Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? new TextEncoder().encode(v) : v])));
  }
  async *list() {
    for (const [path, data] of this.files) yield { path, size: data.length };
  }
  async read(path: string) {
    const d = this.files.get(path);
    if (!d) throw new Error(`no such file ${path}`);
    return d;
  }
}

export class MemoryExtensions implements ExtensionDataSource {
  constructor(public decls: ExtensionBackupDecl[], public dbs: Record<string, Uint8Array> = {}) {}
  async list() { return this.decls; }
  async dbSnapshot(id: string, name: string) {
    const d = this.dbs[`${id}/${name}`];
    if (!d) throw new Error('no such db');
    return d;
  }
}
