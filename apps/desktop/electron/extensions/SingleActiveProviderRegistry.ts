/**
 * SingleActiveProviderRegistry - "only one of X may be active".
 *
 * Manages provider roles where exactly one provider may be active at a time: `searchProvider`, `aiAssistant`,
 * `ttsVoice`, etc. The registry tracks every registered provider for each
 * role, plus the user's persisted selection. Activation order:
 *
 *   1. User override (from preferences) - wins unconditionally.
 *   2. Extension-provided - first registered wins (could add `order` hint).
 *   3. Built-in - always available as fallback.
 *
 * User preferences are persisted via a callback so the registry is
 * decoupled from the storage layer.
 */

import type { Extensions } from '@bible/core';

type LocalizedString = Extensions.LocalizedString;

// --- Role IDs -------------------------------------------------------------

export type ProviderRoleId =
  | 'scriptureTooltip'
  | 'strongsLookup'
  | 'dictionaryDefault'
  | 'referenceParser'
  | 'searchBackend'
  | 'crossReferenceProvider'
  | 'readingPlanProvider'
  | 'aiAssistant'
  | 'ttsVoice'
  | 'verseFormatter';

// --- Registration ---------------------------------------------------------

export interface ProviderRoleRegistration {
  roleId: ProviderRoleId;
  extensionId: string;
  /** "default" or extension-chosen ID. */
  providerId: string;
  displayName: LocalizedString;
}

/** Unique key: `${extensionId}/${providerId}`. */
function providerKey(reg: ProviderRoleRegistration): string {
  return `${reg.extensionId}/${reg.providerId}`;
}

// --- Persistence callback -------------------------------------------------

/**
 * Pluggable persistence for the user's provider selections. The host wires
 * the real implementation (KV row in user DB); tests inject an in-memory map.
 */
export interface ProviderPreferencePersistence {
  /** Read the whole map from storage. */
  load(): Record<string, string>;
  /** Persist the whole map. */
  save(prefs: Record<string, string>): void;
}

/** Default no-op persistence (in-memory only). */
export class InMemoryProviderPreferences implements ProviderPreferencePersistence {
  private data: Record<string, string> = {};
  load(): Record<string, string> {
    return { ...this.data };
  }
  save(prefs: Record<string, string>): void {
    this.data = { ...prefs };
  }
}

// --- Change listeners -----------------------------------------------------

export type ActiveProviderChangeHandler = (event: { roleId: ProviderRoleId }) => void;

// --- Registry -------------------------------------------------------------

export class SingleActiveProviderRegistry {
  /** role -> list of registrations (preserves insertion order). */
  private readonly registrations = new Map<ProviderRoleId, ProviderRoleRegistration[]>();
  private readonly persistence: ProviderPreferencePersistence;
  private readonly listeners: ActiveProviderChangeHandler[] = [];

  constructor(persistence?: ProviderPreferencePersistence) {
    this.persistence = persistence ?? new InMemoryProviderPreferences();
  }

  // --- Registration ----------------------------------------------------

  /**
   * Register a provider for a role. Returns a disposer that removes the
   * registration. Disposing is idempotent.
   */
  register(reg: ProviderRoleRegistration): () => void {
    let list = this.registrations.get(reg.roleId);
    if (!list) {
      list = [];
      this.registrations.set(reg.roleId, list);
    }
    // Prevent duplicate keys.
    const key = providerKey(reg);
    const existing = list.findIndex((r) => providerKey(r) === key);
    if (existing !== -1) {
      list[existing] = reg; // update in place
    } else {
      list.push(reg);
    }
    this.notifyChange(reg.roleId);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const l = this.registrations.get(reg.roleId);
      if (!l) return;
      const idx = l.findIndex((r) => providerKey(r) === key);
      if (idx !== -1) l.splice(idx, 1);
      if (l.length === 0) this.registrations.delete(reg.roleId);
      this.notifyChange(reg.roleId);
    };
  }

  /**
   * Remove every registration owned by `extensionId` across all roles.
   * Returns the number removed.
   */
  removeAllByExtension(extensionId: string): number {
    let count = 0;
    for (const [roleId, list] of this.registrations) {
      const before = list.length;
      const filtered = list.filter((r) => r.extensionId !== extensionId);
      if (filtered.length < before) {
        count += before - filtered.length;
        if (filtered.length === 0) {
          this.registrations.delete(roleId);
        } else {
          this.registrations.set(roleId, filtered);
        }
        this.notifyChange(roleId);
      }
    }
    return count;
  }

  // --- Reads -----------------------------------------------------------

  /** All registered providers for a role. */
  listForRole(roleId: ProviderRoleId): ProviderRoleRegistration[] {
    return [...(this.registrations.get(roleId) ?? [])];
  }

  /**
   * Currently selected (active) provider for a role. Resolution order:
   * 1. User override from preferences.
   * 2. First registered extension provider (insertion order).
   * 3. null if nothing is registered.
   */
  getActive(roleId: ProviderRoleId): ProviderRoleRegistration | null {
    const list = this.registrations.get(roleId);
    if (!list || list.length === 0) return null;

    // Check user preference.
    const prefs = this.persistence.load();
    const preferred = prefs[roleId];
    if (preferred) {
      const match = list.find((r) => providerKey(r) === preferred);
      if (match) return match;
      // Preferred provider is gone - fall through to default.
    }

    // First registered wins.
    return list[0];
  }

  /** User picks the active provider. Persists to preferences. */
  setActive(roleId: ProviderRoleId, key: string): void {
    const prefs = this.persistence.load();
    prefs[roleId] = key;
    this.persistence.save(prefs);
    this.notifyChange(roleId);
  }

  // --- Events ----------------------------------------------------------

  onDidChangeActive(handler: ActiveProviderChangeHandler): () => void {
    this.listeners.push(handler);
    return () => {
      const idx = this.listeners.indexOf(handler);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private notifyChange(roleId: ProviderRoleId): void {
    for (const h of this.listeners) {
      try {
        h({ roleId });
      } catch {
        /* swallow listener errors */
      }
    }
  }
}
