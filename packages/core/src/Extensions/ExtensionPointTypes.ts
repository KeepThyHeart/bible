/**
 * Payload and return type maps for every host-emitted extension point.
 *
 * Spec A section "Extension Points (full list)". Each extension point has:
 *
 *   - a stable string ID (`ExtensionPointId` in `ExtensionApiTypes.ts`)
 *   - a payload type the host passes to subscribers
 *   - a return type a subscriber may return
 *   - a kind: `event` | `filter` | `provider`
 *
 * **Filter** hooks: the host calls every subscriber sequentially; if any
 * returns a non-undefined value, that becomes the new payload for the next
 * subscriber. The final value is what the host uses. A 2-second per-subscriber
 * timeout prevents one slow subscriber from blocking the pipeline.
 *
 * **Provider** hooks: the host calls every subscriber in parallel; results
 * are collected into a single array preserving each subscriber's `order` hint.
 *
 * **Event** hooks: fire-and-forget. Subscribers run in parallel; the host
 * does not await them.
 */

import type { ExtensionPointId } from './ExtensionApiTypes';
import type {
  BookSectionDto,
  CommentaryEntryDto,
  ContextMenuItemDto,
  CrossReferenceDto,
  DecorationDto,
  DictionaryEntryDto,
  FormatOverride,
  HoverContentDto,
  RenderOverride,
  SearchQueryDto,
  SearchResultsDto,
  SearchSuggestionDto,
  UserNoteDto,
  VerseRange,
  VerseTokenDto,
  VerseWordSelection,
} from './ExtensionApiDtos';

// --- Kind classification ---------------------------------------------------

export type ExtensionPointKind = 'event' | 'filter' | 'provider';

/**
 * Authoritative kind for every extension point. Used by the host's emit
 * pipeline to choose between sequential filter execution, parallel provider
 * collection, and fire-and-forget event delivery.
 */
export const EXTENSION_POINT_KINDS: Record<ExtensionPointId, ExtensionPointKind> = {
  // Verse rendering and interaction
  'verse.beforeRender': 'filter',
  'verse.afterRender': 'event',
  'verse.hover': 'provider',
  'verse.contextMenu': 'provider',
  'verse.word.contextMenu': 'provider',
  'verse.decorate': 'provider',
  'verse.activeChanged': 'event',
  'verse.wordSelected': 'event',
  'verse.beforeFormat': 'filter',

  // Content modules
  'commentary.providerRegistered': 'event',
  'commentary.beforeShow': 'filter',
  'commentary.similarRequested': 'provider',
  'dictionary.lookupRequested': 'provider',
  'dictionary.beforeShow': 'filter',
  'book.beforeShow': 'filter',
  'crossReferences.requested': 'provider',

  // Notes / highlights / bookmarks
  'notes.beforeSave': 'filter',
  'notes.afterSave': 'event',
  'notes.beforeDelete': 'filter',
  'highlights.afterChange': 'event',
  'bookmarks.afterAdd': 'event',

  // Search
  'search.beforeQuery': 'filter',
  'search.afterResults': 'filter',
  'search.suggestionsRequested': 'provider',

  // Workspace and lifecycle
  'panel.opened': 'event',
  'panel.closed': 'event',
  'panel.focused': 'event',
  'layout.presetApplied': 'event',
  'bible.referenceParsed': 'event',
  'command.beforeExecute': 'filter',
  'app.ready': 'event',
  'session.restored': 'event',
  'theme.changed': 'event',
  'locale.changed': 'event',
  'settings.changed': 'event',
  'permissions.changed': 'event',

  // Modules and extensions
  'module.installed': 'event',
  'module.updated': 'event',
  'module.removed': 'event',
  'extension.activated': 'event',
  'extension.deactivated': 'event',
};

// --- Payload types ---------------------------------------------------------

export interface ExtensionPointPayloadMap {
  // Verse rendering and interaction
  'verse.beforeRender': { verseId: number; displayMode: string };
  'verse.afterRender': { verseId: number };
  'verse.hover': {
    verseId: number;
    range?: VerseRange;
    modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  };
  'verse.contextMenu': { verseId: number; selection?: VerseRange };
  'verse.word.contextMenu': {
    verseId: number;
    range: VerseRange;
    token?: VerseTokenDto;
  };
  'verse.decorate': { verseId: number };
  'verse.activeChanged': { verseId: number; source: string };
  'verse.wordSelected': VerseWordSelection;
  'verse.beforeFormat': { verseId: number; format: string; mode: string };

