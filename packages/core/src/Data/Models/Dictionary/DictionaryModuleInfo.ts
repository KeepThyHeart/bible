import { BaseModuleInfo, BaseModuleInfoData } from '../BaseModuleInfo';
import { DictionaryType } from '../../Core/Types';

/**
 * Dictionary module types.
 *
 * Defined in `Core/Types.ts` - the single source of truth for the open enums
 * which carry no SQL CHECK constraints. Re-exported
 * here so existing imports from this module keep working.
 */
export type { DictionaryType };

/**
 * Dictionary module information from the module_info table.
 * Stored within each dictionary module database (dictionary_*.db).
 */
export class DictionaryModuleInfo extends BaseModuleInfo {
  readonly moduleType = 'dictionary' as const;
  dictionaryType: DictionaryType;
  languageFrom?: string;
  languageTo: string;

  constructor(data: BaseModuleInfoData & {
    moduleType?: 'dictionary';
    dictionaryType: DictionaryType;
    languageFrom?: string;
    languageTo?: string;
  }) {
    super(data);
    this.dictionaryType = data.dictionaryType;
    this.languageFrom = data.languageFrom;
    this.languageTo = data.languageTo ?? 'en';
  }

  /** Get the full display name with type. */
  getDisplayName(): string {
    const typeStr = this.getTypeDescription();
    return `${this.fullName} (${typeStr})`;
  }

  /** Get a human-readable description of the dictionary type. */
  getTypeDescription(): string {
    const descriptions: Record<DictionaryType, string> = {
      strongs: "Strong's Concordance",
      greek_lexicon: 'Greek Lexicon',
      hebrew_lexicon: 'Hebrew Lexicon',
      bible_dictionary: 'Bible Dictionary',
      topical: 'Topical Dictionary'
    };
    return descriptions[this.dictionaryType];
  }

  /** Check if this is a Strong's Concordance. */
  isStrongsConcordance(): boolean {
    return this.dictionaryType === 'strongs';
  }

  /** Check if this is a lexicon (Greek or Hebrew). */
  isLexicon(): boolean {
    return this.dictionaryType === 'greek_lexicon' || this.dictionaryType === 'hebrew_lexicon';
  }

  /** Check if this is a Greek lexicon. */
  isGreekLexicon(): boolean {
    return this.dictionaryType === 'greek_lexicon';
  }

  /** Check if this is a Hebrew lexicon. */
  isHebrewLexicon(): boolean {
    return this.dictionaryType === 'hebrew_lexicon';
  }

  /** Get the language pair (e.g., "Greek to English"). */
  getLanguagePair(): string {
    if (this.languageFrom) {
      return `${this.languageFrom} to ${this.languageTo}`;
    }
    return this.languageTo;
  }
}
