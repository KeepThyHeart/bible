/**
 * How a printed passage looks: which layout, whether to leave a notes margin, and the page stylesheet.
 *
 * Pure and shared: the desktop print document and the web print iframe both build their CSS here, so
 * the two cannot drift. Storage stays with each app; {@link normalizePrintPreferences} is what makes a
 * stored blob safe to use.
 *
 * The default is numbered verses with no block-quote line or indent: a reader printing a passage
 * usually wants a page to read, not a quotation drawn for pasting into a document. The block-quote
 * layout stays an option.
 */

/** `numbered`: numbered verses, plain; `blockquote`: a quotation with a rule; `preview`: as the dialog shows it. */
export const PRINT_LAYOUTS = ['numbered', 'blockquote', 'preview'] as const;
export type PrintLayout = (typeof PRINT_LAYOUTS)[number];

export const PRINT_NOTES_MARGIN_MIN_CM = 3;
export const PRINT_NOTES_MARGIN_MAX_CM = 8.3;
export const PRINT_NOTES_MARGIN_STEP_CM = 0.5;
/** The same range in inches (1.25-3.25 in, quarter-inch steps). */
export const PRINT_NOTES_MARGIN_MIN_IN = 1.25;
export const PRINT_NOTES_MARGIN_MAX_IN = 3.25;
export const PRINT_NOTES_MARGIN_STEP_IN = 0.25;

export const PRINT_UNITS = ['cm', 'in'] as const;
export type PrintUnit = (typeof PRINT_UNITS)[number];

/** Line-spacing choices: Normal is the page's own 1.6; the others leave room to write between lines. */
export const PRINT_LINE_SPACINGS = [1.6, 2, 2.5, 3] as const;
export const DEFAULT_PRINT_LINE_SPACING = 1.6;

export const PRINT_FONT_SIZE_MIN_PT = 10;
export const PRINT_FONT_SIZE_MAX_PT = 20;
export const DEFAULT_PRINT_FONT_SIZE_PT = 14;

/** Gap between the text and the notes rule, so letters never touch it. */
export const PRINT_NOTES_GAP_CM = 0.5;

/** The preview page at 96 dpi: US Letter with 2 cm page margins, so the iframe is the content area. */
export const PRINT_PREVIEW_PAGE_WIDTH_PX = 816;
export const PRINT_PREVIEW_PAGE_HEIGHT_PX = 1056;
export const PRINT_PREVIEW_PAGE_PADDING_PX = 76;

/** Print colour themes: black and white by default; a theme colours the title and verse numbers only. */
export const PRINT_THEMES = ['bw', 'classic', 'blue', 'green', 'sepia'] as const;
export type PrintTheme = (typeof PRINT_THEMES)[number];

/** The accent each colour theme uses. */
export const PRINT_THEME_COLORS: Readonly<Record<Exclude<PrintTheme, 'bw'>, string>> = {
  classic: '#8b1a1a',
  blue: '#1f4e8c',
  green: '#2e6b3a',
  sepia: '#7a4b1e',
};

/** The words-of-Christ red the passage renderer writes (inline style), recoloured only in a colour theme. */
const WORDS_OF_CHRIST_RED = '#B71C1C';

export const PRINT_VERSE_NUMBERS = ['parenthetical', 'superscript', 'first-full', 'none'] as const;
export type PrintVerseNumbers = (typeof PRINT_VERSE_NUMBERS)[number];

export interface PrintPreferences {
  layout: PrintLayout;
  /** Leave a blank column on the inline-end side for handwritten notes. */
  notesMargin: boolean;
  /** Width of that column, always stored in centimetres whatever unit is shown. */
  notesMarginCm: number;
  /** Draw a faint rule at the notes margin's edge; off by default (plain blank space). */
  notesRule: boolean;
  /** Unit the margin width is shown and chosen in. */
  unit: PrintUnit;
  /** Unitless line-height multiplier. */
  lineSpacing: number;
  /** Body text size in points. */
  fontSizePt: number;
  /** Print the passage title (bold, coloured in a colour theme) above the text. */
  showTitle: boolean;
  /** Colour theme; `bw` is plain black on white. */
  theme: PrintTheme;
  /** Keep the words of Christ in red; only honoured in a colour theme. */
  redLetters: boolean;
  /** How verse numbers are written in the printout; Print's own choice, never Copy's. */
  verseNumbers: PrintVerseNumbers;
}

