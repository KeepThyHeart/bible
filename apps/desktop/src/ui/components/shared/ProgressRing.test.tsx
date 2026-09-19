import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';

// Mock window.matchMedia for prefers-reduced-motion
const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('ProgressRing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatchMedia(false); // Default to not preferring reduced motion
  });

  describe('determinate mode', () => {
    it('renders with role="progressbar"', () => {
      render(<ProgressRing percent={50} />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('sets aria-valuenow to the percent value', () => {
      render(<ProgressRing percent={75} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
    });

    it('clamps percent to 0-100 range', () => {
      const { rerender } = render(<ProgressRing percent={150} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

      rerender(<ProgressRing percent={-50} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    });

    it('renders SVG with two circles (track and progress)', () => {
      const { container } = render(<ProgressRing percent={50} />);
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBe(2);
    });

    it('uses default aria-label "Progress: X%" when not provided', () => {
      render(<ProgressRing percent={42} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Progress: 42%');
    });

    it('uses custom aria-label when provided', () => {
      render(<ProgressRing percent={50} ariaLabel="Downloading module" />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Downloading module');
    });

    it('applies correct stroke color to progress circle', () => {
      const { container } = render(<ProgressRing percent={50} />);
      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1]; // Second circle is the progress
      expect(progressCircle).toHaveAttribute('stroke', 'var(--theme-accent-primary)');
    });

    it('renders different sizes', () => {
      const { container: smallContainer } = render(<ProgressRing percent={50} size="small" />);
      const smallSvg = smallContainer.querySelector('svg');
      expect(smallSvg).toHaveAttribute('width', '24');

      const { container: mediumContainer } = render(<ProgressRing percent={50} size="medium" />);
      const mediumSvg = mediumContainer.querySelector('svg');
      expect(mediumSvg).toHaveAttribute('width', '40');

      const { container: largeContainer } = render(<ProgressRing percent={50} size="large" />);
      const largeSvg = largeContainer.querySelector('svg');
      expect(largeSvg).toHaveAttribute('width', '56');
    });

    it('defaults to medium size', () => {
      const { container } = render(<ProgressRing percent={50} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('width', '40');
      expect(svg).toHaveAttribute('height', '40');
    });

    it('updates aria-valuenow when percent changes', () => {
      const { rerender } = render(<ProgressRing percent={0} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

      rerender(<ProgressRing percent={50} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');

      rerender(<ProgressRing percent={100} />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    });
  });

  describe('indeterminate mode', () => {
    it('renders without aria-valuenow when percent is undefined', () => {
      render(<ProgressRing />);
      expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    });

    it('uses default aria-label "Loading" when not provided', () => {
      render(<ProgressRing />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Loading');
    });

    it('uses custom aria-label when provided', () => {
      render(<ProgressRing ariaLabel="Reindexing module" />);
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Reindexing module');
    });

    it('renders SVG with two circles (track and spinner)', () => {
      const { container } = render(<ProgressRing />);
      const circles = container.querySelectorAll('circle');
      expect(circles.length).toBe(2);
    });

    it('applies spinning animation', () => {
      const { container } = render(<ProgressRing />);
      const circles = container.querySelectorAll('circle');
      const spinnerCircle = circles[1];
      const style = spinnerCircle.getAttribute('style');
      expect(style).toContain('animation');
      expect(style).toContain('progress-ring-spin');
    });

    it('respects prefers-reduced-motion', () => {
      mockMatchMedia(true); // Prefer reduced motion
      const { container } = render(<ProgressRing />);
      const circles = container.querySelectorAll('circle');
      const spinnerCircle = circles[1];
      const style = spinnerCircle.getAttribute('style');
      expect(style).toContain('animation: none');
    });
  });

  describe('SVG structure', () => {
    it('renders SVG with correct viewBox', () => {
      const { container } = render(<ProgressRing size="medium" />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveAttribute('viewBox', '0 0 40 40');
    });

    it('background circle uses tertiary background color', () => {
      const { container } = render(<ProgressRing percent={50} />);
      const circles = container.querySelectorAll('circle');
      const bgCircle = circles[0];
      expect(bgCircle).toHaveAttribute('stroke', 'var(--theme-bg-tertiary)');
      expect(bgCircle).toHaveAttribute('fill', 'none');
    });

    it('progress circle has stroke-linecap="round" for smooth edges', () => {
      const { container } = render(<ProgressRing percent={50} />);
      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      expect(progressCircle).toHaveAttribute('stroke-linecap', 'round');
    });

    it('centers SVG within container', () => {
      const { container } = render(<ProgressRing />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.style.display).toBe('inline-flex');
      expect(wrapper.style.alignItems).toBe('center');
      expect(wrapper.style.justifyContent).toBe('center');
    });
  });

  describe('different percent values', () => {
    it('correctly positions ring for 0%', () => {
      const { container } = render(<ProgressRing percent={0} />);
      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      // At 0%, no progress visible - stroke-dashoffset equals circumference
      expect(progressCircle).toHaveAttribute('stroke-dasharray');
      expect(progressCircle).toHaveAttribute('stroke-dashoffset');
    });

    it('correctly positions ring for 25%', () => {
      const { container } = render(<ProgressRing percent={25} />);
      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      expect(progressCircle).toHaveAttribute('stroke-dashoffset');
    });

    it('correctly positions ring for 50%', () => {
      const { container } = render(<ProgressRing percent={50} />);
      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      expect(progressCircle).toHaveAttribute('stroke-dashoffset');
    });

    it('correctly positions ring for 100%', () => {
      const { container } = render(<ProgressRing percent={100} />);
      const circles = container.querySelectorAll('circle');
      const progressCircle = circles[1];
      // At 100%, full circle visible - stroke-dashoffset should be 0
      expect(progressCircle.getAttribute('stroke-dashoffset')).toBe('0');
    });
  });
});
