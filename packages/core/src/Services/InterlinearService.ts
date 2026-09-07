import { InterlinearWord } from '../Data/Models/Bible/BibleVerse';

/**
 * Formatted interlinear word for display
 */
export interface FormattedInterlinearWord {
  position: number;
  originalWord: string;
  transliteration: string;
  strongsNumber: string;
  gloss: string;
  morphology?: string;
  language: 'Greek' | 'Hebrew' | 'Aramaic';
}

/**
 * Service for formatting and processing interlinear data
 */
export class InterlinearService {
  /**
   * Format interlinear words for display
   */
  static formatForDisplay(words: InterlinearWord[]): FormattedInterlinearWord[] {
    return words.map(word => ({
      position: word.wordPositionStart,
      originalWord: word.originalWord || '',
      transliteration: word.transliteration || '',
      strongsNumber: word.strongsNumber || '',
      gloss: word.gloss || '',
      morphology: word.morphology,
      language: this.detectLanguage(word.strongsNumber)
    }));
  }

  /**
   * Detect language from Strong's number prefix
   */
  static detectLanguage(strongsNumber?: string): 'Greek' | 'Hebrew' | 'Aramaic' {
    if (!strongsNumber) return 'Greek';

    if (strongsNumber.startsWith('H')) {
      return 'Hebrew';
    } else if (strongsNumber.startsWith('G')) {
      return 'Greek';
    } else if (strongsNumber.startsWith('A')) {
      return 'Aramaic';
    }

    return 'Greek';
  }

  /**
   * Parse morphology code into readable form
   */
  static parseMorphology(morphCode?: string): string {
    if (!morphCode) return '';

    // Simple parsing for common patterns
    // Greek: V-AAI-3S = Verb, Aorist, Active, Indicative, 3rd Person, Singular
    // Hebrew: varies by source

    // This is a simplified version - expand based on actual morphology codes
    const parts: string[] = [];

    if (morphCode.includes('V')) parts.push('Verb');
    if (morphCode.includes('N')) parts.push('Noun');
    if (morphCode.includes('A')) parts.push('Adjective');

    return parts.join(', ') || morphCode;
  }

  /**
   * Get color coding for part of speech
   */
  static getPartOfSpeechColor(morphCode?: string): string {
    if (!morphCode) return 'text-gray-700';

    const firstChar = morphCode.charAt(0);

    switch (firstChar) {
      case 'V': return 'text-blue-700';      // Verbs - blue
      case 'N': return 'text-green-700';     // Nouns - green
      case 'A': return 'text-purple-700';    // Adjectives - purple
      case 'P': return 'text-orange-700';    // Pronouns - orange
      case 'C': return 'text-red-700';       // Conjunctions - red
      case 'D': return 'text-yellow-700';    // Adverbs - yellow
      case 'R': return 'text-pink-700';      // Prepositions - pink
      default: return 'text-gray-700';
    }
  }

  /**
   * Format Strong's number for display (remove prefix, pad with zeros)
   */
  static formatStrongsNumber(strongsNumber: string): string {
    if (!strongsNumber) return '';

    // Extract prefix and number
    const match = strongsNumber.match(/^([GHA])(\d+)$/);
    if (!match) return strongsNumber;

    const [, prefix, number] = match;
    const paddedNumber = number.padStart(4, '0');

    return `${prefix}${paddedNumber}`;
  }

  /**
   * Group interlinear words by English word position
   * Useful for inline display
   */
  static groupByPosition(words: InterlinearWord[]): Map<number, InterlinearWord[]> {
    const grouped = new Map<number, InterlinearWord[]>();

    for (const word of words) {
      for (let pos = word.wordPositionStart; pos <= word.wordPositionEnd; pos++) {
        const existing = grouped.get(pos) || [];
        existing.push(word);
        grouped.set(pos, existing);
      }
    }

    return grouped;
  }

  /**
   * Check if a verse has interlinear data
   */
  static hasInterlinearData(words: InterlinearWord[]): boolean {
    return words.length > 0;
  }

  /**
   * Get interlinear statistics for a verse
   */
  static getStatistics(words: InterlinearWord[]): {
    totalWords: number;
    withStrongs: number;
    withMorphology: number;
    withGloss: number;
  } {
    return {
      totalWords: words.length,
      withStrongs: words.filter(w => w.strongsNumber).length,
      withMorphology: words.filter(w => w.morphology).length,
      withGloss: words.filter(w => w.gloss).length
    };
  }

  /**
   * Create tooltip text for a Strong's number
   */
  static createStrongsTooltip(word: InterlinearWord): string {
    const parts: string[] = [];

    if (word.strongsNumber) {
      parts.push(`Strong's: ${this.formatStrongsNumber(word.strongsNumber)}`);
    }

    if (word.lemma) {
      parts.push(`Lemma: ${word.lemma}`);
    }

    if (word.morphology) {
      parts.push(`Morphology: ${this.parseMorphology(word.morphology)}`);
    }

    if (word.gloss) {
      parts.push(`Meaning: ${word.gloss}`);
    }

    return parts.join('\n') || 'Click for dictionary entry';
  }
}
