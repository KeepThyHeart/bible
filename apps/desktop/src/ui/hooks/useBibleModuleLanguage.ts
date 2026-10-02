import { useBibleStore } from '../stores/useBibleStore';

/**
 * The language code of an installed Bible module, or `undefined` when unknown.
 * Text from that module follows this language's direction, not the UI's.
 */
export function useBibleModuleLanguage(abbreviation: string | undefined | null): string | undefined {
  return useBibleStore(s => (abbreviation ? s.availableBibles?.find(b => b.abbreviation === abbreviation)?.language_code : undefined));
}
