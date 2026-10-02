/** Language tag helpers shared by every text tool. */

/** Primary language subtag, lower-cased ("en-US" -> "en", "pt_BR" -> "pt"). */
export function primaryLanguage(tag: string | undefined): string {
  return (tag ?? '').toLowerCase().split(/[-_]/)[0];
}

const ISO_639_2_TO_1: Record<string, string> = {
  eng: 'en', spa: 'es', por: 'pt', fra: 'fr', fre: 'fr', ita: 'it',
  deu: 'de', ger: 'de', nld: 'nl', dut: 'nl', grc: 'el', ell: 'el', gre: 'el', heb: 'he',
};

/** Primary subtag with three-letter ISO 639-2 codes mapped to their two-letter form ("spa" -> "es"). */
export function canonicalLanguage(tag: string | undefined): string {
  const p = primaryLanguage(tag);
  return ISO_639_2_TO_1[p] ?? p;
}