/** Inches in the US, Liberia and Myanmar; centimetres everywhere else. */
export function defaultPrintUnit(locale?: string): PrintUnit {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale ?? '')?.[1]?.toUpperCase();
  return region === 'US' || region === 'LR' || region === 'MM' ? 'in' : 'cm';
}

export const DEFAULT_PRINT_PREFERENCES: PrintPreferences = {
  layout: 'numbered',
  notesMargin: false,
  notesMarginCm: 5,
  notesRule: false,
  unit: 'cm',
  lineSpacing: DEFAULT_PRINT_LINE_SPACING,
  fontSizePt: DEFAULT_PRINT_FONT_SIZE_PT,
  showTitle: true,
  theme: 'bw',
  redLetters: false,
  verseNumbers: 'parenthetical',
};

export function clampNotesMarginCm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PRINT_PREFERENCES.notesMarginCm;
  return Math.min(PRINT_NOTES_MARGIN_MAX_CM, Math.max(PRINT_NOTES_MARGIN_MIN_CM, value));
}

/** The margin as shown in a unit, snapped to that unit's step (what a slider holds). */
export function notesMarginInUnit(cm: number, unit: PrintUnit): number {
  if (unit === 'cm') return Math.round(clampNotesMarginCm(cm) / PRINT_NOTES_MARGIN_STEP_CM) * PRINT_NOTES_MARGIN_STEP_CM;
  const inches = Math.round(clampNotesMarginCm(cm) / 2.54 / PRINT_NOTES_MARGIN_STEP_IN) * PRINT_NOTES_MARGIN_STEP_IN;
  return Math.min(PRINT_NOTES_MARGIN_MAX_IN, Math.max(PRINT_NOTES_MARGIN_MIN_IN, inches));
}

export function notesMarginFromUnit(value: number, unit: PrintUnit): number {
  return clampNotesMarginCm(unit === 'cm' ? value : value * 2.54);
}

export function clampFontSizePt(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PRINT_FONT_SIZE_PT;
  return Math.min(PRINT_FONT_SIZE_MAX_PT, Math.max(PRINT_FONT_SIZE_MIN_PT, Math.round(value)));
}

/** Each field falls back to its default on its own, so one bad value costs one setting. */
export function normalizePrintPreferences(raw: unknown, defaultUnit: PrintUnit = 'cm'): PrintPreferences {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    layout: (PRINT_LAYOUTS as readonly unknown[]).includes(r.layout)
      ? (r.layout as PrintLayout)
      : DEFAULT_PRINT_PREFERENCES.layout,
    notesMargin: typeof r.notesMargin === 'boolean' ? r.notesMargin : DEFAULT_PRINT_PREFERENCES.notesMargin,
    notesMarginCm: typeof r.notesMarginCm === 'number'
      ? clampNotesMarginCm(r.notesMarginCm)
      : DEFAULT_PRINT_PREFERENCES.notesMarginCm,
    notesRule: typeof r.notesRule === 'boolean' ? r.notesRule : DEFAULT_PRINT_PREFERENCES.notesRule,
    unit: (PRINT_UNITS as readonly unknown[]).includes(r.unit) ? (r.unit as PrintUnit) : defaultUnit,
    lineSpacing: (PRINT_LINE_SPACINGS as readonly unknown[]).includes(r.lineSpacing)
      ? (r.lineSpacing as number)
      : DEFAULT_PRINT_LINE_SPACING,
    fontSizePt: typeof r.fontSizePt === 'number' ? clampFontSizePt(r.fontSizePt) : DEFAULT_PRINT_FONT_SIZE_PT,
    showTitle: typeof r.showTitle === 'boolean' ? r.showTitle : DEFAULT_PRINT_PREFERENCES.showTitle,
    theme: (PRINT_THEMES as readonly unknown[]).includes(r.theme) ? (r.theme as PrintTheme) : DEFAULT_PRINT_PREFERENCES.theme,
    redLetters: typeof r.redLetters === 'boolean' ? r.redLetters : DEFAULT_PRINT_PREFERENCES.redLetters,
    verseNumbers: (PRINT_VERSE_NUMBERS as readonly unknown[]).includes(r.verseNumbers)
      ? (r.verseNumbers as PrintVerseNumbers)
      : DEFAULT_PRINT_PREFERENCES.verseNumbers,
  };
}

