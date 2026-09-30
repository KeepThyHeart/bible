/**
 * AssetManager (task 0090, design.md §4.1, §4.3-§4.7): queue, dedupe, registry,
 * usage, eviction and update diffs over the three ports. Pure TypeScript; the clock,
 * sleep and hasher are injected.
 */

import { AssetError, ASSET_REGISTRY_SCHEMA } from './types';
import type {
  AssetEntry,
  AssetFileRef,
  AssetJobPhase,
  AssetListSnapshot,
  AssetManagerDeps,
  AssetManifest,
  AssetProgress,
  AssetRegistrySnapshot,
  AssetStatus,
  AssetUpdate,
  EvictionResult,
  IAssetManager,
  InstallOptions,
  InstalledAsset,
} from './types';
import { Sha256 } from './sha256';
import { downloadFile, resolveExpectedSha, toAssetError } from './downloadFile';
import type { DownloadEnv } from './downloadFile';

const PARTIAL_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const PROGRESS_THROTTLE_MS = 100;
const USED_SAVE_DELAY_MS = 5000;
const FREE_SPACE_MARGIN = 1.05;

interface Sub {
  resolve(v: InstalledAsset): void;
  reject(e: unknown): void;
  onProgress?: (p: AssetProgress) => void;
  unlisten?: () => void;
}

interface Job {
  manifest: AssetManifest;
  controller: AbortController;
  subs: Set<Sub>;
  pinned: boolean;
  started: boolean;
  phase: AssetJobPhase;
  /** Bytes of the asset held so far (completed files + current file). */
  loaded: number;
  /** Bytes of the completed files. */
  base: number;
  fileIndex: number;
  attempt: number;
  lastEmit: number;
  progress: AssetProgress;
  /** Resolves when the job has fully ended (any outcome). */
  done: Promise<void>;
  finish: () => void;
}

interface ErrorRecord {
  code: AssetError['code'];
  message: string;
  manifest: AssetManifest;
}

function abortedError(): AssetError {
  return new AssetError('aborted', 'Aborted');
}

function refFor(manifest: Pick<AssetManifest, 'id' | 'kind' | 'version'>, file: { path: string; url: string; size: number; contentType?: string }): AssetFileRef {
  return {
    assetId: manifest.id,
    kind: manifest.kind,
    version: manifest.version,
    path: file.path,
    url: file.url,
    size: file.size,
    contentType: file.contentType,
  };
}

function refsOfInstalled(a: InstalledAsset): AssetFileRef[] {
  return a.files.map((f) => refFor(a, f));
}

function checkManifest(m: AssetManifest): string | null {
  if (!m || typeof m !== 'object') return 'manifest is not an object';
  if (typeof m.id !== 'string' || !m.id) return 'manifest id missing';
  if (typeof m.kind !== 'string' || !m.kind) return `${m.id}: kind missing`;
  if (typeof m.version !== 'string' || !m.version) return `${m.id}: version missing`;
  if (!Array.isArray(m.files) || m.files.length === 0) return `${m.id}: no files`;
  for (const f of m.files) {
    if (!f || typeof f.path !== 'string' || typeof f.url !== 'string' || typeof f.size !== 'number' || f.size < 0) {
      return `${m.id}: invalid file entry`;
    }
  }
  return null;
}

