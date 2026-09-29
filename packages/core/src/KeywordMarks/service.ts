/**
 * Keyword-set service: built-in sets plus a pluggable store. Framework-free;
 * apps subscribe to `change` and keep the snapshot in their own store.
 */
import { BUILT_IN_KEYWORD_SETS } from './builtins';
import { exportKeywordSet, importKeywordSet, isValidationErrors, validateKeywordSet } from './validate';
import type { KeywordMark, KeywordSet, MarkColorKey, KeywordValidationError } from './types';
import { MARK_COLOR_KEYS } from './types';

export interface IKeywordSetStore {
  list(): Promise<KeywordSet[]>;
  put(set: KeywordSet): Promise<void>;
  remove(id: string): Promise<void>;
}

/** In-memory store, for tests and as a fallback. */
export class MemoryKeywordSetStore implements IKeywordSetStore {
  private readonly items = new Map<string, KeywordSet>();
  async list(): Promise<KeywordSet[]> { return [...this.items.values()].map((s) => structuredClone(s)); }
  async put(set: KeywordSet): Promise<void> { this.items.set(set.id, structuredClone(set)); }
  async remove(id: string): Promise<void> { this.items.delete(id); }
}

/** Minimal Storage shape (localStorage), so this file needs no DOM lib. */
export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Stores every set as one JSON array under one key (web until the web user DB exists). */
export class StorageKeywordSetStore implements IKeywordSetStore {
  constructor(private readonly storage: StringStorage, private readonly key = 'kth.keywordSets') {}
  private read(): KeywordSet[] {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(validateKeywordSet).filter((s): s is KeywordSet => !isValidationErrors(s));
    } catch { return []; }
  }
  private write(sets: KeywordSet[]): void {
    try { this.storage.setItem(this.key, JSON.stringify(sets)); } catch { /* quota or private mode */ }
  }
  async list(): Promise<KeywordSet[]> { return this.read(); }
  async put(set: KeywordSet): Promise<void> {
    const sets = this.read().filter((s) => s.id !== set.id);
    sets.push(set);
    this.write(sets);
  }
  async remove(id: string): Promise<void> { this.write(this.read().filter((s) => s.id !== id)); }
}

let idCounter = 0;
export function newKeywordId(prefix = 'k'): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
  idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The lowest-numbered colour slot not used by any mark in the sets (cycles when all are used). */
export function nextFreeColor(sets: KeywordSet[]): MarkColorKey {
  const used = new Map<MarkColorKey, number>();
  for (const s of sets) for (const m of s.marks) used.set(m.style.color, (used.get(m.style.color) ?? 0) + 1);
  return [...MARK_COLOR_KEYS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
}

export type KeywordSetsListener = (sets: KeywordSet[]) => void;

export class KeywordSetService {
  private user: KeywordSet[] = [];
  private loaded = false;
  private readonly listeners = new Set<KeywordSetsListener>();

  constructor(private readonly store: IKeywordSetStore, private readonly builtIns: readonly KeywordSet[] = BUILT_IN_KEYWORD_SETS) {}

  async load(): Promise<KeywordSet[]> {
    this.user = (await this.store.list()).filter((s) => !s.builtIn);
    this.loaded = true;
    this.emit();
    return this.all();
  }

  /** Built-ins first, then the user's sets by name. */
  all(): KeywordSet[] {
    return [...this.builtIns, ...[...this.user].sort((a, b) => a.name.localeCompare(b.name))];
  }

  get(id: string): KeywordSet | undefined { return this.all().find((s) => s.id === id); }

  subscribe(fn: KeywordSetsListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void { const snap = this.all(); for (const l of this.listeners) l(snap); }

  private async ensureLoaded(): Promise<void> { if (!this.loaded) await this.load(); }

  async create(name: string, opts: { language?: string; marks?: KeywordMark[] } = {}): Promise<KeywordSet> {
    const set: KeywordSet = {
      schema: 1, id: newKeywordId('set'), name: name.trim() || 'Keywords',
      ...(opts.language ? { language: opts.language } : {}),
      scope: { kind: 'everywhere' }, marks: opts.marks ?? [], updatedAt: new Date().toISOString(),
    };
    return this.save(set);
  }

  /** Save (create or replace) a user set. Built-in sets are read-only. */
  async save(set: KeywordSet): Promise<KeywordSet> {
    await this.ensureLoaded();
    if (set.builtIn || this.builtIns.some((b) => b.id === set.id)) throw new Error('Built-in sets are read-only; duplicate it to edit.');
    const valid = validateKeywordSet(set);
    if (isValidationErrors(valid)) throw new Error(`Invalid keyword set: ${valid.map((e) => `${e.path} ${e.message}`).join('; ')}`);
    const saved: KeywordSet = { ...valid, updatedAt: new Date().toISOString() };
    await this.store.put(saved);
    this.user = [...this.user.filter((s) => s.id !== saved.id), saved];
    this.emit();
    return saved;
  }

  async duplicate(id: string, name?: string): Promise<KeywordSet> {
    await this.ensureLoaded();
    const src = this.get(id);
    if (!src) throw new Error(`No such keyword set: ${id}`);
    const copy: KeywordSet = structuredClone(src);
    delete copy.builtIn;
    copy.id = newKeywordId('set');
    copy.name = name ?? `${src.name} (copy)`;
    return this.save(copy);
  }

  async remove(id: string): Promise<void> {
    await this.ensureLoaded();
    if (this.builtIns.some((b) => b.id === id)) throw new Error('Built-in sets cannot be deleted.');
    await this.store.remove(id);
    this.user = this.user.filter((s) => s.id !== id);
    this.emit();
  }

  /** Add one mark to a user set (appending) and save. */
  async addMark(setId: string, mark: KeywordMark): Promise<KeywordSet> {
    await this.ensureLoaded();
    const set = this.user.find((s) => s.id === setId);
    if (!set) throw new Error(`No editable keyword set: ${setId}`);
    return this.save({ ...set, marks: [...set.marks, mark] });
  }

  export(id: string): string {
    const set = this.get(id);
    if (!set) throw new Error(`No such keyword set: ${id}`);
    return exportKeywordSet(set);
  }

  /** Import a JSON file as a new set (fresh id, so it never overwrites). */
  async import(text: string): Promise<KeywordSet | KeywordValidationError[]> {
    const parsed = importKeywordSet(text);
    if (isValidationErrors(parsed)) return parsed;
    return this.save({ ...parsed, id: newKeywordId('set') });
  }
}
