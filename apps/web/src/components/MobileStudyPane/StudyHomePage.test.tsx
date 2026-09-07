/**
 * Component tests for StudyHomePage.
 *
 * Pattern: Store-connected component. settingsStore.leftHandedMode controls
 * card layout order. Tests manipulate the store directly and verify the
 * rendered card order and navigation callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));


import { StudyHomePage } from './StudyHomePage';
import { settingsStore } from '../../stores/settingsStore';

beforeEach(() => {
  settingsStore.setLeftHandedMode(false);
});

describe('StudyHomePage', () => {
  it('renders six study cards', () => {
    const { container } = render(<StudyHomePage onNavigate={vi.fn()} />);
    const cards = container.querySelectorAll('.study-home-grid__card');
    expect(cards.length).toBe(6);
  });

  it('renders all expected card labels', () => {
    render(<StudyHomePage onNavigate={vi.fn()} />);
    expect(screen.getByText('studyHomePage.crossReferences')).toBeTruthy();
    expect(screen.getByText('studyHomePage.topics')).toBeTruthy();
    expect(screen.getByText('studyHomePage.commentary')).toBeTruthy();
    expect(screen.getByText('studyHomePage.dictionary')).toBeTruthy();
    expect(screen.getByText('studyHomePage.interlinear')).toBeTruthy();
    expect(screen.getByText('studyHomePage.commentarySummary')).toBeTruthy();
  });

  it('calls onNavigate with the correct page when a card is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyHomePage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyHomePage.crossReferences'));
    expect(onNavigate).toHaveBeenCalledWith('crossrefs');
  });

  it('calls onNavigate("topics") when topics card is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyHomePage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyHomePage.topics'));
    expect(onNavigate).toHaveBeenCalledWith('topics');
  });

  it('calls onNavigate("commentary") when commentary card is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyHomePage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyHomePage.commentary'));
    expect(onNavigate).toHaveBeenCalledWith('commentary');
  });

  it('calls onNavigate("dictionary") when dictionary card is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyHomePage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyHomePage.dictionary'));
    expect(onNavigate).toHaveBeenCalledWith('dictionary');
  });

  it('calls onNavigate("interlinear") when interlinear card is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyHomePage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyHomePage.interlinear'));
    expect(onNavigate).toHaveBeenCalledWith('interlinear');
  });

  it('calls onNavigate("summary") when summary card is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyHomePage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyHomePage.commentarySummary'));
    expect(onNavigate).toHaveBeenCalledWith('summary');
  });

  it('right-handed layout: crossrefs appears before topics (first two cards)', () => {
    const { container } = render(<StudyHomePage onNavigate={vi.fn()} />);
    const cards = Array.from(container.querySelectorAll('.study-home-grid__card'));
    const labels = cards.map((c) => c.querySelector('.study-home-grid__label')?.textContent);
    expect(labels[0]).toBe('studyHomePage.crossReferences');
    expect(labels[1]).toBe('studyHomePage.topics');
  });

  it('left-handed layout: topics appears before crossrefs (first two cards)', () => {
    act(() => { settingsStore.setLeftHandedMode(true); });
    const { container } = render(<StudyHomePage onNavigate={vi.fn()} />);
    const cards = Array.from(container.querySelectorAll('.study-home-grid__card'));
    const labels = cards.map((c) => c.querySelector('.study-home-grid__label')?.textContent);
    expect(labels[0]).toBe('studyHomePage.topics');
    expect(labels[1]).toBe('studyHomePage.crossReferences');
  });

  it('card order changes when leftHandedMode is toggled', () => {
    const { container } = render(<StudyHomePage onNavigate={vi.fn()} />);
    const getFirstLabel = () =>
      container.querySelector('.study-home-grid__label')?.textContent;

    expect(getFirstLabel()).toBe('studyHomePage.crossReferences');

    act(() => { settingsStore.setLeftHandedMode(true); });
    expect(getFirstLabel()).toBe('studyHomePage.topics');
  });

  it('each card has a color class applied', () => {
    const { container } = render(<StudyHomePage onNavigate={vi.fn()} />);
    const cards = Array.from(container.querySelectorAll('.study-home-grid__card'));
    for (const card of cards) {
      expect(card.className).toMatch(/study-home-grid__card--\w+/);
    }
  });
});
