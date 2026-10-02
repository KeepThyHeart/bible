/** Test data for the quiz components: two chapters of Mark, and an engine over them. */
import { MemoryQuizProgressStore, QuizEngine } from '@bible/core/browser';
import type { IQuizQuestionSource, QuizCatalog, QuizPassage, QuizQuestion } from '@bible/core/browser';

const MARK = 41;
const v = (chapter: number, verse: number) => MARK * 1_000_000 + chapter * 1_000 + verse;

export const QUIZ_FIXTURE_QUESTIONS: QuizQuestion[] = [
  {
    key: 'm1-mc',
    passages: [{ start: v(1, 9), end: v(1, 11), primary: true }],
    kind: 'recall',
    mode: 'multiple_choice',
    difficulty: 1,
    prompt: 'Who baptised Jesus?',
    answer: 'John',
    choices: [
      { text: 'John', correct: true },
      { text: 'Peter', correct: false },
      { text: 'Andrew', correct: false },
    ],
    explanation: 'John baptised Jesus in the Jordan.',
  },
  {
    key: 'm1-short',
    passages: [{ start: v(1, 16), end: v(1, 18), primary: true }],
    kind: 'recall',
    mode: 'short_answer',
    difficulty: 2,
    prompt: 'What did Simon and Andrew do for a living?',
    answer: 'fishing',
    accepted: ['fishing', 'fishermen'],
  },
  {
    key: 'm4-mc',
    passages: [{ start: v(4, 3), end: v(4, 8), primary: true }],
    kind: 'comprehension',
    mode: 'multiple_choice',
    difficulty: 2,
    prompt: 'In the parable, what happened to the seed on good soil?',
    answer: 'It produced a crop',
    choices: [
      { text: 'It produced a crop', correct: true },
      { text: 'It was eaten by birds', correct: false },
      { text: 'It was scorched', correct: false },
    ],
    explanation: 'Some yielded thirty, sixty or a hundred times.',
  },
  {
    key: 'm4-short',
    passages: [{ start: v(4, 37), end: v(4, 39), primary: true }],
    kind: 'recall',
    mode: 'short_answer',
    difficulty: 1,
    prompt: 'What was Jesus doing in the boat during the storm?',
    answer: 'sleeping',
    accepted: ['sleeping', 'asleep'],
  },
  {
    key: 'm4-free',
    passages: [{ start: v(4, 13), end: v(4, 20), primary: true }],
    kind: 'comprehension',
    mode: 'free_response',
    difficulty: 3,
    prompt: 'Explain the four soils in your own words.',
    answer: 'Four responses to the word: hard, shallow, choked and fruitful.',
    explanation: 'Jesus explains the parable to his disciples.',
  },
  {
    key: 'm4-reflect',
    passages: [{ start: v(4, 1), end: v(4, 9), primary: true }],
    kind: 'application',
    mode: 'reflection',
    prompt: 'Which soil is your heart most like today?',
  },
];

export const QUIZ_FIXTURE_CATALOG: QuizCatalog = {
  modules: [
    {
      uuid: 'quiz-kth-mark',
      name: 'KTH Mark Questions',
      abbreviation: 'KTHQ',
      version: '1.2',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      description: 'Study questions on Mark.',
      textBasis: 'WEB',
      sources: [
        { id: 'src-1', name: 'Open Question Set', licence: 'CC BY-SA 4.0', url: 'https://example.org/oqs', attribution: 'Questions by A. Writer' },
      ],
    },
  ],
  coverage: [
    { book: 19, chapter: 23, count: 2 },
    { book: MARK, chapter: 1, count: 2 },
    { book: MARK, chapter: 4, count: 4 },
  ],
};

export const EMPTY_QUIZ_CATALOG: QuizCatalog = { modules: [], coverage: [] };

export const MARK_4: QuizPassage = { start: v(4, 1), end: v(4, 999) };

/** Every fixture question overlapping the passages. */
export const fixtureSource: IQuizQuestionSource = {
  async getQuestions(passages) {
    return QUIZ_FIXTURE_QUESTIONS.filter((q) => q.passages.some((qp) => passages.some((p) => qp.start <= p.end && qp.end >= p.start)));
  },
};

export function makeFixtureEngine() {
  const store = new MemoryQuizProgressStore();
  const engine = new QuizEngine(fixtureSource, store, { now: () => new Date('2026-10-01T09:00:00Z') });
  return { engine, store };
}
