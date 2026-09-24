/**
 * Main-process orchestrator for verse decorators and hovers (task 0036,
 * P0.1a; design doc §5).
 *
 * Owns the authoritative table of registered decorator/hover layers and
 * pushed decoration groups, fans out `decorateEndpoint` calls in parallel on
 * a renderer-triggered chapter fetch, enforces per-layer failure backoff and
 * response size caps, and mirrors every layer into `ContributionRegistry`
 * (so the already-existing `listVerseDecorators()`/`listVerseHoverProviders()`
 * finally have something to return).
 *
 * `RendererUiBridge` owns one instance of this class and delegates its T2
 * verse-decoration/hover methods to it (`IExtensionUiBridge`). This class
 * does not implement that interface itself - it is the layer registry and
 * fetch orchestrator underneath it, kept in its own file because it is
 * substantial and independently testable with a fake `BridgeRpc`/router.
 *
 * Renderer-facing notifications (`ext-bridge:ui`, fire-and-forget, via the
 * `rpc` passed in) and the renderer -> main fetch call
 * (`ext-bridge:ui:invoke`, op `fetchVerseDecorations`) are both wired here.
 */

import type { Extensions } from '@bible/core';
import { validateDecorationDto } from './api-impl/uiApiImpl';
import type { ContributionRegistry } from './ContributionRegistry';

type VerseDecoratorDescriptor = Extensions.VerseDecoratorDescriptor;
type VerseHoverProviderDescriptor = Extensions.VerseHoverProviderDescriptor;
type DecorationDto = Extensions.DecorationDto;
type DecorationRequestDto = Extensions.DecorationRequestDto;
type DecorationFetchRequest = Extensions.DecorationFetchRequest;
type DecorationFetchResponse = Extensions.DecorationFetchResponse;
type DecorationFetchResult = Extensions.DecorationFetchResult;

// Design doc §9.
const MAX_LAYERS_GLOBAL = 32;
const MAX_DECORATIONS_PER_CHUNK = 2_000;
const MAX_PUSH_DECORATIONS_PER_EXTENSION = 5_000;
const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 300_000];
const DEGRADED_AFTER_CONSECUTIVE_FAILURES = 5;

interface DecoratorLayer {
  kind: 'decorator';
  extensionId: string;
  descriptor: VerseDecoratorDescriptor;
  fetch: (request: DecorationRequestDto) => Promise<unknown>;
  layerSeq: number;
  revision: number;
  enabled: boolean;
  failure: { consecutive: number; backoffUntil: number; lastError?: string };
}

interface HoverLayer {
  kind: 'hover';
  extensionId: string;
  descriptor: VerseHoverProviderDescriptor;
  fetch: (request: Extensions.VerseHoverRequestDto) => Promise<unknown>;
  layerSeq: number;
}

interface PushGroup {
  extensionId: string;
  groupId: string;
  decorations: DecorationDto[];
  updatedAt: number;
}

/** Notifier the service pushes renderer-facing events through. Satisfied by `BridgeRpc`. */
export interface VerseDecorationNotifier {
  notify(op: string, args: unknown[]): void;
}

export class VerseDecorationService {
  private readonly notifier: VerseDecorationNotifier;
  private readonly contributionRegistry: ContributionRegistry | undefined;
  private readonly decorators = new Map<string, DecoratorLayer>();
  private readonly hoverProviders = new Map<string, HoverLayer>();
  private readonly pushGroups = new Map<string, PushGroup>();
  private nextLayerSeq = 1;

  constructor(notifier: VerseDecorationNotifier, contributionRegistry?: ContributionRegistry) {
    this.notifier = notifier;
    this.contributionRegistry = contributionRegistry;
  }

  // --- Registration (delegated from RendererUiBridge) ---------------------

  registerDecorator(
    extensionId: string,
    descriptor: VerseDecoratorDescriptor,
    fetch: (request: DecorationRequestDto) => Promise<unknown>,
  ): () => void {
    if (this.decorators.size + this.hoverProviders.size >= MAX_LAYERS_GLOBAL) {
      throw new Error('VerseDecorationService: global layer cap reached');
    }
    const key = `${extensionId}::${descriptor.id}`;
    const layer: DecoratorLayer = {
      kind: 'decorator',
      extensionId,
      descriptor,
      fetch,
      layerSeq: this.nextLayerSeq++,
      revision: 1,
      enabled: true,
      failure: { consecutive: 0, backoffUntil: 0 },
    };
    this.decorators.set(key, layer);
    const registryDispose = this.contributionRegistry
      ? this.contributionRegistry.register(extensionId, 'verseDecorator', descriptor.id, descriptor)
      : (): void => {};
    this.notifier.notify('verseDecoratorRegistered', [{ extensionId, descriptor }]);
    return () => {
      if (this.decorators.delete(key)) {
        registryDispose();
        this.notifier.notify('verseDecoratorUnregistered', [{ extensionId, decoratorId: descriptor.id }]);
      }
    };
  }