  // Content modules
  'commentary.providerRegistered': { moduleId: string };
  'commentary.beforeShow': { entry: CommentaryEntryDto };
  'commentary.similarRequested': { entryId: string; snippet: string };
  'dictionary.lookupRequested': { key: string; sourceModule?: string };
  'dictionary.beforeShow': { entry: DictionaryEntryDto };
  'book.beforeShow': { section: BookSectionDto };
  'crossReferences.requested': { verseId: number };

  // Notes / highlights / bookmarks
  'notes.beforeSave': { note: UserNoteDto };
  'notes.afterSave': { note: UserNoteDto };
  'notes.beforeDelete': { noteId: string };
  'highlights.afterChange': { verseId: number };
  'bookmarks.afterAdd': { bookmark: { id: string; verseId: number } };

  // Search
  'search.beforeQuery': { query: SearchQueryDto; scope?: string };
  'search.afterResults': { query: SearchQueryDto; results: SearchResultsDto };
  'search.suggestionsRequested': { partial: string };

  // Workspace and lifecycle
  'panel.opened': { panelId: string; contentType: string };
  'panel.closed': { panelId: string; contentType: string };
  'panel.focused': { panelId: string };
  'layout.presetApplied': { presetId: string };
  'bible.referenceParsed': { input: string; result: unknown };
  'command.beforeExecute': { id: string; args?: unknown };
  'app.ready': void;
  'session.restored': { sessionId: string };
  'theme.changed': { theme: string };
  'locale.changed': { locale: string };
  'settings.changed': { keys: string[] };
  'permissions.changed': { granted: string[]; revoked: string[] };

  // Modules and extensions
  'module.installed': { moduleId: string; type: string; version: string };
  'module.updated': {
    moduleId: string;
    type: string;
    oldVersion: string;
    newVersion: string;
  };
  'module.removed': { moduleId: string; type: string };
  'extension.activated': { extensionId: string };
  'extension.deactivated': { extensionId: string };
}

// --- Return types ----------------------------------------------------------

/**
 * Return type a subscriber may return for each extension point.
 *
 * - For `event` points the value is `void` - the host ignores anything the
 *   subscriber returns.
 * - For `filter` points the value is the new payload (or `undefined` to
 *   pass through unchanged).
 * - For `provider` points the value is the contributed entry (the host
 *   collects every subscriber's contribution into a single array).
 */
export interface ExtensionPointReturnMap {
  // Verse
  'verse.beforeRender': RenderOverride | undefined;
  'verse.afterRender': void;
  'verse.hover': HoverContentDto[];
  'verse.contextMenu': ContextMenuItemDto[];
  'verse.word.contextMenu': ContextMenuItemDto[];
  'verse.decorate': DecorationDto[];
  'verse.activeChanged': void;
  'verse.wordSelected': void;
  'verse.beforeFormat': FormatOverride | undefined;

  // Content modules
  'commentary.providerRegistered': void;
  'commentary.beforeShow': CommentaryEntryDto | undefined;
  'commentary.similarRequested': CommentaryEntryDto[];
  'dictionary.lookupRequested': DictionaryEntryDto[];
  'dictionary.beforeShow': DictionaryEntryDto | undefined;
  'book.beforeShow': BookSectionDto | undefined;
  'crossReferences.requested': CrossReferenceDto[];

  // Notes / highlights / bookmarks
  'notes.beforeSave': UserNoteDto | undefined;
  'notes.afterSave': void;
  'notes.beforeDelete': 'continue' | 'cancel';
  'highlights.afterChange': void;
  'bookmarks.afterAdd': void;

  // Search
  'search.beforeQuery': SearchQueryDto | undefined;
  'search.afterResults': SearchResultsDto | undefined;
  'search.suggestionsRequested': SearchSuggestionDto[];

  // Workspace and lifecycle
  'panel.opened': void;
  'panel.closed': void;
  'panel.focused': void;
  'layout.presetApplied': void;
  'bible.referenceParsed': void;
  'command.beforeExecute': 'continue' | 'cancel';
  'app.ready': void;
  'session.restored': void;
  'theme.changed': void;
  'locale.changed': void;
  'settings.changed': void;
  'permissions.changed': void;

  // Modules and extensions
  'module.installed': void;
  'module.updated': void;
  'module.removed': void;
  'extension.activated': void;
  'extension.deactivated': void;
}

// --- Helper types for typed subscribe() ------------------------------------

export type ExtensionPointPayload<K extends ExtensionPointId> =
  ExtensionPointPayloadMap[K];

export type ExtensionPointReturn<K extends ExtensionPointId> =
  ExtensionPointReturnMap[K];
