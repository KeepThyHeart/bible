/**
 * Choosing which word to take out of a verse.
 *
 * This is the whole craft of the game. A blank on `the` is not a question, and
 * a blank on a word nothing in the sentence points at is a memory test rather
 * than a comprehension one. Both fail the same way in a room: somebody says
 * "how were we meant to get that", and the next round has fewer people typing.
 *
 * So candidates are filtered first and ranked second.
 *
 * Filtered out entirely:
 *
 * - function words. Articles, pronouns, auxiliaries, prepositions and the
 *   handful of King James verbs that appear on nearly every page (`saith`,
 *   `hath`). There is nothing to know about them.
 * - anything under three letters, which is function words again by another
 *   route, and too short for the answer matcher to give any spelling slack.
 * - a word that appears somewhere else in the same verse. The answer would be
 *   printed on the screen beside the blank.
 *
 * Ranked, highest first, by how firmly the rest of the sentence pins the word
 * down:
 *
 * - a *well-known* proper noun is the most recoverable thing in a verse.
 *   `God`, `Moses`, `Israel`, `Egypt` — a group reads the sentence and says it
 *   out loud together. It is knowing the name, not merely its capital letter,
 *   that earns this: an obscure name gets none of this bonus (see
 *   `KNOWN_NAMES`), so it is chosen only when it is honestly the best word on
 *   offer by length and context — the same as any other word — rather than
 *   preferred for merely being a proper noun.
 * - long words are rarer, and a rare word is held in place by its neighbours
 *   in a way that a common one is not.
 * - context either side. A blank two words in has half a sentence pointing at
 *   it; a blank on the first word has only what follows.
 *
 * The ranking leaves ties, often many, and the tie is broken by the caller's
 * generator rather than by document order — a room that draws the same verse
 * twice should not get the same question twice. Everything here is a pure
 * function of the text and that generator, so a replayed room asks the same
 * questions in the same order.
 *
 * Preferring a *known* name is right for an ordinary verse and wrong for a
 * genealogy, a census or a list of towns — a verse made almost entirely of
 * obscure names and spelled-out numbers turns "fill in the blank" into "guess
 * which name". `isListLike` rejects such a verse outright, ahead of ranking,
 * rather than trying to steer the ranking away from its worst word: with the
 * curated pool (`familiarity` other than `any`) this rarely triggers, since
 * those verses were hand-picked; `familiarity: 'any'` draws uniformly from
 * the whole canon and is what actually reaches Nehemiah 7 or Numbers 1. It is
 * not the fact that a candidate is a proper noun that disqualifies it from
 * either the ranking bonus or (dominant enough) the verse itself — it is
 * that it is obscure, with nothing else in the sentence to reason from.
 */

import { normalise } from '../../../../../src/modules/games/shared/answers/normalise.js';

/**
 * The blank is a fixed width, never the width of the missing word. Sizing it
 * to the answer would hand out the letter count, and hints were deliberately
 * left out of this game.
 */
export const BLANK = '_____';

/** Shorter than this and there is nothing to ask about, and nothing to misspell. */
export const MIN_WORD_LETTERS = 3;

