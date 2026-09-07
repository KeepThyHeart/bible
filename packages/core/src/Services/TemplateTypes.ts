/**
 * Types and enums for template rendering system
 */

/**
 * Supported template engine types
 */
export enum TemplateEngineType {
  Liquid = 'liquid',
  Handlebars = 'handlebars',
}

/**
 * View model for template rendering.
 * Combines template content with engine selection.
 */
export interface TemplateView {
  /**
   * The template engine to use for rendering this template
   */
  engine: TemplateEngineType;

  /**
   * The template string content
   */
  template: string;
}

/**
 * Helper to create a TemplateView
 */
export function createTemplateView(
  engine: TemplateEngineType,
  template: string
): TemplateView {
  return { engine, template };
}
