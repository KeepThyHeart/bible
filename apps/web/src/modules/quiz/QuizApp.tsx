import { backToStudy } from '../../host/appHost';
import { QuizPane } from './QuizPane';

/**
 * The Quiz page (`#/@quiz`): the same quiz as the right-pane tab, full width
 * under the shell's chrome. Opening a passage returns to Study to read it.
 */
export function QuizApp() {
  return (
    <div class="quiz-app">
      <QuizPane onPassageOpened={() => { void backToStudy(); }} />
    </div>
  );
}
