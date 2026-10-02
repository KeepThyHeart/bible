/**
 * The extension API declaration layer - the one place an API namespace says
 * what it is.
 *
 * Before this file, adding a namespace to `BibleExtensionAPI` meant editing
 * eight hand-maintained tables that had to agree: the permission constants,
 * the validator's permission allowlist, the JSON Schema enum, the consent
 * dialog's description keys, the worker proxy's namespace list, the
 * `@bible/extension-testing` mock, the smoke harness's guarded-method table
 * and the host's per-method `requirePermission` calls. Each consuming task
 * (speech, reminders, apps, reading plans, ...) would have added its own row
 * to each of them. Now a namespace is one `defineApiNamespace(...)` value in
 * `Declarations/namespaces/<name>.ts`, registered once in
 * `Declarations/registry.ts`, and every one of those tables is derived from
 * the registry.
 *
 * **Host-neutral by construction.** Nothing in a declaration names Electron,
 * a worker, a bridge or a database: it says which permission gates which
 * method, what the user is told when asked for that permission, which
 * activation events and manifest keys the namespace adds, and what a test
 * fake should resolve with. How a host *implements* the namespace is the
 * host's business (`apps/desktop/electron/extensions/ExtensionHostRpc.ts` on
 * desktop; a web host plugs in the same way later). A host that does not
 * implement a namespace at all simply leaves it out of the init payload's
 * `apiNamespaces`, and the extension sees `api.<name> === undefined`.
 *
 * **Leaf module.** This file imports nothing at runtime, and declaration
 * files may import only from here (plus `import type`). `@bible/core` builds
 * to CommonJS, where a value-level import cycle hands one side a
 * half-initialised `exports` object; `Permissions.ts`, `ActivationEvents.ts`
 * and the manifest validator all read the registry, so a declaration file
 * that imported any of them would close exactly that cycle.
 *
 * See `packages/core/docs/features/extension-api-namespaces.md` for the
 * how-to and a worked example.
 */

// --- Permissions -----------------------------------------------------------

/**
 * How a permission reaches an extension.
 *
 * - `default`: granted at install without asking; never listed in the
 *   consent dialog's checkboxes (`DEFAULT_GRANTED_PERMISSIONS`).
 * - `prompt`: listed in the install consent dialog, checked by default.
 * - `separate`: listed and highlighted as sensitive, with extra detail
 *   (`SEPARATELY_PROMPTED_PERMISSIONS`) - network, keychain, raw databases,
 *   anything that reaches outside the app or survives it.
 */
export type PermissionGrantPolicy = 'default' | 'prompt' | 'separate';

/**
 * What the user reads before granting a permission.
 *
 * `key` is the catalog key (`extensionConsent.permission.*` in the desktop
 * `ui.json`), so the wording can be reviewed and translated. `text` is the
 * English sentence, used verbatim when a host's catalog has no entry for the
 * key yet - a brand-new namespace therefore shows real consent text on day
 * one without touching any catalog, and gains translations later.
 */
export interface ConsentText {
  readonly key: string;
  readonly text: string;
}

export interface PermissionDeclaration<P extends string = string> {
  /** The identifier extensions put in `extension.json`'s `permissions`. */
  readonly id: P;
  readonly grant: PermissionGrantPolicy;
  readonly consent: ConsentText;
  /** `EXTENSION_API_VERSION` that first shipped this permission. */
  readonly since: string;
}

// --- Methods ---------------------------------------------------------------

/**
 * Which permission a call needs.
 *
 * - `null`: no permission (the call is open to every extension).
 * - `'notes:read'`: that permission is required.
 * - `{ anyOf: [...] }`: any one of them suffices.
 * - `{ checkedBy: 'impl', reason }`: the requirement depends on the
 *   arguments (e.g. `commands.execute` is free for the extension's own
 *   commands and gated for built-ins), so the host's generic guard lets the
 *   call through and the implementation decides. `reason` is mandatory so
 *   the exception explains itself where it is declared.
 */
export type MethodGate =
  | null
  | string
  | { readonly anyOf: readonly string[] }
  | { readonly checkedBy: 'impl'; readonly reason: string };

