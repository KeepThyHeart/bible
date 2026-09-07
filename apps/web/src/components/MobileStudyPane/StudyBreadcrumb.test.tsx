/**
 * Component tests for StudyBreadcrumb.
 *
 * Pattern: Pure presentational component with props and click handlers.
 * No store integration — tests verify rendering, separators, conditional
 * button vs. span rendering, and click callbacks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { StudyBreadcrumb } from './StudyBreadcrumb';
import type { BreadcrumbItem } from './StudyBreadcrumb';

describe('StudyBreadcrumb', () => {
  it('renders nothing visible when crumbs is empty', () => {
    const { container } = render(<StudyBreadcrumb crumbs={[]} />);
    expect(container.querySelector('.study-breadcrumb')).toBeTruthy();
    // No child spans
    expect(container.querySelector('.study-breadcrumb__current')).toBeNull();
    expect(container.querySelector('.study-breadcrumb__link')).toBeNull();
  });

  it('renders a single crumb as a current (non-clickable) span', () => {
    const crumbs: BreadcrumbItem[] = [{ label: 'Home' }];
    const { container } = render(<StudyBreadcrumb crumbs={crumbs} />);

    expect(container.querySelector('.study-breadcrumb__current')).toBeTruthy();
    expect(screen.getByText('Home')).toBeTruthy();
    // No separator for a single item
    expect(container.querySelector('.study-breadcrumb__separator')).toBeNull();
  });

  it('renders the last crumb as current (span), not a button', () => {
    const crumbs: BreadcrumbItem[] = [
      { label: 'Topics', onClick: vi.fn() },
      { label: 'Grace', onClick: vi.fn() },
    ];
    const { container } = render(<StudyBreadcrumb crumbs={crumbs} />);

    // First item (not last, has onClick) → button
    expect(container.querySelector('.study-breadcrumb__link')).toBeTruthy();
    // Last item → always a span even if onClick is provided
    const currentSpans = container.querySelectorAll('.study-breadcrumb__current');
    expect(currentSpans.length).toBe(1);
    expect(currentSpans[0].textContent).toBe('Grace');
  });

  it('renders a crumb without onClick as a span', () => {
    const crumbs: BreadcrumbItem[] = [
      { label: 'Root' },
      { label: 'Child' },
    ];
    const { container } = render(<StudyBreadcrumb crumbs={crumbs} />);

    // Root has no onClick and is not last → rendered as current span
    const currentSpans = container.querySelectorAll('.study-breadcrumb__current');
    // Both crumbs lack onClick, so both render as spans
    expect(currentSpans.length).toBe(2);
    expect(container.querySelector('.study-breadcrumb__link')).toBeNull();
  });

  it('calls onClick for non-last crumbs with a handler', () => {
    const firstClick = vi.fn();
    const crumbs: BreadcrumbItem[] = [
      { label: 'Topics', onClick: firstClick },
      { label: 'Current' },
    ];
    render(<StudyBreadcrumb crumbs={crumbs} />);

    fireEvent.click(screen.getByText('Topics'));
    expect(firstClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick for the last crumb (rendered as span)', () => {
    const lastClick = vi.fn();
    const crumbs: BreadcrumbItem[] = [
      { label: 'First', onClick: vi.fn() },
      { label: 'Last', onClick: lastClick },
    ];
    const { container } = render(<StudyBreadcrumb crumbs={crumbs} />);

    // Last crumb is a span, not a button — clicking the text won't trigger lastClick
    const currentSpan = container.querySelector('.study-breadcrumb__current')!;
    fireEvent.click(currentSpan);
    expect(lastClick).not.toHaveBeenCalled();
  });

  it('renders separators between crumbs (n-1 separators for n crumbs)', () => {
    const crumbs: BreadcrumbItem[] = [
      { label: 'A', onClick: vi.fn() },
      { label: 'B', onClick: vi.fn() },
      { label: 'C' },
    ];
    const { container } = render(<StudyBreadcrumb crumbs={crumbs} />);

    const separators = container.querySelectorAll('.study-breadcrumb__separator');
    expect(separators.length).toBe(2);
  });

  it('renders a chevron icon inside each separator', () => {
    const crumbs: BreadcrumbItem[] = [
      { label: 'First', onClick: vi.fn() },
      { label: 'Second' },
    ];
    const { container } = render(<StudyBreadcrumb crumbs={crumbs} />);

    const separator = container.querySelector('.study-breadcrumb__separator');
    expect(separator?.querySelector('.fa-chevron-right')).toBeTruthy();
  });

  it('renders multiple clickable links for all non-last crumbs with onClick', () => {
    const handlers = [vi.fn(), vi.fn(), vi.fn()];
    const crumbs: BreadcrumbItem[] = [
      { label: 'L1', onClick: handlers[0] },
      { label: 'L2', onClick: handlers[1] },
      { label: 'L3', onClick: handlers[2] },
      { label: 'Current' },
    ];
    const { container } = render(<StudyBreadcrumb crumbs={crumbs} />);

    const links = container.querySelectorAll('.study-breadcrumb__link');
    expect(links.length).toBe(3);

    fireEvent.click(links[1]);
    expect(handlers[1]).toHaveBeenCalledTimes(1);
    expect(handlers[0]).not.toHaveBeenCalled();
  });

  it('applies the study-breadcrumb root class', () => {
    const { container } = render(<StudyBreadcrumb crumbs={[{ label: 'X' }]} />);
    expect(container.querySelector('.study-breadcrumb')).toBeTruthy();
  });
});
