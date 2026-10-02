# Quiz (desktop pane)

**Last verified:** 2026-10-01

The Quiz pane (`contentType: 'quiz'`) asks questions on a chapter or passage from the installed quiz modules and records how the user did. The engine, grading and UI are shared with the web app; the desktop side is the pane, the IPC channels and the progress storage.

## Shared code

- `packages/core/src/Quiz/` - `QuizEngine`, grading, selection, `mergeCatalogs`, `chapterPassage`, the ports (`IQuizCatalogSource`, `IQuizProgressStore`) and `NO_READING_PLAN` (`@bible/core/browser`)
- `packages/core/src/Data/Repositories/QuizRepository.ts` - reads one quiz module
- `packages/ui/src/components/Quiz/QuizPanel.tsx` - launcher, runner, summary and history

## Modules

Quiz modules are `module_type: 'quiz'` files named `quiz_*.db` (schema `packages/core/sql/schemas/initial/Quiz.sql`). Every installed one is opened read-only (registry lookup, then `quiz*.db` probing in the user modules and data folders); files that are not readable quiz modules are skipped. `validate-module.js` checks them (`quiz_question` table). The Module Manager lists them under "Quizzes".

## IPC (`electron/ipc/quizHandlers.ts`, renderer side `src/ui/services/quizAPI.ts`)

| Channel | Purpose |
|---|---|
| `quiz:getCatalog` | merged `QuizCatalog` (modules and per-chapter coverage); cached once non-empty |
| `quiz:getQuestions` | questions overlapping up to 50 passage ranges, over all modules |
| `quiz:getStats` | per-question stats for up to 2000 keys, as a plain object |
| `quiz:recordAttempt`, `quiz:recordSession`, `quiz:listSessions` | progress in the user database |

Inputs are validated (`invalid_input`). The renderer wraps them as `IpcQuizSource` and `IpcQuizProgressStore` and builds a `QuizEngine` over them.

## Progress

Stored as `user_data_item` rows in the shared user database, owner `app:quiz`: collection `item-stats` (one row per question key) and `sessions` (one per finished quiz, capped at 200). Backup includes them like any user data.

## Pane and commands

- `src/ui/components/QuizPane.tsx` - loads the catalog (error state with retry), offers "This chapter" from the primary Bible panel, shows the last five quizzes, links passages into the reader. "Today's reading" is `null` until reading plans exist (seam: `IReadingScopeProvider` / `NO_READING_PLAN`).
- `quiz.open` - focus or add the Quiz pane. `quiz.thisChapter` ("Quiz me on this chapter") - leaves a request in `useQuizLaunchStore`, which the pane takes once, and opens the pane.
