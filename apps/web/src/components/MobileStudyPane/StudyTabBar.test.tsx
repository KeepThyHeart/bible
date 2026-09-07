/**
 * Component tests for StudyTabBar.
 *
 * Pattern: Pure presentational component with props and click handlers.
 * No store integration — tests verify tab rendering, active-tab CSS class,
 * and navigation callbacks (home button + study-type tabs).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));


import { StudyTabBar } from './StudyTabBar';
import type { StudySubPage } from './StudyHomePage';

describe('StudyTabBar', () => {
  it('renders the home button', () => {
    const { container } = render(<StudyTabBar activePage="crossrefs" onNavigate={vi.fn()} />);
    expect(container.querySelector('.study-tab-bar__tab--home')).toBeTruthy();
  });

  it('renders all four study-type tabs', () => {
    render(<StudyTabBar activePage="crossrefs" onNavigate={vi.fn()} />);
    expect(screen.getByText('studyTabBar.xrefs')).toBeTruthy();
    expect(screen.getByText('studyTabBar.topics')).toBeTruthy();
    expect(screen.getByText('studyTabBar.commentary')).toBeTruthy();
    expect(screen.getByText('studyTabBar.dictionary')).toBeTruthy();
  });

  it('applies active class to the active tab', () => {
    const { container } = render(<StudyTabBar activePage="topics" onNavigate={vi.fn()} />);
    const activeTabs = container.querySelectorAll('.study-tab-bar__tab--active');
    expect(activeTabs.length).toBe(1);
    // The active tab should contain the "topics" label
    expect(activeTabs[0].textContent).toContain('studyTabBar.topics');
  });

  it('does not apply active class to inactive tabs', () => {
    const { container } = render(<StudyTabBar activePage="crossrefs" onNavigate={vi.fn()} />);
    const active = container.querySelectorAll('.study-tab-bar__tab--active');
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain('studyTabBar.xrefs');
  });

  it('calls onNavigate("home") when home button is clicked', () => {
    const onNavigate = vi.fn();
    const { container } = render(<StudyTabBar activePage="crossrefs" onNavigate={onNavigate} />);
    fireEvent.click(container.querySelector('.study-tab-bar__tab--home')!);
    expect(onNavigate).toHaveBeenCalledWith('home');
  });

  it('calls onNavigate with "crossrefs" when xrefs tab is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyTabBar activePage="commentary" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyTabBar.xrefs'));
    expect(onNavigate).toHaveBeenCalledWith('crossrefs');
  });

  it('calls onNavigate with "topics" when topics tab is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyTabBar activePage="crossrefs" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyTabBar.topics'));
    expect(onNavigate).toHaveBeenCalledWith('topics');
  });

  it('calls onNavigate with "commentary" when commentary tab is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyTabBar activePage="crossrefs" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyTabBar.commentary'));
    expect(onNavigate).toHaveBeenCalledWith('commentary');
  });

  it('calls onNavigate with "dictionary" when dictionary tab is clicked', () => {
    const onNavigate = vi.fn();
    render(<StudyTabBar activePage="crossrefs" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('studyTabBar.dictionary'));
    expect(onNavigate).toHaveBeenCalledWith('dictionary');
  });

  it('switches active tab when activePage prop changes', () => {
    const pages: StudySubPage[] = ['crossrefs', 'topics', 'commentary', 'dictionary'];
    for (const page of pages) {
      const { container } = render(<StudyTabBar activePage={page} onNavigate={vi.fn()} />);
      const active = container.querySelectorAll('.study-tab-bar__tab--active');
      expect(active.length).toBe(1);
    }
  });
});
