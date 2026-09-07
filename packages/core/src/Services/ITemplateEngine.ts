/**
 * Interface for template rendering engines.
 * Allows swapping between different template engines (LiquidJS, Handlebars, etc.)
 * while keeping the same API.
 */
export interface ITemplateEngine {
  /**
   * Renders a template string with the provided data.
   *
   * @param templateString - The template text containing placeholders and logic
   * @param data - The data object to use when rendering the template
   * @returns A promise that resolves to the rendered HTML string
   * @throws Error if the template is invalid or rendering fails
   */
  render(templateString: string, data: Record<string, unknown>): Promise<string>;

  /**
   * Registers a custom filter/helper that can be used in templates.
   *
   * @param name - The name of the filter/helper
   * @param fn - The function that implements the filter/helper
   */
  registerFilter(name: string, fn: (...args: unknown[]) => unknown): void;

  /**
   * Validates that a template string is syntactically correct.
   *
   * @param templateString - The template text to validate
   * @returns true if valid, false otherwise
   */
  validateTemplate(templateString: string): boolean;
}
