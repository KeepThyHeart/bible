/**
 * Build a recording wrapper around `createMockApi()` that captures every
 * registration an extension performs during `activate(api)`.
 *
 * The wrapper preserves the semantics of the underlying mock (methods still
 * resolve with sensible defaults) and piggy-backs a capture step so the
 * smoke harness can enumerate what got registered without the extension
 * needing any test-specific code paths.
 *
 * Only the methods relevant to hook enumeration are wrapped. Everything
 * else falls through to the plain mock.
 */

import type { Extensions } from '@bible/core';
import { createMockApi, type MockApiOverrides } from '../createMockApi';
import type { CapturedRegistrations } from './types';

type BibleExtensionAPI = Extensions.BibleExtensionAPI;
type DisposableHandle = Extensions.DisposableHandle;

export interface RecordingApi {
  api: BibleExtensionAPI;
  captured: CapturedRegistrations;
}

function makeDisposable(): DisposableHandle {
  return { dispose: () => Promise.resolve() };
}

export function createRecordingApi(overrides?: MockApiOverrides): RecordingApi {
  const api = createMockApi(overrides);
  const captured: CapturedRegistrations = {
    commands: [],
    panelTypes: [],
    verseHovers: [],
    verseDecorators: [],
    contextMenus: [],
    statusBarItems: [],
    highlightStyles: [],
    bibleProviders: [],
    commentaryProviders: [],
    dictionaryProviders: [],
    bookProviders: [],
    eventSubscribers: new Map(),
  };

  // ── commands.register ──────────────────────────────────────────────────
  api.commands.register = async (
    cmd: Extensions.ExtensionCommandRegistration,
  ): Promise<DisposableHandle> => {
    captured.commands.push(cmd);
    return makeDisposable();
  };

  // ── ui.* ───────────────────────────────────────────────────────────────
  api.ui.registerPanelType = async (
    def: Extensions.ExtensionPanelTypeDef,
  ): Promise<DisposableHandle> => {
    captured.panelTypes.push(def);
    return makeDisposable();
  };
  api.ui.registerVerseHover = async (
    h: Extensions.VerseHoverProviderDescriptor,
  ): Promise<DisposableHandle> => {
    captured.verseHovers.push(h);
    return makeDisposable();
  };
  api.ui.registerVerseDecorator = async (
    d: Extensions.VerseDecoratorDescriptor,
  ): Promise<DisposableHandle> => {
    captured.verseDecorators.push(d);
    return makeDisposable();
  };
  api.ui.registerContextMenu = async (
    target: Extensions.ContextMenuTarget,
    item: Extensions.ContextMenuItemDescriptor,
  ): Promise<DisposableHandle> => {
    captured.contextMenus.push({ target, item });
    return makeDisposable();
  };
  api.ui.registerStatusBarItem = async (
    item: Extensions.StatusBarItemDescriptor,
  ): Promise<DisposableHandle> => {
    captured.statusBarItems.push(item);
    return makeDisposable();
  };

  // ── Provider registrations ─────────────────────────────────────────────
  api.bible.registerProvider = async (
    p: Extensions.BibleProviderDescriptor,
  ): Promise<DisposableHandle> => {
    captured.bibleProviders.push(p);
    return makeDisposable();
  };
  api.commentary.registerProvider = async (
    p: Extensions.CommentaryProviderDescriptor,
  ): Promise<DisposableHandle> => {
    captured.commentaryProviders.push(p);
    return makeDisposable();
  };
  api.dictionary.registerProvider = async (
    p: Extensions.DictionaryProviderDescriptor,
  ): Promise<DisposableHandle> => {
    captured.dictionaryProviders.push(p);
    return makeDisposable();
  };
  api.book.registerProvider = async (
    p: Extensions.BookProviderDescriptor,
  ): Promise<DisposableHandle> => {
    captured.bookProviders.push(p);
    return makeDisposable();
  };
  api.highlights.registerStyle = async (
    s: Extensions.HighlightStyleDescriptor,
  ): Promise<DisposableHandle> => {
    captured.highlightStyles.push(s);
    return makeDisposable();
  };

  // ── events.subscribe ────────────────────────────────────────────────────
  // Task 0024 round 3 unified every `onDid*` property and the dead
  // `ExtensionPointId` vocabulary into this one method - a per-namespace
  // `EVENT_PATHS` table is no longer needed; `captured.eventSubscribers` is
  // now keyed directly by the channel string an extension passes
  // (`'verse.activeChanged'`, `'notes.changed'`, `'ext.<id>.foo'`, ...).
  api.events.subscribe = (async (
    channel: string,
    handler: (payload: unknown) => unknown | Promise<unknown>,
  ): Promise<DisposableHandle> => {
    const list = captured.eventSubscribers.get(channel) ?? [];
    list.push(handler);
    captured.eventSubscribers.set(channel, list);
    return makeDisposable();
  }) as Extensions.IEventsApi['subscribe'];

  return { api, captured };
}
