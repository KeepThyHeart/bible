/**
 * The checks that decide whether content is fit to put in front of a group.
 *
 * The importer refuses rows that are malformed. This refuses rows that are
 * well formed and wrong — the failure that costs a room its trust in the game:
 *
 * - a quotation that is not what the verse says, so the reveal contradicts the
 *   question;
 * - a clue, or a prompt, that names its own answer;
 * - a wrong answer the typed-answer matcher would mark right;
 * - a reference to a verse the installed module does not carry.
 *
 * Those are errors, and the content tool fails on them. Everything else here
 * is a warning: worth an author's look, but a judgement rather than a defect —
 * a clue whose chapter never names its person may be relying on a pronoun, and
 * a small game is still a game.
 *
 * This runs over the content database rather than over source files, so it
 * checks what the games will actually read, whether it was generated or
 * written by hand.
 */

import { formatRef, fromVerseId } from '../../../../src/modules/games/shared/verseId.js';
import type { VerseId } from '../../../../src/modules/games/shared/verseId.js';
import type {
  ContentDatabase,
  OrderedListRecord,
  QuestionRecord,
  QuestionSetRecord,
} from './ContentDatabase.js';
import { creditedAs, mentions } from './generator/distractors.js';
import { GAME_TAGS } from './generator/generate.js';

/** The reading the checks need. A Bible module satisfies it; a test builds one by hand. */
export interface VerseReader {
  verse(id: VerseId): { text: string } | null;
  chapter(book: number, chapter: number): readonly { text: string }[];
}

export interface ContentFinding {
  severity: 'error' | 'warning';
  kind: 'question' | 'ordered-list' | 'set' | 'game';
  id: string;
  message: string;
}

/** Games where the answer appearing in what is shown ends the round before it starts. */
const GIVEAWAY_GAMES: ReadonlySet<string> = new Set([
  GAME_TAGS.whoSaidIt,
  GAME_TAGS.whoAmI,
  GAME_TAGS.detective,
]);

/** A column of the board runs from easiest to hardest in this many steps. */
export const BOARD_COLUMN = 5;

/** Fewer than this and a game repeats itself inside one evening. */
export const MIN_GAME_ITEMS = 20;

/** Difficulty at or below which a round is one a mixed group can get. */
const EASY = 2;

/**
 * An answer this much longer than every plausible wrong one is picked for its
 * length. Both conditions must hold: a ratio alone flags `Eve` against `Ruth`.
 */
const LENGTH_TELL_RATIO = 1.6;
const LENGTH_TELL_CHARACTERS = 8;

/** The quotation inside a who-said-it prompt. */
const QUOTATION = /“([^”]+)”/u;

/**
 * Every check, over everything in the database. `module` is null when no Bible
 * module is installed; the checks that need verse text are then skipped, and
 * the caller is expected to say so.
 */
export function validateContent(db: ContentDatabase, module: VerseReader | null): ContentFinding[] {
  const findings: ContentFinding[] = [];
  const questions = db.findQuestions();
  const lists = db.listOrderedLists();

  for (const question of questions) checkQuestion(question, module, findings);
  checkRepeatedVerses(questions, findings);
  for (const list of lists) checkList(list, module, findings);
  for (const set of db.listQuestionSets({ tag: GAME_TAGS.categoryBoard })) {
    checkBoardColumn(set, db, findings);
  }
  checkBalance(questions, lists, findings);
  return findings;
}

