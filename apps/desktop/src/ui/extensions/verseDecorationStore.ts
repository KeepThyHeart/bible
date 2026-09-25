/**
 * Renderer store for extension verse decoration DATA (task 0036, P0.1a;
 * design doc §14.2).
 *
 * Deliberately separate from `extensionUiStore`: that store is a small
 * record of "what got registered", touched a handful of times per session.
 * This one churns on every chapter turn and holds the hot read path, so
 * mixing them would notify every `extensionUiStore` subscriber (toasts,
 * modals, panels...) whenever a chapter's decorations arrive.
 *
 * Surface-agnostic - nothing here knows what a Bible pane is. The contract
 * for any surface: call `ensureRange` for whatever passage it displays, then
 * `getDecorationsForVerse` per verse, and feed the result plus its own
 * rendered word sequence to `resolveVerseDecorations` (`decorationResolver.ts`).
 */

import { create } from 'zustand';
import type { Extensions } from '@bible/core';
import { VerseIdHelper } from '@bible/core';
import { invokeUiBridge } from './extensionRendererBridge';
import type { LayerDecorations } from './decorationResolver';

type DecorationDto = Extensions.DecorationDto;
type DecorationFetchStatus = Extensions.DecorationFetchStatus;
type DecorationFetchRequest = Extensions.DecorationFetchRequest;
type DecorationFetchResponse = Extensions.DecorationFetchResponse;

type ChunkKey = `${number}:${number}-${number}`; // moduleId:startVerseId-endVerseId

interface ChunkEntry {
  decorations: DecorationDto[];
  revision: number;
  fetchedAt: number;
  status: DecorationFetchStatus;
}

type Surface = 'standard' | 'study' | 'reading';
const DEFAULT_SURFACES: Surface[] = ['standard', 'study'];

interface LayerMeta {
  extensionId: string;
  decoratorId: string;
  layerSeq: number;
  revision: number;
  enabled: boolean;
  /** `VerseDecoratorDescriptor.surfaces` - default `['standard', 'study']` (amendment A4). */
  surfaces: Surface[];
}

interface PushGroupEntry {
  extensionId: string;
  groupId: string;
  decorations: DecorationDto[];
  updatedAt: number;
}

const EMPTY_LAYERS: LayerDecorations[] = [];
const MAX_CHUNKS_PER_LAYER = 64;

function chunkKey(moduleId: number, startVerseId: number, endVerseId: number): ChunkKey {
  return `${moduleId}:${startVerseId}-${endVerseId}`;
}

function chapterRangeFor(verseId: number): { startVerseId: number; endVerseId: number; chapterId: string } {
  const { bookNumber, chapter } = VerseIdHelper.parse(verseId);
  const range = VerseIdHelper.getChapterRange(bookNumber, chapter);
  return {
    startVerseId: range.startVerseId,
    endVerseId: range.endVerseId ?? range.startVerseId,
    chapterId: `${bookNumber}.${chapter}`,
  };
}

let nextLayerSeq = 1;

interface VerseDecorationState {
  layers: Map<string, LayerMeta>;
  chunks: Map<string, ChunkEntry>; // `${chunkKey}|${layerKey}`
  pushGroups: Map<string, PushGroupEntry>; // `${extensionId}::group:${groupId}`
  inflight: Map<string, Promise<void>>; // `${chunkKey}` (all enabled layers fetched together)
  /**
   * `chapterId` (`${bookNumber}.${chapter}`, module-agnostic) -> version,
   * bumped whenever a chunk or push group touching that chapter changes.
   * Not keyed by module: push groups have no module of their own (a pushed
   * decoration applies to whichever module renders that verse id), so a
   * single per-chapter counter is what keeps a push touching John 3:16 from
   * bumping Psalm 119's version regardless of which module either is read
   * in - the design doc's own test scenario (§16).
   */
  chapterVersion: Map<string, number>;

