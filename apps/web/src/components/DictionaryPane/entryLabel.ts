/**
 * The Strong's number this entry represents, or null for an ordinary dictionary.
 * Strong's entry keys are 5-digit zero-padded and carry no prefix ("00025"), so
 * the G/H comes from which of the two lexicons the tab is showing.
 */
export function strongsNumberFor(moduleAbbr: string, entryKey: string): string | null {
  if (!/^strongs/i.test(moduleAbbr)) return null;
  const m = /^0*(\d+)([A-Za-z]?)$/.exec(entryKey.trim());
  if (!m) return null;
  return `${/hebrew/i.test(moduleAbbr) ? 'H' : 'G'}${m[1]}${m[2].toUpperCase()}`;
}

/**
 * Heading/link label: a Strong's zero-padded key ("00746") reads as users know
 * it ("G746"), followed by the original word when the server sent one ("G26 ἀγάπη").
 */
export function entryLabel(moduleAbbr: string, word: string | undefined, entryKey: string): string {
  const text = word || entryKey;
  if (/^\d+[A-Za-z]?$/.test(text)) return strongsNumberFor(moduleAbbr, text) ?? text;
  const number = strongsNumberFor(moduleAbbr, entryKey);
  return number && text !== number ? `${number} ${text}` : text;
}