/**
 * What the generated test fake (`@bible/extension-testing`'s
 * `createMockApi`) resolves a method with. Plain data only (JSON values, or
 * an `ArrayBuffer`) - it is `structuredClone`d, and a declaration cannot
 * depend on a test framework. Omitted: resolves `undefined`.
 */
export type FakeReturn =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'disposable' };

/** Fake that resolves `value` (deep-copied once per `createMockApi()`). */
export function fakeReturns(value: unknown): FakeReturn {
  return { kind: 'value', value };
}

/** Fake that resolves a `DisposableHandle` whose `dispose` is a recorded mock. */
export const FAKE_DISPOSABLE: FakeReturn = { kind: 'disposable' };

export interface MethodDeclaration {
  readonly permission: MethodGate;
  /**
   * Implemented inside the worker by the API proxy and never sent to the
   * host (`runtime.expose`, `events.subscribe`, `panels.onMessage`). The
   * host's guard never sees these, so `permission` documents intent only.
   */
  readonly local?: boolean;
  readonly fake?: FakeReturn;
  /** `EXTENSION_API_VERSION` that first shipped the method. Defaults to the namespace's. */
  readonly since?: string;
}

/**
 * An RPC method the host serves under this namespace that is not itself a
 * member of the typed interface - the wire half of a typed method
 * (`storage.dbQuery` behind `IExtensionDatabase.query`, `ui.dispose` behind
 * every `DisposableHandle`). The guard enforces these exactly like typed
 * methods; a host that registers a method declared nowhere is refused.
 */
export interface WireMethodDeclaration {
  readonly permission: MethodGate;
  /** Which typed method this serves, for the reader. */
  readonly serves: string;
}

/** One entry per member of `TApi` - a missing or misspelt method is a type error. */
export type MethodTable<TApi> = {
  readonly [K in keyof TApi & string]-?: MethodDeclaration;
};

// --- Activation events -----------------------------------------------------

export interface ActivationEventDeclaration {
  /**
   * A bare event (`onReminder`) or a parameterised prefix ending in `:`
   * (`onApp:`, which matches `onApp:<anything non-empty>`).
   */
  readonly event: string;
  /**
   * True once the host has a firing site for it. A declared but unfired
   * event validates, and the host logs a one-time warning for an extension
   * that relies on it (`FIRED_ACTIVATION_EVENTS`).
   */
  readonly fired: boolean;
  readonly description: string;
  readonly since: string;
}

// --- Manifest `contributes` keys ------------------------------------------

/** Handed to a `contributes` key's validator. */
export interface ContributesValidationContext {
  /** The manifest's validated `id`, or undefined if the id itself was invalid. */
  readonly extensionId: string | undefined;
  /** Report a validation error at `path` (JSON-pointer style). */
  error(path: string, code: string, message: string): void;
  /** Report a non-fatal warning at `path`. */
  warn(path: string, code: string, message: string): void;
  /**
   * `foo` -> `ext.<publisher>.<name>.foo`; an id already under
   * `ext.<this extension's id>.` passes through, and anything else reports
   * an error and returns undefined - the rule every contributed id follows.
   */
  qualifyId(path: string, id: unknown): string | undefined;
}

export interface ContributesKeyDeclaration<T = unknown> {
  /** The key under `contributes` (`apps`, `readingPlans`). */
  readonly key: string;
  readonly description: string;
  readonly since: string;
  /** A manifest using this key must also request this permission. */
  readonly requiresPermission?: string;
  /**
   * Validate and normalise the raw value. Report problems through `ctx` and
   * return undefined; the manifest is then rejected. Keep it pure: it is
   * bundled wherever the registry is, including the extension worker's
   * QuickJS guest, so it may use other pure core code but nothing that
   * touches Node, the DOM or the Data layer. Omitted only for the
   * keys the manifest validator has always validated itself (`commands`,
   * `panelTypes`, `configuration`, `apiExports`, `bibleProviders`) - a
   * contract test holds every other key to having one.
   */
  readonly validate?: (value: unknown, path: string, ctx: ContributesValidationContext) => T | undefined;
  /**
   * JSON Schema for the editor authoring aid (`ExtensionManifestSchema.json`
   * is regenerated from these - see the registry sync test). Omitted for the
   * validator-owned keys, whose schema is maintained in the JSON file.
   */
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
}

// --- Event channels --------------------------------------------------------

