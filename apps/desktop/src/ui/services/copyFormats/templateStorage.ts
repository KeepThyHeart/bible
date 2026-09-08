/**
 * Template Storage
 *
 * Manages user-defined copy templates using localStorage.
 * Templates can be saved, loaded, deleted, and set as default.
 */

import { TemplateConfig, BUILT_IN_TEMPLATES } from './templateParser';

const STORAGE_KEY = 'bible-copy-templates';
const DEFAULT_TEMPLATE_KEY = 'bible-copy-default-template';

/**
 * User template extends TemplateConfig with user-specific fields
 */
export interface UserTemplate extends TemplateConfig {
  /** When the template was created */
  createdAt?: string;
  /** When the template was last modified */
  modifiedAt?: string;
}

/**
 * Storage structure for templates
 */
interface TemplateStorage {
  templates: UserTemplate[];
  version: number;
}

/**
 * Generate a unique ID for a new template
 */
function generateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load templates from localStorage
 */
function loadStorage(): TemplateStorage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as TemplateStorage;
      return parsed;
    }
  } catch (error) {
    console.error('Failed to load templates from storage:', error);
  }

  return { templates: [], version: 1 };
}

/**
 * Save templates to localStorage
 */
function saveStorage(storage: TemplateStorage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
  } catch (error) {
    console.error('Failed to save templates to storage:', error);
  }
}

/**
 * Get all user-defined templates
 */
export function getUserTemplates(): UserTemplate[] {
  const storage = loadStorage();
  return storage.templates.map(t => ({ ...t, isUserDefined: true }));
}

/**
 * Get all built-in templates
 */
export function getBuiltInTemplates(): TemplateConfig[] {
  return BUILT_IN_TEMPLATES.map(t => ({ ...t, isUserDefined: false }));
}

/**
 * Get all templates (built-in + user-defined)
 */
export function getAllTemplates(): TemplateConfig[] {
  return [...getBuiltInTemplates(), ...getUserTemplates()];
}

/**
 * Get a template by ID (checks both built-in and user templates)
 */
export function getTemplateById(id: string): TemplateConfig | undefined {
  // Check built-in templates first
  const builtIn = BUILT_IN_TEMPLATES.find(t => t.id === id);
  if (builtIn) {
    return { ...builtIn, isUserDefined: false };
  }

  // Check user templates
  const storage = loadStorage();
  const userTemplate = storage.templates.find(t => t.id === id);
  if (userTemplate) {
    return { ...userTemplate, isUserDefined: true };
  }

  return undefined;
}

/**
 * Save a new user template
 *
 * @param template - Template to save (id will be generated if not provided)
 * @returns The saved template with generated ID
 */
export function saveUserTemplate(template: Omit<UserTemplate, 'id'> & { id?: string }): UserTemplate {
  const storage = loadStorage();
  const now = new Date().toISOString();

  const newTemplate: UserTemplate = {
    ...template,
    id: template.id || generateId(),
    isUserDefined: true,
    createdAt: template.createdAt || now,
    modifiedAt: now
  };

  // Check if template with this ID already exists
  const existingIndex = storage.templates.findIndex(t => t.id === newTemplate.id);
  if (existingIndex >= 0) {
    // Update existing template
    storage.templates[existingIndex] = newTemplate;
  } else {
    // Add new template
    storage.templates.push(newTemplate);
  }

  saveStorage(storage);
  return newTemplate;
}

/**
 * Update an existing user template
 *
 * @param id - ID of template to update
 * @param updates - Fields to update
 * @returns Updated template or undefined if not found
 */
export function updateUserTemplate(
  id: string,
  updates: Partial<Omit<UserTemplate, 'id' | 'isUserDefined'>>
): UserTemplate | undefined {
  const storage = loadStorage();
  const index = storage.templates.findIndex(t => t.id === id);

  if (index < 0) {
    return undefined;
  }

  const updated: UserTemplate = {
    ...storage.templates[index],
    ...updates,
    modifiedAt: new Date().toISOString()
  };

  storage.templates[index] = updated;
  saveStorage(storage);

  return updated;
}

