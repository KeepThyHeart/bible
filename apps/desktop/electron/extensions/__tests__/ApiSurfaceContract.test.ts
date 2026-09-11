/**
 * The API-surface checklist, as an executable invariant.
 *
 * `ExtensionApiTypes.ts` is the contract extension authors are handed. Two
 * other places independently re-declare pieces of that same surface, and
 * neither is checked against it by the compiler:
 *
 *   1. `EVENT_PROPERTIES` in `extension-runtime/apiProxy.ts` - the guest-side
 *      list of property names that should yield an `IEventApi` instead of an
 *      RPC-dispatching function.
 *   2. The channel strings each api-impl passes to `router.emitEvent(...)` -
 *      the host-side list of events that actually fire.
 *
 * All three drifted. The proxy named six events the types do not declare and
 * missed seven the types do, so `api.notes.onDidChange.subscribe(handler)` -
 * documented, typed, and emitted by the host - threw `TypeError: ... is not a
 * function`. Nothing catches that class of bug: the proxy is intentionally
 * permissive (any unknown property becomes an RPC), the guest is untyped at
 * the boundary, and the failure only appears at runtime inside a sandboxed
 * realm.
 *
 * So this file reads the type declarations as data and diffs them against
 * both. Parsing source in a test is normally a smell; here the source *is*
 * the specification, the alternative is a hand-maintained list that drifts
 * exactly like the two lists it would be checking, and a broken parse fails
 * loudly (zero members found) rather than silently passing.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { EVENT_PROPERTIES } from '../../../extension-runtime/apiProxy';

const TYPES_PATH = join(
  __dirname,
  '../../../../../packages/core/src/Extensions/ExtensionApiTypes.ts',
);
const IMPL_DIR = join(__dirname, '../api-impl');

const typesSrc = readFileSync(TYPES_PATH, 'utf8');

/** Strip comments so a doc-block example can't be mistaken for a member. */
function decomment(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** `namespace -> interface name`, read from `BibleExtensionAPI`. */
function namespaceMap(): Map<string, string> {
  const body = typesSrc.match(/export interface BibleExtensionAPI \{([\s\S]*?)\n\}/)?.[1];
  if (!body) throw new Error('Could not locate BibleExtensionAPI in ExtensionApiTypes.ts');
  const map = new Map<string, string>();
  for (const m of body.matchAll(/^\s*(\w+):\s*(I\w+);/gm)) map.set(m[1]!, m[2]!);
  return map;
}

/**
 * The `IEventApi<...>` members of one interface. Only brace-depth-0 lines
 * count, so a nested payload type containing an `IEventApi` field would not
 * be mistaken for a namespace-level event.
 */
function eventMembersOf(ifaceName: string): Set<string> {
  const body = typesSrc.match(
    new RegExp(`export interface ${ifaceName} \\{([\\s\\S]*?)\\n\\}`, 'm'),
  )?.[1];
  if (body === undefined) throw new Error(`Interface ${ifaceName} not found`);
  const events = new Set<string>();
  let depth = 0;
  for (const line of decomment(body).split('\n')) {
    if (depth === 0) {
      const m = line.trim().match(/^(\w+)\s*:\s*IEventApi</);
      if (m) events.add(m[1]!);
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
    }
  }
  return events;
}

/** `namespace -> Set<eventName>` for the whole declared contract. */
function declaredEvents(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [ns, iface] of namespaceMap()) {
    const events = eventMembersOf(iface);
    if (events.size > 0) out.set(ns, events);
  }
  return out;
}

/**
 * Every channel string the host can pass to `router.emitEvent(...)`, as
 * `namespace -> Set<eventName>`. Covers both idioms in use: a literal at the
 * call site, and the more common `const X_CHANNEL = 'ns.event'` module const.
 */
