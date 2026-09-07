/**
 * Strong's Number Helper
 *
 * Normalizes Strong's number formats across the different storage schemes:
 * - User input: "G25", "H7225" (no zero-padding)
 * - Interlinear (Greek): "G25", "G3588" (no zero-padding)
 * - Interlinear (Hebrew): "H07225", "H0430" (variable zero-padding)
 * - Dictionary entry_key: "00025", "07225" (5-digit zero-padded, no prefix)
 */

export type StrongsLanguage = 'Greek' | 'Hebrew';

export interface ParsedStrongsNumber {
  prefix: 'G' | 'H';
  number: number;
  language: StrongsLanguage;
}

export class StrongsNumberHelper {
  /**
   * Parse a Strong's number string into its components.
   * Accepts formats like "G25", "H7225", "g0025", "strongs:G25"
   */
  static parse(input: string): ParsedStrongsNumber | null {
    if (!input) return null;

    // Strip optional "strongs:" prefix
    let cleaned = input.trim();
    if (cleaned.toLowerCase().startsWith('strongs:')) {
      cleaned = cleaned.substring(8);
    }

    const match = cleaned.match(/^([GH])0*(\d+)$/i);
    if (!match) return null;

    const prefix = match[1].toUpperCase() as 'G' | 'H';
    const num = parseInt(match[2], 10);
    if (num <= 0) return null;

    return {
      prefix,
      number: num,
      language: prefix === 'G' ? 'Greek' : 'Hebrew',
    };
  }

  /**
   * Check if a string looks like a Strong's number
   */
  static isStrongsNumber(input: string): boolean {
    return this.parse(input) !== null;
  }

  /**
   * Convert to the 5-digit zero-padded format used in dictionary_entry.entry_key
   * "G25" -> "00025", "H7225" -> "07225"
   */
  static toDictionaryKey(input: string): string | null {
    const parsed = this.parse(input);
    if (!parsed) return null;
    return String(parsed.number).padStart(5, '0');
  }

  /**
   * Convert to canonical display format: "G25", "H7225" (no zero-padding)
   */
  static toDisplayFormat(input: string): string | null {
    const parsed = this.parse(input);
    if (!parsed) return null;
    return `${parsed.prefix}${parsed.number}`;
  }

  /**
   * Get all plausible interlinear format variants for a Strong's number.
   * Hebrew has variable zero-padding in the interlinear data, so we generate
   * multiple variants to match against.
   *
   * Greek: just "G25" (no padding observed)
   * Hebrew: "H7225", "H07225", "H007225" (variable padding observed)
   */
  static toInterlinearVariants(input: string): string[] {
    const parsed = this.parse(input);
    if (!parsed) return [];

    const numStr = String(parsed.number);
    const variants = new Set<string>();

    // Always include the bare number (no extra padding)
    variants.add(`${parsed.prefix}${numStr}`);

    if (parsed.prefix === 'H') {
      // Hebrew: add zero-padded variants up to 5 digits
      for (let len = numStr.length + 1; len <= 5; len++) {
        variants.add(`${parsed.prefix}${numStr.padStart(len, '0')}`);
      }
    }

    return Array.from(variants);
  }

  /**
   * Build a SQL WHERE clause fragment for matching a Strong's number
   * in the interlinear_word table, handling variable padding.
   *
   * Returns { clause: string, params: string[] } for use in parameterized queries.
   */
  static buildInterlinearWhereClause(strongsNumber: string): { clause: string; params: string[] } | null {
    const variants = this.toInterlinearVariants(strongsNumber);
    if (variants.length === 0) return null;

    const placeholders = variants.map(() => '?').join(', ');
    return {
      clause: `strongs_number IN (${placeholders})`,
      params: variants,
    };
  }

  /**
   * Get the dictionary module name for a Strong's number
   */
  static getDictionaryModule(input: string): string | null {
    const parsed = this.parse(input);
    if (!parsed) return null;
    return parsed.prefix === 'G' ? 'strongsgreek' : 'strongshebrew';
  }
}
