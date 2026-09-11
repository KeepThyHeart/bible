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
 *
 * ── Id qualification, and why merging needs it ──────────────────────────────
 * The manifest validator rewrites every contribution id to `ext.<publisher>.
 * <name>.<id>` (see `normalizeId` in `ExtensionManifestValidator.ts`), while
 * an imperative `api.ui.registerPanelType({ id: 'panel' })` records whatever
 * the author passed. The same panel therefore arrives here under two names,
 * and the harness used to report both — telling an author they had registered
 * two panels when they had registered one. So ids from the runtime side are
 * put through the same qualification before they are used as a merge key.
 *
 * ── Invocation targets ──────────────────────────────────────────────────────
 * Each descriptor also carries a `target`, resolved here rather than in the
 * invoker because this is the only place that can see both sources at once.
 * A context-menu item names a *command*, not an endpoint; resolving that link
 * needs the command index, which is built from the manifest and the
 * activation record together. See `HookTarget` for what each case means.
 */

import type { Extensions } from '@bible/core';
import type {
  CapturedRegistrations,
  HookDescriptor,
  HookKind,
  HookTarget,
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

/**
 * Kinds whose ids the manifest validator qualifies, and which can therefore
 * arrive from both sources under two spellings of the same id.
 *
 * Deliberately not every kind: context-menu ids are already scoped by their
 * target, and hovers, decorators, status-bar items and highlight styles have
 * no manifest counterpart to collide with, so qualifying them would only
 * rewrite the label an author sees in the report for no gain.
 */
const QUALIFIED_ID_KINDS: ReadonlySet<HookKind> = new Set<HookKind>([
  'command',
  'panelType',
  'displayMode',
  'bibleProvider',
  'commentaryProvider',
  'dictionaryProvider',
  'bookProvider',
]);

function hookId(kind: HookKind, localId: string): string {
  return `${kind}:${localId}`;
}

/**
 * Mirror of the manifest validator's `normalizeId`: an unprefixed id is
 * qualified with `ext.<publisher>.<name>.`, an already-prefixed one is left
 * alone. Kept as a local copy rather than exported from core because the
 * validator's version also reports validation errors, which is not wanted
 * here — a foreign prefix is the manifest's problem, and this pass only needs
 * a stable merge key.
 */
function qualifyId(extensionId: string, rawId: string): string {
  if (rawId.startsWith('ext.')) return rawId;
  const bare = extensionId.startsWith('ext.') ? extensionId.slice(4) : extensionId;
  if (bare.length === 0) return rawId;
  return `ext.${bare}.${rawId}`;
}

/** What a command id resolves to, for the hooks that reach one indirectly. */
interface CommandLink {
  id: string;
  handlerEndpoint?: string;
}

export interface EnumerateOptions {
  manifest: Extensions.ExtensionManifest;
  /** Optional — when undefined the enumeration lists static contributions only. */
  captured?: CapturedRegistrations;
}

export function enumerateHooks(opts: EnumerateOptions): HookDescriptor[] {
  const { manifest, captured } = opts;
  const out = new Map<string, HookDescriptor>();
  const commands = buildCommandIndex(manifest, captured);

  const addHook = (
    kind: HookKind,
    rawLocalId: string,
    source: HookDescriptor['source'],
    raw: unknown,
    target: HookTarget,
  ): void => {
    const localId = QUALIFIED_ID_KINDS.has(kind)
      ? qualifyId(manifest.id, rawLocalId)
      : rawLocalId;
    const id = hookId(kind, localId);
    const existing = out.get(id);
    if (existing && source === 'manifest') return;
    out.set(id, {
      hookId: id,
      kind,
      source,
      localId,
      inputShape: INPUT_SHAPE_BY_KIND[kind],
      ...(target.via === 'endpoint' ? { endpoint: target.endpoint } : {}),
      target,
      raw,
    });
  };

  // ── Static: manifest.contributes ───────────────────────────────────────
  const contrib = manifest.contributes ?? {};
  for (const cmd of contrib.commands ?? []) {
    addHook('command', cmd.id, 'manifest', cmd, commandTarget(cmd.id, cmd.handlerEndpoint));
  }
  for (const panel of contrib.panelTypes ?? []) {
    addHook('panelType', panel.id, 'manifest', panel, panelTypeTarget(panel.id));
  }
  if (contrib.menus) {
    for (const [target, items] of Object.entries(contrib.menus)) {
      for (const item of items) {
        // Scope the id by target the same way the runtime branch below does,
        // so a menu item contributed in the manifest and re-registered during
        // activate merges into one hook instead of appearing twice.
        const id = `${target}:${item.id ?? item.command}`;
        addHook(
          'contextMenu',
          id,
          'manifest',
          { target, item },
          viaCommandTarget(commands, item.command, `menu item "${id}"`),
        );
      }
    }
  }
  for (const mode of contrib.displayModes ?? []) {
    addHook(
      'displayMode',
      mode.id,
      'manifest',
      mode,
      endpointTarget(mode.renderEndpoint, `display mode "${mode.id}"`, 'renderEndpoint'),
    );
  }
  for (const p of contrib.commentaryProviders ?? []) {
    addHook(
      'commentaryProvider',
      p.id,
      'manifest',
      p,
      endpointTarget(p.fetchEndpoint, `commentary provider "${p.id}"`, 'fetchEndpoint'),
    );
  }
  for (const p of contrib.dictionaryProviders ?? []) {
    addHook(
      'dictionaryProvider',
      p.id,
      'manifest',
      p,
      endpointTarget(p.fetchEndpoint, `dictionary provider "${p.id}"`, 'fetchEndpoint'),
    );
  }
  for (const p of contrib.bookProviders ?? []) {
    addHook(
      'bookProvider',
      p.id,
      'manifest',
      p,
      endpointTarget(p.fetchEndpoint, `book provider "${p.id}"`, 'fetchEndpoint'),
    );
  }

  // ── Runtime: captured from activate() ──────────────────────────────────
  if (captured) {
    for (const cmd of captured.commands) {
      addHook('command', cmd.id, 'runtime', cmd, commandTarget(cmd.id, cmd.handlerEndpoint));
    }
    for (const panel of captured.panelTypes) {
      addHook('panelType', panel.id, 'runtime', panel, panelTypeTarget(panel.id));
    }
    for (const h of captured.verseHovers) {
      addHook(
        'hover',
        h.id,
        'runtime',
        h,
        endpointTarget(h.hoverEndpoint, `verse hover "${h.id}"`, 'hoverEndpoint'),
      );
    }
    for (const d of captured.verseDecorators) {
      addHook(
        'decorator',
        d.id,
        'runtime',
        d,
        endpointTarget(d.decorateEndpoint, `verse decorator "${d.id}"`, 'decorateEndpoint'),
      );
    }
    for (const m of captured.contextMenus) {
      const id = `${m.target}:${m.item.id}`;
      addHook(
        'contextMenu',
        id,
        'runtime',
        m,
        viaCommandTarget(commands, m.item.command, `menu item "${id}"`),
      );
    }
    for (const mode of captured.displayModes) {
      addHook(
        'displayMode',
        mode.id,
        'runtime',
        mode,
        endpointTarget(mode.renderEndpoint, `display mode "${mode.id}"`, 'renderEndpoint'),
      );
    }
    for (const item of captured.statusBarItems) {
      addHook('statusBar', item.id, 'runtime', item, statusBarTarget(commands, item));
    }
    for (const style of captured.highlightStyles) {
      addHook('highlightStyle', style.id, 'runtime', style, {
        via: 'declarative',
        reason:
          `Highlight style "${style.id}" is a style definition, not code: the host ` +
          'applies it to a verse range. There is no handler to call.',
      });
    }
    for (const p of captured.bibleProviders) {
      addHook(
        'bibleProvider',
        p.id,
        'runtime',
        p,
        endpointTarget(p.fetchEndpoint, `bible provider "${p.id}"`, 'fetchEndpoint'),
      );
    }
    for (const p of captured.commentaryProviders) {
      addHook(
        'commentaryProvider',
        p.id,
        'runtime',
        p,
        endpointTarget(p.fetchEndpoint, `commentary provider "${p.id}"`, 'fetchEndpoint'),
      );
    }
    for (const p of captured.dictionaryProviders) {
      addHook(
        'dictionaryProvider',
        p.id,
        'runtime',
        p,
        endpointTarget(p.fetchEndpoint, `dictionary provider "${p.id}"`, 'fetchEndpoint'),
      );
    }
    for (const p of captured.bookProviders) {
      addHook(
        'bookProvider',
        p.id,
        'runtime',
        p,
        endpointTarget(p.fetchEndpoint, `book provider "${p.id}"`, 'fetchEndpoint'),
      );
    }
    for (const [eventKey] of captured.eventSubscribers) {
      addHook('event', eventKey, 'runtime', { eventKey }, {
        via: 'event',
        channel: eventKey,
      });
    }
  }

  return [...out.values()];
}

// ── Target resolution ───────────────────────────────────────────────────────

/**
 * Every command this extension makes available, keyed by both the id as
 * written and its qualified form.
 *
 * Both spellings are indexed because a context-menu item is free to name
 * either: manifest ids come back qualified from the validator, while an
 * author hand-writing `command: 'practiceDue'` in an imperative
 * `registerContextMenu` call means the same command. Failing that lookup
 * would report a working menu item as broken.
 */
function buildCommandIndex(
  manifest: Extensions.ExtensionManifest,
  captured: CapturedRegistrations | undefined,
): Map<string, CommandLink> {
  const index = new Map<string, CommandLink>();
  const put = (id: string, handlerEndpoint: string | undefined): void => {
    const link: CommandLink = {
      id,
      ...(handlerEndpoint !== undefined ? { handlerEndpoint } : {}),
    };
    index.set(id, link);
    index.set(qualifyId(manifest.id, id), link);
  };
  for (const cmd of manifest.contributes?.commands ?? []) {
    put(cmd.id, cmd.handlerEndpoint);
  }
  // Runtime registrations last: `commands.register` requires a
  // `handlerEndpoint`, so it is strictly the better answer where both exist.
  for (const cmd of captured?.commands ?? []) {
    put(cmd.id, cmd.handlerEndpoint);
  }
  return index;
}

function commandTarget(id: string, handlerEndpoint: string | undefined): HookTarget {
  if (handlerEndpoint === undefined || handlerEndpoint.length === 0) {
    return {
      via: 'broken',
      reason:
        `Command "${id}" declares no handlerEndpoint, so the host has no address to ` +
        'dispatch to. The command appears in the palette and does nothing when chosen.',
    };
  }
  return { via: 'endpoint', endpoint: handlerEndpoint };
}

function endpointTarget(
  endpoint: string | undefined,
  what: string,
  field: string,
): HookTarget {
  if (endpoint === undefined || endpoint.length === 0) {
    return {
      via: 'broken',
      reason: `${what} declares no ${field}; the host has nothing to call.`,
    };
  }
  return { via: 'endpoint', endpoint };
}

/** Resolve a contribution that reaches its code through a command id. */
function viaCommandTarget(
  commands: ReadonlyMap<string, CommandLink>,
  commandId: string | undefined,
  what: string,
): HookTarget {
  if (commandId === undefined || commandId.length === 0) {
    return { via: 'broken', reason: `${what} names no command.` };
  }
  const link = commands.get(commandId);
  if (!link) {
    const known = [...new Set([...commands.values()].map((c) => c.id))];
    return {
      via: 'broken',
      reason:
        `${what} points at command "${commandId}", which this extension neither ` +
        `contributes in its manifest nor registers at activation. Known commands: ` +
        `${known.join(', ') || '(none)'}.`,
    };
  }
  if (link.handlerEndpoint === undefined || link.handlerEndpoint.length === 0) {
    return {
      via: 'broken',
      reason:
        `${what} points at command "${link.id}", which declares no handlerEndpoint. ` +
        'Clicking it reaches the host and stops there.',
    };
  }
  return { via: 'endpoint', endpoint: link.handlerEndpoint, commandId: link.id };
}

function statusBarTarget(
  commands: ReadonlyMap<string, CommandLink>,
  item: Extensions.StatusBarItemDescriptor,
): HookTarget {
  // `command` is optional on a status-bar item, and an item without one is a
  // legitimate read-only indicator (the word-count example is exactly that).
  // Only an item that claims to be clickable is held to the command contract.
  if (item.command === undefined || item.command.length === 0) {
    return {
      via: 'declarative',
      reason:
        `Status-bar item "${item.id}" declares no command, so it is a display-only ` +
        'indicator with nothing to invoke.',
    };
  }
  return viaCommandTarget(commands, item.command, `status-bar item "${item.id}"`);
}

function panelTypeTarget(id: string): HookTarget {
  return {
    via: 'declarative',
    reason:
      `Panel type "${id}" is declarative: the host mounts its uiEntry in an iframe. ` +
      'The panel talks to the extension over api.panels, which the smoke corpus ' +
      'has no messages for.',
  };
}