  registerHoverProvider(
    extensionId: string,
    descriptor: VerseHoverProviderDescriptor,
    fetch: (request: Extensions.VerseHoverRequestDto) => Promise<unknown>,
  ): () => void {
    if (this.decorators.size + this.hoverProviders.size >= MAX_LAYERS_GLOBAL) {
      throw new Error('VerseDecorationService: global layer cap reached');
    }
    const key = `${extensionId}::${descriptor.id}`;
    const layer: HoverLayer = {
      kind: 'hover',
      extensionId,
      descriptor,
      fetch,
      layerSeq: this.nextLayerSeq++,
    };
    this.hoverProviders.set(key, layer);
    const registryDispose = this.contributionRegistry
      ? this.contributionRegistry.register(extensionId, 'verseHover', descriptor.id, descriptor)
      : (): void => {};
    this.notifier.notify('verseHoverRegistered', [{ extensionId, descriptor }]);
    return () => {
      if (this.hoverProviders.delete(key)) {
        registryDispose();
        this.notifier.notify('verseHoverUnregistered', [{ extensionId, hoverId: descriptor.id }]);
      }
    };
  }

  async updatePush(extensionId: string, groupId: string, decorations: DecorationDto[]): Promise<void> {
    const key = `${extensionId}::group:${groupId}`;
    if (decorations.length === 0) {
      this.pushGroups.delete(key);
    } else {
      this.pushGroups.set(key, { extensionId, groupId, decorations, updatedAt: Date.now() });
      this.enforcePushCap(extensionId);
    }
    this.notifier.notify('verseDecorationsUpdated', [{ extensionId, groupId, decorations }]);
  }

  async invalidate(
    extensionId: string,
    opts?: { decoratorId?: string; startVerseId?: number; endVerseId?: number },
  ): Promise<void> {
    const affected: string[] = [];
    for (const [key, layer] of this.decorators) {
      if (layer.extensionId !== extensionId) continue;
      if (opts?.decoratorId && layer.descriptor.id !== opts.decoratorId) continue;
      layer.revision++;
      layer.failure.consecutive = 0;
      layer.failure.backoffUntil = 0;
      affected.push(key);
    }
    if (affected.length > 0) {
      this.notifier.notify('verseDecorationsInvalidated', [
        {
          extensionId,
          layerKeys: affected,
          ...(opts?.startVerseId !== undefined ? { startVerseId: opts.startVerseId } : {}),
          ...(opts?.endVerseId !== undefined ? { endVerseId: opts.endVerseId } : {}),
        },
      ]);
    }
  }

  /** Called by the runtime-permission-revocation / deactivation / uninstall path. */
  disposeByOwner(extensionId: string): void {
    for (const [key, layer] of [...this.decorators]) {
      if (layer.extensionId === extensionId) {
        this.decorators.delete(key);
        this.notifier.notify('verseDecoratorUnregistered', [
          { extensionId, decoratorId: layer.descriptor.id },
        ]);
      }
    }
    for (const [key, layer] of [...this.hoverProviders]) {
      if (layer.extensionId === extensionId) {
        this.hoverProviders.delete(key);
        this.notifier.notify('verseHoverUnregistered', [{ extensionId, hoverId: layer.descriptor.id }]);
      }
    }
    for (const key of [...this.pushGroups.keys()]) {
      if (this.pushGroups.get(key)?.extensionId === extensionId) this.pushGroups.delete(key);
    }
    this.contributionRegistry?.removeAllByExtension(extensionId);
  }

  /** The per-extension "show verse decorations" toggle (design doc §13). */
  setExtensionEnabled(extensionId: string, enabled: boolean): void {
    for (const layer of this.decorators.values()) {
      if (layer.extensionId === extensionId) layer.enabled = enabled;
    }
  }