  registerLayer(extensionId: string, decoratorId: string, surfaces?: Surface[]): void;
  unregisterLayer(extensionId: string, decoratorId: string): void;
  setLayerEnabled(extensionId: string, decoratorId: string, enabled: boolean): void;
  /** Ensure a passage's decorations are fetched. Idempotent, deduped, cheap to call in an effect. */
  ensureRange(req: { moduleId: number; moduleAbbrev: string; startVerseId: number; endVerseId: number }): void;
  applyPush(extensionId: string, groupId: string, decorations: DecorationDto[]): void;
  invalidate(layerKeys: string[], passage?: { startVerseId: number; endVerseId: number }): void;
  /** Everything targeting this verse, across enabled layers. Stable reference while unchanged (design doc §14.2). */
  getDecorationsForVerse(verseId: number, moduleId: number): LayerDecorations[];
}

// Not store state - a plain per-verse memo captured in the store creator's
// closure, so `getDecorationsForVerse` can return the SAME array reference
// across unrelated `set()` calls (design doc §14.2's stable-reference
// requirement). Keyed by chapter granularity in P0.1a: chunks and push
// groups are whole-chapter, so a change is always chapter-scoped.
const verseMemo = new Map<string, { version: number; result: LayerDecorations[] }>();

function bumpChapterVersions(
  state: Pick<VerseDecorationState, 'chapterVersion'>,
  chapterIds: Iterable<string>,
): Map<string, number> {
  const next = new Map(state.chapterVersion);
  for (const chapterId of chapterIds) {
    next.set(chapterId, (next.get(chapterId) ?? 0) + 1);
  }
  return next;
}

/** Every chapter id a decoration's target(s) touch (verse/passage only in P0.1a). */
function chapterIdsForDecorations(decorations: DecorationDto[]): Set<string> {
  const ids = new Set<string>();
  for (const d of decorations) {
    const targets = Array.isArray(d.target) ? d.target : [d.target];
    for (const t of targets) {
      if (t.kind === 'verse') ids.add(chapterRangeFor(t.verseId).chapterId);
      else if (t.kind === 'passage') {
        ids.add(chapterRangeFor(t.startVerseId).chapterId);
        ids.add(chapterRangeFor(t.endVerseId).chapterId);
      } else if (t.kind === 'tokens') ids.add(chapterRangeFor(t.verseId).chapterId);
      // 'word' targets carry a scope that is itself a verse/passage - same shape.
      else if ('scope' in t) {
        const scope = t.scope;
        if ('verseId' in scope) ids.add(chapterRangeFor(scope.verseId).chapterId);
        else {
          ids.add(chapterRangeFor(scope.startVerseId).chapterId);
          ids.add(chapterRangeFor(scope.endVerseId).chapterId);
        }
      }
    }
  }
  return ids;
}

