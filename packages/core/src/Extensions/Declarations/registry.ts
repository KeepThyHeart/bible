/**
 * The registry of extension API namespaces - the "registration" step.
 *
 * Adding a namespace is: write `namespaces/<name>.ts`, append it to
 * `API_NAMESPACES` below, and bump `EXTENSION_API_VERSION` per the rule in
 * `docs/features/extension-api-namespaces.md`. Everything else - the
 * `ExtensionPermission` union, the manifest validator's allowlists, the
 * consent dialog's text, the activation-event vocabulary, the worker proxy's
 * namespace list, the host's per-method permission guard, the
 * `@bible/extension-testing` fake and the smoke harness's guarded methods -
 * reads `EXTENSION_API_REGISTRY`.
 *
 * `createApiRegistry` is exported so tests can build a registry with an
 * extra (sample) namespace and check the whole pipeline without shipping it.
 */

import type {
  ActivationEventDeclaration,
  AnyApiNamespaceDeclaration,
  ContributesKeyDeclaration,
  EventChannelDeclaration,
  ExtensionApiOf,
  MethodGate,
  NamespaceNamesOf,
  PermissionDeclaration,
  PermissionsOf,
} from './defineApiNamespace';

import { bibleNamespace } from './namespaces/bible';
import { commentaryNamespace } from './namespaces/commentary';
import { bookNamespace } from './namespaces/book';
import { dictionaryNamespace } from './namespaces/dictionary';
import { notesNamespace } from './namespaces/notes';
import { highlightsNamespace } from './namespaces/highlights';
import { bookmarksNamespace } from './namespaces/bookmarks';
import { collectionsNamespace } from './namespaces/collections';
import { commandsNamespace } from './namespaces/commands';
import { uiNamespace } from './namespaces/ui';
import { workspaceNamespace } from './namespaces/workspace';
import { contextNamespace } from './namespaces/context';
import { storageNamespace } from './namespaces/storage';
import { l10nNamespace } from './namespaces/l10n';
import { eventsNamespace } from './namespaces/events';
import { runtimeNamespace } from './namespaces/runtime';
import { panelsNamespace } from './namespaces/panels';
import { networkNamespace } from './namespaces/network';
import { authNamespace } from './namespaces/auth';
import { tasksNamespace } from './namespaces/tasks';
import { extensionsNamespace } from './namespaces/extensions';
import { aiNamespace } from './namespaces/ai';
import { remindersNamespace } from './namespaces/reminders';
import { speechNamespace } from './namespaces/speech';

/**
 * Every namespace of `BibleExtensionAPI`, in the order the consent dialog
 * lists their permissions. Append new namespaces at the end.
 */
export const API_NAMESPACES = [
  bibleNamespace,
  commentaryNamespace,
  dictionaryNamespace,
  bookNamespace,
  notesNamespace,
  highlightsNamespace,
  bookmarksNamespace,
  collectionsNamespace,
  storageNamespace,
  uiNamespace,
  commandsNamespace,
  tasksNamespace,
  networkNamespace,
  authNamespace,
  extensionsNamespace,
  workspaceNamespace,
  contextNamespace,
  l10nNamespace,
  eventsNamespace,
  runtimeNamespace,
  panelsNamespace,
  aiNamespace,
  remindersNamespace,
  speechNamespace,
] as const;

/** The `api` object shape, derived from the declarations. */
export type DeclaredExtensionApi = ExtensionApiOf<typeof API_NAMESPACES>;

/** Every permission identifier any namespace declares. */
export type DeclaredPermission = PermissionsOf<typeof API_NAMESPACES>;

/** Every namespace name (`'bible' | 'notes' | ...`). */
export type ApiNamespaceName = NamespaceNamesOf<typeof API_NAMESPACES>;

// --- Runtime registry ------------------------------------------------------

/** A declared method's gate, with where it was declared. */
export interface ResolvedMethodGate {
  readonly namespace: string;
  /** Method name without the namespace (`list`). */
  readonly method: string;
  readonly gate: MethodGate;
  /** True for a member of the typed interface, false for a `wire` method. */
  readonly typed: boolean;
  readonly local: boolean;
}

export interface DeclaredEventChannel extends EventChannelDeclaration {
  readonly channel: string;
  readonly namespace: string;
}

