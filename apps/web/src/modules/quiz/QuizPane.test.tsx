import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { QuizPane } from './QuizPane';

vi.mock('@bible/ui', () => ({
  QuizPanel: (props: { catalog: { modules: unknown[] }; history?: unknown; todaysReading?: unknown; labels?: { title?: string; kinds?: Record<string, string> } }) => (
    <div data-testid="panel">
      {props.catalog.modules.length}|{String(props.history)}|{String(props.todaysReading)}|{props.labels?.title}|{props.labels?.kinds?.recall}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

const catalog = { modules: [{ uuid: 'u', name: 'Q', sources: [] }], coverage: [] };
const engine = {} as never;

describe('QuizPane', () => {
  it('mounts the panel with the catalog, no history, labels from the catalog', async () => {
    render(<QuizPane provider={{ getCatalog: () => Promise.resolve(catalog), getQuestions: async () => [] }} engine={engine} />);
    expect(screen.getByText('quiz.loading')).toBeTruthy();
    const panel = await screen.findByTestId('panel');
    expect(panel.textContent).toBe('1|undefined|null|quiz.title|quiz.kinds.recall');
  });

  it('shows an error with a retry that reloads', async () => {
    const getCatalog = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(catalog);
    render(<QuizPane provider={{ getCatalog, getQuestions: async () => [] }} engine={engine} />);
    expect(await screen.findByText('quiz.loadError')).toBeTruthy();
    fireEvent.click(screen.getByText('quiz.retry'));
    await waitFor(() => expect(screen.getByTestId('panel')).toBeTruthy());
    expect(getCatalog).toHaveBeenCalledTimes(2);
  });
});
