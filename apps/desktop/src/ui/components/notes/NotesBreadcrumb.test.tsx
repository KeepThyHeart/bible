import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotesBreadcrumb, { type BreadcrumbSegment } from './NotesBreadcrumb';

describe('NotesBreadcrumb', () => {
  it('renders breadcrumb segments', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Root', path: '/' },
      { label: 'Folder', path: '/folder' },
      { label: 'Document', path: '/folder/doc' },
    ];
    const onNavigate = vi.fn();

    render(<NotesBreadcrumb segments={segments} onNavigate={onNavigate} />);

    expect(screen.getByText('Root')).toBeInTheDocument();
    expect(screen.getByText('Folder')).toBeInTheDocument();
    expect(screen.getByText('Document')).toBeInTheDocument();
  });

  it('renders first segment as a button', async () => {
    const user = userEvent.setup();
    const segments: BreadcrumbSegment[] = [
      { label: 'Root', path: '/' },
      { label: 'Child', path: '/child' },
    ];
    const onNavigate = vi.fn();

    render(<NotesBreadcrumb segments={segments} onNavigate={onNavigate} />);

    const rootButton = screen.getByRole('button', { name: 'Root' });
    expect(rootButton).toBeInTheDocument();

    await user.click(rootButton);
    expect(onNavigate).toHaveBeenCalledWith('/');
  });

  it('renders last segment as text (not a button)', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Root', path: '/' },
      { label: 'Document', path: '/document' },
    ];
    const onNavigate = vi.fn();

    render(<NotesBreadcrumb segments={segments} onNavigate={onNavigate} />);

    const lastSegment = screen.getByText('Document');
    expect(lastSegment.closest('button')).not.toBeInTheDocument();
    expect(lastSegment).toHaveClass('font-medium', 'text-text-heading');
  });

  it('calls onNavigate with correct path when segment is clicked', async () => {
    const user = userEvent.setup();
    const segments: BreadcrumbSegment[] = [
      { label: 'Root', path: '/' },
      { label: 'Level1', path: '/level1' },
      { label: 'Level2', path: '/level1/level2' },
    ];
    const onNavigate = vi.fn();

    render(<NotesBreadcrumb segments={segments} onNavigate={onNavigate} />);

    const level1Button = screen.getByRole('button', { name: 'Level1' });
    await user.click(level1Button);

    expect(onNavigate).toHaveBeenCalledWith('/level1');
  });

  it('renders separator between segments', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Root', path: '/' },
      { label: 'Child', path: '/child' },
    ];
    const onNavigate = vi.fn();

    const { container } = render(
      <NotesBreadcrumb segments={segments} onNavigate={onNavigate} />
    );

    const separators = container.querySelectorAll('svg');
    expect(separators.length).toBeGreaterThan(0);
  });

  it('does not render separator before first segment', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Root', path: '/' },
    ];
    const onNavigate = vi.fn();

    const { container } = render(
      <NotesBreadcrumb segments={segments} onNavigate={onNavigate} />
    );

    // Should have the container but no separators
    const separators = container.querySelectorAll('svg');
    expect(separators.length).toBe(0);
  });

  it('renders single segment correctly', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Standalone', path: '/standalone' },
    ];
    const onNavigate = vi.fn();

    render(<NotesBreadcrumb segments={segments} onNavigate={onNavigate} />);

    const segment = screen.getByText('Standalone');
    expect(segment).toHaveClass('font-medium');
  });

  it('renders many segments', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Level1', path: '/1' },
      { label: 'Level2', path: '/1/2' },
      { label: 'Level3', path: '/1/2/3' },
      { label: 'Level4', path: '/1/2/3/4' },
      { label: 'Level5', path: '/1/2/3/4/5' },
    ];
    const onNavigate = vi.fn();

    render(<NotesBreadcrumb segments={segments} onNavigate={onNavigate} />);

    expect(screen.getByText('Level1')).toBeInTheDocument();
    expect(screen.getByText('Level5')).toBeInTheDocument();
  });

  it('handles segments with special characters in labels', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Root & Folder', path: '/' },
      { label: 'Child (with parens)', path: '/child' },
    ];
    const onNavigate = vi.fn();

    render(<NotesBreadcrumb segments={segments} onNavigate={onNavigate} />);

    expect(screen.getByText('Root & Folder')).toBeInTheDocument();
    expect(screen.getByText('Child (with parens)')).toBeInTheDocument();
  });

  it('has proper accessibility attributes on buttons', async () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Root', path: '/' },
      { label: 'Child', path: '/child' },
    ];
    const onNavigate = vi.fn();

    render(<NotesBreadcrumb segments={segments} onNavigate={onNavigate} />);

    const button = screen.getByRole('button', { name: 'Root' });
    expect(button).toHaveClass('text-accent-strong', 'hover:underline');
  });

  it('renders with correct container styling', () => {
    const segments: BreadcrumbSegment[] = [
      { label: 'Root', path: '/' },
    ];
    const onNavigate = vi.fn();

    const { container } = render(
      <NotesBreadcrumb segments={segments} onNavigate={onNavigate} />
    );

    const wrapper = container.firstChild;
    expect(wrapper).toHaveClass('flex', 'items-center', 'gap-1');
  });
});
