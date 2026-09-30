/**
 * Payload and return type maps for every host-emitted extension point.
 *
 * Each extension point has:
 *
 *   - a stable string ID (`ExtensionPointId` in `ExtensionApiTypes.ts`)
 *   - a payload type the host passes to subscribers
 *   - a return type a subscriber may return
 *   - a kind: `event` | `filter` | `provider`
 *
 * **Event** hooks: fire-and-forget. Subscribers run in parallel; the host
 * does not await them. A throwing subscriber is logged and skipped.
 *
 * **Filter** hooks: the host calls every subscriber sequentially
 * (`EXTENSION_POINT_CANCELABLE` members return `'continue' | 'cancel'` and
 * short-circuit on the first `'cancel'`; the rest transform the payload -
 * any non-`undefined` return becomes the new payload for the next
 * subscriber). A `FILTER_PER_SUBSCRIBER_TIMEOUT_MS` timeout per subscriber
 * and a `FILTER_TOTAL_BUDGET_MS` wall-clock budget across the whole waterfall
 * prevent one slow or hung subscriber from blocking the pipeline; a
 * subscriber that throws or times out is skipped (never treated as
 * `'cancel'` - hooks fail open) and the waterfall continues with the
 * previous value.
 *
 * **Provider** hooks: the host calls every subscriber in parallel (each
 * individually time-boxed to `PROVIDER_PER_SUBSCRIBER_TIMEOUT_MS`, so the
 * worst case is one timeout, not N in series) and concatenates the arrays
 * they return, in `(order, extensionId)` order, up to `PROVIDER_MAX_ITEMS`.
 *
 * This is the single vocabulary and dispatcher for both what used to be two
 * systems: the `onDid*` properties (removed, see `ExtensionApiTypes.ts`) and
 * this file's own union, which had zero call sites before task 0024 round 3.
 * See `apps/desktop/electron/extensions/ExtensionHostLifecycle.ts`'s
 * `dispatchExtensionPoint` for the dispatch algorithm these tables drive.
 */

import type { ExtensionPointId } from './ExtensionApiTypes';
import type { ExtensionPermission } from './Permissions';
import type {
  CrossReferenceDto,
  PanelInfoDto,
  SearchQueryDto,
  VerseWordSelection,
} from './ExtensionApiDtos';

// --- Kind classification ---------------------------------------------------

export type ExtensionPointKind = 'event' | 'filter' | 'provider';

/**
 * Authoritative kind for every extension point. Used by the host's dispatch
 * pipeline to choose between fire-and-forget event delivery, sequential
 * filter execution, and parallel provider collection.
 */
export const EXTENSION_POINT_KINDS: Record<ExtensionPointId, ExtensionPointKind> = {
  // Verse
  'verse.activeChanged': 'event',
  'verse.wordSelected': 'event',

  // Notes / highlights
  'notes.changed': 'event',
  'notes.beforeDelete': 'filter',
  'highlights.afterChange': 'event',

  // Search
  'search.beforeQuery': 'filter',

  // Cross references
  'crossReferences.requested': 'provider',

  // Workspace
  'panel.opened': 'event',
  'panel.closed': 'event',
  'panel.focused': 'event',

  // Host lifecycle
  'settings.changed': 'event',
  'locale.changed': 'event',
  'extension.activated': 'event',
  'extension.deactivated': 'event',
};

/**
 * Channels whose value is state, not a stream: a subscriber that arrives
 * after the last change is replayed the current value immediately, rather
 * than waiting for the next one. Opt-in per channel - replaying
 * `panel.closed` or `notes.changed` would be meaningless or actively wrong,
 * but the active verse is state a handler registered during `activate()`
 * must still learn even though it missed the last navigation.
 *
 * A channel listed here with no registered replay source is a startup
 * assertion failure in `ExtensionPointWiring.ts` - the kind of drift
 * `ApiSurfaceContract.test.ts` exists to catch before it ships.
 */
export const EXTENSION_POINT_REPLAY: ReadonlySet<ExtensionPointId> = new Set([
  'verse.activeChanged',
]);

/**
 * Filter channels whose return type is `'continue' | 'cancel'` rather than a
 * replacement payload. The dispatcher short-circuits on the first
 * `'cancel'`; a throw or timeout is never treated as `'cancel'` (fail open).
 */
export const EXTENSION_POINT_CANCELABLE: ReadonlySet<ExtensionPointId> = new Set([
  'notes.beforeDelete',
]);

/**
 * Permission required to subscribe to a channel, checked at dispatch time
 * (not at subscribe time - see `dispatchExtensionPoint`'s `subscribers()`
 * filter). A channel absent from this table requires no permission.
 *
 * Gating at dispatch rather than at subscribe means a grant that changes
 * later (`permissions.changed` is a real, if unlikely, event) takes effect
 * immediately, and an extension written against a superset of permissions
 * degrades to silence on the gated channels rather than a hard failure in
 * `activate()`.
 *
 * Reuses the same permission that already gates the underlying data, so an
 * extension does not need a second grant to hear about data it can already
 * read: `notes:read` already gates `api.notes.list`/`get`, and
 * `highlights:read` already gates `api.highlights.list`.
 */
export const EXTENSION_POINT_PERMISSIONS: Partial<
  Record<ExtensionPointId, ExtensionPermission>
> = {
  'notes.changed': 'notes:read',
  'notes.beforeDelete': 'notes:read',
  'highlights.afterChange': 'highlights:read',
};

// --- Timing constants --------------------------------------------------

