/**
 * Display capitalization for keyword-mark labels (task 0065, round 09).
 *
 * Divine names and titles are always shown capitalized, out of respect ("God", "Jesus", "Lord"), in
 * every language that has letter case. This changes what is *shown*; matching is unaffected. Labels the
 * text already spells in capitals (the KJV small-caps "LORD") are left as they are.
 */
import { primaryLanguage } from './connectives';

/** lower-case form -> displayed form, per primary language. Multi-word entries are matched as phrases. */
const DIVINE_NAMES: Record<string, Record<string, string>> = {
  en: {
    god: 'God', jesus: 'Jesus', christ: 'Christ', lord: 'Lord', messiah: 'Messiah', almighty: 'Almighty',
    jehovah: 'Jehovah', yahweh: 'Yahweh', savior: 'Savior', saviour: 'Saviour', 'holy spirit': 'Holy Spirit',
    'holy ghost': 'Holy Ghost', 'son of god': 'Son of God', 'son of man': 'Son of Man', 'jesus christ': 'Jesus Christ',
  },
  es: {
    dios: 'Dios', jesús: 'Jesús', jesus: 'Jesús', cristo: 'Cristo', señor: 'Señor', mesías: 'Mesías', todopoderoso: 'Todopoderoso',
    jehová: 'Jehová', yahvé: 'Yahvé', 'espíritu santo': 'Espíritu Santo', 'hijo de dios': 'Hijo de Dios', 'hijo del hombre': 'Hijo del Hombre',
  },
  pt: {
    deus: 'Deus', jesus: 'Jesus', cristo: 'Cristo', senhor: 'Senhor', messias: 'Messias', 'todo-poderoso': 'Todo-Poderoso', jeová: 'Jeová', 'espírito santo': 'Espírito Santo', 'filho de deus': 'Filho de Deus', 'filho do homem': 'Filho do Homem',
  },
  ru: {
    бог: 'Бог', иисус: 'Иисус', христос: 'Христос', господь: 'Господь', господа: 'Господа', господу: 'Господу', богу: 'Богу',
    бога: 'Бога', богом: 'Богом', мессия: 'Мессия', иегова: 'Иегова', 'дух святой': 'Дух Святой', 'святой дух': 'Святой Дух',
  },
};

const ALL_LANGUAGES = Object.keys(DIVINE_NAMES);

function isAllCaps(s: string): boolean {
  return s.length > 1 && s === s.toUpperCase() && s !== s.toLowerCase();
}

/**
 * The label as it should be shown. Whole-label and word-by-word: "god" -> "God", "the lord jesus" ->
 * "the Lord Jesus". `language` picks the name table; without it every table applies. Idempotent.
 */
export function displayKeywordLabel(label: string, language?: string): string {
  if (!label) return label;
  const langs = language ? [primaryLanguage(language)].filter((l) => l in DIVINE_NAMES) : ALL_LANGUAGES;
  if (langs.length === 0) return label;
  const table: Record<string, string> = {};
  for (const l of langs) Object.assign(table, DIVINE_NAMES[l]);
  const phrases = Object.keys(table).filter((k) => k.includes(' ')).sort((a, b) => b.length - a.length);
  let out = label;
  // Phrases first, on word boundaries (Unicode-aware, case-insensitive), skipping all-caps text.
  for (const p of phrases) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${p.replace(/ /g, '\\s+')})(?![\\p{L}\\p{N}])`, 'giu'), (m, pre: string, hit: string) =>
      isAllCaps(hit) ? m : pre + table[p]);
  }
  return out.replace(/[\p{L}\p{M}'’-]+/gu, (w) => {
    if (isAllCaps(w)) return w;
    return table[w.toLowerCase()] ?? w;
  });
}
