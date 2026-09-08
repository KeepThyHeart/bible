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
 * invoke a reverse-RPC endpoint. Static-only contributions with no runtime
 * analogue (`panelType`, `contextMenu`, `statusBar`) are still enumerated
 * so later items can assert they parse cleanly.
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
   */
  endpoint?: string;
  /**
   * The raw descriptor or registration object the hook came from. Exposed so
   * later work items (DTO validators, reporters) can inspect capabilities,
   * permissions, etc. without re-enumerating.
   */
  raw: unknown;
}

export type HookInvocationStatus =
  | 'ok'
  | 'threw'
  | 'timeout'
  | 'not-invokable';

export interface HookInvocationResult {
  hookId: string;
  status: HookInvocationStatus;
  /** Wall-clock ms the invocation took. 0 for `not-invokable`. */
  durationMs: number;
  /** The value the hook returned (events resolve with `undefined`). */
  value?: unknown;
  /** Populated when `status === 'threw'` or `'timeout'`. */
  error?: { message: string; stack?: string };
  /**
   * Populated when `status === 'not-invokable'`. Tells the caller why —
   * e.g. `"endpoint-based hooks require --full mode (WorkerProcessInvoker)"`.
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