/** Per-subscriber timeout for a `filter` channel's reverse RPC request. */
export const FILTER_PER_SUBSCRIBER_TIMEOUT_MS = 2000;

/**
 * Wall-clock budget for an entire filter waterfall, across every subscriber.
 * Once exhausted, remaining subscribers are skipped (logged) and the
 * dispatcher returns the last good value - a single very-long waterfall
 * cannot compound into an unbounded wait even though each subscriber is
 * individually time-boxed.
 */
export const FILTER_TOTAL_BUDGET_MS = 5000;

/** Per-subscriber timeout for a `provider` channel's reverse RPC request. */
export const PROVIDER_PER_SUBSCRIBER_TIMEOUT_MS = 2000;

/** Hard cap on the number of items a `provider` dispatch returns. */
export const PROVIDER_MAX_ITEMS = 200;

/**
 * Per-channel override of `FILTER_PER_SUBSCRIBER_TIMEOUT_MS` /
 * `PROVIDER_PER_SUBSCRIBER_TIMEOUT_MS`. `search.beforeQuery` is
 * latency-visible - a user waiting on a search result feels a 2-second
 * extension stall as a host bug - so it gets a tighter budget than the
 * uniform default.
 */
export const EXTENSION_POINT_TIMEOUT_MS_OVERRIDE: Partial<
  Record<ExtensionPointId, number>
> = {
  'search.beforeQuery': 500,
};

// --- Payload types ---------------------------------------------------------

export interface ExtensionPointPayloadMap {
  // Verse
  /**
   * The user's active verse changed. `null` when nothing is active (e.g. no
   * Bible pane open). Corrected from the never-implemented speculative
   * shape `{ verseId: number; source: string }` (nothing in the host ever
   * produced `source`) to `{ verseId; module }`, which matches what
   * `BibleBridge.subscribeActiveVerse` actually sends - `module` is data an
   * extension genuinely needs (which translation the verse belongs to).
   */
  'verse.activeChanged': { verseId: number; module: string } | null;
  'verse.wordSelected': VerseWordSelection;

  // Notes / highlights
  /**
   * Unified create/update/delete notification - the shape the notes bridge
   * already produces. Replaces the old system's separate "notes changed"
   * property on `api.notes`; there is no `notes.afterSave`/`notes.afterDelete`
   * split because that would mean splitting the bridge's single change
   * notification apart for no behavioural gain.
   */
  'notes.changed': { id: string; type: 'created' | 'updated' | 'deleted' };
  /**
   * Fired before a note is deleted. Payload corrected from the speculative
   * `{ noteId: string }` to `{ noteId: number }` - `notesHandlers.ts`'s
   * `notes:delete` IPC handler proves note ids are numbers.
   */
  'notes.beforeDelete': { noteId: number };
  'highlights.afterChange': { verseId: number };

  // Search
  'search.beforeQuery': { query: SearchQueryDto; scope?: string };

  // Cross references
  'crossReferences.requested': { verseId: number };

  // Workspace
  /**
   * Widened from the speculative narrow inline shapes
   * (`{ panelId, contentType }` / `{ panelId }`) to the full `PanelInfoDto`
   * the host already has in hand when a panel opens or gains focus -
   * dropping fields to satisfy a speculative type helped no one.
   */
  'panel.opened': PanelInfoDto;
  'panel.closed': { panelId: string; contentType: string };
  /**
   * `null` when no panel is focused (matches the bridge's
   * `subscribeActivePanel(handler: (panel: PanelInfoDto | null) => void)`).
   */
  'panel.focused': PanelInfoDto | null;

  // Host lifecycle
  'settings.changed': { keys: string[] };
  /**
   * The wrapper object (rather than a bare string) is the one place the
   * speculative type was the better design: an object can gain a field
   * later, a bare string cannot. `l10nApiImpl` wraps the bridge's bare
   * locale string on emit.
   */
  'locale.changed': { locale: string };
  'extension.activated': { extensionId: string };
  'extension.deactivated': { extensionId: string };
}

// --- Return types ----------------------------------------------------------

/**
 * Return type a subscriber may return for each extension point.
 *
 * - For `event` points the value is `void` - the host ignores anything the
 *   subscriber returns.
 * - For `filter` points the value is `'continue' | 'cancel'` (cancelable
 *   channels, `EXTENSION_POINT_CANCELABLE`) or the new payload / `undefined`
 *   to pass through unchanged (transform channels).
 * - For `provider` points the value is an array of contributed entries (the
 *   host concatenates every subscriber's array into one).
 */
export interface ExtensionPointReturnMap {
  // Verse
  'verse.activeChanged': void;
  'verse.wordSelected': void;

  // Notes / highlights
  'notes.changed': void;
  'notes.beforeDelete': 'continue' | 'cancel';
  'highlights.afterChange': void;

  // Search
  'search.beforeQuery': SearchQueryDto | undefined;

  // Cross references
  'crossReferences.requested': CrossReferenceDto[];

  // Workspace
  'panel.opened': void;
  'panel.closed': void;
  'panel.focused': void;

  // Host lifecycle
  'settings.changed': void;
  'locale.changed': void;
  'extension.activated': void;
  'extension.deactivated': void;
}

// --- Helper types for typed subscribe() ------------------------------------

export type ExtensionPointPayload<K extends ExtensionPointId> =
  ExtensionPointPayloadMap[K];

export type ExtensionPointReturn<K extends ExtensionPointId> =
  ExtensionPointReturnMap[K];