export interface DeclaredActivationEvent extends ActivationEventDeclaration {
  readonly namespace: string;
}

export interface DeclaredContributesKey extends ContributesKeyDeclaration {
  readonly namespace: string;
}

export interface DeclaredPermissionEntry extends PermissionDeclaration {
  readonly namespace: string;
}

export interface ApiRegistry {
  readonly namespaces: readonly AnyApiNamespaceDeclaration[];
  readonly namespaceNames: readonly string[];
  namespace(name: string): AnyApiNamespaceDeclaration | undefined;

  /** Every declared permission, in declaration order. */
  readonly permissions: readonly DeclaredPermissionEntry[];
  readonly permissionIds: readonly string[];
  permission(id: string): DeclaredPermissionEntry | undefined;
  readonly defaultGranted: readonly string[];
  readonly separatelyPrompted: readonly string[];

  /** Gate for a full RPC method name (`notes.list`), or undefined if undeclared. */
  methodGate(method: string): ResolvedMethodGate | undefined;
  /** Every declared method (typed and wire) of every namespace. */
  readonly methods: readonly ResolvedMethodGate[];

  readonly activationEvents: readonly DeclaredActivationEvent[];
  readonly contributesKeys: readonly DeclaredContributesKey[];
  contributesKey(key: string): DeclaredContributesKey | undefined;
  readonly eventChannels: readonly DeclaredEventChannel[];
  eventChannel(channel: string): DeclaredEventChannel | undefined;

  /**
   * True if the namespace exists for an extension holding `granted` - false
   * for an undeclared name, or one whose `availability.whenGranted`
   * permission is missing.
   */
  isNamespaceAvailable(name: string, granted: Iterable<string>): boolean;
}

/** Permissions a `MethodGate` names (empty for open and impl-checked gates). */
export function gatePermissions(gate: MethodGate): readonly string[] {
  if (gate === null) return [];
  if (typeof gate === 'string') return [gate];
  if ('anyOf' in gate) return gate.anyOf;
  return [];
}

export type GateCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly required: readonly string[]; readonly anyOf: boolean };

/**
 * Does `granted` satisfy `gate`? Host-neutral - the desktop RPC guard and the
 * smoke harness's interceptors both call this, so they cannot disagree.
 * An impl-checked gate always passes here; the implementation decides.
 */
export function checkMethodGate(gate: MethodGate, granted: ReadonlySet<string>): GateCheckResult {
  if (gate === null) return { ok: true };
  if (typeof gate === 'string') {
    return granted.has(gate) ? { ok: true } : { ok: false, required: [gate], anyOf: false };
  }
  if ('anyOf' in gate) {
    return gate.anyOf.some((p) => granted.has(p))
      ? { ok: true }
      : { ok: false, required: gate.anyOf, anyOf: true };
  }
  return { ok: true };
}

/**
 * Build a registry from declarations, checking them for internal
 * consistency. Throws on the first problem found - a declaration error is a
 * programming error that must not ship, and `EXTENSION_API_REGISTRY` is built
 * at module load, so every test run catches it.
 */
