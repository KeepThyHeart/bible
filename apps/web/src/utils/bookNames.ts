import i18n from '../i18n';

/** Get localized book name for display (i18n primary, English fallback). */
export function getLocalizedBookName(bookNumber: number): string {
  return i18n.t(String(bookNumber), { ns: 'books', defaultValue: `Book ${bookNumber}` });
}

/** Get all 66 book names from i18n as Record<number, string> (for parsing/search). */
export function getAllBookNames(): Record<number, string> {
  const result: Record<number, string> = {};
  for (let i = 1; i <= 66; i++) {
    result[i] = i18n.t(String(i), { ns: 'books' });
  }
  return result;
}