/**
 * A channel extensions reach through `api.events.subscribe(channel, ...)`,
 * owned by this namespace. Gating happens at dispatch: a subscriber without
 * `permission` is skipped (silence, not an error), so an extension written
 * against a larger grant degrades instead of failing in `activate()`.
 */
export interface EventChannelDeclaration<TPayload = unknown> {
  readonly kind: 'event' | 'filter' | 'provider';
  readonly permission: string | null;
  readonly description: string;
  readonly since: string;
  /** Type-level only: the payload a subscriber receives. Never set at runtime. */
  readonly __payload?: TPayload;
}

/** Declare an event channel with a typed payload. */
export function eventChannel<TPayload = unknown>(
  decl: Omit<EventChannelDeclaration<TPayload>, '__payload'>,
): EventChannelDeclaration<TPayload> {
  return decl;
}

// --- The namespace ---------------------------------------------------------

export interface ApiNamespaceDeclaration<
  N extends string = string,
  TApi = unknown,
  P extends string = string,
  O extends boolean = boolean,
> {
  /** `api.<name>`. */
  readonly name: N;
  readonly description: string;
  /** `EXTENSION_API_VERSION` that first shipped the namespace. */
  readonly since: string;
  /**
   * Typed as optional on `BibleExtensionAPI` (`api.speech?`), so authors
   * must feature-detect. Every namespace added after `0.1.0` should be
   * optional: an extension may run on a host that predates it, or on a host
   * (web) that does not implement it.
   */
  readonly optional: O;
  /**
   * Host-neutral attach policy. `whenGranted`: the host registers the
   * namespace's methods only for an extension holding that permission (and
   * answers `Unknown RPC method` otherwise; the `api.<name>` object still
   * exists in the worker). Omitted: attached whenever the host
   * implements it, with every call gated per method.
   */
  readonly availability?: { readonly whenGranted?: string };
  /** Permissions this namespace introduces. A method may also use another namespace's. */
  readonly permissions: readonly PermissionDeclaration<P>[];
  readonly methods: MethodTable<TApi>;
  readonly wire?: Readonly<Record<string, WireMethodDeclaration>>;
  readonly activationEvents?: readonly ActivationEventDeclaration[];
  readonly contributes?: readonly ContributesKeyDeclaration[];
  readonly events?: Readonly<Record<string, EventChannelDeclaration>>;
  /** Type-level only: the namespace's interface. Never set at runtime. */
  readonly __api?: TApi;
}

/**
 * Declare a namespace. Curried so `TApi` is given explicitly while the name,
 * permission ids and optionality are inferred as literals:
 *
 *     export const notesNamespace = defineApiNamespace<INotesApi>()({
 *       name: 'notes',
 *       ...
 *     });
 */
export function defineApiNamespace<TApi>() {
  return <const N extends string, const P extends string = never, const O extends boolean = false>(
    decl: Omit<ApiNamespaceDeclaration<N, TApi, P, O>, '__api' | 'optional'> & { readonly optional?: O },
  ): ApiNamespaceDeclaration<N, TApi, P, O> => ({
    ...decl,
    optional: (decl.optional ?? false) as O,
  });
}

// --- Type-level derivations -----------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyApiNamespaceDeclaration = ApiNamespaceDeclaration<string, any, string, boolean>;

/** The interface a declaration was declared against. */
export type ApiOfDeclaration<D> = D extends { readonly __api?: infer T } ? T : never;

/**
 * The `api` object an extension receives, built from a list of declarations:
 * required namespaces as required members, optional ones as `?` members.
 */
export type ExtensionApiOf<D extends readonly AnyApiNamespaceDeclaration[]> = {
  [X in D[number] as X['optional'] extends true ? never : X['name']]: ApiOfDeclaration<X>;
} & {
  [X in D[number] as X['optional'] extends true ? X['name'] : never]?: ApiOfDeclaration<X>;
};

/** Union of every permission id the declarations introduce. */
export type PermissionsOf<D extends readonly AnyApiNamespaceDeclaration[]> =
  D[number] extends infer X
    ? X extends ApiNamespaceDeclaration<string, unknown, infer P, boolean>
      ? P
      : never
    : never;

/** Union of every namespace name. */
export type NamespaceNamesOf<D extends readonly AnyApiNamespaceDeclaration[]> = D[number]['name'];
