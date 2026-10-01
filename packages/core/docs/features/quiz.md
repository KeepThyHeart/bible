# Quiz (task 0074)

Questions about the text, asked over a passage: today's reading (once reading plans
exist), the chapter on screen, or a passage the user picks. Core holds the module
format, the repository, a pure engine and the progress stores; `@bible/ui` holds
`QuizPanel`; each app wraps it in its own pane.

| Layer | Where |
|---|---|
| Module schema | `sql/schemas/initial/Quiz.sql` (module type `quiz`, format `quiz-module`, files `quiz_*.db`) |
| Repository | `src/Data/Repositories/QuizRepository.ts` (`IQuizRepository`), factory key `quiz` |
| Engine, grading, types, ports, progress stores | `src/Quiz/` (in the `@bible/core/browser` barrel) |
| Shared UI | `packages/ui/src/components/Quiz/` (`QuizPanel`) |
| Desktop | IPC `quiz:*`, Quiz dock panel, commands `quiz.open` and `quiz.thisChapter` |
| Web | `GET /api/quiz`, `GET /api/quiz/questions`, Study-pane Quiz tab and phone sheet (flag `quiz`) |
| Module builder | Out of repo (bible-scripts): `build-quiz.js` builds a module from JSON question files plus unfoldingWord Translation Questions TSVs |

## Module format

One `quiz_question` row per question; its passages are `verse_link` rows
(`source_type = 'quiz_question'`, `link_type = 'primary_passage'` for the verses it is
chiefly about). Licence and credit of each source dataset are `data_source` rows, and a
question names its source in `source_id`. `module_info.metadata.textBasis` names the
translation the wording follows (the shipped questions follow the KJV).

`question_key` is the identity everywhere outside the file (progress, retries, sync):
stable across releases, never reused. Row ids are not stable.

### Extensibility

- `kind` (`recall`, `comprehension`, `application`) and `answer_mode`
  (`multiple_choice`, `short_answer`, `free_response`, `reflection`) are open sets with
  no CHECK. `effectiveAnswerMode()` maps anything unknown or incomplete to
  `free_response` (reveal the answer, grade yourself) when there is an answer, else to an
  ungraded `reflection`, so an old app never breaks on a new question type.
- `metadata` (JSON object) carries whatever a new type needs, on the question
  (`QuizQuestion.metadata`). Add fields; never repurpose one.
- Third-party quiz modules (e.g. a denomination's catechism quiz) are ordinary `quiz`
  modules; the engine merges every installed module and the launcher credits each. The
  core-shipped questions stay non-denominational.

## Engine

`QuizEngine(sources, store, { now?, adjudicator? })`:

- `buildQuiz(request)`: candidates from every source (merged by key, first source wins),
  stats from the store, then `selectQuestions` and a per-quiz shuffle of each
  multiple-choice question's choices. Deterministic for a given `seed`.
- `grade(question, response, choices)`: pure (`gradeResponse`).
- `recordGrade(grade, quizId)`: stores graded answers only (not reflection or skips).
- `finish(quiz, grades)`: score and missed list, stored as a session.
- `retry(quiz, keys)`: the same questions again, re-shuffled.

### Selection

1. Candidates overlap the scope and pass the kind and mode filters. A fixed difficulty
   keeps only that level; unrated questions count as medium (2).
2. Priority: missed (or partly right) in the last 30 days, then never seen, then seen
   (oldest first). Questions answered correctly in the last 14 days come only when too
   few others remain. Ties are broken by the seeded random number generator.
3. Round-robin over the scope's chapters, so a long reading is covered evenly.
4. Mixed difficulty aims at 2:2:1 easy:medium:hard; a level that runs out is filled from
   the next easier level, then from any.
5. At most one reflection question, last, in quizzes of three or more.
6. Graded questions are shown in the text's order.

This is a light rotation, not spaced repetition; memorisation belongs to the Bible Memory
extension.

Coverage (`getCoverage`) counts each question once, in the chapter of its primary
passage, while `getQuestions` also matches secondary passages; a quiz over a chapter may
therefore include a question chiefly about another chapter that also cites it.

### Grading

- Multiple choice: the chosen choice's `correct` flag (choices are tracked by object, so
  shuffling is safe).
- Short answer: `normalizeAnswer` (NFKC, no diacritics, lower case, no punctuation, no
  leading "the/a/an"), exact match against `accepted`, number words equal digits, and one
  edit (Damerau) allowed for answers longer than five characters. A miss can be
  overridden by the user ("I was right").
- Free response: the user reveals the model answer and picks Got it, Partly or Missed.
- Reflection: ungraded.
- Adjudicated (seam): the adjudicator's result and 0..1 score.

A question's progress is recorded once, when the user leaves it (Next, or End quiz), with
its final grade, so an "I was right" correction does not count twice.

## Progress

| Platform | Store |
|---|---|
| Desktop | `UserDataQuizProgressStore` over the user database: `user_data_item`, owner `app:quiz`, collection `item-stats` (one row per question key) and `sessions` (one per finished quiz, newest 200 kept). Backed up and, later, synced like any other item; no new table. |
| Web | `MemoryQuizProgressStore`: page session only. The web saves no personal content in the browser until web accounts exist (product decision), so it shows no history. |

## Ports and seams

- `IQuizQuestionSource` / `IQuizCatalogSource`: modules over IPC (desktop) or HTTP (web).
- `IReadingScopeProvider`: what "today's reading" is. `NO_READING_PLAN` answers null
  until reading plans ship; the launcher then hides the option. A reading-plan provider
  plugs in without engine changes.
- `IQuizAdjudicator` (seam only, not implemented): judges a free-text answer, e.g. by
  sending the question, the user's answer, the expected answer and the passage text to an
  LLM, returning correct/partly/incorrect and a 0..1 score. `QuizEngine.canAdjudicate()` /
  `adjudicate()` delegate to it when one is configured, and the verdict is graded with the
  `{ type: 'adjudicated', result, score, adjudicator }` response. The shared UI has no
  "Check my answer" button yet: the future change adds it to `QuizQuestionCard` when
  `engine.canAdjudicate(question)` is true. An implementation must ask the user's consent
  before sending their answer off the device.

## Dynamic question types (future)

Some quizzes are better generated than stored. The planned one is **missing word**: a
verse in the reader's default translation with one word blanked; the user types the word
(no choices). It works in any language with no authored data. Word choice is weighted by
frequency (rarer, more significant words more often, with some common ones mixed in).

It fits the model without schema changes:

- A generator is just another `IQuizQuestionSource` passed to `QuizEngine` alongside the
  module source. It builds questions for the requested passages at run time.
- Each question is a `short_answer` with `accepted: [word]` (plus spelling variants), the
  verse (with a blank) as the prompt, `origin: 'generator:missing-word'`, and
  `metadata: { generator: 'missing-word', translation, verseId, wordIndex }`.
- Keys must be deterministic so progress works: `gen:missing-word:<translation>:<verseId>:<wordIndex>`.
- The UI can later give it its own mode name (e.g. `cloze`) for a richer rendering;
  older apps fall back to `free_response` as described above.

It overlaps with Bible games and the Bible Memory extension; decide there whether it
ships in core or as an extension.

## Data

The pilot module (`quiz_mark.db`, built out of repo) holds KJV-worded questions for
Mark 1-4 (multiple choice, short answer, free response, reflection; draft, unreviewed)
and unfoldingWord® Translation Questions for all of Mark (free response, CC BY-SA 4.0,
answers in ULT wording). The module is CC BY-SA 4.0 because of the latter.
