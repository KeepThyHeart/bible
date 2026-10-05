/**
 * Extension verse-menu adapter (task 0080, row 9): mirrors the `target === 'verse'`
 * rows of `useExtensionUiStore.contextMenuItems` into the shared `verseActions`
 * registry, so `VerseContextMenu` reads one registry. Only the main renderer
 * installs it; detached windows keep an empty registry, which is today's behaviour.
 *
 * Reconciled by key (`${extensionId}::${item.id}`) and item identity. Rows with a
 * `when` are skipped, as before; evaluating them is M3 work.
 */
import type { Disposable } from '@bible/core/browser';
import { useExtensionUiStore } from '../extensions/extensionUiStore';
import type { ExtensionContextMenuItem } from '../extensions/extensionUiStore';
import { withVerseIdsContext } from './verseContext';
import type { AppServices } from '../contexts/ContextProvider';
import { verseActions } from './appHost';

interface Installed {
  item: ExtensionContextMenuItem['item'];
  disposables: Disposable[];
}

type Services = Pick<AppServices, 'registry'>;

let installed = false;

export function mapExtensionOrder(order: number | undefined): number {
  const n = typeof order === 'number' && Number.isFinite(order) ? order : 0;
  return 100 + Math.min(900, Math.max(0, n));
}

export function installExtensionVerseActions(services: Services): () => void {
  if (installed) return () => undefined;
  installed = true;
  const rows = new Map<string, Installed>();

  const drop = (key: string): void => {
    const row = rows.get(key);
    if (!row) return;
    for (const d of row.disposables) d.dispose();
    rows.delete(key);
  };

  const reconcile = (): void => {
    const wanted = new Map<string, ExtensionContextMenuItem>();
    for (const c of useExtensionUiStore.getState().contextMenuItems) { // allow-getstate: store subscription callback
      if (c.target === 'verse' && c.item.when === undefined) wanted.set(c.key, c);
    }
    for (const key of [...rows.keys()]) {
      if (!wanted.has(key) || rows.get(key)!.item !== wanted.get(key)!.item) drop(key);
    }
    for (const [key, c] of wanted) {
      if (rows.has(key)) continue;
      const id = `${c.extensionId}.${c.item.id}`;
      const { item } = c;
      try {
        const reg = verseActions.register(
          {
            id,
            title: { extensionId: c.extensionId, text: item.label },
            order: mapExtensionOrder(item.order),
            group: 'extension',
          },
          { kind: 'extension', extensionId: c.extensionId },
        );
        const bound = verseActions.bindHandler({
          id,
          load: async () => ({
            run: async (ctx) => {
              await services.registry.execute(
                item.command,
                withVerseIdsContext(item.args, ctx.verseIds, ctx.module),
              );
            },
          }),
        });
        rows.set(key, { item, disposables: [reg, bound] });
      } catch (err) {
        console.error(`[verseActions] could not register "${id}"`, err);
      }
    }
  };

  reconcile();
  const unsubscribe = useExtensionUiStore.subscribe((s, prev) => {
    if (s.contextMenuItems !== prev.contextMenuItems) reconcile();
  });
  return () => {
    unsubscribe();
    for (const key of [...rows.keys()]) drop(key);
    installed = false;
  };
}
