/**
 * Template Parser
 *
 * Parses and applies custom copy templates using a two-template system:
 * - Master Template: Overall structure with {verses} placeholder
 * - Verse Template: Per-verse formatting
 * - Separator: What goes between verses
 */

import { type PassageVerse as BibleVerse, type VerseContext, type FormatOptions } from '@bible/core';

/**
 * A complete template configuration
 */
export interface TemplateConfig {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Master template (e.g., "{book} {chapter}:{verse_range}{nl}{verses}") */
  masterTemplate: string;
  /** Verse template (e.g., "{num} {text}") */
  verseTemplate: string;
  /** Separator between verses (e.g., "{nl}" or " ") */
  verseSeparator: string;
  /** Whether this is a user-defined template */
  isUserDefined?: boolean;
}

/**
 * Variables available in the master template
 */
export interface MasterVariables {
  [key: string]: string;
  /** Full book name (e.g., "John") */
  book: string;
  /** Abbreviated book name (e.g., "Jn") */
  book_short: string;
  /** Chapter number (e.g., "3") */
  chapter: string;
  /** First verse number (e.g., "16") */
  verse_start: string;
  /** Last verse number (e.g., "17") */
  verse_end: string;
  /** Smart verse range - "16" for single, "16-17" for multiple */
  verse_range: string;
  /** Translation abbreviation (e.g., "KJV") */
  version: string;
  /** Expanded verses using verse template */
  verses: string;
  /** Newline character */
  nl: string;
  /** Tab character */
  tab: string;
}

/**
 * Variables available in the verse template (per-verse)
 */
export interface VerseVariables {
  [key: string]: string;
  /** Verse number (e.g., "17") */
  num: string;
  /** Verse text content */
  text: string;
  /** Newline character */
  nl: string;
  /** Tab character */
  tab: string;
}

/**
 * Strip HTML tags from text
 */
function stripHtml(text: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = text;
  const cleanText = tmp.textContent || tmp.innerText || '';
  return cleanText.replace(/¶/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Get clean text from a verse
 */
function getVerseText(verse: BibleVerse): string {
  if (verse.text) {
    return stripHtml(verse.text);
  }
  if (verse.text_html) {
    return stripHtml(verse.text_html);
  }
  return '';
}

/**
 * Substitute variables in a template string
 *
 * @param template - Template string with {variable} placeholders
 * @param variables - Object mapping variable names to values
 * @returns Template with variables substituted
 */
export function substituteVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, varName) => {
    if (varName in variables) {
      return variables[varName];
    }
    // Unknown variable - leave as-is
    return match;
  });
}

/**
 * Build verse template variables for a single verse
 */
export function buildVerseVariables(verse: BibleVerse): VerseVariables {
  return {
    num: String(verse.verse),
    text: getVerseText(verse),
    nl: '\n',
    tab: '\t'
  };
}

/**
 * Expand the verse template for all verses and join with separator
 */
function expandVerses(
  verses: BibleVerse[],
  verseTemplate: string,
  separator: string
): string {
  // Process separator to handle special variables like {nl}
  const processedSeparator = substituteVariables(separator, {
    nl: '\n',
    tab: '\t'
  });

  return verses
    .map(verse => {
      const vars = buildVerseVariables(verse);
      return substituteVariables(verseTemplate, vars);
    })
    .join(processedSeparator);
}

/**
 * Build master template variables from verses and context
 */
export function buildMasterVariables(
  verses: BibleVerse[],
  context: VerseContext,
  verseTemplate: string,
  verseSeparator: string
): MasterVariables {
  const firstVerse = verses[0];
  const lastVerse = verses[verses.length - 1];

  const verseStart = String(firstVerse?.verse ?? '');
  const verseEnd = String(lastVerse?.verse ?? '');

  // Smart verse range: "16" for single verse, "16-17" for multiple
  const verseRange = verses.length === 1 || verseStart === verseEnd
    ? verseStart
    : `${verseStart}-${verseEnd}`;

  // Get book abbreviation from context, fallback to first 3 chars of book name
  const bookAbbreviation = context.bookAbbreviation ?? context.bookName.substring(0, 3);

  return {
    book: context.bookName,
    book_short: bookAbbreviation,
    chapter: String(context.chapter),
    verse_start: verseStart,
    verse_end: verseEnd,
    verse_range: verseRange,
    version: context.translation || '',
    verses: expandVerses(verses, verseTemplate, verseSeparator),
    nl: '\n',
    tab: '\t'
  };
}

