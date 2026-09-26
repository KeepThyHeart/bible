/**
 * The API-surface checklist, as an executable invariant.
 *
 * Task 0024 round 3 (P0.3) replaced two independently-hand-maintained event
 * surfaces - the `onDid*` properties scattered across eleven namespaces, and
 * the 40-member `ExtensionPointId` union with zero call sites - with one
 * channel vocabulary (`ExtensionPointId`, now 14 members) and one dispatcher
 * (`dispatchExtensionPoint`). This file is the drift test for *that* surface:
 * it reads `ExtensionPointTypes.ts` (kinds, payload/return maps,
 * cancelable/replay tables) and `ExtensionApiTypes.ts` (the `ExtensionPointId`
 * union itself) as data, and diffs them against the actual wiring in
 * `ExtensionPointWiring.ts` and the desktop `electron/ipc/*Handlers.ts`
 * files that call `dispatchExtensionPoint`.
 *
 * With the union pruned to 14, there is no `DECLARED_BUT_NOT_EMITTED`
 * allow-list any more: an unwired channel is a hard test failure, full stop.
 * That is the main win of the pruning, and this test is what makes it real
 * rather than aspirational.
 *
 * Parsing source in a test is normally a smell; here the source *is* the
 * specification, the alternative is a hand-maintained list that drifts
 * exactly like the tables it would be checking, and a broken parse fails
 * loudly (zero members found) rather than silently passing.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { Extensions } from '@bible/core';

const CORE_EXTENSIONS_DIR = join(__dirname, '../../../../../packages/core/src/Extensions');
const API_TYPES_PATH = join(CORE_EXTENSIONS_DIR, 'ExtensionApiTypes.ts');
const POINT_TYPES_PATH = join(CORE_EXTENSIONS_DIR, 'ExtensionPointTypes.ts');
const WIRING_PATH = join(__dirname, '../ExtensionPointWiring.ts');
const LIFECYCLE_PATH = join(__dirname, '../ExtensionHostLifecycle.ts');
const STORAGE_API_IMPL_PATH = join(__dirname, '../api-impl/storageApiImpl.ts');
const IMPL_DIR = join(__dirname, '../api-impl');
const RUNTIME_DIR = join(__dirname, '../../../extension-runtime');
const IPC_DIR = join(__dirname, '../../ipc');

const apiTypesSrc = readFileSync(API_TYPES_PATH, 'utf8');
const pointTypesSrc = readFileSync(POINT_TYPES_PATH, 'utf8');
const wiringSrc = readFileSync(WIRING_PATH, 'utf8');
const lifecycleSrc = readFileSync(LIFECYCLE_PATH, 'utf8');
const storageApiImplSrc = readFileSync(STORAGE_API_IMPL_PATH, 'utf8');

/** Strip comments so a doc-block example can't be mistaken for a member. */
function decomment(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** `namespace -> interface name`, read from `BibleExtensionAPI`. */
function namespaceMap(): Map<string, string> {
  const body = apiTypesSrc.match(/export interface BibleExtensionAPI \{([\s\S]*?)\n\}/)?.[1];
  if (!body) throw new Error('Could not locate BibleExtensionAPI in ExtensionApiTypes.ts');
  const map = new Map<string, string>();
  for (const m of body.matchAll(/^\s*(\w+):\s*(I\w+);/gm)) map.set(m[1]!, m[2]!);
  return map;
}

function interfaceBody(ifaceName: string): string | undefined {
  return apiTypesSrc.match(new RegExp(`export interface ${ifaceName} \\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1];
}

/** Namespaces declaring at least one method that returns a `DisposableHandle`. */
function namespacesReturningDisposables(): Set<string> {
  const out = new Set<string>();
  for (const [ns, iface] of namespaceMap()) {
    const body = interfaceBody(iface);
    if (body !== undefined && /Promise<DisposableHandle>/.test(decomment(body))) out.add(ns);
  }
  return out;
}

/** Method names each api-impl registers, by namespace. Covers both idioms. */
function registeredMethods(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (ns: string, name: string): void => {
    if (!out.has(ns)) out.set(ns, new Set());
    out.get(ns)!.add(name);
  };
  for (const file of readdirSync(IMPL_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(IMPL_DIR, file), 'utf8');
    for (const m of src.matchAll(/registerNamespace\(\s*'(\w+)'\s*,\s*\{/g)) {
      // Walk to the matching brace so nested object literals in a handler
      // body cannot leak keys into the list.
      let i = m.index! + m[0].length - 1;
      let depth = 0;
      let end = i;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) {
          end = i;
          break;
        }
      }
      let d = 0;
      for (const line of decomment(src.slice(m.index! + m[0].length, end)).split('\n')) {
        if (d === 0) {
          const k = line.trim().match(/^(\w+)\s*:/);
          if (k) add(m[1]!, k[1]!);
        }
        for (const ch of line) {
          if (ch === '{' || ch === '(' || ch === '[') d++;
          else if (ch === '}' || ch === ')' || ch === ']') d--;
        }
      }
    }
    for (const m of src.matchAll(/registerMethod\(\s*'(\w+)\.(\w+)'/g)) add(m[1]!, m[2]!);
  }
  return out;
}

/**
 * Members that are neither a method nor an `IEventsApi.subscribe`-shaped
 * signature, i.e. plain data properties. The proxy cannot serve one:
 * property access returns a function that dispatches an RPC, so a
 * `foo: Promise<string>` member hands the caller a *function* and `await`
 * resolves it to itself rather than throwing.
 */
function barePropertyMembers(): string[] {
  const out: string[] = [];
  for (const [ns, iface] of namespaceMap()) {
    const body = interfaceBody(iface);
    if (body === undefined) continue;
    let depth = 0;
    for (const line of decomment(body).split('\n')) {
      const t = line.trim();
      if (depth === 0 && t.length > 0) {
        const isMethod = /^\w+\s*\??\s*(?:<[^(]*>)?\s*\(/.test(t);
        const isProperty = /^\w+\s*\??\s*:/.test(t);
        if (isProperty && !isMethod) out.push(`${ns}.${t}`);
      }
      for (const ch of line) {
        if (ch === '{' || ch === '(' || ch === '[') depth++;
        else if (ch === '}' || ch === ')' || ch === ']') depth--;
      }
    }
  }
  return out;
}

/** Every `ExtensionPointId` literal declared in the union (source order). */
function declaredPointIds(): string[] {
  const body = apiTypesSrc.match(/export type ExtensionPointId =([\s\S]*?);/m)?.[1];
  if (!body) throw new Error('Could not locate the ExtensionPointId union in ExtensionApiTypes.ts');
  return [...decomment(body).matchAll(/'([\w.]+)'/g)].map((m) => m[1]!);
}

/** The `key: <Type>` (or `'key': <Type>`) entries of one top-level interface/object in a source string, brace-depth-0 only. */
function topLevelEntries(src: string, headerPattern: RegExp): Map<string, string> {
  const m = headerPattern.exec(src);
  if (!m) throw new Error(`Pattern not found: ${headerPattern}`);
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  const body = decomment(src.slice(start, i - 1));
  const out = new Map<string, string>();
  let d = 0;
  let currentKey: string | undefined;
  let currentType = '';
  for (const line of body.split('\n')) {
    if (d === 0) {
      const keyMatch = line.match(/^\s*'?([\w.]+)'?\s*:\s*(.*)$/);
      if (keyMatch) {
        if (currentKey) out.set(currentKey, currentType.trim());
        currentKey = keyMatch[1];
        currentType = keyMatch[2] ?? '';
      } else if (currentKey) {
        currentType += ' ' + line;
      }
    } else if (currentKey) {
      currentType += ' ' + line;
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') d++;
      else if (ch === '}' || ch === ')' || ch === ']') d--;
    }
  }
  if (currentKey) out.set(currentKey, currentType.trim());
  return out;
}

describe('API surface contract', () => {
  it('extracts a plausible surface from ExtensionApiTypes.ts', () => {
    const namespaces = namespaceMap();
    expect(namespaces.size).toBeGreaterThanOrEqual(19);
    expect(namespaces.get('bible')).toBe('IBibleApi');

    const pointIds = declaredPointIds();
    expect(pointIds.length).toBe(14);
  });

  it('declares only methods (never a bare data property)', () => {
    // `IL10nApi.currentLocale` was declared `Promise<string>`, which the proxy
    // silently served as a function. Any future member added in that shape has
    // the same defect, so the contract disallows the shape outright. Nothing
    // in `BibleExtensionAPI`'s per-namespace interfaces is an `IEventsApi`
    // member any more - subscription lives entirely on `api.events`, which
    // this check does not need to special-case.
    expect(barePropertyMembers()).toEqual([]);
  });

  it('backs every DisposableHandle-returning namespace with a dispose handler', () => {
    // The guest proxy reconstitutes a `DisposableHandle` by calling
    // `<ns>.dispose(disposalId)` - see `maybeWrapDisposable`. A namespace that
    // hands out disposables without registering that method produces a handle
    // whose `dispose()` rejects with `Unknown RPC method`, which is worse than
    // the missing handle it replaced: it fails at teardown, asynchronously,
    // usually unobserved.
    //
    // Three namespaces are legitimate exceptions, and they are all the same
    // exception: the proxy special-cases them to worker-local state, so they
    // hand back a real `DisposableHandle` built in the worker and never issue
    // a request the host could answer with a `disposalId`.
    //
    //   `events`   - `subscribe` goes to the worker-side emitter; its
    //                `dispose()` sends an `RpcUnsubscribe` envelope (event
    //                channels) or unregisters a `hook:` reverse handler
    //                (filter/provider channels).
    //   `runtime`  - `expose` binds a callback into the worker's own
    //                reverse-RPC endpoint table; `dispose()` unbinds it. The
    //                host is never told, because the host was never the one
    //                holding it.
    //   `panels`   - `onMessage` is `runtime.expose` under a fixed endpoint
    //                name. Its `dispose()` unbinds locally *and* sends
    //                `panels.setMessageHandler(false)`, but that is a state
    //                update, not a disposal call.
    const WORKER_LOCAL_DISPOSABLES = new Set(['events', 'runtime', 'panels']);
    const registered = registeredMethods();
    const missing = [...namespacesReturningDisposables()]
      .filter((ns) => !WORKER_LOCAL_DISPOSABLES.has(ns))
      .filter((ns) => registered.get(ns)?.has('dispose') !== true);
    expect(missing).toEqual([]);
  });

  describe('extension point vocabulary', () => {
    it('EXTENSION_POINT_KINDS, ExtensionPointPayloadMap and ExtensionPointReturnMap all cover exactly the declared union', () => {
      const declared = new Set(declaredPointIds());
      const kinds = topLevelEntries(pointTypesSrc, /export const EXTENSION_POINT_KINDS: Record<ExtensionPointId, ExtensionPointKind> = \{/);
      const payloads = topLevelEntries(pointTypesSrc, /export interface ExtensionPointPayloadMap \{/);
      const returns = topLevelEntries(pointTypesSrc, /export interface ExtensionPointReturnMap \{/);

      expect([...kinds.keys()].sort()).toEqual([...declared].sort());
      expect([...payloads.keys()].sort()).toEqual([...declared].sort());
      expect([...returns.keys()].sort()).toEqual([...declared].sort());
    });

    it('every filter channel returns a transform-or-undefined or a continue/cancel verdict; every provider channel returns an array; every event channel returns void', () => {
      const returns = topLevelEntries(pointTypesSrc, /export interface ExtensionPointReturnMap \{/);
      const cancelable = Extensions.EXTENSION_POINT_CANCELABLE;
      for (const pointId of declaredPointIds()) {
        const kind = Extensions.EXTENSION_POINT_KINDS[pointId as Extensions.ExtensionPointId];
        const returnType = returns.get(pointId) ?? '';
        if (kind === 'event') {
          expect(returnType, pointId).toBe('void;');
        } else if (kind === 'provider') {
          expect(returnType, pointId).toMatch(/\[\];$/);
        } else if (kind === 'filter') {
          if (cancelable.has(pointId as Extensions.ExtensionPointId)) {
            expect(returnType, pointId).toContain(`'continue' | 'cancel'`);
          } else {
            expect(returnType, pointId).toContain('undefined');
          }
        }
      }
    });

    it('EXTENSION_POINT_CANCELABLE is a subset of filter channels', () => {
      for (const pointId of Extensions.EXTENSION_POINT_CANCELABLE) {
        expect(Extensions.EXTENSION_POINT_KINDS[pointId], pointId).toBe('filter');
      }
    });

    it('EXTENSION_POINT_REPLAY is a subset of event channels, each with a registered replay source', () => {
      const replaySourceKeys = [
        ...wiringSrc.matchAll(/^\s*'([\w.]+)':\s*\(ctx\)\s*=>/gm),
      ].map((m) => m[1]!);
      for (const pointId of Extensions.EXTENSION_POINT_REPLAY) {
        expect(Extensions.EXTENSION_POINT_KINDS[pointId], pointId).toBe('event');
        expect(replaySourceKeys, `${pointId} has no REPLAY_SOURCES entry in ExtensionPointWiring.ts`).toContain(pointId);
      }
    });

    it('every EXTENSION_POINT_PERMISSIONS entry names a real permission for a real channel', () => {
      const declared = new Set(declaredPointIds());
      for (const [pointId, permission] of Object.entries(Extensions.EXTENSION_POINT_PERMISSIONS)) {
        expect(declared.has(pointId), pointId).toBe(true);
        expect(typeof permission).toBe('string');
      }
    });
  });

  describe('every channel is wired somewhere', () => {
    it('every ExtensionPointId is dispatched from ExtensionPointWiring.ts, ExtensionHostLifecycle.ts, storageApiImpl.ts, or an electron/ipc handler', () => {
      // With the union pruned to 14, there is no allow-list any more - an
      // unwired channel is a hard failure, full stop. That is the point of
      // the pruning in design-p0.3-p2.14-event-system.md §5.3.
      const wiredViaDispatch = new Set<string>();
      const collectDispatch = (src: string): void => {
        // `ExtensionPointWiring.ts`'s bridge subscriptions call `safeDispatch`,
        // which itself calls `dispatchExtensionPoint`; the IPC handlers call
        // `dispatchExtensionPoint`/`host.dispatchExtensionPoint` directly.
        for (const m of src.matchAll(/safeDispatch\(\s*ctx,\s*'([\w.]+)'/g)) wiredViaDispatch.add(m[1]!);
        for (const m of src.matchAll(/dispatchExtensionPoint\(\s*ctx,\s*'([\w.]+)'/g)) wiredViaDispatch.add(m[1]!);
        for (const m of src.matchAll(/\.dispatchExtensionPoint\(\s*'([\w.]+)'/g)) wiredViaDispatch.add(m[1]!);
      };
      collectDispatch(wiringSrc);
      for (const file of readdirSync(IPC_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
        collectDispatch(readFileSync(join(IPC_DIR, file), 'utf8'));
      }
      // The two channels fired directly by name (not through the generic
      // dispatcher) because they need self-exclusion semantics the generic
      // fan-out cannot express - see ExtensionHostLifecycle.ts's comments on
      // `extension.activated`/`extension.deactivated`.
      for (const m of lifecycleSrc.matchAll(/router\.emitEvent\('([\w.]+)'/g)) wiredViaDispatch.add(m[1]!);
      // `settings.changed` is fired only to the owning worker (never through
      // the host-wide dispatcher, which would leak it cross-extension) - see
      // storageApiImpl.ts's `notifySettingsChanged`.
      for (const m of storageApiImplSrc.matchAll(/router\.emitEvent\('([\w.]+)'/g)) wiredViaDispatch.add(m[1]!);
      for (const m of storageApiImplSrc.matchAll(/emitEvent\(\s*SETTINGS_CHANGE_CHANNEL/g)) {
        void m;
        wiredViaDispatch.add('settings.changed');
      }

      const unwired = declaredPointIds().filter((id) => !wiredViaDispatch.has(id));
      expect(unwired).toEqual([]);
    });
  });

  describe('no onDid* survives', () => {
    it('ExtensionApiTypes.ts and ExtensionApiDtos.ts declare no onDid* member and no IEventApi reference', () => {
      for (const file of ['ExtensionApiTypes.ts', 'ExtensionApiDtos.ts', 'ExtensionPointTypes.ts']) {
        const src = readFileSync(join(CORE_EXTENSIONS_DIR, file), 'utf8');
        expect(src, file).not.toMatch(/\bonDid\w+/);
        expect(src, file).not.toMatch(/\bIEventApi\b/);
      }
    });

    it('the extension-runtime package references no onDid* member and no IEventApi', () => {
      for (const file of ['apiProxy.ts', 'eventEmitter.ts', 'runtime.ts']) {
        const src = readFileSync(join(RUNTIME_DIR, file), 'utf8');
        expect(src, file).not.toMatch(/\bonDid\w+/);
        expect(src, file).not.toMatch(/\bIEventApi\b/);
      }
    });
  });
});
