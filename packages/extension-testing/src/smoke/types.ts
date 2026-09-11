/**
 * Shared types for the smoke-test harness (Work Item 1).
 *
 * A `HookDescriptor` is the unit the harness iterates over when firing
 * smoke inputs at an extension. It comes from two sources:
 *
 *   - **Static**: declared in the extension manifest's `contributes` block
 *     (commands, menus, provider descriptors, etc.).
 *   - **Dynamic**: captured during `activate(api)` when the extension calls
 *     `api.ui.registerVerseHover(...)`, `api.commands.register(...)`, etc.
 *
 * Both sources are normalized to the same shape so later work items
 * (corpora + assertion engine) don't need to care where the hook came from.
 */

import type { Extensions } from '@bible/core';

/**
 * Every hook has a `kind` that tells the harness how to drive it and what
 * corpus to pull inputs from.
 *
 * `event:*` hooks fire an event payload into a captured subscriber.
 * Endpoint-based hooks (`hover`, `decorator`, `command`, providers, etc.)
 * invoke a reverse-RPC endpoint the extension bound with
 * `api.runtime.expose(...)`. `contextMenu` and `statusBar` items do not name
 * an endpoint themselves; they name a *command*, which does — so they are
 * driven through that command's endpoint.
 *
 * `panelType` and `highlightStyle` are the only genuinely declarative kinds:
 * the host mounts an iframe / applies a CSS style, and there is no extension
 * code behind them to call. They are still enumerated so the report accounts
 * for every contribution.
 */
export type HookKind =
  | 'command'
  | 'contextMenu'
  | 'panelType'
  | 'statusBar'
  | 'hover'
  | 'decorator'
  | 'displayMode'
  | 'bibleProvider'
  | 'commentaryProvider'
  | 'dictionaryProvider'
  | 'bookProvider'
  | 'highlightStyle'
  | 'event';

/**
 * Where the hook descriptor originated. Callers use this to filter — e.g.
 * a CI mode may only want to smoke the dynamic registrations, since those
 * are the ones that can crash at runtime.
 */
export type HookSource = 'manifest' | 'runtime';

/**
 * The input shape the harness should feed a hook from its default corpus.
 * Later items map each `inputShape` to a corpus generator.
 */
export type HookInputShape =
  | 'verseId'
  | 'verseRange'
  | 'referenceString'
  | 'dictionaryKey'
  | 'sectionId'
  | 'commandArgs'
  | 'eventPayload'
  | 'none';

/**
 * How the harness reaches a hook — resolved once, at enumeration time, so the
 * invoker never has to re-derive "what would the host actually call here?".
 *
 * The four cases exist because they carry four different verdicts, and
 * collapsing any two of them is how a smoke run ends up lying:
 *
 *   - `event`       — fire the captured subscribers. Pass/fail on what they do.
 *   - `endpoint`    — call the reverse-RPC endpoint. Pass/fail on what the
 *                     handler does; a *missing* binding is decided by the
 *                     invoker, since only it can see the endpoint table.
 *   - `broken`      — the author declared something whose wiring is provably
 *                     absent from the manifest and the activation record: a
 *                     command with no `handlerEndpoint`, or a menu item
 *                     pointing at a command that does not exist. Always a
 *                     failure. This is the platform's most common extension
 *                     bug — the item shows up in the UI and does nothing — and
 *                     it is silent in production, so the smoke run is the only
 *                     place it can be caught.
 *   - `declarative` — there is no extension code behind the contribution at
 *                     all. The only case that earns a `skip`.
 */
export type HookTarget =
  /** Fire every subscriber captured for this event channel. */
  | { via: 'event'; channel: string }
  /**
   * Call `endpoint` on the extension's reverse-RPC table.
   * `commandId` is set when the hook reached the endpoint indirectly (a
   * context-menu or status-bar item naming a command), so a failure message
   * can name the whole chain rather than just the endpoint.
   */
  | { via: 'endpoint'; endpoint: string; commandId?: string }
  /** Declared, but unreachable by construction. Always a failure. */
  | { via: 'broken'; reason: string }
  /** Nothing to invoke, by design. The only legitimate skip. */
  | { via: 'declarative'; reason: string };