export function createApiRegistry(decls: readonly AnyApiNamespaceDeclaration[]): ApiRegistry {
  const fail = (msg: string): never => {
    throw new Error(`Extension API registry: ${msg}`);
  };

  const byName = new Map<string, AnyApiNamespaceDeclaration>();
  const permissions: DeclaredPermissionEntry[] = [];
  const permissionById = new Map<string, DeclaredPermissionEntry>();
  const methods: ResolvedMethodGate[] = [];
  const methodByName = new Map<string, ResolvedMethodGate>();
  const activationEvents: DeclaredActivationEvent[] = [];
  const contributesKeys: DeclaredContributesKey[] = [];
  const contributesByKey = new Map<string, DeclaredContributesKey>();
  const eventChannels: DeclaredEventChannel[] = [];
  const eventByChannel = new Map<string, DeclaredEventChannel>();

  for (const d of decls) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(d.name)) fail(`namespace name "${d.name}" must be a camelCase identifier`);
    if (byName.has(d.name)) fail(`duplicate namespace "${d.name}"`);
    byName.set(d.name, d);

    for (const p of d.permissions) {
      if (permissionById.has(p.id)) {
        fail(`permission "${p.id}" declared by both "${permissionById.get(p.id)!.namespace}" and "${d.name}"`);
      }
      if (!p.consent.key || !p.consent.text) fail(`permission "${p.id}" needs consent key and text`);
      const entry = { ...p, namespace: d.name };
      permissions.push(entry);
      permissionById.set(p.id, entry);
    }

    const addMethod = (method: string, gate: MethodGate, typed: boolean, local: boolean): void => {
      const full = `${d.name}.${method}`;
      if (methodByName.has(full)) fail(`method "${full}" declared twice (typed and wire?)`);
      const r: ResolvedMethodGate = { namespace: d.name, method, gate, typed, local };
      methods.push(r);
      methodByName.set(full, r);
    };
    for (const [method, m] of Object.entries(d.methods as Record<string, { permission: MethodGate; local?: boolean }>)) {
      addMethod(method, m.permission, true, m.local === true);
    }
    for (const [method, w] of Object.entries(d.wire ?? {})) {
      addMethod(method, w.permission, false, false);
    }

    for (const e of d.activationEvents ?? []) {
      if (!/^on[A-Z][A-Za-z]*(:)?$/.test(e.event)) {
        fail(`activation event "${e.event}" (${d.name}) must be onXxx or an onXxx: prefix`);
      }
      if (activationEvents.some((x) => x.event === e.event)) fail(`duplicate activation event "${e.event}"`);
      activationEvents.push({ ...e, namespace: d.name });
    }

    for (const c of d.contributes ?? []) {
      if (contributesByKey.has(c.key)) fail(`duplicate contributes key "${c.key}"`);
      const entry = { ...c, namespace: d.name };
      contributesKeys.push(entry);
      contributesByKey.set(c.key, entry);
    }

    for (const [channel, ev] of Object.entries(d.events ?? {})) {
      if (eventByChannel.has(channel)) fail(`duplicate event channel "${channel}"`);
      const entry = { ...ev, channel, namespace: d.name };
      eventChannels.push(entry);
      eventByChannel.set(channel, entry);
    }
  }

  // Cross-references are checked once every permission is known: a method
  // may use a permission another namespace owns (collections -> bookmarks).
  for (const m of methods) {
    for (const p of gatePermissions(m.gate)) {
      if (!permissionById.has(p)) fail(`${m.namespace}.${m.method} uses undeclared permission "${p}"`);
    }
  }
  for (const d of decls) {
    const w = d.availability?.whenGranted;
    if (w !== undefined && !permissionById.has(w)) fail(`${d.name}.availability uses undeclared permission "${w}"`);
    for (const c of d.contributes ?? []) {
      if (c.requiresPermission !== undefined && !permissionById.has(c.requiresPermission)) {
        fail(`contributes.${c.key} requires undeclared permission "${c.requiresPermission}"`);
      }
    }
    for (const [channel, ev] of Object.entries(d.events ?? {})) {
      if (ev.permission !== null && !permissionById.has(ev.permission)) {
        fail(`event "${channel}" uses undeclared permission "${ev.permission}"`);
      }
    }
  }

  const namespaces = [...decls];
  return {
    namespaces,
    namespaceNames: namespaces.map((d) => d.name),
    namespace: (name) => byName.get(name),
    permissions,
    permissionIds: permissions.map((p) => p.id),
    permission: (id) => permissionById.get(id),
    defaultGranted: permissions.filter((p) => p.grant === 'default').map((p) => p.id),
    separatelyPrompted: permissions.filter((p) => p.grant === 'separate').map((p) => p.id),
    methodGate: (method) => methodByName.get(method),
    methods,
    activationEvents,
    contributesKeys,
    contributesKey: (key) => contributesByKey.get(key),
    eventChannels,
    eventChannel: (channel) => eventByChannel.get(channel),
    isNamespaceAvailable(name, granted) {
      const d = byName.get(name);
      if (!d) return false;
      const w = d.availability?.whenGranted;
      if (w === undefined) return true;
      for (const p of granted) if (p === w) return true;
      return false;
    },
  };
}

/** The registry every host and tool reads. */
export const EXTENSION_API_REGISTRY: ApiRegistry = createApiRegistry(API_NAMESPACES);
