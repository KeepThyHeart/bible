/**
 * Registry for plugin-contributed settings panel sections.
 *
 * Plugin sections appear after core settings in the SettingsPanel.
 */

import type { ComponentType } from 'preact';

export interface SettingsSection {
  /** Unique section identifier */
  id: string;

  /** Display label for the section heading */
  label: string;

  /** Sort order among plugin sections (core sections come first) */
  order: number;

  /** The Preact component to render for this settings section */
  component: ComponentType<Record<string, never>>;
}

class SettingsRegistryImpl {
  private sections = new Map<string, SettingsSection>();

  register(section: SettingsSection): () => void {
    this.sections.set(section.id, section);
    return () => this.sections.delete(section.id);
  }

  /**
   * Get all sections, sorted by order.
   */
  getAll(): SettingsSection[] {
    return Array.from(this.sections.values()).sort((a, b) => a.order - b.order);
  }

  /**
   * Check if any plugin settings are registered.
   */
  hasSections(): boolean {
    return this.sections.size > 0;
  }
}

export const settingsRegistry = new SettingsRegistryImpl();
