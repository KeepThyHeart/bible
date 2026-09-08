/**
 * Shared types for the DocumentationDialog composition.
 */

export type TFn = (key: string, params?: Record<string, unknown>) => string;

export interface DocSection {
  id: string;
  title: string;
  icon: string; // SVG path data
  content: DocBlock[];
}

/** A block of content inside a section */
export type DocBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'subheading'; text: string }
  | { type: 'list'; ordered?: boolean; items: string[] }
  | { type: 'shortcut-table'; rows: [string, string][] }
  | { type: 'tip'; text: string }
  | { type: 'note'; text: string }
  | { type: 'divider' };