export const useVerseDecorationStore = create<VerseDecorationState>((set, get) => ({
  layers: new Map(),
  chunks: new Map(),
  pushGroups: new Map(),
  inflight: new Map(),
  chapterVersion: new Map(),

  registerLayer(extensionId, decoratorId, surfaces) {
    const key = `${extensionId}::${decoratorId}`;
    set((s) => {
      const layers = new Map(s.layers);
      layers.set(key, {
        extensionId,
        decoratorId,
        layerSeq: nextLayerSeq++,
        revision: 1,
        enabled: true,
        surfaces: surfaces && surfaces.length > 0 ? surfaces : DEFAULT_SURFACES,
      });
      return { layers };
    });
  },

  unregisterLayer(extensionId, decoratorId) {
    const key = `${extensionId}::${decoratorId}`;
    set((s) => {
      if (!s.layers.has(key)) return s;
      const layers = new Map(s.layers);
      layers.delete(key);
      const chunks = new Map(s.chunks);
      for (const k of [...chunks.keys()]) {
        if (k.endsWith(`|${key}`)) chunks.delete(k);
      }
      return { layers, chunks };
    });
  },

  setLayerEnabled(extensionId, decoratorId, enabled) {
    const key = `${extensionId}::${decoratorId}`;
    set((s) => {
      const layer = s.layers.get(key);
      if (!layer || layer.enabled === enabled) return s;
      const layers = new Map(s.layers);
      layers.set(key, { ...layer, enabled });
      return { layers };
    });
    void invokeUiBridge('setVerseDecorationsEnabled', [extensionId, enabled]).catch(() => undefined);
  },

  ensureRange(req) {
    const { moduleId, moduleAbbrev, startVerseId, endVerseId } = req;
    const ck = chunkKey(moduleId, startVerseId, endVerseId);
    const state = get();
    if (state.inflight.has(ck)) return;
    const enabledLayers = [...state.layers.entries()].filter(([, l]) => l.enabled);
    if (enabledLayers.length === 0) return;
    // Skip layers whose chunk is already fresh at the current revision.
    const stale = enabledLayers.filter(([key, l]) => {
      const entry = state.chunks.get(`${ck}|${key}`);
      return !entry || entry.revision !== l.revision;
    });
    if (stale.length === 0) return;

    const revisions: Record<string, number> = {};
    for (const [key, l] of enabledLayers) revisions[key] = l.revision;
    const fetchReq: DecorationFetchRequest = {
      startVerseId,
      endVerseId,
      moduleId,
      moduleAbbrev,
      layerKeys: stale.map(([key]) => key),
      revisions,
    };

    const promise = invokeUiBridge<DecorationFetchResponse>('fetchVerseDecorations', [fetchReq])
      .then((response) => {
        applyFetchResponse(set, get, ck, response);
      })
      .catch(() => undefined)
      .finally(() => {
        set((s) => {
          const inflight = new Map(s.inflight);
          inflight.delete(ck);
          return { inflight };
        });
      });

    set((s) => {
      const inflight = new Map(s.inflight);
      inflight.set(ck, promise);
      return { inflight };
    });
  },

  applyPush(extensionId, groupId, decorations) {
    const key = `${extensionId}::group:${groupId}`;
    set((s) => {
      const pushGroups = new Map(s.pushGroups);
      const touchedChapters = new Set<string>();
      const previous = pushGroups.get(key);
      if (previous) for (const id of chapterIdsForDecorations(previous.decorations)) touchedChapters.add(id);
      if (decorations.length === 0) {
        pushGroups.delete(key);
      } else {
        pushGroups.set(key, { extensionId, groupId, decorations, updatedAt: Date.now() });
        for (const id of chapterIdsForDecorations(decorations)) touchedChapters.add(id);
      }
      return { pushGroups, chapterVersion: bumpChapterVersions(s, touchedChapters) };
    });
  },

  invalidate(layerKeys, passage) {
    set((s) => {
      const layers = new Map(s.layers);
      const chunks = new Map(s.chunks);
      const touchedChapters = new Set<string>();
      for (const key of layerKeys) {
        const layer = layers.get(key);
        if (layer) layers.set(key, { ...layer, revision: layer.revision + 1 });
        for (const [ck, entry] of chunks) {
          if (!ck.endsWith(`|${key}`)) continue;
          chunks.delete(ck);
          for (const d of entry.decorations) for (const id of chapterIdsForDecorations([d])) touchedChapters.add(id);
        }
      }
      void passage; // P0.1a invalidates whole layers; passage-scoped invalidation is additive later.
      return { layers, chunks, chapterVersion: bumpChapterVersions(s, touchedChapters) };
    });
  },

  getDecorationsForVerse(verseId, moduleId) {
    const state = get();
    const { chapterId } = chapterRangeFor(verseId);
    const version = state.chapterVersion.get(chapterId) ?? 0;
    const memoKey = `${moduleId}:${verseId}`;
    const cached = verseMemo.get(memoKey);
    if (cached && cached.version === version) return cached.result;

    const range = chapterRangeFor(verseId);
    const ck = chunkKey(moduleId, range.startVerseId, range.endVerseId);
    const result: LayerDecorations[] = [];
    for (const [layerKey, layer] of state.layers) {
      if (!layer.enabled) continue;
      const entry = state.chunks.get(`${ck}|${layerKey}`);
      if (!entry || entry.decorations.length === 0) continue;
      result.push({
        layerKey,
        extensionId: layer.extensionId,
        layerSeq: layer.layerSeq,
        surfaces: layer.surfaces,
        decorations: entry.decorations,
      });
    }
    for (const [, group] of state.pushGroups) {
      const decorations = group.decorations.filter((d) =>
        (Array.isArray(d.target) ? d.target : [d.target]).some((t) => targetInChapter(t, moduleId, verseId)),
      );
      if (decorations.length === 0) continue;
      result.push({
        layerKey: `${group.extensionId}::group:${group.groupId}`,
        extensionId: group.extensionId,
        layerSeq: -1, // pushed groups render after that extension's pull layers (design doc §5.2)
        // Pushed decorations have no descriptor to carry `surfaces` on - they
        // always render on the same default surfaces a decorator without an
        // explicit `surfaces` list would (amendment A4).
        surfaces: DEFAULT_SURFACES,
        decorations,
      });
    }
    const final = result.length === 0 ? EMPTY_LAYERS : result;
    verseMemo.set(memoKey, { version, result: final });
    return final;
  },
}));

