/**
 * Word Family Service
 *
 * Resolves word families (related words sharing a common root) from Strong's
 * dictionary data. Parses cross-references embedded in definitions to build
 * a bidirectional relationship graph.
 *
 * Definition cross-reference patterns:
 * - "from 25; love..." -> G26 derives from G25
 * - "see GREEK for 25" / "see HEBREW for 430" -> related entry
 * - "Compare 5368" -> weaker relationship
 */

import { IDictionaryRepository } from '../Data/Repositories/IDictionaryRepository';
import { StrongsNumberHelper, StrongsLanguage } from '../Data/Core/StrongsNumberHelper';

export type WordFamilyRelationship = 'self' | 'parent' | 'child' | 'related';

export interface WordFamilyMember {
  strongsNumber: string;          // Display format: "G25"
  word?: string;                  // Original language word (unicode)
  transliteration?: string;
  gloss: string;                  // Brief English meaning
  relationship: WordFamilyRelationship;
  occurrenceCount?: number;
}

export interface WordFamily {
  primary: WordFamilyMember;
  members: WordFamilyMember[];    // All members including primary
}

/**
 * Parsed header from a Strong's definition string.
 * Format: "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o}"
 */
interface DefinitionHeader {
  number: number;
  originalWord?: string;          // Unicode original (ἀγαπάω)
  transliteration?: string;       // Readable romanization (agapao)
  pronunciation?: string;         // In braces {ag-ap-ah'-o}
}

/**
 * Parsed gloss from after the ":--" separator in a definition
 */
interface ParsedGloss {
  gloss: string;
  derivedFrom?: number;           // "from <N>" reference
  seeRefs: number[];              // "see GREEK/HEBREW for <N>" references
  compareRefs: number[];          // "Compare <N>" references
}

export class WordFamilyService {
  private greekDict: IDictionaryRepository | null;
  private hebrewDict: IDictionaryRepository | null;

  // Cached family graph: maps "G25" -> Set of related display-format numbers
  private familyGraph: Map<string, Set<string>> | null = null;
  // Cached entry metadata for quick lookup
  private entryCache: Map<string, { word?: string; transliteration?: string; gloss: string }> | null = null;
  // Cached derivation direction: "G26" -> "G25" means G26 derives from G25
  private derivedFrom: Map<string, string> | null = null;

  constructor(
    greekDict: IDictionaryRepository | null,
    hebrewDict: IDictionaryRepository | null
  ) {
    this.greekDict = greekDict;
    this.hebrewDict = hebrewDict;
  }

  /**
   * Get the word family for a Strong's number.
   * Returns the primary word plus all related words.
   */
  getWordFamily(strongsNumber: string): WordFamily | null {
    this.ensureInitialized();

    const display = StrongsNumberHelper.toDisplayFormat(strongsNumber);
    if (!display) return null;

    const cached = this.entryCache!.get(display);
    if (!cached) return null;

    const primary: WordFamilyMember = {
      strongsNumber: display,
      word: cached.word,
      transliteration: cached.transliteration,
      gloss: cached.gloss,
      relationship: 'self',
    };

    const relatedSet = this.familyGraph!.get(display);
    const members: WordFamilyMember[] = [primary];

    if (relatedSet) {
      for (const relatedNum of relatedSet) {
        if (relatedNum === display) continue;
        const relatedEntry = this.entryCache!.get(relatedNum);
        if (!relatedEntry) continue;

        // Determine relationship direction
        let relationship: WordFamilyRelationship = 'related';
        if (this.derivedFrom!.get(relatedNum) === display) {
          relationship = 'child';  // relatedNum derives from primary
        } else if (this.derivedFrom!.get(display) === relatedNum) {
          relationship = 'parent'; // primary derives from relatedNum
        }

        members.push({
          strongsNumber: relatedNum,
          word: relatedEntry.word,
          transliteration: relatedEntry.transliteration,
          gloss: relatedEntry.gloss,
          relationship,
        });
      }
    }

    return { primary, members };
  }

  /**
   * Get just the related Strong's numbers (display format) for a given number.
   */
  getRelatedNumbers(strongsNumber: string): string[] {
    this.ensureInitialized();

    const display = StrongsNumberHelper.toDisplayFormat(strongsNumber);
    if (!display) return [];

    const related = this.familyGraph!.get(display);
    if (!related) return [];

    return Array.from(related).filter(n => n !== display);
  }

  /**
   * Get cached entry info for a Strong's number (word, transliteration, gloss).
   */
  getEntryInfo(strongsNumber: string): { word?: string; transliteration?: string; gloss: string } | null {
    this.ensureInitialized();

    const display = StrongsNumberHelper.toDisplayFormat(strongsNumber);
    if (!display) return null;

    return this.entryCache!.get(display) ?? null;
  }

  /**
   * Build the family graph from dictionary data (lazy, called once).
   */
  private ensureInitialized(): void {
    if (this.familyGraph) return;

    this.familyGraph = new Map();
    this.entryCache = new Map();
    this.derivedFrom = new Map();

    if (this.greekDict) {
      this.indexDictionary(this.greekDict, 'Greek');
    }
    if (this.hebrewDict) {
      this.indexDictionary(this.hebrewDict, 'Hebrew');
    }
  }

