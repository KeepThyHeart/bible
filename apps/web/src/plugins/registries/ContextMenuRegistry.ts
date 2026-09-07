/**
 * Registry for plugin-contributed context menu items.
 *
 * Items are merged with core items (copy, commentary, study) and sorted by order.
 */

export interface ContextMenuItem {
  /** Unique item identifier */
  id: string;

  /** Display label */
  label: string;

  /** FontAwesome icon class (optional) */
  icon?: string;

  /** Sort position — core items use 10, 20, 30. Plugins should use gaps. */
  order: number;

  /** Handler called when the item is clicked */
  handler(verseId: number, book: number, chapter: number, verse: number): void;

  /** Optional: hide item conditionally */
  visible?(verseId: number): boolean;
}

class ContextMenuRegistryImpl {
  private items = new Map<string, ContextMenuItem>();

  register(item: ContextMenuItem): () => void {
    this.items.set(item.id, item);
    return () => this.items.delete(item.id);
  }

  /**
   * Get all items visible for a given verse, sorted by order.
   */
  getItems(verseId: number): ContextMenuItem[] {
    return Array.from(this.items.values())
      .filter(item => !item.visible || item.visible(verseId))
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Get all registered items (unfiltered), sorted by order.
   */
  getAll(): ContextMenuItem[] {
    return Array.from(this.items.values()).sort((a, b) => a.order - b.order);
  }
}

export const contextMenuRegistry = new ContextMenuRegistryImpl();