export function formatFindings(findings: readonly ContentFinding[]): string {
  return findings
    .map((finding) => `  [${finding.severity}] ${finding.kind} ${finding.id}: ${finding.message}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function checkQuestion(
  question: QuestionRecord,
  module: VerseReader | null,
  findings: ContentFinding[]
): void {
  const report = (severity: ContentFinding['severity'], message: string): void => {
    findings.push({ severity, kind: 'question', id: question.id, message });
  };
  const answer = { name: question.answer, accept: question.accept };
  const giveaway = question.tags.some((tag) => GIVEAWAY_GAMES.has(tag));

  if (namesAnswer(question.prompt, answer)) {
    report(giveaway ? 'error' : 'warning', `the prompt names the answer, ${question.answer}`);
  }
  for (const clue of question.clues) {
    if (namesAnswer(clue.text, answer)) report('error', `a clue names the answer: ${clue.text}`);
  }
  for (const distractor of question.distractors) {
    if (creditedAs({ name: distractor, accept: [] }, answer)) {
      report('error', `${distractor} would be marked right if typed`);
    }
  }

  const leading = question.distractors.slice(0, 3);
  if (leading.length > 0) {
    const longest = Math.max(...leading.map((distractor) => distractor.length));
    if (
      question.answer.length >= longest * LENGTH_TELL_RATIO &&
      question.answer.length - longest >= LENGTH_TELL_CHARACTERS
    ) {
      report('warning', `the answer is much the longest option, which gives it away`);
    }
  }

  if (module === null) return;

  if (question.promptVerseId !== null) {
    const verse = module.verse(question.promptVerseId);
    if (verse === null) {
      report('error', `${formatRef(question.promptVerseId)} is not in the installed module`);
    } else if (question.tags.includes(GAME_TAGS.whoSaidIt)) {
      const quoted = QUOTATION.exec(question.prompt)?.[1];
      if (quoted !== undefined && !mentions(verse.text, quoted)) {
        report('error', `the quotation is not in ${formatRef(question.promptVerseId)} as written`);
      }
    }
  }

  for (const clue of question.clues) {
    if (clue.verseId === null) continue;
    if (module.verse(clue.verseId) === null) {
      report('error', `${formatRef(clue.verseId)} is not in the installed module`);
      continue;
    }
    const { book, chapter } = fromVerseId(clue.verseId);
    const chapterText = module.chapter(book, chapter).map((verse) => verse.text);
    if (!chapterText.some((text) => namesAnswer(text, answer))) {
      report(
        'warning',
        `${formatRef(clue.verseId)} is in a chapter that never names ${question.answer}; ` +
          'check the reference behind the clue'
      );
    }
  }
}

/**
 * True when the text names the answer under any accepted form, the possessive
 * included: the King James text says `Peter's house` in chapters that never
 * say `Peter` alone, and a check that missed it would flag a sound clue.
 */
function namesAnswer(text: string, answer: { name: string; accept: readonly string[] }): boolean {
  return [answer.name, ...answer.accept].some(
    (form) => mentions(text, form) || mentions(text, `${form}'s`)
  );
}

/**
 * The same verse quoted twice in one game is two rounds with the same reveal.
 * Worth knowing about; sometimes two speakers genuinely share a verse.
 */
function checkRepeatedVerses(questions: readonly QuestionRecord[], findings: ContentFinding[]): void {
  const seen = new Map<VerseId, string>();
  for (const question of questions) {
    if (!question.tags.includes(GAME_TAGS.whoSaidIt) || question.promptVerseId === null) continue;
    const first = seen.get(question.promptVerseId);
    if (first === undefined) {
      seen.set(question.promptVerseId, question.id);
      continue;
    }
    findings.push({
      severity: 'warning',
      kind: 'question',
      id: question.id,
      message: `quotes the same verse as ${first}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Orderings and board columns
// ---------------------------------------------------------------------------

function checkList(list: OrderedListRecord, module: VerseReader | null, findings: ContentFinding[]): void {
  const verses = new Set<VerseId>();
  for (const item of list.items) {
    if (item.verseId === null) continue;
    if (module !== null && module.verse(item.verseId) === null) {
      findings.push({
        severity: 'error',
        kind: 'ordered-list',
        id: list.id,
        message: `${item.label}: ${formatRef(item.verseId)} is not in the installed module`,
      });
    }
    if (verses.has(item.verseId)) {
      findings.push({
        severity: 'warning',
        kind: 'ordered-list',
        id: list.id,
        message: `${item.label} shares its verse with another item, so the reveal cannot tell them apart`,
      });
    }
    verses.add(item.verseId);
  }
}

function checkBoardColumn(set: QuestionSetRecord, db: ContentDatabase, findings: ContentFinding[]): void {
  if (set.questionIds.length < BOARD_COLUMN) {
    findings.push({
      severity: 'warning',
      kind: 'set',
      id: set.id,
      message: `${set.questionIds.length} questions; a board column wants ${BOARD_COLUMN}`,
    });
  }
  const difficulties = new Set(
    set.questionIds.map((id) => db.getQuestion(id)?.difficulty).filter((value) => value !== undefined)
  );
  if (set.questionIds.length > 1 && difficulties.size === 1) {
    findings.push({
      severity: 'warning',
      kind: 'set',
      id: set.id,
      message: 'every question is the same difficulty, so the column does not climb',
    });
  }
}

// ---------------------------------------------------------------------------
// Balance across a game
// ---------------------------------------------------------------------------

/**
 * Two things a playtest will notice before anything else: a game that runs out
 * of material, and a game with nothing easy in it. A mixed group needs rounds
 * everyone can get, or the evening belongs to the two people who read Leviticus.
 */
function checkBalance(
  questions: readonly QuestionRecord[],
  lists: readonly OrderedListRecord[],
  findings: ContentFinding[]
): void {
  const games: { tag: string; difficulties: number[] }[] = [
    GAME_TAGS.whoSaidIt,
    GAME_TAGS.whoAmI,
    GAME_TAGS.detective,
    GAME_TAGS.categoryBoard,
  ].map((tag) => ({
    tag,
    difficulties: questions.filter((question) => question.tags.includes(tag)).map((question) => question.difficulty),
  }));
  games.push({ tag: GAME_TAGS.putInOrder, difficulties: lists.map((list) => list.difficulty) });

  for (const game of games) {
    const count = game.difficulties.length;
    if (count === 0) continue;
    if (count < MIN_GAME_ITEMS) {
      findings.push({
        severity: 'warning',
        kind: 'game',
        id: game.tag,
        message: `only ${count} items; fewer than ${MIN_GAME_ITEMS} repeats inside an evening`,
      });
    }
    if (!game.difficulties.some((difficulty) => difficulty <= EASY)) {
      findings.push({
        severity: 'warning',
        kind: 'game',
        id: game.tag,
        message: `nothing at difficulty ${EASY} or below, so a mixed group has no way in`,
      });
    }
  }
}