/**
 * Words that carry no question.
 *
 * Grouped by what they are so that the next person to hit a gap knows where to
 * put the addition. The King James forms sit beside their modern equivalents
 * rather than in a section of their own, because they are the same part of
 * speech doing the same job.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // Articles and the commonest conjunctions.
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'than', 'then',
  'as', 'if', 'because', 'that', 'though', 'lest', 'neither', 'either', 'both',
  'whether', 'also', 'even',
  // Prepositions and particles.
  'of', 'in', 'on', 'at', 'to', 'unto', 'into', 'from', 'by', 'with', 'without',
  'upon', 'over', 'under', 'before', 'after', 'against', 'among', 'amongst',
  'between', 'through', 'throughout', 'toward', 'towards', 'about', 'above',
  'below', 'beside', 'within', 'out', 'off', 'up', 'down', 'concerning',
  // Pronouns, in both vocabularies.
  'i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves', 'thou', 'thee', 'thy',
  'thine', 'thyself', 'ye', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
  'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs',
  'themselves', 'who', 'whom', 'whose', 'which', 'what', 'whatsoever',
  'whosoever', 'this', 'these', 'those', 'there', 'here',
  // The `there`/`where`/`here` compounds, which are pronouns wearing a hat.
  'thereof', 'therein', 'thereby', 'thereto', 'thereon', 'therefore',
  'wherefore', 'whereby', 'wherein', 'whereof', 'whereas', 'whereupon',
  'hereby', 'herein', 'hereof', 'hereafter',
  // Auxiliaries and the verb to be.
  'be', 'is', 'am', 'are', 'was', 'were', 'been', 'being', 'art', 'wast', 'wert',
  'have', 'has', 'had', 'having', 'hast', 'hath', 'do', 'does', 'did', 'done',
  'doth', 'dost', 'shall', 'shalt', 'should', 'shouldest', 'will', 'wilt',
  'would', 'wouldest', 'may', 'might', 'must', 'can', 'cannot', 'could', 'let',
  'ought',
  // Quantifiers, degree words and the rest of the high-frequency tail.
  'not', 'no', 'all', 'any', 'some', 'such', 'same', 'very', 'only', 'more',
  'most', 'much', 'many', 'one', 'every', 'each', 'other', 'another', 'own',
  'ever', 'never', 'now', 'when', 'where', 'while', 'until', 'till', 'again',
  'yea', 'nay', 'thus', 'how', 'why', 'behold',
  // Speech verbs. Grammatically content words, but they carry a third of the
  // narrative in this translation and blanking one asks nothing.
  'say', 'says', 'said', 'saith', 'sayest', 'saying', 'spake', 'speak',
]);

/**
 * A run of letters, allowing the apostrophes and hyphens that live inside a
 * word: `God's`, `Jesus'`, `well-beloved`. Punctuation that merely sits beside
 * a word is left out, so it survives into the text either side of the blank.
 */
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’‘\-][\p{L}\p{N}]*)*/gu;

/** Punctuation after which a capital letter means a new sentence, not a name. */
const SENTENCE_ENDINGS = new Set(['.', '!', '?', ':', ';']);

/**
 * Spelled out, which is the only way the King James Version ever writes a
 * number. A run of these beside a name is an age or a tally, not a sentence
 * with anything in it to reason from — the shape behind a genealogy's "lived
 * an hundred and thirty years" or a census's "were forty and six thousand".
 */
const NUMBER_WORDS: ReadonlySet<string> = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty',
  'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'score',
]);

interface WordToken {
  /** Position in the verse's word sequence, so context is a subtraction. */
  position: number;
  start: number;
  end: number;
  /** Exactly as the verse prints it. */
  text: string;
  /** Comparable spelling, in the form the answer matcher works in. */
  key: string;
}

/** One word the verse could lose, with the ranking already applied. */
export interface BlankCandidate {
  position: number;
  word: string;
  score: number;
}

/** A verse with one word taken out, and what will be accepted for it. */
export interface Blank {
  /** Everything before the missing word, punctuation intact. */
  before: string;
  /** The missing word exactly as printed, possessive and all. */
  word: string;
  after: string;
  /** Spellings credited besides the printed one. */
  accept: string[];
}

function words(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index;
    tokens.push({
      position: tokens.length,
      start,
      end: start + match[0].length,
      text: match[0],
      key: normalise(match[0]),
    });
  }
  return tokens;
}

/** Letters only: the apostrophe in `God's` is not a letter anyone can misspell. */
function letterCount(key: string): number {
  return key.replace(/ /g, '').length;
}

/**
 * A capital away from the start of a sentence is a name. The verse's own first
 * word is capitalised by typesetting convention and tells us nothing, and so is
 * the word after a colon, which this translation uses where a modern one would
 * open a quotation.
 */
function isProperNoun(token: WordToken, text: string): boolean {
  if (token.position === 0) return false;
  if (!/^\p{Lu}/u.test(token.text)) return false;
  const preceding = text.slice(0, token.start).trimEnd();
  const last = preceding.at(-1);
  return last === undefined ? false : !SENTENCE_ENDINGS.has(last);
}

/** How much of the sentence points at this word, counted on its thinner side. */
function contextScore(position: number, total: number): number {
  return Math.min(position, total - 1 - position, 2);
}

function lengthScore(letters: number): number {
  if (letters >= 8) return 2;
  if (letters >= 6) return 1;
  return 0;
}

function scoreToken(token: WordToken, tokens: readonly WordToken[], text: string): number {
  return (
    // The "most recoverable thing in a verse" bonus belongs to a name most
    // players already carry, not to any capital letter — an obscure name
    // (`isKnownName` false) earns nothing extra here, so it is chosen only
    // when it is honestly the best candidate on length and context, the same
    // as any other word, rather than preferred for merely being a proper
    // noun. See `KNOWN_NAMES` for what counts as known.
    (isProperNoun(token, text) && isKnownName(token) ? 3 : 0) +
    lengthScore(letterCount(token.key)) +
    contextScore(token.position, tokens.length)
  );
}

