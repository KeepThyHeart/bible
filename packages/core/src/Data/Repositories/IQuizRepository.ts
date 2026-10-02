import type { QuizChapterCoverage, QuizFilter, QuizModuleInfo, QuizPassage, QuizQuestion } from '../../Quiz/types';

/** Read access to one quiz module (`quiz_*.db`). */
export interface IQuizRepository {
  /** module_info plus the module's data sources (attribution). */
  getInfo(): QuizModuleInfo;
  /** Questions per chapter, by each question's primary passage. */
  getCoverage(): QuizChapterCoverage[];
  /** Every question with a passage overlapping any of `passages`, in text order. */
  getQuestions(passages: QuizPassage[], filter?: QuizFilter): QuizQuestion[];
  /** The questions with these keys (unknown keys are skipped). */
  getQuestionsByKeys(keys: string[]): QuizQuestion[];
}
