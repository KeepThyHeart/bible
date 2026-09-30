/**
 * In-memory subset of the File System Access API (OPFS) for tests (task 0075):
 * directories with getDirectoryHandle/getFileHandle (create), removeEntry (recursive),
 * entries(); files with getFile, createWritable (keepExistingData, write, seek, truncate,
 * close, abort) and move(). `withoutMove` drops move() to test the copy fallback.
 */

class NotFoundError extends Error {
  override name = 'NotFoundError';
}

class FakeBlobFile {
  readonly lastModified = Date.now();
  constructor(readonly name: string, private readonly bytes: Uint8Array) {}
  get size(): number { return this.bytes.length; }
  slice(start?: number, end?: number): FakeBlobFile {
    return new FakeBlobFile(this.name, this.bytes.slice(start ?? 0, end ?? this.bytes.length));
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer as ArrayBuffer;
  }
  async text(): Promise<string> {
    return new TextDecoder().decode(this.bytes);
  }
}

interface FileNode { kind: 'file'; data: Uint8Array }

export class FakeDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, FileNode | FakeDir>();
  constructor(readonly name: string, private readonly opts: { withoutMove?: boolean }, private readonly parent: FakeDir | null = null) {}

  async getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<FakeDir> {
    const hit = this.children.get(name);
    if (hit instanceof FakeDir) return hit;
    if (hit) throw new DOMException('type mismatch', 'TypeMismatchError');
    if (!o?.create) throw new NotFoundError(name);
    const d = new FakeDir(name, this.opts, this);
    this.children.set(name, d);
    return d;
  }

  async getFileHandle(name: string, o?: { create?: boolean }): Promise<FakeFileHandle> {
    let hit = this.children.get(name);
    if (hit instanceof FakeDir) throw new DOMException('type mismatch', 'TypeMismatchError');
    if (!hit) {
      if (!o?.create) throw new NotFoundError(name);
      hit = { kind: 'file', data: new Uint8Array(0) };
      this.children.set(name, hit);
    }
    return new FakeFileHandle(this, name, this.opts);
  }

  async removeEntry(name: string, o?: { recursive?: boolean }): Promise<void> {
    const hit = this.children.get(name);
    if (!hit) throw new NotFoundError(name);
    if (hit instanceof FakeDir && hit.children.size > 0 && !o?.recursive) throw new DOMException('not empty', 'InvalidModificationError');
    this.children.delete(name);
  }

  async *entries(): AsyncGenerator<[string, FakeDir | FakeFileHandle]> {
    for (const [name, node] of [...this.children]) {
      yield [name, node instanceof FakeDir ? node : new FakeFileHandle(this, name, this.opts)];
    }
  }

  /** Test helper: bytes of a file by path ('modules/kjv.db'), or undefined. */
  peek(path: string): Uint8Array | undefined {
    let dir: FakeDir = this;
    const parts = path.split('/');
    for (const p of parts.slice(0, -1)) {
      const n = dir.children.get(p);
      if (!(n instanceof FakeDir)) return undefined;
      dir = n;
    }
    const f = dir.children.get(parts[parts.length - 1]);
    return f && !(f instanceof FakeDir) ? f.data : undefined;
  }

  /** Test helper: file names of a directory path ('' = this). */
  list(path = ''): string[] {
    let dir: FakeDir = this;
    for (const p of path.split('/').filter(Boolean)) {
      const n = dir.children.get(p);
      if (!(n instanceof FakeDir)) return [];
      dir = n;
    }
    return [...dir.children.keys()].sort();
  }
}

export class FakeFileHandle {
  readonly kind = 'file' as const;
  constructor(private readonly dir: FakeDir, readonly name: string, opts: { withoutMove?: boolean }) {
    if (opts.withoutMove) (this as { move?: unknown }).move = undefined;
  }

  private node(): FileNode {
    const n = this.dir.children.get(this.name);
    if (!n || n instanceof FakeDir) throw new NotFoundError(this.name);
    return n;
  }

  async getFile(): Promise<FakeBlobFile> {
    return new FakeBlobFile(this.name, this.node().data.slice());
  }

  async createWritable(o?: { keepExistingData?: boolean }): Promise<FakeWritable> {
    const node = this.node();
    return new FakeWritable(node, o?.keepExistingData ? node.data.slice() : new Uint8Array(0));
  }

  async move(dest: FakeDir | string, name?: string): Promise<void> {
    const node = this.node();
    const target = typeof dest === 'string' ? this.dir : dest;
    const newName = typeof dest === 'string' ? dest : name!;
    this.dir.children.delete(this.name);
    target.children.set(newName, node);
  }
}

export class FakeWritable {
  private pos = 0;
  private done = false;
  constructor(private readonly node: FileNode, private buf: Uint8Array) {}

  private put(bytes: Uint8Array): void {
    const end = this.pos + bytes.length;
    if (end > this.buf.length) {
      const grown = new Uint8Array(end);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf.set(bytes, this.pos);
    this.pos = end;
  }

  async write(chunk: Uint8Array | string | { type: string; data?: Uint8Array | string; position?: number; size?: number }): Promise<void> {
    if (this.done) throw new Error('closed');
    if (typeof chunk === 'string') return this.put(new TextEncoder().encode(chunk));
    if (chunk instanceof Uint8Array) return this.put(chunk);
    if (chunk.type === 'seek') this.pos = chunk.position ?? 0;
    else if (chunk.type === 'truncate') await this.truncate(chunk.size ?? 0);
    else if (chunk.data !== undefined) {
      if (chunk.position !== undefined) this.pos = chunk.position;
      this.put(typeof chunk.data === 'string' ? new TextEncoder().encode(chunk.data) : chunk.data);
    }
  }

  async seek(pos: number): Promise<void> { this.pos = pos; }

  async truncate(size: number): Promise<void> {
    const next = new Uint8Array(size);
    next.set(this.buf.slice(0, size));
    this.buf = next;
    if (this.pos > size) this.pos = size;
  }

  async close(): Promise<void> {
    if (this.done) return;
    this.done = true;
    this.node.data = this.buf;
  }

  async abort(): Promise<void> { this.done = true; }
}

export function createFakeOpfs(opts: { withoutMove?: boolean } = {}): FakeDir {
  return new FakeDir('', opts);
}