function isEligible(token: WordToken, counts: ReadonlyMap<string, number>): boolean {
  if (token.key === '') return false;
  if (/\p{N}/u.test(token.key)) return false;
  if (letterCount(token.key) < MIN_WORD_LETTERS) return false;
  if (STOPWORDS.has(token.key)) return false;
  // The answer would otherwise be printed on the screen beside the blank.
  return counts.get(token.key) === 1;
}

/**
 * Names well known enough that guessing them costs no Bible knowledge at
 * all — the handful that appear on nearly every page, in every book, of
 * every tier (`god`, `lord`, `jesus`, `christ`), plus the ~130 people and
 * places a curious but not deeply-read player could reasonably be expected
 * to know: the major patriarchs, judges, kings, prophets and apostles, and
 * the best-known places (Jerusalem, Egypt, Galilee, ...). Drawn from
 * `content/source/people.json` and `content/source/places.json`, keeping
 * only single-word names at `difficulty` 1 or 2 (the generator's own scale
 * for "how well known" — "1 is a household name") — the multi-word entries
 * (`John the Baptist`, `Mount Sinai`) do not match a single blank candidate
 * anyway, and `difficulty` 3-4 is exactly the "known once you are told, not
 * recognised cold" territory this list is for excluding.
 *
 * This is what tells a genuinely obscure name (a minor figure two names deep
 * in a genealogy, a town nobody has heard of) apart from a verse that simply
 * mentions who it is about: "the Revelation of Jesus Christ... which God
 * gave" is four capitalised words in eleven, and none of them is a memory
 * test — and "Samuel" is a fine word to blank when the sentence around it
 * makes the answer inferable, exactly because it is a name most players
 * already carry, not because it happens to be a name at all.
 */
const KNOWN_NAMES: ReadonlySet<string> = new Set([
  'god', 'lord', 'jesus', 'christ',
  // Generated from content/source/people.json + places.json, difficulty <= 2,
  // single-word names and aliases only. Regenerate by hand if those files
  // change meaningfully; this list does not need to track them exactly.
  'aaron', 'abednego', 'abel', 'abraham', 'abram', 'absalom', 'adam', 'ahab',
  'andrew', 'ararat', 'babel', 'babylon', 'barabbas', 'barnabas', 'bathsheba',
  'bethany', 'bethlehem', 'boaz', 'cain', 'calvary', 'cana', 'canaan',
  'capernaum', 'cephas', 'damascus', 'daniel', 'david', 'deborah', 'delilah',
  'didymus', 'eden', 'edom', 'egypt', 'elias', 'elijah', 'elisha', 'esaias',
  'esau', 'esther', 'eve', 'galilee', 'gethsemane', 'gideon', 'golgotha',
  'goliath', 'hadassah', 'haman', 'hannah', 'herod', 'isaac', 'isaiah',
  'israel', 'jacob', 'james', 'jeremiah', 'jeremias', 'jeremy', 'jericho',
  'jerusalem', 'jezebel', 'job', 'john', 'jonah', 'jonathan', 'jordan',
  'joseph', 'joshua', 'judas', 'lazarus', 'levi', 'lot', 'lydia', 'martha',
  'mary', 'matthew', 'meshach', 'miriam', 'moab', 'mordecai', 'moses',
  'naaman', 'naomi', 'nazareth', 'nebuchadnezzar', 'nicodemus', 'nile',
  'nineveh', 'noah', 'olivet', 'paul', 'peter', 'pilate', 'rachel', 'rahab',
  'rebekah', 'rome', 'ruth', 'samson', 'samuel', 'sarah', 'sarai', 'saul',
  'shadrach', 'simon', 'sinai', 'sodom', 'solomon', 'stephen', 'thomas',
  'timotheus', 'timothy', 'zacchaeus', 'zaccheus',
]);

/**
 * `token.key` has already lost its apostrophe by the time this runs
 * (`normalise` drops it rather than spacing it, so a room typing `Gods` for
 * `God's` still matches) — a possessive is indistinguishable at this point
 * from the same name with a plain trailing `s`. Both are checked so `God's`
 * (key `gods`) still reads as the known name `god`.
 */