function sanitizeInstalled(raw: unknown, now: number): InstalledAsset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.kind !== 'string' || typeof r.version !== 'string') return null;
  if (!Array.isArray(r.files) || r.files.length === 0) return null;
  const files: InstalledAsset['files'] = [];
  for (const f of r.files) {
    const x = f as Record<string, unknown> | null;
    if (!x || typeof x.path !== 'string' || typeof x.url !== 'string' || typeof x.size !== 'number' || typeof x.sha256 !== 'string') return null;
    files.push({ path: x.path, url: x.url, size: x.size, sha256: x.sha256 });
  }
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const out: InstalledAsset = {
    id: r.id,
    kind: r.kind,
    version: r.version,
    title: typeof r.title === 'string' ? r.title : r.id,
    license: typeof r.license === 'string' ? r.license : '',
    size: num(r.size, files.reduce((n, f) => n + f.size, 0)),
    files,
    verified: r.verified === true,
    pinned: r.pinned === true,
    installedAt: num(r.installedAt, now),
    lastUsedAt: num(r.lastUsedAt, now),
  };
  if (r.meta && typeof r.meta === 'object') out.meta = r.meta as Record<string, unknown>;
  return out;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortedError());
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class AssetManager implements IAssetManager {
  private readonly deps: AssetManagerDeps;
  private readonly now: () => number;
  private readonly log: (message: string, detail?: unknown) => void;
  private readonly maxConcurrent: number;
  private readonly createHasher: () => { update(c: Uint8Array): void; digestHex(): string };

  private catalog = new Map<string, AssetManifest>();
  private registry = new Map<string, InstalledAsset>();
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private running = 0;
  private errors = new Map<string, ErrorRecord>();
  private listeners = new Set<() => void>();
  private snapshot: AssetListSnapshot | null = null;
  private initPromise: Promise<void> | undefined;

  private saveWaiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  private saveRunning = false;
  private usedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: AssetManagerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => undefined);
    this.maxConcurrent = Math.max(1, deps.maxConcurrent ?? 2);
    this.createHasher = deps.createHasher ?? (() => new Sha256());
  }

  // ---------------------------------------------------------------------------
  // init, catalog, snapshot
  // ---------------------------------------------------------------------------

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    let changed = false;
    let snap: AssetRegistrySnapshot | null = null;
    try {
      snap = await this.deps.registry.load();
    } catch (e) {
      this.log('asset registry load failed; starting empty', e);
    }
    if (snap) {
      if (typeof snap !== 'object' || snap.schema !== ASSET_REGISTRY_SCHEMA || !Array.isArray(snap.assets)) {
        this.log('asset registry has an unknown schema; starting empty');
      } else {
        for (const raw of snap.assets) {
          const entry = sanitizeInstalled(raw, this.now());
          if (entry && !this.registry.has(entry.id)) this.registry.set(entry.id, entry);
          else {
            changed = true;
            this.log('dropped invalid asset registry entry', raw);
          }
        }
      }
    }
    for (const entry of [...this.registry.values()]) {
      const refs = refsOfInstalled(entry);
      let missing = false;
      try {
        for (const ref of refs) {
          if (!(await this.deps.store.exists(ref))) {
            missing = true;
            break;
          }
        }
      } catch (e) {
        this.log(`could not check files of ${entry.id}; keeping the entry`, e);
        continue;
      }
      if (missing) {
        this.log(`files of ${entry.id} are gone; dropping it from the registry`);
        this.registry.delete(entry.id);
        changed = true;
        try {
          await this.deps.store.delete(refs);
        } catch (e) {
          this.log(`cleanup of ${entry.id} failed`, e);
        }
      }
    }
    if (changed) {
      try {
        await this.saveRegistry();
      } catch (e) {
        this.log('asset registry save failed', e);
      }
    }
    try {
      await this.deps.store.sweepPartials(PARTIAL_MAX_AGE_MS);
    } catch (e) {
      this.log('partial sweep failed', e);
    }
    this.emit();
  }

  setCatalog(manifests: readonly AssetManifest[]): void {
    const next = new Map<string, AssetManifest>();
    for (const m of manifests) {
      if (!m || typeof m.id !== 'string') continue;
      if (next.has(m.id)) {
        this.log(`duplicate asset id "${m.id}" in the catalog; the first one wins`);
        continue;
      }
      next.set(m.id, m);
    }
    this.catalog = next;
    this.emit();
  }

  getSnapshot(): AssetListSnapshot {
    if (!this.snapshot) this.snapshot = this.buildSnapshot();
    return this.snapshot;
  }

  private buildSnapshot(): AssetListSnapshot {
    const ids = new Set<string>([...this.catalog.keys(), ...this.registry.keys(), ...this.jobs.keys(), ...this.errors.keys()]);
    const entries: AssetEntry[] = [];
    for (const id of ids) {
      const job = this.jobs.get(id);
      const err = this.errors.get(id);
      const inst = this.registry.get(id);
      const m = job?.manifest ?? this.catalog.get(id) ?? err?.manifest;
      const base = m ?? inst;
      if (!base) continue;
      let status: AssetStatus;
      if (job) status = job.started ? 'downloading' : 'queued';
      else if (inst && m && m.version !== inst.version) status = 'update-available';
      else if (inst) status = 'installed';
      else if (err) status = 'error';
      else status = 'available';
      const entry: AssetEntry = {
        id,
        kind: base.kind,
        title: base.title,
        license: base.license,
        status,
        version: m?.version ?? (inst as InstalledAsset).version,
        size: m?.size ?? (inst as InstalledAsset).size,
        storedBytes: inst?.size ?? 0,
        pinned: inst?.pinned ?? false,
        verified: inst?.verified ?? false,
      };
      if (inst) entry.installedVersion = inst.version;
      if (job) entry.progress = job.progress;
      if (err) entry.error = { code: err.code, message: err.message };
      entries.push(entry);
    }
    entries.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { entries, storedBytes: this.storedBytes(), active: this.jobs.size };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.snapshot = null;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (e) {
        this.log('asset listener failed', e);
      }
    }
  }

  installed(id: string): InstalledAsset | undefined {
    return this.registry.get(id);
  }

  private storedBytes(): number {
    let n = 0;
    for (const a of this.registry.values()) n += a.size;
    return n;
  }

  // ---------------------------------------------------------------------------
  // install, jobs
  // ---------------------------------------------------------------------------

  async install(target: AssetManifest | string, opts: InstallOptions = {}): Promise<InstalledAsset> {
    if (this.initPromise) await this.initPromise;
    const manifest = typeof target === 'string' ? this.catalog.get(target) : target;
    if (!manifest) throw new AssetError('invalid-manifest', `Unknown asset "${String(target)}"`);
    const problem = checkManifest(manifest);
    if (problem) throw new AssetError('invalid-manifest', problem);
    if (opts.signal?.aborted) throw abortedError();

    // Everything from here to the job registration is synchronous: concurrent callers dedupe.
    const running = this.jobs.get(manifest.id);
    if (running) {
      if (running.manifest.version !== manifest.version) {
        throw new AssetError('busy', `${manifest.id} ${running.manifest.version} is being installed`);
      }
      return this.attach(running, opts);
    }
    const existing = this.registry.get(manifest.id);
    if (existing && existing.version === manifest.version) {
      if (opts.pinned && !existing.pinned) {
        const pinned = { ...existing, pinned: true };
        this.registry.set(existing.id, pinned);
        this.emit();
        await this.saveRegistry();
        return pinned;
      }
      return existing;
    }

    this.errors.delete(manifest.id);
    let finish!: () => void;
    const done = new Promise<void>((r) => {
      finish = r;
    });
    const job: Job = {
      manifest,
      controller: new AbortController(),
      subs: new Set(),
      pinned: false,
      started: false,
      phase: 'queued',
      loaded: 0,
      base: 0,
      fileIndex: 1,
      attempt: 0,
      lastEmit: Number.NEGATIVE_INFINITY,
      progress: {
        id: manifest.id,
        version: manifest.version,
        phase: 'queued',
        loaded: 0,
        total: manifest.size,
        file: 1,
        files: manifest.files.length,
        attempt: 0,
      },
      done,
      finish,
    };
    this.jobs.set(manifest.id, job);
    this.queue.push(job);
    const result = this.attach(job, opts);
    this.emit();
    this.pump();
    return result;
  }

  private attach(job: Job, opts: InstallOptions): Promise<InstalledAsset> {
    return new Promise<InstalledAsset>((resolve, reject) => {
      const sub: Sub = { resolve, reject, onProgress: opts.onProgress };
      if (opts.pinned) job.pinned = true;
      job.subs.add(sub);
      const signal = opts.signal;
      if (signal) {
        const onAbort = (): void => this.detach(job, sub);
        signal.addEventListener('abort', onAbort, { once: true });
        sub.unlisten = () => signal.removeEventListener('abort', onAbort);
      }
      this.callProgress(sub, job.progress);
    });
  }

  private callProgress(sub: Sub, p: AssetProgress): void {
    if (!sub.onProgress) return;
    try {
      sub.onProgress(p);
    } catch (e) {
      this.log('install onProgress failed', e);
    }
  }

  private detach(job: Job, sub: Sub): void {
    if (!job.subs.delete(sub)) return;
    sub.unlisten?.();
    sub.reject(abortedError());
    if (job.subs.size === 0) this.abortJob(job);
  }

  private abortJob(job: Job): void {
    if (!job.started) {
      const i = this.queue.indexOf(job);
      if (i >= 0) this.queue.splice(i, 1);
      this.finishJob(job);
    } else {
      job.controller.abort();
    }
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const subs = [...job.subs];
    job.subs.clear();
    for (const sub of subs) {
      sub.unlisten?.();
      sub.reject(abortedError());
    }
    this.abortJob(job);
  }

  private pump(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift() as Job;
      void this.runJob(job);
    }
  }

  private finishJob(job: Job): void {
    if (this.jobs.get(job.manifest.id) === job) this.jobs.delete(job.manifest.id);
    job.finish();
    this.emit();
    this.pump();
  }

  private settle(job: Job, result: InstalledAsset | AssetError): void {
    const subs = [...job.subs];
    job.subs.clear();
    for (const sub of subs) {
      sub.unlisten?.();
      if (result instanceof AssetError) sub.reject(result);
      else sub.resolve(result);
    }
  }

  private async runJob(job: Job): Promise<void> {
    this.running++;
    job.started = true;
    this.publish(job, 'downloading', true);
    try {
      await this.prepareSpace(job);
      const installed = await this.downloadAsset(job);
      this.settle(job, installed);
    } catch (e) {
      const err = toAssetError(e);
      if (err.code !== 'aborted') {
        this.errors.set(job.manifest.id, { code: err.code, message: err.message, manifest: job.manifest });
        this.log(`install of ${job.manifest.id} failed: ${err.code}`, err.message);
      }
      this.settle(job, err);
    } finally {
      this.running--;
      this.finishJob(job);
    }
  }

  /** Update and emit the job's published progress; unforced updates are throttled to 100 ms. */
  private publish(job: Job, phase: AssetJobPhase, force: boolean): void {
    const phaseChanged = phase !== job.phase;
    job.phase = phase;
    const t = this.now();
    if (!force && !phaseChanged && t - job.lastEmit < PROGRESS_THROTTLE_MS) return;
    job.lastEmit = t;
    job.progress = {
      id: job.manifest.id,
      version: job.manifest.version,
      phase,
      loaded: job.loaded,
      total: job.manifest.size,
      file: job.fileIndex,
      files: job.manifest.files.length,
      attempt: job.attempt,
    };
    this.emit();
    for (const sub of [...job.subs]) this.callProgress(sub, job.progress);
  }

  /** §4.6: make room (budget, then free space) before downloading. Throws `quota`. */
  private async prepareSpace(job: Job): Promise<void> {
    const { manifest } = job;
    const { store, budgetBytes } = this.deps;
    let held = 0;
    for (const f of manifest.files) {
      try {
        if (await store.exists(refFor(manifest, f))) held += f.size;
      } catch {
        /* unknown: count nothing */
      }
    }
    const need = Math.max(0, manifest.size - held);
    if (need === 0) return;
    if (budgetBytes !== undefined) {
      const over = this.storedBytes() + need - budgetBytes;
      if (over > 0) await this.evict(over, [manifest.id]);
    }
    if (store.freeBytes) {
      const free = await store.freeBytes();
      if (free !== null && free < need * FREE_SPACE_MARGIN) {
        await this.evict(need * FREE_SPACE_MARGIN - free, [manifest.id]);
        const after = await store.freeBytes();
        if (after !== null && after < need) {
          throw new AssetError('quota', `Not enough free space for ${manifest.id}: need ${need} bytes, ${after} free`);
        }
      }
    }
  }

  private downloadEnv(job: Job): DownloadEnv {
    return {
      transport: this.deps.transport,
      createHasher: this.createHasher,
      sleep: this.deps.sleep ?? defaultSleep,
      log: this.log,
      maxRetries: this.deps.maxRetries ?? 3,
      retryDelaysMs: this.deps.retryDelaysMs ?? [1000, 4000, 10000],
      stallTimeoutMs: this.deps.stallTimeoutMs ?? 30000,
      onQuota: async () => {
        const remaining = Math.max(1, job.manifest.size - job.loaded);
        const r = await this.evict(remaining, [job.manifest.id]);
        return r.freedBytes > 0;
      },
    };
  }

  private async downloadAsset(job: Job): Promise<InstalledAsset> {
    const { manifest } = job;
    const signal = job.controller.signal;
    const env = this.downloadEnv(job);
    const previous = this.registry.get(manifest.id);
    const files: InstalledAsset['files'] = [];
    let verified = true;
    let total = 0;

    for (let i = 0; i < manifest.files.length; i++) {
      if (signal.aborted) throw abortedError();
      const file = manifest.files[i];
      job.fileIndex = i + 1;
      job.attempt = 0;
      job.loaded = job.base;
      this.publish(job, 'downloading', true);
      const expected = await resolveExpectedSha(file, manifest, env, signal);
      const result = await downloadFile(this.deps.store, refFor(manifest, file), expected, env, {
        signal,
        onBytes: (held) => {
          job.loaded = job.base + held;
          this.publish(job, job.phase, false);
        },
        onPhase: (phase) => this.publish(job, phase, true),
        onAttempt: (n) => {
          if (n !== job.attempt) {
            job.attempt = n;
            this.publish(job, job.phase, true);
          }
        },
      });
      if (!expected) verified = false;
      files.push({ path: file.path, url: file.url, size: result.size, sha256: expected ?? '' });
      job.base += result.size;
      job.loaded = job.base;
      total += result.size;
    }
    if (signal.aborted) throw abortedError(); // committed files stay and are reused by the next install

    this.publish(job, 'committing', true);
    const t = this.now();
    const installed: InstalledAsset = {
      id: manifest.id,
      kind: manifest.kind,
      version: manifest.version,
      title: manifest.title,
      license: manifest.license,
      size: total,
      files,
      verified,
      pinned: job.pinned || (previous?.pinned ?? false),
      installedAt: t,
      lastUsedAt: t,
    };
    if (manifest.meta) installed.meta = manifest.meta;

    // The registry save is the asset's commit point.
    this.registry.set(manifest.id, installed);
    try {
      await this.saveRegistry();
    } catch (e) {
      if (previous) this.registry.set(manifest.id, previous);
      else this.registry.delete(manifest.id);
      throw new AssetError('storage', `Could not save the asset registry: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Upgrade: only now delete old-version files whose key (url) no new file shares.
    if (previous) {
      const keep = new Set(files.map((f) => f.url));
      const stale = refsOfInstalled(previous).filter((r) => !keep.has(r.url));
      if (stale.length) {
        try {
          await this.deps.store.delete(stale);
        } catch (e) {
          this.log(`could not delete old files of ${manifest.id} ${previous.version}`, e);
        }
      }
    }
    return installed;
  }

  // ---------------------------------------------------------------------------
  // registry persistence
  // ---------------------------------------------------------------------------

  /** Serialised: one save in flight; callers that arrive meanwhile share the next save (newest state). */
  private saveRegistry(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.saveWaiters.push({ resolve, reject });
      if (!this.saveRunning) void this.drainSaves();
    });
  }

  private async drainSaves(): Promise<void> {
    this.saveRunning = true;
    try {
      while (this.saveWaiters.length > 0) {
        const batch = this.saveWaiters.splice(0);
        const snapshot: AssetRegistrySnapshot = {
          schema: ASSET_REGISTRY_SCHEMA,
          assets: [...this.registry.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        };
        try {
          await this.deps.registry.save(snapshot);
          for (const w of batch) w.resolve();
        } catch (e) {
          for (const w of batch) w.reject(e);
        }
      }
    } finally {
      this.saveRunning = false;
    }
  }

  markUsed(id: string): void {
    const a = this.registry.get(id);
    if (!a) return;
    this.registry.set(id, { ...a, lastUsedAt: this.now() });
    if (this.usedTimer === undefined) {
      this.usedTimer = setTimeout(() => {
        this.usedTimer = undefined;
        this.saveRegistry().catch((e) => this.log('asset registry save failed', e));
      }, USED_SAVE_DELAY_MS);
    }
  }

  /** Save now if a debounced `markUsed` save is pending (call before the process exits). */
  async flush(): Promise<void> {
    if (this.usedTimer === undefined) return;
    clearTimeout(this.usedTimer);
    this.usedTimer = undefined;
    await this.saveRegistry();
  }

  // ---------------------------------------------------------------------------
  // adopt, remove, read, evict, diff
  // ---------------------------------------------------------------------------

  async adopt(manifest: AssetManifest): Promise<boolean> {
    if (this.initPromise) await this.initPromise;
    const problem = checkManifest(manifest);
    if (problem) throw new AssetError('invalid-manifest', problem);
    const existing = this.registry.get(manifest.id);
    if (existing && existing.version === manifest.version) return true;
    if (this.jobs.has(manifest.id)) return false;

    const { store } = this.deps;
    const files: InstalledAsset['files'] = [];
    let verified = true;
    let total = 0;
    for (const file of manifest.files) {
      const ref = refFor(manifest, file);
      const src = await store.exists(ref) ? await store.read(ref) : null;
      if (!src) return false;
      const expected = file.sha256?.toLowerCase();
      if (!expected && !manifest.allowUnverified) return false;
      const hasher = this.createHasher();
      let size = 0;
      for await (const chunk of src) {
        hasher.update(chunk);
        size += chunk.length;
      }
      const sha = hasher.digestHex();
      if ((expected && sha !== expected) || (file.size > 0 && size !== file.size)) {
        await store.delete([ref]);
        return false;
      }
      if (!expected) verified = false;
      files.push({ path: file.path, url: file.url, size, sha256: expected ?? '' });
      total += size;
    }
    const t = this.now();
    const installed: InstalledAsset = {
      id: manifest.id,
      kind: manifest.kind,
      version: manifest.version,
      title: manifest.title,
      license: manifest.license,
      size: total,
      files,
      verified,
      pinned: true,
      installedAt: t,
      lastUsedAt: t,
    };
    if (manifest.meta) installed.meta = manifest.meta;
    this.registry.set(manifest.id, installed);
    this.errors.delete(manifest.id);
    try {
      await this.saveRegistry();
    } catch (e) {
      this.registry.delete(manifest.id);
      throw new AssetError('storage', `Could not save the asset registry: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.emit();
    return true;
  }

  async remove(id: string): Promise<void> {
    if (this.initPromise) await this.initPromise;
    const job = this.jobs.get(id);
    const refs: AssetFileRef[] = [];
    if (job) {
      refs.push(...job.manifest.files.map((f) => refFor(job.manifest, f)));
      this.cancel(id);
      await job.done;
    }
    const inst = this.registry.get(id);
    const cat = this.catalog.get(id);
    if (inst) refs.push(...refsOfInstalled(inst));
    if (cat) refs.push(...cat.files.map((f) => refFor(cat, f)));
    const err = this.errors.get(id);
    if (err) refs.push(...err.manifest.files.map((f) => refFor(err.manifest, f)));
    this.errors.delete(id);
    if (inst) {
      this.registry.delete(id);
      try {
        await this.saveRegistry();
      } catch (e) {
        this.registry.set(id, inst);
        this.emit();
        throw new AssetError('storage', `Could not save the asset registry: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      await this.deps.store.delete(refs);
    } catch (e) {
      this.emit();
      throw toAssetError(e);
    }
    this.emit();
  }

  async readFile(id: string, path: string): Promise<Uint8Array> {
    if (this.initPromise) await this.initPromise;
    const inst = this.registry.get(id);
    const file = inst?.files.find((f) => f.path === path);
    if (!inst || !file) throw new AssetError('not-found', `${id}/${path} is not installed`);
    const src = await this.deps.store.read(refFor(inst, file));
    if (!src) throw new AssetError('not-found', `${id}/${path} is missing from the store`);
    const chunks: Uint8Array[] = [];
    let n = 0;
    for await (const c of src) {
      chunks.push(c);
      n += c.length;
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    this.markUsed(id);
    return out;
  }

  async evict(needBytes: number, protect: readonly string[] = []): Promise<EvictionResult> {
    if (this.initPromise) await this.initPromise;
    const result: EvictionResult = { removed: [], freedBytes: 0 };
    if (!(needBytes > 0)) return result;
    const candidates = [...this.registry.values()]
      .filter((a) => !a.pinned && !protect.includes(a.id) && !this.jobs.has(a.id))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt || b.size - a.size || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const a of candidates) {
      if (result.freedBytes >= needBytes) break;
      if (this.registry.get(a.id) !== a || this.jobs.has(a.id)) continue; // changed while we awaited
      this.registry.delete(a.id);
      this.emit();
      try {
        await this.saveRegistry();
        await this.deps.store.delete(refsOfInstalled(a));
      } catch (e) {
        this.log(`eviction of ${a.id} failed`, e);
      }
      result.removed.push(a.id);
      result.freedBytes += a.size;
    }
    return result;
  }

  diffForUpdate(): AssetUpdate[] {
    const out: AssetUpdate[] = [];
    for (const a of this.registry.values()) {
      const m = this.catalog.get(a.id);
      if (m && m.version !== a.version) out.push({ id: a.id, from: a.version, to: m.version, size: m.size });
    }
    return out.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }
}
