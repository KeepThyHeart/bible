/**
 * Custom Format
 *
 * A CopyFormat implementation that uses user-configurable templates.
 * This format delegates to the template parser to format verses.
 */

import { type CopyFormat, type PassageVerse as BibleVerse, type VerseContext, type FormatOptions, truncateForPreview } from '@bible/core';
import { TemplateConfig, applyTemplate } from './templateParser';
import { getDefaultTemplate, getTemplateById } from './templateStorage';

/**
 * Current active template ID (stored in memory, synced with storage)
 */
let activeTemplateId: string | null = null;

/**
 * Get the currently active template
 */
export function getActiveTemplate(): TemplateConfig {
  if (activeTemplateId) {
    const template = getTemplateById(activeTemplateId);
    if (template) {
      return template;
    }
  }
  return getDefaultTemplate();
}

/**
 * Set the active template by ID
 */
export function setActiveTemplateId(id: string): void {
  activeTemplateId = id;
}

/**
 * Get the active template ID
 */
export function getActiveTemplateId(): string {
  return activeTemplateId || getDefaultTemplate().id;
}

/**
 * Custom format that uses configurable templates
 */
const customFormat: CopyFormat = {
  id: 'custom',
  name: 'Custom',
  description: 'User-configurable template format',

  format(
    verses: BibleVerse | BibleVerse[],
    context: VerseContext,
    options: FormatOptions
  ): string {
    const template = getActiveTemplate();
    return applyTemplate(template, verses, context, options);
  },

  preview(
    verses: BibleVerse | BibleVerse[],
    context: VerseContext,
    options: FormatOptions
  ): string {
    const template = getActiveTemplate();
    const fullText = applyTemplate(template, verses, context, options);
    return truncateForPreview(fullText, 150);
  }
};

/**
 * Create a CopyFormat from a specific template
 *
 * This is useful when you want to use a specific template
 * rather than the active/default one.
 */
export function createFormatFromTemplate(template: TemplateConfig): CopyFormat {
  return {
    id: `template-${template.id}`,
    name: template.name,
    description: template.isUserDefined ? 'Custom template' : 'Built-in template',

    format(
      verses: BibleVerse | BibleVerse[],
      context: VerseContext,
      options: FormatOptions
    ): string {
      return applyTemplate(template, verses, context, options);
    },

    preview(
      verses: BibleVerse | BibleVerse[],
      context: VerseContext,
      options: FormatOptions
    ): string {
      const fullText = applyTemplate(template, verses, context, options);
      return truncateForPreview(fullText, 150);
    }
  };
}

/**
 * Format verses using a specific template ID
 */
export function formatWithTemplate(
  templateId: string,
  verses: BibleVerse | BibleVerse[],
  context: VerseContext,
  options: FormatOptions
): string {
  const template = getTemplateById(templateId) || getDefaultTemplate();
  return applyTemplate(template, verses, context, options);
}

/**
 * Format verses using a template config directly
 */
export function formatWithTemplateConfig(
  template: TemplateConfig,
  verses: BibleVerse | BibleVerse[],
  context: VerseContext,
  options: FormatOptions
): string {
  return applyTemplate(template, verses, context, options);
}

export default customFormat;