function targetInChapter(target: Extensions.DecorationTarget, _moduleId: number, verseId: number): boolean {
  switch (target.kind) {
    case 'verse':
      return target.verseId === verseId;
    case 'passage':
      return verseId >= target.startVerseId && verseId <= target.endVerseId;
    case 'tokens':
      return target.verseId === verseId;
    case 'word':
      return 'verseId' in target.scope
        ? target.scope.verseId === verseId
        : verseId >= target.scope.startVerseId && verseId <= target.scope.endVerseId;
    default:
      return false;
  }
}

function applyFetchResponse(
  set: (fn: (s: VerseDecorationState) => Partial<VerseDecorationState>) => void,
  get: () => VerseDecorationState,
  ck: string,
  response: DecorationFetchResponse,
): void {
  set((s) => {
    const chunks = new Map(s.chunks);
    const touchedChapters = new Set<string>();
    for (const result of response.results) {
      const layer = s.layers.get(result.layerKey);
      // Stale response (layer disposed, or its revision moved on since the
      // request went out) - drop it (design doc §8).
      if (!layer || layer.revision !== result.revision) continue;
      chunks.set(`${ck}|${result.layerKey}`, {
        decorations: result.decorations,
        revision: result.revision,
        fetchedAt: Date.now(),
        status: result.status,
      });
      for (const id of chapterIdsForDecorations(result.decorations)) touchedChapters.add(id);
    }
    evictOldestChunksIfNeeded(chunks);
    return { chunks, chapterVersion: bumpChapterVersions(s, touchedChapters) };
  });
  void get; // reserved for future targeted re-fetch logic
}

/** LRU cap of 64 chunks per layer (design doc §7). */
function evictOldestChunksIfNeeded(chunks: Map<string, ChunkEntry>): void {
  const byLayer = new Map<string, string[]>();
  for (const key of chunks.keys()) {
    const layerKey = key.slice(key.indexOf('|') + 1);
    const list = byLayer.get(layerKey) ?? [];
    list.push(key);
    byLayer.set(layerKey, list);
  }
  for (const [, keys] of byLayer) {
    if (keys.length <= MAX_CHUNKS_PER_LAYER) continue;
    const sorted = keys.sort((a, b) => (chunks.get(a)?.fetchedAt ?? 0) - (chunks.get(b)?.fetchedAt ?? 0));
    for (let i = 0; i < sorted.length - MAX_CHUNKS_PER_LAYER; i++) chunks.delete(sorted[i]);
  }
}

/** Test-only reset, mirroring `verseFetchCache.ts`'s `__clearVerseFetchCache`. */
export function __resetVerseDecorationStore(): void {
  verseMemo.clear();
  useVerseDecorationStore.setState({
    layers: new Map(),
    chunks: new Map(),
    pushGroups: new Map(),
    inflight: new Map(),
    chapterVersion: new Map(),
  });
}