  // --- Fetch fan-out (renderer -> main, `ext-bridge:ui:invoke`) -----------

  async fetch(req: DecorationFetchRequest): Promise<DecorationFetchResponse> {
    const now = Date.now();
    const wanted = req.layerKeys ? new Set(req.layerKeys) : null;
    const targets = [...this.decorators.entries()].filter(([key, layer]) => {
      if (wanted && !wanted.has(key)) return false;
      return layer.enabled;
    });

    const results = await Promise.allSettled(
      targets.map(async ([key, layer]): Promise<DecorationFetchResult> => {
        if (now < layer.failure.backoffUntil) {
          return { layerKey: key, revision: layer.revision, status: 'skipped', decorations: [] };
        }
        const request: DecorationRequestDto = {
          startVerseId: req.startVerseId,
          endVerseId: req.endVerseId,
          moduleId: req.moduleId,
          moduleAbbrev: req.moduleAbbrev,
          requestId: `${key}:${req.startVerseId}-${req.endVerseId}`,
        };
        try {
          const raw = await layer.fetch(request);
          this.recordSuccess(layer);
          const { decorations, rejected } = normalizeAndCap(raw);
          return {
            layerKey: key,
            revision: layer.revision,
            status: rejected > 0 && decorations.length >= MAX_DECORATIONS_PER_CHUNK ? 'truncated' : 'ok',
            decorations,
            ...(rejected > 0 ? { rejected } : {}),
          };
        } catch (err) {
          const isTimeout =
            err instanceof Error && (err.name === 'RpcTimeoutError' || /timed out/i.test(err.message));
          this.recordFailure(layer, err instanceof Error ? err.message : String(err));
          return {
            layerKey: key,
            revision: layer.revision,
            status: isTimeout ? 'timeout' : 'error',
            decorations: [],
          };
        }
      }),
    );

    return {
      results: results.map((r) =>
        r.status === 'fulfilled'
          ? r.value
          : { layerKey: 'unknown', revision: 0, status: 'error' as const, decorations: [] },
      ),
    };
  }

  private recordSuccess(layer: DecoratorLayer): void {
    layer.failure.consecutive = 0;
    layer.failure.backoffUntil = 0;
    delete layer.failure.lastError;
  }

  private recordFailure(layer: DecoratorLayer, message: string): void {
    layer.failure.consecutive++;
    layer.failure.lastError = message;
    const step = Math.min(layer.failure.consecutive, BACKOFF_STEPS_MS.length) - 1;
    layer.failure.backoffUntil = Date.now() + BACKOFF_STEPS_MS[Math.max(0, step)];
    if (layer.failure.consecutive >= DEGRADED_AFTER_CONSECUTIVE_FAILURES) {
      this.notifier.notify('verseDecorationLayerDegraded', [
        { extensionId: layer.extensionId, decoratorId: layer.descriptor.id, lastError: message },
      ]);
    }
  }

  private enforcePushCap(extensionId: string): void {
    const groups = [...this.pushGroups.entries()].filter(([, g]) => g.extensionId === extensionId);
    let total = groups.reduce((sum, [, g]) => sum + g.decorations.length, 0);
    if (total <= MAX_PUSH_DECORATIONS_PER_EXTENSION) return;
    // LRU-evict whole groups, oldest `updatedAt` first, until back under cap.
    const sorted = groups.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key, g] of sorted) {
      if (total <= MAX_PUSH_DECORATIONS_PER_EXTENSION) break;
      this.pushGroups.delete(key);
      total -= g.decorations.length;
      this.notifier.notify('verseDecorationsPushCapExceeded', [{ extensionId, evictedGroupId: g.groupId }]);
    }
  }
}

/** Validate + cap a raw `decorateEndpoint` response (design doc §3.8, §9). */
function normalizeAndCap(raw: unknown): { decorations: DecorationDto[]; rejected: number } {
  if (!Array.isArray(raw)) return { decorations: [], rejected: 0 };
  let rejected = 0;
  const valid: DecorationDto[] = [];
  for (const item of raw) {
    const d = validateDecorationDto(item);
    if (d) valid.push(d);
    else rejected++;
  }
  if (valid.length > MAX_DECORATIONS_PER_CHUNK) {
    rejected += valid.length - MAX_DECORATIONS_PER_CHUNK;
    return { decorations: valid.slice(0, MAX_DECORATIONS_PER_CHUNK), rejected };
  }
  return { decorations: valid, rejected };
}
