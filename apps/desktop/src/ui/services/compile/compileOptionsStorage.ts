/**
 * Remembered options of the "compile passage notes" dialog (localStorage,
 * per-field validation, best-effort writes - same approach as
 * `copyFormats/passageMarkupPreferences.ts`).
 */
import type { CompileOptions } from './compilePassageNotes';

const OPTIONS_KEY = 'bible-desktop-compile-options';
const FOLDER_KEY = 'bible-desktop-compile-options-folder';

export const DEFAULT_COMPILE_OPTIONS: CompileOptions = {
  canonicalOrder: false,
  includeVerseText: true,
  translation: '',
  redLetters: true,
  versesWithoutNotes: 'skip',
  blankLines: 5,
  passageHeadings: true,
  showTranslation: false,
  verseLabel: 'reference',
};

const WITHOUT_NOTES = ['skip', 'blank-space', 'text-only'] as const;
const VERSE_LABELS = ['reference', 'number', 'none'] as const;

function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], d: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d;
}

/** Validate an untrusted record field by field; each bad field falls back to its default. */
export function normalizeCompileOptions(raw: unknown): CompileOptions {
  const d = DEFAULT_COMPILE_OPTIONS;
  const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const blank = o.blankLines;
  return {
    canonicalOrder: bool(o.canonicalOrder, d.canonicalOrder),
    includeVerseText: bool(o.includeVerseText, d.includeVerseText),
    translation: typeof o.translation === 'string' ? o.translation : d.translation,
    redLetters: bool(o.redLetters, d.redLetters),
    versesWithoutNotes: oneOf(o.versesWithoutNotes, WITHOUT_NOTES, d.versesWithoutNotes),
    blankLines:
      typeof blank === 'number' && Number.isInteger(blank) && blank >= 0 && blank <= 50 ? blank : d.blankLines,
    passageHeadings: bool(o.passageHeadings, d.passageHeadings),
    showTranslation: bool(o.showTranslation, d.showTranslation),
    verseLabel: oneOf(o.verseLabel, VERSE_LABELS, d.verseLabel),
  };
}

export function loadCompileOptions(): CompileOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    return normalizeCompileOptions(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_COMPILE_OPTIONS };
  }
}

export function saveCompileOptions(options: CompileOptions): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Best-effort.
  }
}

export function loadCompileFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveCompileFolder(folder: string): void {
  try {
    localStorage.setItem(FOLDER_KEY, folder);
  } catch {
    // Best-effort.
  }
}
