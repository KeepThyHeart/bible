/**
 * ContributionRegistry - central index of every active extension's
 * contributions.
 *
 * This is the consolidated read-side view the renderer queries when it needs to iterate "every provider / panel
 * type / menu item contributed by any extension" without walking each api-impl.
 *
 * Most api-impls already track their own contributions; this registry
 * collects them into a single queryable index that survives
 * activate/deactivate cycles and lets the host answer questions like:
 *
 *   - "Which extensions currently provide a commentary provider?"
 *   - "What api exports does extension X declare?"
 *   - "List every registered provider across all active extensions."
 *
 * The registry is keyed by `(extensionId, kind, itemId)`. Each active
 * extension registers its contributions at activation time and removes them
 * at deactivation. The host owns a single shared instance.
 */

import type { Extensions } from '@bible/core';

type BibleProviderDescriptor = Extensions.BibleProviderDescriptor;
type CommentaryProviderDescriptor = Extensions.CommentaryProviderDescriptor;
type DictionaryProviderDescriptor = Extensions.DictionaryProviderDescriptor;
type BookProviderDescriptor = Extensions.BookProviderDescriptor;
type VerseDecoratorDescriptor = Extensions.VerseDecoratorDescriptor;
type VerseHoverProviderDescriptor = Extensions.VerseHoverProviderDescriptor;
type ContextMenuItemDescriptor = Extensions.ContextMenuItemDescriptor;
type StatusBarItemDescriptor = Extensions.StatusBarItemDescriptor;
type DisplayModeDescriptor = Extensions.DisplayModeDescriptor;

// --- Contribution kinds ---------------------------------------------------

export type ContributionKind =
  | 'bibleProvider'
  | 'commentaryProvider'
  | 'dictionaryProvider'
  | 'bookProvider'
  | 'verseDecorator'
  | 'verseHover'
  | 'contextMenuItem'
  | 'statusBarItem'
  | 'displayMode';

export interface ContributionEntry<T = unknown> {
  extensionId: string;
  kind: ContributionKind;
  itemId: string;
  descriptor: T;
}

// --- Registry -------------------------------------------------------------

export class ContributionRegistry {
  /**
   * Map from `${extensionId}::${kind}::${itemId}` -> entry. The composite
   * key guarantees uniqueness per extension per contribution type.
   */
  private readonly entries = new Map<string, ContributionEntry>();

  private static key(extensionId: string, kind: ContributionKind, itemId: string): string {
    return `${extensionId}::${kind}::${itemId}`;
  }

  // --- Mutations ----------------------------------------------------------

  /**
   * Register a contribution. Returns a disposer that removes it. Calling
   * the disposer more than once is a no-op.
   */
  register<T>(
    extensionId: string,
    kind: ContributionKind,
    itemId: string,
    descriptor: T,
  ): () => void {
    const k = ContributionRegistry.key(extensionId, kind, itemId);
    this.entries.set(k, { extensionId, kind, itemId, descriptor });
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.entries.delete(k);
    };
  }

  /**
   * Remove every contribution owned by `extensionId`. Called from
   * `disposeApiImpls` during deactivation. Returns the number removed.
   */
  removeAllByExtension(extensionId: string): number {
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.extensionId === extensionId) {
        this.entries.delete(key);
        count++;
      }
    }
    return count;
  }

  // --- Reads --------------------------------------------------------------

  /** All contributions of a given kind, across all extensions. */
  listByKind<T>(kind: ContributionKind): ContributionEntry<T>[] {
    const result: ContributionEntry<T>[] = [];
    for (const entry of this.entries.values()) {
      if (entry.kind === kind) result.push(entry as ContributionEntry<T>);
    }
    return result;
  }

  /** All contributions by a given extension. */
  listByExtension(extensionId: string): ContributionEntry[] {
    const result: ContributionEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.extensionId === extensionId) result.push(entry);
    }
    return result;
  }

  /** Look up a specific contribution. */
  get<T>(extensionId: string, kind: ContributionKind, itemId: string): ContributionEntry<T> | undefined {
    return this.entries.get(
      ContributionRegistry.key(extensionId, kind, itemId),
    ) as ContributionEntry<T> | undefined;
  }

  /** True if a contribution exists. */
  has(extensionId: string, kind: ContributionKind, itemId: string): boolean {
    return this.entries.has(ContributionRegistry.key(extensionId, kind, itemId));
  }

  /** Total number of contributions. */
  get size(): number {
    return this.entries.size;
  }

  /** All Bible text providers across all extensions. */
  listBibleProviders(): ContributionEntry<BibleProviderDescriptor>[] {
    return this.listByKind<BibleProviderDescriptor>('bibleProvider');
  }

  /** All commentary providers across all extensions. */
  listCommentaryProviders(): ContributionEntry<CommentaryProviderDescriptor>[] {
    return this.listByKind<CommentaryProviderDescriptor>('commentaryProvider');
  }

  /** All dictionary providers across all extensions. */
  listDictionaryProviders(): ContributionEntry<DictionaryProviderDescriptor>[] {
    return this.listByKind<DictionaryProviderDescriptor>('dictionaryProvider');
  }

  /** All book providers across all extensions. */
  listBookProviders(): ContributionEntry<BookProviderDescriptor>[] {
    return this.listByKind<BookProviderDescriptor>('bookProvider');
  }

  /** All verse decorators across all extensions. */
  listVerseDecorators(): ContributionEntry<VerseDecoratorDescriptor>[] {
    return this.listByKind<VerseDecoratorDescriptor>('verseDecorator');
  }

  /** All verse hover providers across all extensions. */
  listVerseHoverProviders(): ContributionEntry<VerseHoverProviderDescriptor>[] {
    return this.listByKind<VerseHoverProviderDescriptor>('verseHover');
  }

  /** All context menu items across all extensions. */
  listContextMenuItems(): ContributionEntry<ContextMenuItemDescriptor>[] {
    return this.listByKind<ContextMenuItemDescriptor>('contextMenuItem');
  }

  /** All status bar items across all extensions. */
  listStatusBarItems(): ContributionEntry<StatusBarItemDescriptor>[] {
    return this.listByKind<StatusBarItemDescriptor>('statusBarItem');
  }

  /** All display modes across all extensions. */
  listDisplayModes(): ContributionEntry<DisplayModeDescriptor>[] {
    return this.listByKind<DisplayModeDescriptor>('displayMode');
  }
}
