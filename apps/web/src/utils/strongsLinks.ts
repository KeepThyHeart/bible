/**
 * Auto-link Strong's cross-references in dictionary definitions.
 * Patterns matched:
 *   "see GREEK for 1234"  → G1234
 *   "see HEBREW for 0175" → H0175
 *   "GREEK for 1234"      → G1234
 *   "HEBREW for 0175"     → H0175
 */
export function linkStrongsRefs(html: string, currentModule: string): string {
  // Link "see GREEK for NNNN" / "see HEBREW for NNNN" patterns
  html = html.replace(
    /\b(see\s+)?(GREEK|HEBREW)\s+for\s+0*(\d+)/gi,
    (_match, seePrefix, lang, num) => {
      const prefix = lang.toUpperCase().startsWith('G') ? 'G' : 'H';
      const strongsNum = `${prefix}${num}`;
      const display = `${seePrefix || ''}${lang} for ${num}`;
      return `<a href="#" class="strongs-link" data-strongs="${strongsNum}">${display}</a>`;
    }
  );

  // Link "Compare NNNN" or "compare NNNN" within Strong's dictionaries
  if (currentModule.startsWith('strongs')) {
    const prefix = currentModule === 'strongshebrew' ? 'H' : 'G';
    html = html.replace(
      /\b([Cc]ompare)\s+(\d{1,5})\b/g,
      (_match, compareWord, num) => {
        const strongsNum = `${prefix}${num}`;
        return `${compareWord} <a href="#" class="strongs-link" data-strongs="${strongsNum}">${num}</a>`;
      }
    );
  }

  return html;
}