function isKnownName(token: WordToken): boolean {
  if (KNOWN_NAMES.has(token.key)) return true;
  return token.key.endsWith('s') && KNOWN_NAMES.has(token.key.slice(0, -1));
}

/** A name or a spelled-out number: recognisable, but not reasoned to. */
function isUnreasonable(token: WordToken, text: string): boolean {
  if (isKnownName(token)) return false;
  return isProperNoun(token, text) || NUMBER_WORDS.has(token.key);
}

/**
 * Below this many eligible candidates, the ratio below is noise rather than a
 * signal — a couple of names in an otherwise ordinary sentence is how most of
 * the Bible reads, not a pattern worth rejecting a verse over.
 */
const MIN_CANDIDATES_TO_JUDGE = 3;

/** At or above this share of names and numbers, a verse reads as a list. */
const LIST_RATIO = 0.5;

/**
 * A verse dominated by proper nouns and spelled-out numbers a player has no
 * way to reason about — a genealogy ("Jared lived an hundred sixty and two
 * years, and begat Enoch"), a census, a list of towns or tribal allotments —
 * rather than a sentence with something else in it to point to the word.
 *
 * Judged against the *eligible* candidates specifically, because
 * `scoreToken` already prefers a proper noun over almost anything else
 * (see the module doc comment): a verse where most of what is even in the
 * running is a name or a number is exactly the shape that turns this game
 * into a guess instead of a question, whichever particular word the ranking
 * or the generator's tie-break happens to land on. This is checked ahead of,
 * and separately from, the ranking below, so a verse can be rejected outright
 * rather than merely steered away from its worst word.
 */
function isListLike(tokens: readonly WordToken[], counts: ReadonlyMap<string, number>, text: string): boolean {
  const eligible = tokens.filter((token) => isEligible(token, counts));
  if (eligible.length < MIN_CANDIDATES_TO_JUDGE) return false;
  const unreasonable = eligible.filter((token) => isUnreasonable(token, text)).length;
  return unreasonable / eligible.length >= LIST_RATIO;
}

/**
 * Every word the verse could lose, best first. Exported because the ranking is
 * the game's one real judgement call and deserves to be asserted directly.
 */
export function blankCandidates(text: string): BlankCandidate[] {
  const tokens = words(text);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token.key, (counts.get(token.key) ?? 0) + 1);

  return tokens
    .filter((token) => isEligible(token, counts))
    .map((token) => ({
      position: token.position,
      word: token.text,
      score: scoreToken(token, tokens, text),
    }))
    .sort((a, b) => b.score - a.score || a.position - b.position);
}

/**
 * Trailing possessives, so that a blank standing where `God's` was still
 * credits someone who types `God`. Normalisation drops the apostrophe itself,
 * which leaves `gods` against `god` — one edit on a four-letter answer, and
 * four-letter answers are matched exactly. The alternate is what closes that.
 */
function possessiveStripped(word: string): string | null {
  const shortened = word.replace(/['’‘](?:s|S)?$/u, '');
  return shortened !== word && shortened !== '' ? shortened : null;
}

function toBlank(text: string, token: WordToken): Blank {
  const alternate = possessiveStripped(token.text);
  return {
    before: text.slice(0, token.start),
    word: token.text,
    after: text.slice(token.end),
    accept: alternate === null ? [] : [alternate],
  };
}

/**
 * Takes one word out of the verse, or returns null when the verse has no word
 * worth taking — a short verse of nothing but function words has no question
 * in it, a verse dominated by names and numbers (`isListLike`) is a memory
 * test rather than one, and either way the caller should draw again rather
 * than ask a bad question.
 *
 * Among equally good candidates the choice is the generator's, so the same
 * verse asked twice in a season is a different question, and a room replayed
 * from its own seed asks exactly what it asked the first time.
 */
export function chooseBlank(text: string, random: () => number): Blank | null {
  const tokens = words(text);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token.key, (counts.get(token.key) ?? 0) + 1);
  if (isListLike(tokens, counts, text)) return null;

  const ranked = blankCandidates(text);
  const best = ranked[0];
  if (best === undefined) return null;

  const tied = ranked.filter((candidate) => candidate.score === best.score);
  const picked = tied[Math.min(tied.length - 1, Math.floor(random() * tied.length))];
  if (picked === undefined) return null;

  const token = words(text)[picked.position];
  return token === undefined ? null : toBlank(text, token);
}

/** The verse as the room sees it while the round is live. */
export function maskedText(blank: Blank): string {
  return `${blank.before}${BLANK}${blank.after}`;
}