/**
 * Apply a complete template configuration to format verses
 *
 * @param config - Template configuration
 * @param verses - Verses to format
 * @param context - Verse context (book name, chapter, translation)
 * @param _options - Format options (reserved for future use)
 * @returns Formatted string
 */
export function applyTemplate(
  config: TemplateConfig,
  verses: BibleVerse | BibleVerse[],
  context: VerseContext,
  _options: FormatOptions
): string {
  const versesArray = Array.isArray(verses) ? verses : [verses];

  if (versesArray.length === 0) {
    return '';
  }

  const masterVars = buildMasterVariables(
    versesArray,
    context,
    config.verseTemplate,
    config.verseSeparator
  );

  return substituteVariables(config.masterTemplate, masterVars);
}

/**
 * Validate a template configuration
 *
 * @returns Array of warning messages (empty if valid)
 */
export function validateTemplate(config: TemplateConfig): string[] {
  const warnings: string[] = [];

  if (!config.masterTemplate.includes('{verses}')) {
    warnings.push('Master template should include {verses} to display verse content');
  }

  if (!config.verseTemplate.includes('{text}')) {
    warnings.push('Verse template should include {text} to display verse text');
  }

  // Check for unrecognized variables in master template
  const masterVarPattern = /\{(\w+)\}/g;
  const validMasterVars = ['book', 'book_short', 'chapter', 'verse_start', 'verse_end', 'verse_range', 'version', 'verses', 'nl', 'tab'];
  let match;
  while ((match = masterVarPattern.exec(config.masterTemplate)) !== null) {
    if (!validMasterVars.includes(match[1])) {
      warnings.push(`Unknown variable in master template: {${match[1]}}`);
    }
  }

  // Check for unrecognized variables in verse template
  const verseVarPattern = /\{(\w+)\}/g;
  const validVerseVars = ['num', 'text', 'nl', 'tab'];
  while ((match = verseVarPattern.exec(config.verseTemplate)) !== null) {
    if (!validVerseVars.includes(match[1])) {
      warnings.push(`Unknown variable in verse template: {${match[1]}}`);
    }
  }

  return warnings;
}

/**
 * Get list of available master template variables with descriptions
 */
export function getMasterVariableList(): Array<{ name: string; description: string; example: string }> {
  return [
    { name: 'book', description: 'Full book name', example: 'John' },
    { name: 'book_short', description: 'Abbreviated book name', example: 'Jn' },
    { name: 'chapter', description: 'Chapter number', example: '3' },
    { name: 'verse_start', description: 'First verse number', example: '16' },
    { name: 'verse_end', description: 'Last verse number', example: '17' },
    { name: 'verse_range', description: 'Smart verse range', example: '16-17' },
    { name: 'version', description: 'Translation abbreviation', example: 'KJV' },
    { name: 'verses', description: 'Expanded verse content', example: '(uses verse template)' },
    { name: 'nl', description: 'Newline', example: '\\n' },
    { name: 'tab', description: 'Tab character', example: '\\t' }
  ];
}

/**
 * Get list of available verse template variables with descriptions
 */
export function getVerseVariableList(): Array<{ name: string; description: string; example: string }> {
  return [
    { name: 'num', description: 'Verse number', example: '16' },
    { name: 'text', description: 'Verse text', example: 'For God so loved...' },
    { name: 'nl', description: 'Newline', example: '\\n' },
    { name: 'tab', description: 'Tab character', example: '\\t' }
  ];
}

/**
 * Default built-in templates
 */
export const BUILT_IN_TEMPLATES: TemplateConfig[] = [
  {
    id: 'builtin-standard',
    name: 'Standard',
    masterTemplate: '{book} {chapter}:{verse_range} ({version}){nl}{verses}',
    verseTemplate: '{num} {text}',
    verseSeparator: '{nl}',
    isUserDefined: false
  },
  {
    id: 'builtin-plain',
    name: 'Plain',
    masterTemplate: '{verses}{nl}{nl}{book} {chapter}:{verse_range} ({version})',
    verseTemplate: '{text}',
    verseSeparator: ' ',
    isUserDefined: false
  },
  {
    id: 'builtin-inline',
    name: 'Inline',
    masterTemplate: '({book} {chapter}:{verse_range}) {verses}',
    verseTemplate: '({num}) {text}',
    verseSeparator: ' ',
    isUserDefined: false
  },
  {
    id: 'builtin-quote',
    name: 'Quote',
    masterTemplate: '"{verses}" —{book} {chapter}:{verse_range}',
    verseTemplate: '{text}',
    verseSeparator: ' ',
    isUserDefined: false
  }
];
