/**
 * Reading the King James Version without punishing anyone for reading it.
 *
 * The default translation is four hundred years old, so the words on the
 * screen are not the words in the player's head. Someone who understood the
 * verse perfectly types `you have` where the text says `thou hast`, `shows`
 * where it says `sheweth`, `brothers` where it says `brethren`. Refusing those
 * is not strictness, it is a vocabulary test nobody signed up for, and it
 * fails in a way that feels arbitrary rather than fair.
 *
 * Two things do the work here, and both are meant to be edited by whoever hits
 * the next gap:
 *
 * 1. `FORM_GROUPS` — a table of forms that mean the same thing. Every word in
 *    a group, old or new, resolves to the same set of modern spellings, which
 *    is why the credit runs in both directions: the answer may be the archaic
 *    word and the submission the modern one, or the other way round.
 * 2. `VERB_ENDINGS` — `-eth` and `-est` are productive rather than a closed
 *    list, so they are a rule. Everything irregular enough to resist the rule
 *    (`doth`, `saith`, `hast`, `shalt`) is table data instead.
 *
 * A word resolves to several candidate spellings, not one, because English
 * gives no way to choose between them without a dictionary: `cometh` could
 * modernise to `comes` or to `come`, and both are things a player types. Two
 * words are treated as the same word when their candidate sets overlap.
 *
 * The bias throughout is toward crediting the player. Over-generosity costs a
 * point that was nearly earned; a wrong rejection costs someone their turn and
 * looks like a bug from the sofa.
 */

import { normaliseWords } from './normalise.js';

/**
 * One cluster of words that a player may use interchangeably. Every form must
 * already be in normalised spelling — lowercase, unpunctuated — because that
 * is the form lookups arrive in.
 */
export interface FormGroup {
  /** Modern spellings, the most usual first. */
  readonly modern: readonly string[];
  /** King James forms carrying the same sense. */
  readonly archaic: readonly string[];
}

/**
 * The table. Adding a mapping is one line here and nothing else; the tests
 * walk it and assert both directions of every entry, so a new line is covered
 * the moment it is written.
 *
 * A word appears in exactly one group. Two groups claiming the same spelling
 * would silently merge, so the tests refuse it.
 */
export const FORM_GROUPS: readonly FormGroup[] = [
  // Second person. Thou/thee/ye collapse onto `you` and thy/thine onto
  // `your`, losing the subject/object and determiner/pronoun distinctions
  // English itself gave up on. Nobody is being tested on those.
  { modern: ['you'], archaic: ['thou', 'thee', 'ye'] },
  { modern: ['your', 'yours'], archaic: ['thy', 'thine'] },
  { modern: ['yourself'], archaic: ['thyself'] },
  { modern: ['my'], archaic: ['mine'] },

  // Verbs whose archaic ending is fused into the stem, so no rule reaches
  // them. This is the whole closed class of them worth carrying.
  { modern: ['are'], archaic: ['art'] },
  { modern: ['have', 'has'], archaic: ['hast', 'hath'] },
  { modern: ['does', 'do'], archaic: ['doth', 'dost'] },
  { modern: ['did'], archaic: ['didst'] },
  { modern: ['says', 'say'], archaic: ['saith', 'sayest'] },
  { modern: ['said'], archaic: ['saidst'] },
  { modern: ['shall'], archaic: ['shalt'] },
  { modern: ['will'], archaic: ['wilt'] },
  { modern: ['can'], archaic: ['canst'] },
  { modern: ['could'], archaic: ['couldst'] },
  { modern: ['would'], archaic: ['wouldst'] },
  { modern: ['should'], archaic: ['shouldst'] },
  { modern: ['may'], archaic: ['mayest', 'mayst'] },
  { modern: ['were'], archaic: ['wast', 'wert'] },
  { modern: ['know'], archaic: ['wot'] },

  // Spellings the translators used that a modern reader silently converts.
  { modern: ['show'], archaic: ['shew'] },
  { modern: ['showed'], archaic: ['shewed'] },
  { modern: ['showing'], archaic: ['shewing'] },
  { modern: ['spoke'], archaic: ['spake'] },
  { modern: ['brothers', 'brother'], archaic: ['brethren'] },
  { modern: ['to'], archaic: ['unto'] },
  { modern: ['among'], archaic: ['amongst'] },
  { modern: ['while'], archaic: ['whilst'] },
  { modern: ['amid'], archaic: ['amidst'] },
  { modern: ['always'], archaic: ['alway'] },
  { modern: ['before'], archaic: ['ere'] },
  { modern: ['often'], archaic: ['oft', 'oftentimes'] },
  { modern: ['here'], archaic: ['hither'] },
  { modern: ['there'], archaic: ['thither'] },
  { modern: ['where'], archaic: ['whither'] },
  { modern: ['nothing'], archaic: ['naught', 'nought'] },
  { modern: ['no'], archaic: ['nay'] },
  { modern: ['yes'], archaic: ['yea'] },
  { modern: ['whoever'], archaic: ['whosoever'] },
  { modern: ['whatever'], archaic: ['whatsoever'] },
  { modern: ['wherever'], archaic: ['wheresoever'] },

  // Words with no modern currency at all, where the player can only type a
  // gloss. These are the ones that most often read as an unfair rejection.
  { modern: ['perhaps', 'maybe'], archaic: ['peradventure'] },
  { modern: ['immediately'], archaic: ['straightway', 'forthwith', 'anon'] },
  { modern: ['listen', 'hear'], archaic: ['hearken'] },
  { modern: ['clothes', 'clothing'], archaic: ['raiment'] },
  { modern: ['truly', 'surely'], archaic: ['verily'] },
  { modern: ['kill'], archaic: ['slay'] },
  { modern: ['killed'], archaic: ['slew', 'slain'] },
  { modern: ['fathered', 'begot'], archaic: ['begat'] },

  // British spellings the translation uses and an American phone does not.
  { modern: ['savior'], archaic: ['saviour'] },
  { modern: ['honor'], archaic: ['honour'] },
  { modern: ['labor'], archaic: ['labour'] },
  { modern: ['neighbor'], archaic: ['neighbour'] },
  { modern: ['favor'], archaic: ['favour'] },
  { modern: ['color'], archaic: ['colour'] },
  { modern: ['behavior'], archaic: ['behaviour'] },
];

