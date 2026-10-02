/**
 * One parser for the CrossWire Strong's dictionary definition format:
 *   "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o} \n perhaps from agan (much); to love ...:--(be-)love(-ed). Compare 5368."
 */

export interface ParsedStrongsDefinition {
  number: number;
  originalWord?: string;
  transliteration?: string;
  pronunciation?: string;
  /** Text between the header and ":--" (the derivation and sense). */
  sense: string;
  /** Strong's own KJV rendering list after ":--", split on commas. */
  lexiconRenderings: string[];
  derivedFrom?: number;
  seeRefs: number[];
  compareRefs: number[];
}

export function parseStrongsDefinition(raw: string, language: 'Greek' | 'Hebrew'): ParsedStrongsDefinition {
  const def = raw ?? '';
  const numMatch = def.match(/^\s*(\d+)/);
  const sep = def.indexOf(':--');
  // Greek: "25 ἀγαπάω ajgapavw agapao {ag-ap-ah'-o} ..."
  // Hebrew: "157 'ahab aw-hab' or raheb {aw-habe'}; ..." (transliteration, pronunciation, optional variant, optional braces)
  const greek = language === 'Greek' ? def.match(/^\s*(\d+)\s+(\S+)\s+\S+\s+(\S+)\s*\{([^}]*)\}/) : null;
  const hebrew = language === 'Hebrew' ? def.match(/^\s*(\d+)\s+(\S+)\s+(\S+)(?:\s+or\s+\S+)?(?:\s*\{[^}]*\})?\s*;?/) : null;
  const header = greek ?? hebrew;
  const headerEnd = header ? (header.index ?? 0) + header[0].length : 0;

  let sense = '';
  if (sep >= 0) sense = def.slice(headerEnd, sep);
  else if (header) sense = def.slice(headerEnd);
  sense = sense.replace(/\s+/g, ' ').trim();

  let lexiconRenderings: string[] = [];
  if (sep >= 0) {
    const tail = def.slice(sep + 3)
      .replace(/\s*see\s+(?:GREEK|HEBREW)\s+for\s+\d+\s*/gi, ' ')
      .replace(/\bCompare\s+\d+\.?/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[.\s]+$/, '')
      .trim();
    lexiconRenderings = tail.split(',').map(s => s.trim()).filter(Boolean);
  }

  const fromMatch = def.match(/\b(?:from|plural of|feminine of|masculine of)\s+(\d+)\s*[;,]/);
  const derivedFrom = fromMatch ? parseInt(fromMatch[1], 10) : undefined;
  const seeRefs: number[] = [];
  const lang = language === 'Greek' ? 'GREEK' : 'HEBREW';
  for (const m of def.matchAll(new RegExp(`see\\s+${lang}\\s+for\\s+0*(\\d+)`, 'gi'))) {
    const n = parseInt(m[1], 10);
    if (n !== derivedFrom && !seeRefs.includes(n)) seeRefs.push(n);
  }
  const compareRefs: number[] = [];
  for (const m of def.matchAll(/\bCompare\s+(\d+)\b/gi)) {
    const n = parseInt(m[1], 10);
    if (!compareRefs.includes(n)) compareRefs.push(n);
  }

  return {
    number: numMatch ? parseInt(numMatch[1], 10) : 0,
    originalWord: greek?.[2],
    transliteration: greek ? greek[3] : hebrew?.[2],
    pronunciation: greek ? greek[4] : hebrew?.[3],
    sense,
    lexiconRenderings,
    derivedFrom,
    seeRefs,
    compareRefs,
  };
}