  /**
   * Scan all entries in a dictionary and build the relationship graph.
   */
  private indexDictionary(dict: IDictionaryRepository, language: StrongsLanguage): void {
    const prefix = language === 'Greek' ? 'G' : 'H';

    // Load all entries (dictionaries are small: ~6K Greek, ~9K Hebrew)
    const entries = dict.getAllEntries({ limit: 20000 });

    for (const entry of entries) {
      // Dictionary keys are zero-padded without prefix: "00025"
      const num = parseInt(entry.entryKey, 10);
      if (isNaN(num) || num <= 0) continue;

      const displayNum = `${prefix}${num}`;

      // Parse the definition to extract metadata and cross-references
      const header = this.parseDefinitionHeader(entry.definition);
      const glossInfo = this.parseGlossAndRefs(entry.definition, prefix);

      // Cache entry info
      this.entryCache!.set(displayNum, {
        word: header.originalWord,
        transliteration: header.transliteration,
        gloss: glossInfo.gloss,
      });

      // Build relationships from "from <N>" (derivation)
      if (glossInfo.derivedFrom) {
        const parentNum = `${prefix}${glossInfo.derivedFrom}`;
        this.derivedFrom!.set(displayNum, parentNum);
        this.addEdge(displayNum, parentNum);
      }

      // Build relationships from "see GREEK/HEBREW for <N>"
      for (const ref of glossInfo.seeRefs) {
        const refNum = `${prefix}${ref}`;
        this.addEdge(displayNum, refNum);
      }

      // Build relationships from "Compare <N>"
      for (const ref of glossInfo.compareRefs) {
        const refNum = `${prefix}${ref}`;
        this.addEdge(displayNum, refNum);
      }
    }
  }

  /**
   * Add a bidirectional edge in the family graph.
   */
  private addEdge(a: string, b: string): void {
    if (!this.familyGraph!.has(a)) {
      this.familyGraph!.set(a, new Set());
    }
    if (!this.familyGraph!.has(b)) {
      this.familyGraph!.set(b, new Set());
    }
    this.familyGraph!.get(a)!.add(b);
    this.familyGraph!.get(b)!.add(a);
  }

  /**
   * Parse the header line of a Strong's definition.
   * Format: "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o}"
   *
   * The pattern is: number, unicode original, betacode, transliteration, {pronunciation}
   */
  parseDefinitionHeader(definition: string): DefinitionHeader {
    // Match: number, then words up to the braces
    const headerMatch = definition.match(/^(\d+)\s+(\S+)\s+\S+\s+(\S+)\s*\{([^}]*)\}/);
    if (headerMatch) {
      return {
        number: parseInt(headerMatch[1], 10),
        originalWord: headerMatch[2],
        transliteration: headerMatch[3],
        pronunciation: headerMatch[4],
      };
    }

    // Fallback: just get the number
    const numMatch = definition.match(/^(\d+)/);
    return {
      number: numMatch ? parseInt(numMatch[1], 10) : 0,
    };
  }

  /**
   * Parse gloss text and cross-references from a definition.
   *
   * Looks for:
   * - ":--" separator to extract the gloss
   * - "from <N>" to find derivation
   * - "see GREEK for <N>" or "see HEBREW for <N>" for cross-refs
   * - "Compare <N>" for related entries
   */
  parseGlossAndRefs(definition: string, expectedPrefix: string): ParsedGloss {
    let gloss = '';
    let derivedFrom: number | undefined;
    const seeRefs: number[] = [];
    const compareRefs: number[] = [];

    // Extract gloss from after ":--"
    const glossSep = definition.indexOf(':--');
    if (glossSep >= 0) {
      const glossPart = definition.substring(glossSep + 3).trim();
      // Clean: remove "see GREEK/HEBREW for ..." references and trailing whitespace
      gloss = glossPart
        .replace(/\s*see\s+(?:GREEK|HEBREW)\s+for\s+\d+\s*/gi, '')
        .replace(/\s*\.\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Parse "from <N>" - derivation (usually near start of meaning section)
    // Match patterns like "from 25;" or "from 25," but not "from the" etc.
    const fromMatch = definition.match(/\bfrom\s+(\d+)\s*[;,]/);
    if (fromMatch) {
      derivedFrom = parseInt(fromMatch[1], 10);
    }

    // Parse "see GREEK for <N>" and "see HEBREW for <N>"
    const expectedLang = expectedPrefix === 'G' ? 'GREEK' : 'HEBREW';
    const seeRegex = new RegExp(`see\\s+${expectedLang}\\s+for\\s+0*(\\d+)`, 'gi');
    let seeMatch;
    while ((seeMatch = seeRegex.exec(definition)) !== null) {
      const refNum = parseInt(seeMatch[1], 10);
      // Don't add the derivedFrom as a seeRef too (avoid double-counting)
      if (refNum !== derivedFrom && !seeRefs.includes(refNum)) {
        seeRefs.push(refNum);
      }
    }

    // Parse "Compare <N>"
    const compareRegex = /\bCompare\s+(\d+)\b/gi;
    let compMatch;
    while ((compMatch = compareRegex.exec(definition)) !== null) {
      const refNum = parseInt(compMatch[1], 10);
      if (!compareRefs.includes(refNum)) {
        compareRefs.push(refNum);
      }
    }

    return { gloss, derivedFrom, seeRefs, compareRefs };
  }
}
