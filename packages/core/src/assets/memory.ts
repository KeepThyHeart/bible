/**
 * In-memory asset store and registry store (task 0090).
 *
 * Used as the fallback where no persistent store exists (web without Cache Storage),
 * and as the reference implementation of the IAssetStore contract in tests.
 * Committed files are keyed by `ref.url`, like the web store.
 */

import { AssetError } from './types';
import type {
  AssetFileRef,
  AssetRegistrySnapshot,
  IAssetRegistryStore,
  IAssetStore,
  IPartialFile,
} from './types';

export interface MemoryAssetStoreOptions {
  /** Clock for partial `touchedAt` (sweeps). Default `Date.now`. */
  now?: () => number;
  /** Simulated device capacity (committed + partial bytes). Over it, append throws `quota`. Default: unlimited. */
  capacityBytes?: number;
  /** With `capacityBytes`: whether `freeBytes()` reports the remaining space. Default true. */
  reportFreeBytes?: boolean;
}

interface PartialState {
  chunks: Uint8Array[];
  size: number;
  validator: string | null;
  touchedAt: number;
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

class MemoryPartialFile implements IPartialFile {
  private ended = false;

  constructor(
    private readonly store: MemoryAssetStore,
    private readonly key: string,
    private readonly state: PartialState,
  ) {}

  get size(): number {
    return this.state.size;
  }

  get validator(): string | null {
    return this.state.validator;
  }

  read(): AsyncIterable<Uint8Array> {
    const chunks = this.state.chunks.slice();
    return (async function* () {
      for (const c of chunks) yield c.slice();
    })();
  }

  async append(chunk: Uint8Array): Promise<void> {
    this.assertOpen();
    this.store.assertRoom(chunk.length);
    this.state.chunks.push(chunk.slice());
    this.state.size += chunk.length;
    this.state.touchedAt = this.store.now();
  }

  async reset(validator: string | null): Promise<void> {
    this.assertOpen();
    this.state.chunks = [];
    this.state.size = 0;
    this.state.validator = validator;
    this.state.touchedAt = this.store.now();
  }

  async close(): Promise<void> {
    if (this.ended) return;
    this.state.touchedAt = this.store.now();
  }

  async commit(): Promise<void> {
    this.assertOpen();
    this.ended = true;
    this.store.commitPartial(this.key, this.state, concat(this.state.chunks, this.state.size));
  }

  async discard(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.store.dropPartial(this.key, this.state);
  }

  private assertOpen(): void {
    if (this.ended) throw new AssetError('storage', 'Partial file already committed or discarded');
  }
}

export class MemoryAssetStore implements IAssetStore {
  private readonly files = new Map<string, Uint8Array>();
  private readonly partials = new Map<string, PartialState>();
  private readonly clock: () => number;
  private readonly capacity: number | undefined;
  freeBytes?: () => Promise<number | null>;

  constructor(opts: MemoryAssetStoreOptions = {}) {
    this.clock = opts.now ?? (() => Date.now());
    this.capacity = opts.capacityBytes;
    if (this.capacity !== undefined && opts.reportFreeBytes !== false) {
      this.freeBytes = async () => Math.max(0, (this.capacity as number) - this.usedBytes());
    }
  }

  /** @internal */
  now(): number {
    return this.clock();
  }

  /** Committed + partial bytes held. */
  usedBytes(): number {
    let n = 0;
    for (const f of this.files.values()) n += f.length;
    for (const p of this.partials.values()) n += p.size;
    return n;
  }

  /** @internal */
  assertRoom(extra: number): void {
    if (this.capacity !== undefined && this.usedBytes() + extra > this.capacity) {
      throw new AssetError('quota', 'Memory store is full');
    }
  }

  /** @internal */
  commitPartial(key: string, state: PartialState, data: Uint8Array): void {
    this.files.set(key, data);
    if (this.partials.get(key) === state) this.partials.delete(key);
  }

  /** @internal */
  dropPartial(key: string, state: PartialState): void {
    if (this.partials.get(key) === state) this.partials.delete(key);
  }

  async exists(ref: AssetFileRef): Promise<boolean> {
    return this.files.has(ref.url);
  }

  async read(ref: AssetFileRef): Promise<AsyncIterable<Uint8Array> | null> {
    const data = this.files.get(ref.url);
    if (!data) return null;
    return (async function* () {
      yield data.slice();
    })();
  }

  async openPartial(ref: AssetFileRef): Promise<IPartialFile> {
    let state = this.partials.get(ref.url);
    if (!state) {
      state = { chunks: [], size: 0, validator: null, touchedAt: this.now() };
      this.partials.set(ref.url, state);
    }
    return new MemoryPartialFile(this, ref.url, state);
  }

  async delete(refs: AssetFileRef[]): Promise<void> {
    for (const ref of refs) {
      this.files.delete(ref.url);
      this.partials.delete(ref.url);
    }
  }

  async sweepPartials(olderThanMs: number): Promise<void> {
    const cutoff = this.now() - olderThanMs;
    for (const [key, state] of [...this.partials]) {
      if (state.touchedAt < cutoff) this.partials.delete(key);
    }
  }

  // --- inspection (tests) ---

  /** Committed bytes by url, or undefined. */
  peekFile(url: string): Uint8Array | undefined {
    return this.files.get(url)?.slice();
  }

  /** Bytes held in the partial for `url`, or undefined when there is none. */
  peekPartial(url: string): Uint8Array | undefined {
    const p = this.partials.get(url);
    return p ? concat(p.chunks, p.size) : undefined;
  }

  fileUrls(): string[] {
    return [...this.files.keys()].sort();
  }

  partialUrls(): string[] {
    return [...this.partials.keys()].sort();
  }
}

/** Registry document held as a JSON string (so a load never aliases live objects). */
export class MemoryAssetRegistryStore implements IAssetRegistryStore {
  /** The stored document as JSON text, or null when nothing was saved. Tests may set garbage. */
  raw: string | null = null;
  saves = 0;
  /** Number of upcoming `save` calls that reject (test hook). */
  failSaves = 0;

  constructor(initial?: AssetRegistrySnapshot) {
    if (initial) this.raw = JSON.stringify(initial);
  }

  async load(): Promise<AssetRegistrySnapshot | null> {
    if (this.raw == null) return null;
    try {
      return JSON.parse(this.raw) as AssetRegistrySnapshot;
    } catch {
      return null;
    }
  }

  async save(snapshot: AssetRegistrySnapshot): Promise<void> {
    if (this.failSaves > 0) {
      this.failSaves--;
      throw new Error('registry save failed');
    }
    this.saves++;
    this.raw = JSON.stringify(snapshot);
  }

  /** The stored document parsed, or null. */
  get current(): AssetRegistrySnapshot | null {
    if (this.raw == null) return null;
    try {
      return JSON.parse(this.raw) as AssetRegistrySnapshot;
    } catch {
      return null;
    }
  }
}
