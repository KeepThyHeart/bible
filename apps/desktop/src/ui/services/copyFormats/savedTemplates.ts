/**
 * Saved copy templates - user-defined custom templates for the "template" format.
 *
 * Persists in localStorage. Also exposes the built-in template list re-exported
 * from @bible/core so the UI has a single source for both built-in and custom
 * templates.
 */

import { BUILTIN_TEMPLATES, type SavedTemplate } from '@bible/core';

export type { SavedTemplate };
export { BUILTIN_TEMPLATES };

const STORAGE_KEY = 'bible-desktop-copy-templates';
const ACTIVE_KEY = 'bible-desktop-copy-active-template';
const ACTIVE_NAME_KEY = 'bible-desktop-copy-active-template-name';

/** Load user-saved templates from localStorage */
export function loadUserTemplates(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is SavedTemplate =>
        t &&
        typeof t.name === 'string' &&
        typeof t.template === 'string'
    );
  } catch {
    return [];
  }
}

/** Persist user templates to localStorage */
export function saveUserTemplates(templates: SavedTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    /* ignore quota / access errors */
  }
}

/** Save a single template (add or update by name). Returns the updated list. */
export function upsertUserTemplate(template: SavedTemplate): SavedTemplate[] {
  const templates = loadUserTemplates();
  const idx = templates.findIndex(t => t.name === template.name);
  if (idx >= 0) {
    templates[idx] = template;
  } else {
    templates.push(template);
  }
  saveUserTemplates(templates);
  return templates;
}

/** Delete a saved user template by name. Returns the updated list. */
export function deleteUserTemplate(name: string): SavedTemplate[] {
  const templates = loadUserTemplates().filter(t => t.name !== name);
  saveUserTemplates(templates);
  return templates;
}

/** Get all templates: built-in first, then user-saved */
export function getAllTemplates(): SavedTemplate[] {
  return [...BUILTIN_TEMPLATES, ...loadUserTemplates()];
}

/** Find a template by name (searches built-in and user templates) */
export function findTemplateByName(name: string): SavedTemplate | undefined {
  return getAllTemplates().find(t => t.name === name);
}

/**
 * The active template string used by the "custom" copy format.
 * Stored as raw text so the user can edit freely without picking a name.
 */
export function loadActiveTemplateText(): string {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw != null) return raw;
  } catch {
    /* ignore */
  }
  return BUILTIN_TEMPLATES[0].template;
}

export function saveActiveTemplateText(text: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, text);
  } catch {
    /* ignore */
  }
}

/**
 * The NAME of the template last chosen from the "Load template..." picker.
 *
 * Stored separately from the active template text because the two can legitimately
 * diverge: the user may load "Quote block" and then hand-edit it. The text is what
 * gets rendered; the name only drives the picker's displayed selection. Without
 * persisting it the picker would reset to a blank "Load template..." on every reopen,
 * which would read as "the dialog forgot my template" even though the text had been
 * restored.
 *
 * Returns '' when nothing was picked, or when the remembered name no longer names
 * an existing template (a saved template can be deleted between sessions).
 */
export function loadActiveTemplateName(): string {
  try {
    const raw = localStorage.getItem(ACTIVE_NAME_KEY);
    if (raw && findTemplateByName(raw)) return raw;
  } catch {
    /* ignore */
  }
  return '';
}

export function saveActiveTemplateName(name: string): void {
  try {
    localStorage.setItem(ACTIVE_NAME_KEY, name);
  } catch {
    /* ignore */
  }
}