/**
 * Delete a user template
 *
 * @param id - ID of template to delete
 * @returns true if deleted, false if not found
 */
export function deleteUserTemplate(id: string): boolean {
  const storage = loadStorage();
  const initialLength = storage.templates.length;

  storage.templates = storage.templates.filter(t => t.id !== id);

  if (storage.templates.length < initialLength) {
    saveStorage(storage);

    // If deleted template was the default, clear the default
    const defaultId = getDefaultTemplateId();
    if (defaultId === id) {
      clearDefaultTemplate();
    }

    return true;
  }

  return false;
}

/**
 * Duplicate a template (built-in or user)
 *
 * @param id - ID of template to duplicate
 * @param newName - Name for the duplicate (optional, defaults to "Copy of [name]")
 * @returns The new duplicated template
 */
export function duplicateTemplate(id: string, newName?: string): UserTemplate | undefined {
  const source = getTemplateById(id);
  if (!source) {
    return undefined;
  }

  const name = newName || `Copy of ${source.name}`;

  return saveUserTemplate({
    name,
    masterTemplate: source.masterTemplate,
    verseTemplate: source.verseTemplate,
    verseSeparator: source.verseSeparator,
    isUserDefined: true
  });
}

/**
 * Get the ID of the default template
 */
export function getDefaultTemplateId(): string | null {
  try {
    return localStorage.getItem(DEFAULT_TEMPLATE_KEY);
  } catch {
    return null;
  }
}

/**
 * Set the default template
 *
 * @param id - ID of template to set as default
 */
export function setDefaultTemplate(id: string): void {
  try {
    localStorage.setItem(DEFAULT_TEMPLATE_KEY, id);
  } catch (error) {
    console.error('Failed to save default template:', error);
  }
}

/**
 * Clear the default template setting
 */
export function clearDefaultTemplate(): void {
  try {
    localStorage.removeItem(DEFAULT_TEMPLATE_KEY);
  } catch (error) {
    console.error('Failed to clear default template:', error);
  }
}

/**
 * Get the default template (or first built-in if none set)
 */
export function getDefaultTemplate(): TemplateConfig {
  const defaultId = getDefaultTemplateId();

  if (defaultId) {
    const template = getTemplateById(defaultId);
    if (template) {
      return template;
    }
  }

  // Fallback to first built-in template
  return BUILT_IN_TEMPLATES[0];
}

/**
 * Check if a template name is unique among user templates
 */
export function isTemplateNameUnique(name: string, excludeId?: string): boolean {
  const storage = loadStorage();
  return !storage.templates.some(
    t => t.name.toLowerCase() === name.toLowerCase() && t.id !== excludeId
  );
}

/**
 * Export all user templates as JSON string
 */
export function exportTemplates(): string {
  const templates = getUserTemplates();
  return JSON.stringify(templates, null, 2);
}

/**
 * Import templates from JSON string
 *
 * @param json - JSON string containing array of templates
 * @param overwrite - If true, replace existing templates with same name
 * @returns Number of templates imported
 */
export function importTemplates(json: string, overwrite: boolean = false): number {
  try {
    const imported = JSON.parse(json) as UserTemplate[];

    if (!Array.isArray(imported)) {
      throw new Error('Invalid template format: expected array');
    }

    let count = 0;
    for (const template of imported) {
      if (!template.name || !template.masterTemplate || !template.verseTemplate) {
        continue; // Skip invalid templates
      }

      const existing = getUserTemplates().find(
        t => t.name.toLowerCase() === template.name.toLowerCase()
      );

      if (existing && !overwrite) {
        continue; // Skip if exists and not overwriting
      }

      saveUserTemplate({
        ...template,
        id: existing?.id, // Preserve ID if updating
        isUserDefined: true
      });
      count++;
    }

    return count;
  } catch (error) {
    console.error('Failed to import templates:', error);
    return 0;
  }
}