/**
 * An archaic verb ending and what modern English puts in its place. Several
 * replacements, because `-eth` becomes `-s` on `walketh` and `-es` on
 * `cometh`, and the player is as likely to drop the ending altogether.
 */
interface VerbEnding {
  readonly ending: string;
  /** Endings to try in place of it, the most usual first. */
  readonly replacements: readonly string[];
}

const VERB_ENDINGS: readonly VerbEnding[] = [
  { ending: 'eth', replacements: ['s', 'es', '', 'e'] },
  { ending: 'est', replacements: ['', 'e', 's', 'es'] },
];

/**
 * Below this, what is left after the ending is more likely to be an ordinary
 * short word that merely happens to end that way — `best`, `rest`, `west` —
 * than a verb stem.
 */
const MIN_STEM_LENGTH = 2;

const MODERN_BY_FORM: ReadonlyMap<string, readonly string[]> = indexForms(FORM_GROUPS);

function indexForms(groups: readonly FormGroup[]): Map<string, readonly string[]> {
  const index = new Map<string, readonly string[]>();
  for (const group of groups) {
    for (const form of [...group.modern, ...group.archaic]) {
      index.set(form, group.modern);
    }
  }
  return index;
}

function pushUnique(into: string[], value: string): void {
  if (value !== '' && !into.includes(value)) into.push(value);
}

/**
 * The spellings a stem might take once its archaic ending is removed. English
 * spelling changes the stem as the ending changes, and undoing that is what
 * gets `sitteth` to `sits` and `crieth` to `cries` rather than to `sitts` and
 * `cris`.
 */
function stemBases(stem: string): string[] {
  const bases: string[] = [];
  // `sheweth` is an archaic ending on an archaic stem, so the stem gets the
  // same treatment it would have had standing on its own.
  for (const modern of MODERN_BY_FORM.get(stem) ?? []) pushUnique(bases, modern);
  pushUnique(bases, stem);
  if (stem.charAt(stem.length - 1) === stem.charAt(stem.length - 2)) {
    pushUnique(bases, stem.slice(0, -1));
  }
  if (stem.endsWith('i')) pushUnique(bases, `${stem.slice(0, -1)}y`);
  return bases;
}

/**
 * Every modern spelling one normalised word might stand for, the most likely
 * first. A word the table and the rules have nothing to say about stands for
 * itself, so this never returns an empty list.
 */
export function wordVariants(word: string): readonly string[] {
  const known = MODERN_BY_FORM.get(word);
  if (known) return known;

  for (const { ending, replacements } of VERB_ENDINGS) {
    if (!word.endsWith(ending)) continue;
    const stem = word.slice(0, word.length - ending.length);
    if (stem.length < MIN_STEM_LENGTH) continue;
    const variants: string[] = [];
    for (const base of stemBases(stem)) {
      for (const replacement of replacements) pushUnique(variants, base + replacement);
    }
    if (variants.length > 0) return variants;
  }

  return [word];
}

/**
 * The single most likely modern spelling of a normalised word. Callers that
 * are comparing words should prefer `sameWord`, which considers all of them;
 * this exists for the cases where a single string is needed, such as measuring
 * an edit distance.
 */
export function moderniseWord(word: string): string {
  return wordVariants(word)[0] ?? word;
}

/** The whole phrase in its most likely modern spelling, normalised on the way. */
export function modernise(text: string): string {
  return normaliseWords(text).map(moderniseWord).join(' ');
}

/**
 * True when two already-normalised words are the same word as far as a player
 * is concerned. Overlap rather than equality, because a word carries several
 * candidate spellings and any shared one is agreement.
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const candidates = wordVariants(a);
  return wordVariants(b).some((variant) => candidates.includes(variant));
}

/**
 * True when two phrases are the same phrase word for word. A differing word
 * count is left to fall through to edit distance rather than being forced into
 * an alignment this has no way to guess at.
 */
export function samePhrase(a: string, b: string): boolean {
  const left = normaliseWords(a);
  const right = normaliseWords(b);
  if (left.length === 0 || left.length !== right.length) return false;
  return left.every((word, index) => sameWord(word, right[index] ?? ''));
}
