/**
 * Normalize an extension's contributions into a flat `HookDescriptor[]`.
 *
 * Combines two sources:
 *   - Static `contributes` from the manifest (commands, menus, providers,
 *     panelTypes, displayModes).
 *   - Dynamic registrations captured by the recording mock API while the
 *     extension's `activate(api)` runs.
 *
 * Duplicate static + runtime entries for the same id are merged so the
 * harness doesn't smoke the same hook twice. Runtime wins when both exist
 * because runtime descriptors carry the most information (endpoint names,
 * capabilities already resolved).
 */

import type { Extensions } from '@bible/core';
import type {
  CapturedRegistrations,
  HookDescriptor,
  HookKind,
} from './types';

export const INPUT_SHAPE_BY_KIND: Record<HookKind, HookDescriptor['inputShape']> = {
  command: 'commandArgs',
  contextMenu: 'commandArgs',
  panelType: 'none',
  statusBar: 'none',
  hover: 'verseId',
  decorator: 'verseRange',
  displayMode: 'verseRange',
  bibleProvider: 'verseId',
  commentaryProvider: 'verseId',
  dictionaryProvider: 'dictionaryKey',
  bookProvider: 'sectionId',
  highlightStyle: 'none',
  event: 'eventPayload',
};

function hookId(kind: HookKind, localId: string): string {
  return `${kind}:${localId}`;
}

export interface EnumerateOptions {
  manifest: Extensions.ExtensionManifest;
  /** Optional — when undefined the enumeration lists static contributions only. */
  captured?: CapturedRegistrations;
}

export function enumerateHooks(opts: EnumerateOptions): HookDescriptor[] {
  const { manifest, captured } = opts;
  const out = new Map<string, HookDescriptor>();

  const addHook = (
    kind: HookKind,
    localId: string,
    source: HookDescriptor['source'],
    raw: unknown,
    endpoint?: string,
  ): void => {
    const id = hookId(kind, localId);
    const existing = out.get(id);
    if (existing && source === 'manifest') return;
    out.set(id, {
      hookId: id,
      kind,
      source,
      localId,
      inputShape: INPUT_SHAPE_BY_KIND[kind],
      ...(endpoint !== undefined ? { endpoint } : {}),
      raw,
    });
  };

  // ── Static: manifest.contributes ───────────────────────────────────────
  const contrib = manifest.contributes ?? {};
  for (const cmd of contrib.commands ?? []) {
    addHook('command', cmd.id, 'manifest', cmd, cmd.handlerEndpoint);
  }
  for (const panel of contrib.panelTypes ?? []) {
    addHook('panelType', panel.id, 'manifest', panel);
  }
  if (contrib.menus) {
    for (const [target, items] of Object.entries(contrib.menus)) {
      for (const item of items) {
        const id = item.id ?? `${target}:${item.command}`;
        addHook('contextMenu', id, 'manifest', { target, item });
      }
    }
  }
  for (const mode of contrib.displayModes ?? []) {
    addHook('displayMode', mode.id, 'manifest', mode, mode.renderEndpoint);
  }
  for (const p of contrib.commentaryProviders ?? []) {
    addHook('commentaryProvider', p.id, 'manifest', p, p.fetchEndpoint);
  }
  for (const p of contrib.dictionaryProviders ?? []) {
    addHook('dictionaryProvider', p.id, 'manifest', p, p.fetchEndpoint);
  }
  for (const p of contrib.bookProviders ?? []) {
    addHook('bookProvider', p.id, 'manifest', p, p.fetchEndpoint);
  }

  // ── Runtime: captured from activate() ──────────────────────────────────
  if (captured) {
    for (const cmd of captured.commands) {
      addHook('command', cmd.id, 'runtime', cmd, cmd.handlerEndpoint);
    }
    for (const panel of captured.panelTypes) {
      addHook('panelType', panel.id, 'runtime', panel);
    }
    for (const h of captured.verseHovers) {
      addHook('hover', h.id, 'runtime', h, h.hoverEndpoint);
    }
    for (const d of captured.verseDecorators) {
      addHook('decorator', d.id, 'runtime', d, d.decorateEndpoint);
    }
    for (const m of captured.contextMenus) {
      addHook('contextMenu', `${m.target}:${m.item.id}`, 'runtime', m);
    }
    for (const mode of captured.displayModes) {
      addHook('displayMode', mode.id, 'runtime', mode, mode.renderEndpoint);
    }
    for (const item of captured.statusBarItems) {
      addHook('statusBar', item.id, 'runtime', item);
    }
    for (const style of captured.highlightStyles) {
      addHook('highlightStyle', style.id, 'runtime', style);
    }
    for (const p of captured.bibleProviders) {
      addHook('bibleProvider', p.id, 'runtime', p, p.fetchEndpoint);
    }
    for (const p of captured.commentaryProviders) {
      addHook('commentaryProvider', p.id, 'runtime', p, p.fetchEndpoint);
    }
    for (const p of captured.dictionaryProviders) {
      addHook('dictionaryProvider', p.id, 'runtime', p, p.fetchEndpoint);
    }
    for (const p of captured.bookProviders) {
      addHook('bookProvider', p.id, 'runtime', p, p.fetchEndpoint);
    }
    for (const [eventKey] of captured.eventSubscribers) {
      addHook('event', eventKey, 'runtime', { eventKey });
    }
  }

  return [...out.values()];
}
