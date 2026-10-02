import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuizRequest } from '@bible/core/browser';
import { QuizPanel } from './QuizPanel';
import { fillLabel, DEFAULT_QUIZ_LABELS } from './labels';
import { EMPTY_QUIZ_CATALOG, MARK_4, QUIZ_FIXTURE_CATALOG, makeFixtureEngine } from './fixture';
import type { QuizPanelProps } from './types';

function setup(props: Partial<QuizPanelProps> = {}) {
  const { engine, store } = makeFixtureEngine();
  const utils = render(<QuizPanel catalog={QUIZ_FIXTURE_CATALOG} engine={engine} {...props} />);
  return { engine, store, ...utils };
}

const only = (...keys: string[]): QuizRequest => ({ passages: [MARK_4], label: 'Mark 4', count: 10, onlyKeys: keys });
const advance = () => userEvent.click(screen.getByRole('button', { name: /^(Next|See results)$/ }));

describe('QuizPanel launcher', () => {
  it('offers this chapter when it has questions and lists the covered scope', async () => {
    setup({ currentChapter: { book: 41, chapter: 4 } });
    expect(screen.getByRole('radio', { name: 'This chapter (Mark 4)' })).toHaveProperty('checked', true);
    expect(screen.getByText('4 questions')).toBeTruthy();
    expect(screen.queryByText(/No questions for/)).toBeNull();
  });

  it('hides this chapter without questions and says so', () => {
    setup({ currentChapter: { book: 41, chapter: 3 } });
    expect(screen.queryByRole('radio', { name: /This chapter/ })).toBeNull();
    expect(screen.getByText('No questions for Mark 3 yet.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Choose a passage' })).toHaveProperty('checked', true);
  });

  it("shows today's reading first when given", () => {
    setup({
      currentChapter: { book: 41, chapter: 4 },
      todaysReading: { label: 'Day 3', passages: [{ start: 41001001, end: 41001999 }] },
    });
    expect(screen.getByRole('radio', { name: "Today's reading (Day 3)" })).toHaveProperty('checked', true);
    expect(screen.getByText('2 questions')).toBeTruthy();
  });

  it("leaves today's reading out when the module has no questions for it", () => {
    setup({
      currentChapter: { book: 41, chapter: 4 },
      todaysReading: { label: 'Genesis 1', passages: [{ start: 1001001, end: 1001999 }] },
    });
    expect(screen.queryByRole('radio', { name: /Today's reading/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /This chapter/ })).toHaveProperty('checked', true);
  });

  it('lists only covered books and chapters in the passage selects', async () => {
    setup();
    const book = screen.getByLabelText('Book') as HTMLSelectElement;
    expect([...book.options].map((o) => o.text)).toEqual(['Psalms', 'Mark']);
    await userEvent.selectOptions(book, 'Mark');
    expect([...(screen.getByLabelText('From chapter') as HTMLSelectElement).options].map((o) => o.text)).toEqual(['1', '4']);
    await userEvent.selectOptions(screen.getByLabelText('To chapter'), '4');
    expect(screen.getByText('6 questions')).toBeTruthy();
  });

  it('starts a quiz over the chosen scope', async () => {
    setup({ currentChapter: { book: 41, chapter: 4 } });
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(await screen.findByText('Question 1 of 4')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByText('Mark 4')).toBeTruthy();
  });

  it('shows attribution for each module', () => {
    setup();
    expect(screen.getByText('KTH Mark Questions')).toBeTruthy();
    const licence = screen.getAllByRole('link', { name: 'CC BY-SA 4.0' })[0];
    expect(licence.getAttribute('href')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(screen.getByText('Worded after the WEB')).toBeTruthy();
    expect(screen.getByText(/Questions by A\. Writer/)).toBeTruthy();
  });

  it('shows recent quizzes, at most five', () => {
    const history = Array.from({ length: 7 }, (_, i) => ({
      id: `q${i}`, date: '2026-09-30T10:00:00Z', label: `Quiz ${i}`, passages: [MARK_4], total: 5, graded: 5, correct: 3, partly: 0, score: 0.6, missedKeys: [],
    }));
    setup({ history });
    expect(screen.getByText('Recent quizzes')).toBeTruthy();
    expect(screen.getAllByText(/^Quiz \d: 3\/5/).length).toBe(5);
  });

  it('shows loading while the catalog is null', () => {
    const { engine } = makeFixtureEngine();
    render(<QuizPanel catalog={null} engine={engine} />);
    expect(screen.getByRole('status').textContent).toBe(DEFAULT_QUIZ_LABELS.loading);
  });

  it('shows noModule and the empty action for an empty catalog', async () => {
    const onClick = vi.fn();
    const { engine } = makeFixtureEngine();
    render(<QuizPanel catalog={EMPTY_QUIZ_CATALOG} engine={engine} emptyAction={{ label: 'Install questions', onClick }} />);
    expect(screen.getByText('No quiz questions are installed.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Install questions' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('stays on the launcher when the scope builds no questions', async () => {
    const { engine } = makeFixtureEngine();
    render(<QuizPanel catalog={QUIZ_FIXTURE_CATALOG} engine={engine} />);
    // Psalms 23 is in the catalog but the fixture source has no questions for it.
    await userEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(await screen.findByText('No questions for Psalms 23 yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start quiz' })).toBeTruthy();
  });
});

describe('QuizPanel running', () => {
  it('auto-starts a startRequest and starts again when it changes', async () => {
    const { engine } = makeFixtureEngine();
    const first = only('m4-mc');
    const { rerender } = render(<QuizPanel catalog={QUIZ_FIXTURE_CATALOG} engine={engine} startRequest={first} />);
    expect(await screen.findByText('In the parable, what happened to the seed on good soil?')).toBeTruthy();
    rerender(<QuizPanel catalog={QUIZ_FIXTURE_CATALOG} engine={engine} startRequest={only('m4-short')} />);
    expect(await screen.findByText('What was Jesus doing in the boat during the storm?')).toBeTruthy();
  });

  it('grades a correct multiple-choice answer and records it', async () => {
    const { store } = setup({ startRequest: only('m4-mc') });
    await screen.findByText(/good soil/);
    const check = screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: 'It produced a crop' }));
    await userEvent.click(check);
    expect(screen.getByRole('status').textContent).toContain('Correct');
    expect(screen.getByText('Some yielded thirty, sixty or a hundred times.')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'It was scorched' }) as HTMLInputElement).disabled).toBe(true);
    await advance();
    await vi.waitFor(async () => expect((await store.getStats(['m4-mc'])).get('m4-mc')?.correct).toBe(1));
  });

  it('records a corrected short answer once, with its final grade', async () => {
    const { store } = setup({ startRequest: only('m4-short') });
    await screen.findByText(/in the boat/);
    await userEvent.type(screen.getByLabelText('Your answer'), 'walking{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'I was right' }));
    await advance();
    await screen.findByText('1 of 1 correct');
    const stat = (await store.getStats(['m4-short'])).get('m4-short');
    expect(stat).toMatchObject({ seen: 1, correct: 1, missed: 0 });
  });

  it('records an answered card when the panel closes before Next', async () => {
    const { store } = setup({ startRequest: only('m4-mc') });
    await screen.findByText(/good soil/);
    await userEvent.click(screen.getByRole('radio', { name: 'It produced a crop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    cleanup();
    await vi.waitFor(async () => expect((await store.getStats(['m4-mc'])).get('m4-mc')).toMatchObject({ seen: 1, correct: 1 }));
  });

  it('wrong multiple choice also announces the answer, and focus moves to Next', async () => {
    setup({ startRequest: only('m4-mc') });
    await screen.findByText(/good soil/);
    await userEvent.click(screen.getByRole('radio', { name: 'It was scorched' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('status').textContent).toContain('The answer: It produced a crop');
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'See results' })));
  });

  it('keeps Check disabled for an empty short answer', async () => {
    setup({ startRequest: only('m4-short') });
    await screen.findByText(/in the boat/);
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Your answer'), 'x');
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('grades a wrong multiple-choice answer and marks the right one', async () => {
    const { container } = setup({ startRequest: only('m4-mc') });
    await screen.findByText(/good soil/);
    await userEvent.click(screen.getByRole('radio', { name: 'It was scorched' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('status').textContent).toContain('Not quite');
    expect(container.querySelectorAll('.kth-quiz__choice--correct').length).toBe(1);
    expect(container.querySelectorAll('.kth-quiz__choice--incorrect').length).toBe(1);
  });

  it('short answer: Enter submits, a miss shows the answer, "I was right" corrects it', async () => {
    const onFinished = vi.fn();
    setup({ startRequest: only('m4-short'), onFinished });
    await screen.findByText(/in the boat/);
    await userEvent.type(screen.getByLabelText('Your answer'), 'walking{Enter}');
    expect(screen.getByRole('status').textContent).toContain('Not quite');
    expect(screen.getByRole('status').textContent).toContain('The answer: sleeping');
    await userEvent.click(screen.getByRole('button', { name: 'I was right' }));
    expect(screen.getByRole('status').textContent).toContain('Correct');
    expect(screen.queryByRole('button', { name: 'I was right' })).toBeNull();
    await advance();
    expect(await screen.findByText('1 of 1 correct')).toBeTruthy();
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished.mock.calls[0][0]).toMatchObject({ correct: 1, graded: 1, missedKeys: [] });
  });

  it('short answer: a right answer is accepted', async () => {
    setup({ startRequest: only('m4-short') });
    await screen.findByText(/in the boat/);
    await userEvent.type(screen.getByLabelText('Your answer'), 'Asleep');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('status').textContent).toContain('Correct');
  });

  it('free response: reveals the model answer and takes a self-grade', async () => {
    setup({ startRequest: only('m4-free') });
    await screen.findByText(/four soils/);
    expect(screen.queryByText(/Four responses/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getByText('Four responses to the word: hard, shallow, choked and fruitful.')).toBeTruthy();
    expect(screen.getByText('Jesus explains the parable to his disciples.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Partly' }));
    expect(screen.getByRole('status').textContent).toContain('Partly');
    await advance();
    expect(await screen.findByText('0 of 1 correct · 1 partly')).toBeTruthy();
  });

  it('reflection: shows no verdict and continues ungraded', async () => {
    setup({ startRequest: only('m4-reflect') });
    await screen.findByText(/Which soil/);
    expect(screen.getByText(DEFAULT_QUIZ_LABELS.reflectionHint)).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox'), 'The path');
    await userEvent.click(screen.getByRole('button', { name: 'See results' }));
    expect(await screen.findByText('Nothing was graded in this quiz.')).toBeTruthy();
  });

  it('skip moves on without grading', async () => {
    setup({ startRequest: only('m4-mc') });
    await screen.findByText(/good soil/);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('Nothing was graded in this quiz.')).toBeTruthy();
  });

  it('shows the kind, difficulty and a passage link', async () => {
    const onOpenPassage = vi.fn();
    setup({ startRequest: only('m4-mc'), onOpenPassage });
    await screen.findByText(/good soil/);
    expect(screen.getByText('Understanding')).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toMatch(/good soil/);
    await userEvent.click(screen.getByRole('button', { name: 'Read Mark 4:3-8' }));
    expect(onOpenPassage).toHaveBeenCalledWith(41004003, 41004008);
  });

  it('End quiz with nothing graded records no session and does not call onFinished', async () => {
    const onFinished = vi.fn();
    const { store } = setup({ startRequest: only('m4-mc'), onFinished });
    await screen.findByText(/good soil/);
    await userEvent.click(screen.getByRole('button', { name: 'End quiz' }));
    await screen.findByText('Nothing was graded in this quiz.');
    expect(onFinished).not.toHaveBeenCalled();
    expect(await store.listSessions()).toEqual([]);
  });

  it('a new startRequest finishes a running quiz that has graded answers', async () => {
    const onFinished = vi.fn();
    const { engine } = makeFixtureEngine();
    const { rerender } = render(<QuizPanel catalog={QUIZ_FIXTURE_CATALOG} engine={engine} startRequest={only('m4-mc', 'm4-short')} onFinished={onFinished} />);
    await screen.findByText('Question 1 of 2');
    if (screen.queryByRole('radiogroup')) {
      await userEvent.click(screen.getByRole('radio', { name: 'It produced a crop' }));
      await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    } else {
      await userEvent.type(screen.getByLabelText('Your answer'), 'asleep{Enter}');
    }
    rerender(<QuizPanel catalog={QUIZ_FIXTURE_CATALOG} engine={engine} startRequest={only('m4-free')} onFinished={onFinished} />);
    expect(await screen.findByText(/four soils/)).toBeTruthy();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('End quiz jumps to the summary with what was answered', async () => {
    setup({ startRequest: only('m4-mc', 'm4-short') });
    await screen.findByText('Question 1 of 2');
    await userEvent.click(screen.getByRole('button', { name: 'End quiz' }));
    expect(await screen.findByText('Results')).toBeTruthy();
  });
});

describe('QuizPanel summary', () => {
  async function missBoth() {
    await screen.findByText('Question 1 of 2');
    for (let i = 0; i < 2; i++) {
      if (screen.queryByRole('radiogroup')) {
        await userEvent.click(screen.getByRole('radio', { name: 'It was scorched' }));
        await userEvent.click(screen.getByRole('button', { name: 'Check' }));
      } else {
        await userEvent.type(screen.getByLabelText('Your answer'), 'zzz{Enter}');
      }
      await advance();
    }
  }

  it('shows the score, the missed list with answers, and retries the missed ones', async () => {
    setup({ startRequest: only('m4-mc', 'm4-short') });
    await missBoth();
    expect(await screen.findByText('0 of 2 correct')).toBeTruthy();
    const list = within(screen.getByText('To review').parentElement as HTMLElement);
    expect(list.getByText(/good soil/)).toBeTruthy();
    expect(list.getByText('The answer: It produced a crop')).toBeTruthy();
    expect(list.getByText('The answer: sleeping')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry the ones I missed' }));
    expect(await screen.findByText('Question 1 of 2')).toBeTruthy();
  });

  it('summary: missed prompts and their answers are dir=auto', async () => {
    setup({ startRequest: only('m4-mc', 'm4-short') });
    await missBoth();
    const list = within(screen.getByText('To review').parentElement as HTMLElement);
    expect(list.getByText(/good soil/).getAttribute('dir')).toBe('auto');
    expect(list.getByText('The answer: sleeping').getAttribute('dir')).toBe('auto');
  });

  it('offers another quiz on the same scope and a new quiz', async () => {
    setup({ startRequest: only('m4-mc', 'm4-short') });
    await missBoth();
    await userEvent.click(await screen.findByRole('button', { name: fillLabel(DEFAULT_QUIZ_LABELS.sameAgain, { label: 'Mark 4' }) }));
    expect(await screen.findByText('Question 1 of 2')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'End quiz' }));
    await userEvent.click(await screen.findByRole('button', { name: 'New quiz' }));
    expect(screen.getByRole('button', { name: 'Start quiz' })).toBeTruthy();
  });

  it('hides "Retry the ones I missed" when nothing was missed', async () => {
    setup({ startRequest: only('m4-reflect') });
    await screen.findByText(/Which soil/);
    await userEvent.click(screen.getByRole('button', { name: 'See results' }));
    await screen.findByText('Results');
    expect(screen.queryByRole('button', { name: 'Retry the ones I missed' })).toBeNull();
  });
});

describe('fillLabel', () => {
  it('replaces known placeholders and keeps unknown ones', () => {
    expect(fillLabel('{a} of {b} {c}', { a: 1, b: 'x' })).toBe('1 of x {c}');
  });
});

describe('quiz content direction (UI may be RTL, question text follows its own script)', () => {
  it('multiple choice: prompt, choices, expected answer and explanation are dir=auto; chrome is not', async () => {
    setup({ startRequest: only('m4-mc') });
    const prompt = await screen.findByText(/good soil/);
    expect(prompt.getAttribute('dir')).toBe('auto');
    expect(screen.getByText('It produced a crop').getAttribute('dir')).toBe('auto');
    expect(screen.getByRole('button', { name: 'Check' }).hasAttribute('dir')).toBe(false);
    await userEvent.click(screen.getByRole('radio', { name: 'It produced a crop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('Some yielded thirty, sixty or a hundred times.').getAttribute('dir')).toBe('auto');
  });

  it('short answer: the typed input is dir=auto (empty: UI direction) and a miss shows the expected answer as dir=auto', async () => {
    setup({ startRequest: only('m4-short') });
    await screen.findByText(/in the boat/);
    const input = screen.getByLabelText('Your answer');
    expect(input.getAttribute('dir')).toBeNull(); // the placeholder follows the UI
    await userEvent.type(input, 'walking');
    expect(input.getAttribute('dir')).toBe('auto');
    await userEvent.type(input, '{Enter}');
    expect(document.querySelector('.kth-quiz__expected')?.getAttribute('dir')).toBe('auto');
  });

  it('free response: typed textarea and model answer are dir=auto', async () => {
    setup({ startRequest: only('m4-free') });
    await screen.findByText(/four soils/);
    const area = screen.getByLabelText('Your answer');
    expect(area.getAttribute('dir')).toBeNull();
    await userEvent.type(area, 'soils');
    expect(area.getAttribute('dir')).toBe('auto');
    await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getByText('Four responses to the word: hard, shallow, choked and fruitful.').getAttribute('dir')).toBe('auto');
  });
});
