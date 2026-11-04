/**
 * Pulls the clean headword out of a raw Strong's definition, which opens
 * "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o} ...": original word, then the
 * encoded transliteration ("ajgapavw", Strong's own ASCII-ised Greek), then the
 * readable one and the pronunciation. The `transliteration` column holds the
 * encoded form, which reads as garbage in a heading (B-018).
 */
export function parseStrongsHeadline(definition: string): { word: string; transliteration: string; pronunciation: string } | null {
  const m = /^\s*\d+\s+(\S+)\s+\S+\s+(\S+)\s+\{([^}]+)\}/.exec(definition ?? '');
  return m ? { word: m[1], transliteration: m[2], pronunciation: m[3] } : null;
}


const HEAD = /^\s*\d+\s+\S+\s+\S+\s+\S+\s*\{[^}]*\}\s*/;

/** The definition without its raw "25 word encoded readable {pron}" opening line. */
export function stripStrongsHeadline(definition: string): string {
  return (definition ?? '').replace(HEAD, '');
}