function emittedChannels(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (channel: string): void => {
    const dot = channel.indexOf('.');
    if (dot < 0) return;
    const ns = channel.slice(0, dot);
    if (!out.has(ns)) out.set(ns, new Set());
    out.get(ns)!.add(channel.slice(dot + 1));
  };
  for (const file of readdirSync(IMPL_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = decomment(readFileSync(join(IMPL_DIR, file), 'utf8'));
    for (const m of src.matchAll(/emitEvent\(\s*'([\w.]+)'/g)) add(m[1]!);
    for (const m of src.matchAll(/const \w*CHANNEL\w* = '([\w.]+)'/g)) add(m[1]!);
  }
  return out;
}

/**
 * Events the contract declares that no api-impl emits yet. Subscribing to one
 * succeeds and the handler never fires.
 *
 * These are missing *plumbing*, not a naming mismatch: there is no bridge
 * subscription for "the user switched active commentary/dictionary/book", and
 * `contextApiImpl`'s header describes a `WhenContextService` forward that was
 * never written. Listing them here keeps the gap visible and makes wiring one
 * up a test-passing change rather than a test-editing one.
 */
const DECLARED_BUT_NOT_EMITTED = new Set([
  'commentary.onDidChangeActiveCommentary',
  'dictionary.onDidChangeActiveDictionary',
  'book.onDidChangeActiveBook',
  'context.onDidChange',
]);

/** Namespaces declaring at least one method that returns a `DisposableHandle`. */
function namespacesReturningDisposables(): Set<string> {
  const out = new Set<string>();
  for (const [ns, iface] of namespaceMap()) {
    const body = typesSrc.match(
      new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`, 'm'),
    )?.[1];
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
 * Members that are neither a method nor an `IEventApi`, i.e. plain data
 * properties. The proxy cannot serve one: property access returns a function
 * that dispatches an RPC, so a `foo: Promise<string>` member hands the caller
 * a *function* and `await` resolves it to itself rather than throwing.
 */
function barePropertyMembers(): string[] {
  const out: string[] = [];
  for (const [ns, iface] of namespaceMap()) {
    const body = typesSrc.match(
      new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`, 'm'),
    )?.[1];
    if (body === undefined) continue;
    let depth = 0;
    for (const line of decomment(body).split('\n')) {
      const t = line.trim();
      if (depth === 0 && t.length > 0) {
        const isMethod = /^\w+\s*\??\s*(?:<[^(]*>)?\s*\(/.test(t);
        const isEvent = /^\w+\s*:\s*IEventApi</.test(t);
        const isProperty = /^\w+\s*\??\s*:/.test(t);
        if (isProperty && !isEvent && !isMethod) out.push(`${ns}.${t}`);
      }
      for (const ch of line) {
        if (ch === '{' || ch === '(' || ch === '[') depth++;
        else if (ch === '}' || ch === ')' || ch === ']') depth--;
      }
    }
  }
  return out;
}

describe('API surface contract', () => {
  // A broken parse must fail here rather than vacuously passing everything
  // downstream, so pin the shape of what we extracted.
  it('extracts a plausible surface from ExtensionApiTypes.ts', () => {
    const namespaces = namespaceMap();
    expect(namespaces.size).toBeGreaterThanOrEqual(19);
    expect(namespaces.get('bible')).toBe('IBibleApi');

    const events = declaredEvents();
    const total = [...events.values()].reduce((n, s) => n + s.size, 0);
    // Cross-check against a whole-file count of `IEventApi<` declarations:
    // if the per-interface walk misses one, these disagree.
    const rawCount = (typesSrc.match(/^\s+\w+: IEventApi</gm) ?? []).length;
    expect(total).toBe(rawCount);
    expect(total).toBeGreaterThan(0);
  });

  it('declares only methods and events — never a bare data property', () => {
    // `IL10nApi.currentLocale` was declared `Promise<string>`, which the proxy
    // silently served as a function. Any future member added in that shape has
    // the same defect, so the contract disallows the shape outright.
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
    //                `dispose()` sends an `RpcUnsubscribe` envelope.
    //   `runtime`  - `expose` binds a callback into the worker's own
    //                reverse-RPC endpoint table; `dispose()` unbinds it. The
    //                host is never told, because the host was never the one
    //                holding it.
    //   `panels`   - `onMessage` is `runtime.expose` under a fixed endpoint
    //                name. Its `dispose()` unbinds locally *and* sends
    //                `panels.setMessageHandler(false)`, but that is a state
    //                update, not a disposal call.
    //
    // Adding a namespace here needs the same property: the handle must be
    // constructed worker-side. A namespace whose handle comes back over the
    // wire belongs in the checked set, or its `dispose()` rejects at teardown,
    // asynchronously, usually unobserved.
    const WORKER_LOCAL_DISPOSABLES = new Set(['events', 'runtime', 'panels']);
    const registered = registeredMethods();
    const missing = [...namespacesReturningDisposables()]
      .filter((ns) => !WORKER_LOCAL_DISPOSABLES.has(ns))
      .filter((ns) => registered.get(ns)?.has('dispose') !== true);
    expect(missing).toEqual([]);
  });

  describe('guest proxy event table', () => {
    it('names every event the contract declares, and only those', () => {
      const declared = declaredEvents();

      // Compare as flat sorted lists so a mismatch prints as a readable diff
      // rather than a Map/Set dump.
      const flat = (m: Map<string, Set<string>> | Record<string, ReadonlySet<string>>) => {
        const entries =
          m instanceof Map ? [...m.entries()] : Object.entries(m).map(([k, v]) => [k, v] as const);
        return entries
          .flatMap(([ns, names]) => [...names].map((n) => `${ns}.${n}`))
          .sort();
      };

      expect(flat(EVENT_PROPERTIES)).toEqual(flat(declared));
    });

    it('has no namespace key for a namespace with no events', () => {
      // An empty Set would still work, but it invites the reading that the
      // namespace has events pending - which is how four phantom entries
      // survived in the first place.
      for (const [ns, names] of Object.entries(EVENT_PROPERTIES)) {
        expect(names.size, `EVENT_PROPERTIES.${ns} is empty`).toBeGreaterThan(0);
      }
    });
  });

  describe('host emitters', () => {
    it('only emits channels the contract declares', () => {
      const declared = declaredEvents();
      const stray: string[] = [];
      for (const [ns, names] of emittedChannels()) {
        for (const name of names) {
          if (!declared.get(ns)?.has(name)) stray.push(`${ns}.${name}`);
        }
      }
      // A host emitting `context.didChange` while the contract declares
      // `context.onDidChange` is a channel nobody is listening on: the guest
      // subscribes under the declared name and the payload is dropped.
      expect(stray).toEqual([]);
    });

    it('accounts for every declared event as emitted or explicitly pending', () => {
      const emitted = emittedChannels();
      const unaccounted: string[] = [];
      for (const [ns, names] of declaredEvents()) {
        for (const name of names) {
          const key = `${ns}.${name}`;
          if (!emitted.get(ns)?.has(name) && !DECLARED_BUT_NOT_EMITTED.has(key)) {
            unaccounted.push(key);
          }
        }
      }
      expect(unaccounted).toEqual([]);
    });

    it('does not list an already-wired event as pending', () => {
      // Keeps DECLARED_BUT_NOT_EMITTED from rotting into a permanent excuse:
      // wiring an event up must force its removal from the list.
      const emitted = emittedChannels();
      const nowWired = [...DECLARED_BUT_NOT_EMITTED].filter((key) => {
        const dot = key.indexOf('.');
        return emitted.get(key.slice(0, dot))?.has(key.slice(dot + 1)) === true;
      });
      expect(nowWired).toEqual([]);
    });
  });
});
