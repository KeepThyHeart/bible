/**
 * Registry for plugin-contributed keyboard shortcuts.
 *
 * Plugin keybindings are checked after core shortcuts.
 */

export interface KeyBinding {
  /** Unique binding identifier */
  id: string;

  /** Key combo string (e.g., "ctrl+shift+d", "alt+r") */
  key: string;

  /** Human-readable label for the shortcut */
  label: string;

  /** Handler called when the shortcut is triggered */
  handler(): void;

  /** Optional: only active when this returns true */
  when?(): boolean;
}

/** Parse a key string like "ctrl+shift+d" into parts */
function parseKeyCombo(key: string): {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
} {
  const parts = key.toLowerCase().split('+');
  const mainKey = parts[parts.length - 1];
  return {
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key: mainKey,
  };
}

class KeybindingRegistryImpl {
  private bindings = new Map<string, KeyBinding>();

  register(binding: KeyBinding): () => void {
    this.bindings.set(binding.id, binding);
    return () => this.bindings.delete(binding.id);
  }

  /**
   * Try to handle a keyboard event. Returns true if a binding matched.
   */
  handleKeyEvent(e: KeyboardEvent): boolean {
    for (const binding of this.bindings.values()) {
      const combo = parseKeyCombo(binding.key);
      if (
        e.key.toLowerCase() === combo.key &&
        e.ctrlKey === combo.ctrl &&
        e.shiftKey === combo.shift &&
        e.altKey === combo.alt &&
        e.metaKey === combo.meta
      ) {
        if (binding.when && !binding.when()) continue;
        e.preventDefault();
        binding.handler();
        return true;
      }
    }
    return false;
  }

  /**
   * Get all registered bindings (for display in help/settings).
   */
  getAll(): KeyBinding[] {
    return Array.from(this.bindings.values());
  }

  /**
   * Check if any bindings are registered.
   */
  hasBindings(): boolean {
    return this.bindings.size > 0;
  }
}

export const keybindingRegistry = new KeybindingRegistryImpl();
