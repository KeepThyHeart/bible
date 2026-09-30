/**
 * Display capitalization for keyword-mark labels (task 0065, round 09).
 *
 * Divine names and titles are always shown capitalized, out of respect ("God", "Jesus"), in
 * every language that has letter case. Ambiguous titles ("lord", señor, senhor, Herr, seigneur, господа) are NOT in
 * the tables: they can address a human master, so they stay as typed or as the text has them. This changes what is *shown*; matching is unaffected. Labels the
 * text already spells in capitals (the KJV small-caps "LORD") are left as they are.
 */
import { primaryLanguage } from './connectives';

/** lower-case form -> displayed form, per primary language. Multi-word entries are matched as phrases. */
const DIVINE_NAMES: Record<string, Record<string, string>> = {
  en: {
    god: 'God', jesus: 'Jesus', christ: 'Christ', messiah: 'Messiah', almighty: 'Almighty',
    jehovah: 'Jehovah', yahweh: 'Yahweh', savior: 'Savior', saviour: 'Saviour', 'holy spirit': 'Holy Spirit',
    'holy ghost': 'Holy Ghost', 'son of god': 'Son of God', 'son of man': 'Son of Man', 'jesus christ': 'Jesus Christ',
  },
  es: {
    dios: 'Dios', jesús: 'Jesús', jesus: 'Jesús', cristo: 'Cristo', mesías: 'Mesías', todopoderoso: 'Todopoderoso',
    jehová: 'Jehová', yahvé: 'Yahvé', 'espíritu santo': 'Espíritu Santo', 'hijo de dios': 'Hijo de Dios', 'hijo del hombre': 'Hijo del Hombre',
  },
  pt: {
    deus: 'Deus', jesus: 'Jesus', cristo: 'Cristo', messias: 'Messias', 'todo-poderoso': 'Todo-Poderoso', jeová: 'Jeová', 'espírito santo': 'Espírito Santo', 'filho de deus': 'Filho de Deus', 'filho do homem': 'Filho do Homem',
  },
  de: {
    gott: 'Gott', jesus: 'Jesus', christus: 'Christus', messias: 'Messias', allmächtiger: 'Allmächtiger',
    jehova: 'Jehova', 'heiliger geist': 'Heiliger Geist', 'heiligen geist': 'Heiligen Geist', 'sohn gottes': 'Sohn Gottes',
    'menschensohn': 'Menschensohn', gottes: 'Gottes',
  },
  fr: {
    dieu: 'Dieu', jésus: 'Jésus', jesus: 'Jésus', christ: 'Christ', messie: 'Messie', 'tout-puissant': 'Tout-Puissant',
    jéhovah: 'Jéhovah', 'saint-esprit': 'Saint-Esprit', 'saint esprit': 'Saint Esprit', 'fils de dieu': 'Fils de Dieu', "fils de l'homme": "Fils de l'Homme",
  },
  ru: {
    бог: 'Бог', иисус: 'Иисус', христос: 'Христос', господь: 'Господь', господу: 'Господу', богу: 'Богу',
    бога: 'Бога', богом: 'Богом', боге: 'Боге', боже: 'Боже', господе: 'Господе', господом: 'Господом', господи: 'Господи',
    иисуса: 'Иисуса', иисусу: 'Иисусу', иисусом: 'Иисусом', иисусе: 'Иисусе', христа: 'Христа', христу: 'Христу',
    христом: 'Христом', христе: 'Христе', 'духа святого': 'Духа Святого', 'духу святому': 'Духу Святому',
    'духом святым': 'Духом Святым', 'святого духа': 'Святого Духа', 'святым духом': 'Святым Духом', мессия: 'Мессия', иегова: 'Иегова', 'дух святой': 'Дух Святой', 'святой дух': 'Святой Дух',
  },
};

/** Merge order: English last, so its spelling wins when no language is given ("jesus" -> "Jesus"). */
const ALL_LANGUAGES = [...Object.keys(DIVINE_NAMES).filter((l) => l !== 'en'), 'en'];

const tableCache = new Map<string, { table: Record<string, string>; phrases: RegExp[] }>();

function tableFor(language?: string): { table: Record<string, string>; phrases: RegExp[] } {
  const primary = language ? primaryLanguage(language) : '';
  // A language with no table of its own (de and fr aside, e.g. it, nl) falls back to every table.
  const langs = primary in DIVINE_NAMES ? [primary] : ALL_LANGUAGES;
  const key = langs.join(',');
  let hit = tableCache.get(key);
  if (!hit) {
    const table: Record<string, string> = {};
    for (const l of langs) Object.assign(table, DIVINE_NAMES[l]);
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const phrases = Object.keys(table).filter((k) => k.includes(' ')).sort((a, b) => b.length - a.length)
      .map((k) => new RegExp(`(^|[^\\p{L}\\p{N}])(${esc(k)})(?![\\p{L}\\p{N}])`, 'giu'));
    hit = { table, phrases };
    tableCache.set(key, hit);
  }
  return hit;
}

const AMBIGUOUS_LORD = new Set(['lord', 'señor', 'senhor', 'herr', 'seigneur', 'господа']);

export function isAllCaps(s: string): boolean {
  return s.length > 1 && s === s.toUpperCase() && s !== s.toLowerCase();
}

/**
 * The label for a mark made from a clicked or suggested token: lower-cased, except a token the text spells in
 * capitals (the KJV small-caps "LORD"), which stays as it is.
 */
export function labelFromToken(raw: string): string {
  const t = raw.normalize('NFC').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  // "Lord"/"lord" is ambiguous (a human master or God): keep the case the text has it in.
  return isAllCaps(t) || AMBIGUOUS_LORD.has(t.toLowerCase()) ? t : t.toLowerCase();
}

/**
 * The label as it should be shown. Whole-label and word-by-word: "god" -> "God", "the lord jesus" ->
 * "the lord Jesus". `language` picks the name table; without it, or with a language that has none, every
 * table applies. Idempotent; all-capital words are left alone.
 */
export function displayKeywordLabel(label: string, language?: string): string {
  if (!label) return label;
  const { table, phrases } = tableFor(language);
  let out = label.normalize('NFC');
  for (let i = 0; i < phrases.length; i++) {
    const re = phrases[i];
    out = out.replace(re, (m, pre: string, hit: string) => (isAllCaps(hit) ? m : pre + table[hit.toLowerCase().replace(/\s+/g, ' ')]));
  }
  return out.replace(/[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*/gu, (w) => (isAllCaps(w) ? w : table[w.toLowerCase()] ?? w));
}
