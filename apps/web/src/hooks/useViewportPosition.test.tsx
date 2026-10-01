import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/preact';
import { useViewportPosition } from './useViewportPosition';

function Probe({ left, dir }: { left: number; dir?: 'ltr' | 'rtl' }) {
  const ref = useViewportPosition<HTMLDivElement>({ top: 10, left }, [], dir);
  return <div ref={ref} data-testid="probe" style={{ position: 'fixed', width: '100px', height: '20px' }} />;
}

describe('useViewportPosition with a UI direction', () => {
  const original = window.innerWidth;
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
  });

  it('anchors with inset-inline-start and never sets a physical left', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const { getByTestId } = render(<Probe left={300} dir="rtl" />);
    const el = getByTestId('probe') as HTMLElement;
    // jsdom has no layout, so the menu width is 0 and the inline offset is the
    // pointer distance from the right edge (1000 - 300).
    expect(el.style.insetInlineStart).toBe('700px');
    expect(el.style.left).toBe('');
  });

  it('keeps the old 16px edge padding near the edges', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const { getByTestId } = render(<Probe left={2} dir="ltr" />);
    expect((getByTestId('probe') as HTMLElement).style.insetInlineStart).toBe('16px');
  });

  it('in LTR the inline offset equals the pointer x', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const { getByTestId } = render(<Probe left={300} dir="ltr" />);
    expect((getByTestId('probe') as HTMLElement).style.insetInlineStart).toBe('300px');
  });
});
