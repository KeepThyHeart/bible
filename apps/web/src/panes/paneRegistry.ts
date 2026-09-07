/**
 * Pane registry for self-registering right-side panes.
 *
 * Both core panes and plugin panes register through this system.
 * The app shell renders whatever panes are registered without knowing internals.
 */

import type { ComponentType } from 'preact';

// ---------------------------------------------------------------------------
// Registration types
// ---------------------------------------------------------------------------

export interface PaneProps {
  isActive: boolean;
}

export interface PaneRegistration {
  /** Unique pane identifier (e.g., 'commentary', 'study', 'my-plugin-pane') */
  id: string;

  /** Display label for the pane tab */
  label: string;

  /** FontAwesome icon class (e.g., 'fa-book') */
  icon: string;

  /** Tab sort order — lower values appear first */
  order: number;

  /** The Preact component to render */
  component: ComponentType<PaneProps>;

  /** Optional: only show tab when this returns true (e.g., search tab) */
  showTab?: () => boolean;

  /** Optional: mobile navigation entry */
  mobileNav?: {
    icon: string;
    label: string;
    order: number;
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type Listener = () => void;

class PaneRegistry {
  private panes = new Map<string, PaneRegistration>();
  private listeners = new Set<Listener>();

  /**
   * Register a pane. Returns an unregister function.
   */
  register(registration: PaneRegistration): () => void {
    this.panes.set(registration.id, registration);
    this.notifyListeners();
    return () => {
      this.panes.delete(registration.id);
      this.notifyListeners();
    };
  }

  /**
   * Unregister a pane by ID.
   */
  unregister(id: string): void {
    this.panes.delete(id);
    this.notifyListeners();
  }

  /**
   * Get all registered panes, sorted by order.
   */
  getAll(): PaneRegistration[] {
    return Array.from(this.panes.values()).sort((a, b) => a.order - b.order);
  }

  /**
   * Get a pane by ID.
   */
  get(id: string): PaneRegistration | undefined {
    return this.panes.get(id);
  }

  /**
   * Subscribe to registry changes. Returns an unsubscribe function.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }
}

/** Singleton pane registry instance */
export const paneRegistry = new PaneRegistry();
