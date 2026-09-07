/**
 * Registry for plugin-contributed verse decorators.
 *
 * Verse decorators inject Preact components before/after/inline with verse text.
 */

import type { ComponentType } from 'preact';

export interface VerseDecorator {
  /** Unique decorator identifier */
  id: string;

  /** Where to render relative to verse text */
  position: 'before' | 'after' | 'inline';

  /** Sort order among decorators in the same position */
  order: number;

  /**
   * Return a component to render for the given verse, or null to skip.
   * The returned component receives { verseId } as props.
   */
  decorate(verseId: number, module: string): ComponentType<{ verseId: number }> | null;
}

class VerseDecoratorRegistryImpl {
  private decorators = new Map<string, VerseDecorator>();

  register(decorator: VerseDecorator): () => void {
    this.decorators.set(decorator.id, decorator);
    return () => this.decorators.delete(decorator.id);
  }

  /**
   * Get all decorators, sorted by order.
   */
  getAll(): VerseDecorator[] {
    return Array.from(this.decorators.values()).sort((a, b) => a.order - b.order);
  }

  /**
   * Get decorators for a specific position, sorted by order.
   */
  getByPosition(position: 'before' | 'after' | 'inline'): VerseDecorator[] {
    return this.getAll().filter(d => d.position === position);
  }

  /**
   * Check if any decorators are registered.
   */
  hasDecorators(): boolean {
    return this.decorators.size > 0;
  }
}

export const verseDecoratorRegistry = new VerseDecoratorRegistryImpl();