export interface HookDescriptor {
  /**
   * Stable identifier inside the harness run. Format:
   * `${kind}:${extensionRelativeId}`. Used as the lookup key for
   * `invokeHook()` and as the row label in the final report.
   */
  hookId: string;
  kind: HookKind;
  source: HookSource;
  /** The identifier the extension assigned (command id, provider id, event key). */
  localId: string;
  /** Canonical input shape the default corpus should target. */
  inputShape: HookInputShape;
  /**
   * For endpoint-based hooks, the reverse-RPC endpoint name the host would
   * dispatch to. Undefined for event hooks and pure-static contributions.
   * Prefer `target` for dispatch decisions; this stays for callers that only
   * want to read the endpoint name off a descriptor.
   */
  endpoint?: string;
  /**
   * What the harness should actually do to run this hook. Always present.
   */
  target: HookTarget;
  /**
   * The raw descriptor or registration object the hook came from. Exposed so
   * later work items (DTO validators, reporters) can inspect capabilities,
   * permissions, etc. without re-enumerating.
   */
  raw: unknown;
}

/**
 * The outcome of one invocation attempt.
 *
 * `unbound-endpoint` and `not-invokable` look similar and mean opposite
 * things, which is why they are separate statuses rather than one status with
 * a reason string:
 *
 *   - `unbound-endpoint` — the hook *should* have been callable and was not.
 *     Nothing bound the endpoint the contribution names, so in the app the
 *     command sits in the palette (or the menu item in the context menu) and
 *     does nothing when clicked. `runSmokeSuite` reports it as a **failure**.
 *   - `not-invokable` — the hook has no invocation semantics to begin with,
 *     or the harness genuinely cannot drive it in this mode. Reported as a
 *     **skip**, with `reason` saying which.
 */
export type HookInvocationStatus =
  | 'ok'
  | 'threw'
  | 'timeout'
  | 'unbound-endpoint'
  | 'not-invokable';

export interface HookInvocationResult {
  hookId: string;
  status: HookInvocationStatus;
  /** Wall-clock ms the invocation took. 0 when nothing ran. */
  durationMs: number;
  /** The value the hook returned (events resolve with `undefined`). */
  value?: unknown;
  /** Populated when `status === 'threw'` or `'timeout'`. */
  error?: { message: string; stack?: string };
  /**
   * Populated when `status === 'not-invokable'` or `'unbound-endpoint'`.
   * Names what was missing, precisely enough to fix — e.g. which endpoint was
   * expected, which command pointed at it, and what the extension did bind.
   */
  reason?: string;
}

/**
 * What the harness captures while the extension runs `activate(api)`.
 * Later work items layer the assertion engine on top of this.
 */
export interface CapturedRegistrations {
  commands: Extensions.ExtensionCommandRegistration[];
  panelTypes: Extensions.ExtensionPanelTypeDef[];
  verseHovers: Extensions.VerseHoverProviderDescriptor[];
  verseDecorators: Extensions.VerseDecoratorDescriptor[];
  contextMenus: Array<{
    target: Extensions.ContextMenuTarget;
    item: Extensions.ContextMenuItemDescriptor;
  }>;
  displayModes: Extensions.DisplayModeDescriptor[];
  statusBarItems: Extensions.StatusBarItemDescriptor[];
  highlightStyles: Extensions.HighlightStyleDescriptor[];
  bibleProviders: Extensions.BibleProviderDescriptor[];
  commentaryProviders: Extensions.CommentaryProviderDescriptor[];
  dictionaryProviders: Extensions.DictionaryProviderDescriptor[];
  bookProviders: Extensions.BookProviderDescriptor[];
  /**
   * Event subscriptions the extension set up during activate. Keyed by the
   * canonical event path (e.g. `bible.onDidChangeActiveVerse`). A single
   * event may have multiple subscribers; the harness fans the invocation
   * out to every registered handler.
   */
  eventSubscribers: Map<string, Array<(payload: unknown) => unknown | Promise<unknown>>>;
}