/** The passage format a layout renders, or `null` for "whatever the dialog is showing". */
export function printLayoutFormatId(layout: PrintLayout): string | null {
  if (layout === 'numbered') return 'blockquote-numbered';
  if (layout === 'blockquote') return 'blockquote';
  return null;
}

/**
 * The page stylesheet. Text is always black on white. Only the `blockquote` layout (and `preview`, which
 * may contain one) draws the quote line; otherwise a block quote is a plain indent-free paragraph block.
 * The notes margin narrows the text column (an inline-end padding) rather than shrinking the font, and
 * follows the writing direction, so in right-to-left text it is on the left.
 */
export function buildPrintStylesheet(prefs: PrintPreferences): string {
  const quoteLine = prefs.layout !== 'numbered';
  const margin = prefs.notesMargin ? clampNotesMarginCm(prefs.notesMarginCm) : 0;
  const rule = margin > 0 && prefs.notesRule;
  const size = clampFontSizePt(prefs.fontSizePt);
  const lh = (PRINT_LINE_SPACINGS as readonly number[]).includes(prefs.lineSpacing) ? prefs.lineSpacing : DEFAULT_PRINT_LINE_SPACING;
  const font = `font-family: Georgia, "Times New Roman", serif; font-size: ${size}pt; line-height: ${lh};`;
  const body = margin > 0
    ? `body { ${font} max-width: none; margin: 0; padding: 0; padding-inline-end: ${margin + (rule ? PRINT_NOTES_GAP_CM : 0)}cm; box-sizing: border-box; color: #000; background: #fff; }`
    : `body { ${font} max-width: 38em; margin: 2em auto; padding: 0 1em; color: #000; background: #fff; }`;
  return [
    body,
    `h1 { font-size: ${Math.round(size * 1.3 * 10) / 10}pt; font-weight: 700; margin: 0 0 0.6em; line-height: 1.3; }`,
    'h2, h3, h4 { color: #000; }',
    quoteLine
      ? 'blockquote { border-inline-start: 2px solid #000; margin-inline: 0; padding-inline-start: 1em; }'
      : 'blockquote { border: 0; margin: 0 0 0.8em; padding: 0; }',
    '* { color: #000 !important; background: transparent !important; }',
    'sup { font-size: 0.7em; line-height: 0; }',
    ...themeRules(prefs),
    rule
      ? `.notes-rule { position: fixed; top: 0; bottom: 0; inset-inline-end: ${margin}cm; width: 0; border-inline-start: 0.5pt solid #888; }`
      : '',
    '@page { margin: 2cm; }',
  ].filter(Boolean).join('\n      ');
}

/** Colour rules, after the black-on-white reset; empty for the black-and-white theme. */
function themeRules(prefs: PrintPreferences): string[] {
  if (prefs.theme === 'bw') return [];
  const color = PRINT_THEME_COLORS[prefs.theme];
  const rules = [`h1, sup { color: ${color} !important; }`];
  if (prefs.redLetters) rules.push(`span[style*="${WORDS_OF_CHRIST_RED}" i] { color: ${WORDS_OF_CHRIST_RED} !important; }`);
  return rules;
}

/** Whether the passage should be rendered with its words of Christ in red for this print. */
export function printWantsRedLetters(prefs: PrintPreferences): boolean {
  return prefs.theme !== 'bw' && prefs.redLetters;
}

function escapeTitle(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The title heading, or nothing when the title is switched off. */
export function printTitleHtml(title: string, prefs: PrintPreferences): string {
  return prefs.showTitle ? `<h1>${escapeTitle(title)}</h1>` : '';
}

/** The faint rule that marks the notes column; empty when there is no margin. */
export function printNotesRuleHtml(prefs: PrintPreferences): string {
  return prefs.notesMargin && prefs.notesRule ? '<div class="notes-rule" aria-hidden="true"></div>' : '';
}
