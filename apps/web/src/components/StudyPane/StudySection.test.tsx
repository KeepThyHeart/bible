/**
 * Component tests for StudySection.
 *
 * Pattern: Pure presentational component with local state (expand/collapse),
 * sessionStorage persistence, and click handlers.
 * No store integration — tests verify rendering, toggling, and CSS class application.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { StudySection } from './StudySection';

describe('StudySection', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders the label', () => {
    render(
      <StudySection id="test" label="Cross References">
        <div>content</div>
      </StudySection>,
    );

    expect(screen.getByText('Cross References')).toBeTruthy();
  });

  it('renders subtitle when provided', () => {
    render(
      <StudySection id="test" label="Commentary" subtitle="(3 entries)">
        <div>content</div>
      </StudySection>,
    );

    expect(screen.getByText('(3 entries)')).toBeTruthy();
  });

  it('does not render subtitle when omitted', () => {
    const { container } = render(
      <StudySection id="test" label="Commentary">
        <div>content</div>
      </StudySection>,
    );

    expect(container.querySelector('.study-pane__section-subtitle')).toBeNull();
  });

  it('is collapsed by default when defaultExpanded is false', () => {
    const { container } = render(
      <StudySection id="test" label="Section" defaultExpanded={false}>
        <div data-testid="body">body</div>
      </StudySection>,
    );

    expect(container.querySelector('.study-pane__section-body')).toBeNull();
  });

  it('is expanded by default when defaultExpanded is true', () => {
    const { container } = render(
      <StudySection id="test" label="Section" defaultExpanded={true}>
        <div data-testid="body">body</div>
      </StudySection>,
    );

    expect(container.querySelector('.study-pane__section-body')).toBeTruthy();
  });

  it('toggles open when label is clicked', () => {
    const { container } = render(
      <StudySection id="test" label="Section">
        <div>content</div>
      </StudySection>,
    );

    // Initially collapsed
    expect(container.querySelector('.study-pane__section-body')).toBeNull();

    // Click to expand
    fireEvent.click(container.querySelector('.study-pane__section-label')!);
    expect(container.querySelector('.study-pane__section-body')).toBeTruthy();
  });

  it('toggles closed when already expanded and label is clicked', () => {
    const { container } = render(
      <StudySection id="test" label="Section" defaultExpanded={true}>
        <div>content</div>
      </StudySection>,
    );

    // Initially expanded
    expect(container.querySelector('.study-pane__section-body')).toBeTruthy();

    // Click to collapse
    fireEvent.click(container.querySelector('.study-pane__section-label')!);
    expect(container.querySelector('.study-pane__section-body')).toBeNull();
  });

  it('applies sticky CSS class to label when expanded', () => {
    const { container } = render(
      <StudySection id="test" label="Section" defaultExpanded={true}>
        <div>content</div>
      </StudySection>,
    );

    expect(container.querySelector('.study-pane__section-label--sticky')).toBeTruthy();
  });

  it('does not apply sticky CSS class to label when collapsed', () => {
    const { container } = render(
      <StudySection id="test" label="Section" defaultExpanded={false}>
        <div>content</div>
      </StudySection>,
    );

    expect(container.querySelector('.study-pane__section-label--sticky')).toBeNull();
  });

  it('shows chevron-down icon when expanded', () => {
    const { container } = render(
      <StudySection id="test" label="Section" defaultExpanded={true}>
        <div>content</div>
      </StudySection>,
    );

    expect(container.querySelector('.fa-chevron-down')).toBeTruthy();
    expect(container.querySelector('.fa-chevron-right')).toBeNull();
  });

  it('shows chevron-right icon when collapsed', () => {
    const { container } = render(
      <StudySection id="test" label="Section" defaultExpanded={false}>
        <div>content</div>
      </StudySection>,
    );

    expect(container.querySelector('.fa-chevron-right')).toBeTruthy();
    expect(container.querySelector('.fa-chevron-down')).toBeNull();
  });

  it('renders children inside the section body when expanded', () => {
    render(
      <StudySection id="test" label="Section" defaultExpanded={true}>
        <div data-testid="child-content">Child content here</div>
      </StudySection>,
    );

    expect(screen.getByTestId('child-content')).toBeTruthy();
    expect(screen.getByText('Child content here')).toBeTruthy();
  });

  it('persists expanded state to sessionStorage', () => {
    const { container } = render(
      <StudySection id="my-section" label="Section">
        <div>content</div>
      </StudySection>,
    );

    // Click to expand
    fireEvent.click(container.querySelector('.study-pane__section-label')!);
    expect(sessionStorage.getItem('bible-study-section-my-section')).toBe('1');

    // Click to collapse
    fireEvent.click(container.querySelector('.study-pane__section-label')!);
    expect(sessionStorage.getItem('bible-study-section-my-section')).toBe('0');
  });

  it('restores expanded state from sessionStorage', () => {
    sessionStorage.setItem('bible-study-section-restored', '1');

    const { container } = render(
      <StudySection id="restored" label="Section">
        <div>content</div>
      </StudySection>,
    );

    // Should be expanded based on sessionStorage
    expect(container.querySelector('.study-pane__section-body')).toBeTruthy();
  });

  it('renders the outer section container element', () => {
    const { container } = render(
      <StudySection id="test" label="Section">
        <div>content</div>
      </StudySection>,
    );

    expect(container.querySelector('.study-pane__section')).toBeTruthy();
  });
});
