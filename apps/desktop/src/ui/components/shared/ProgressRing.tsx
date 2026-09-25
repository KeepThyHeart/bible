/**
 * ProgressRing.tsx
 *
 * A circular progress indicator supporting both determinate and indeterminate modes.
 *
 * When `percent` prop is provided (0-100), renders a determinate ring showing the progress.
 * When no `percent` is provided, renders an indeterminate spinning ring.
 *
 * Props:
 * - percent?: number (0-100) - If provided, shows determinate progress. Otherwise shows spinner.
 * - size?: 'small' | 'medium' | 'large' - Ring size. Default: 'medium'.
 * - ariaLabel?: string - Label for screen readers. Default: "Loading" or "Progress: X%".
 *
 * Respects prefers-reduced-motion for animations.
 */

import React from 'react';

type Size = 'small' | 'medium' | 'large';

export interface ProgressRingProps {
  /** Progress percentage (0-100). If undefined, renders indeterminate spinner. */
  percent?: number;
  /** Ring size. Default: 'medium'. */
  size?: Size;
  /** Label for screen readers. Default: "Loading" or "Progress: X%". */
  ariaLabel?: string;
}

const SIZES: Record<Size, number> = {
  small: 24,
  medium: 40,
  large: 56,
};

const STROKE_WIDTH = 3;

export const ProgressRing: React.FC<ProgressRingProps> = ({
  percent,
  size = 'medium',
  ariaLabel,
}) => {
  const diameter = SIZES[size];
  const radius = (diameter - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;

  const isDeterminate = typeof percent === 'number';
  const progress = isDeterminate ? Math.min(Math.max(percent, 0), 100) : 0;
  const strokeDashoffset = isDeterminate ? circumference - (progress / 100) * circumference : 0;

  const defaultLabel = isDeterminate ? `Progress: ${progress}%` : 'Loading';
  const finalLabel = ariaLabel || defaultLabel;

  // Check for prefers-reduced-motion
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  return (
    <div
      role="progressbar"
      aria-valuenow={isDeterminate ? progress : undefined}
      aria-label={finalLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg
        width={diameter}
        height={diameter}
        viewBox={`0 0 ${diameter} ${diameter}`}
        style={{ display: 'block' }}
      >
        {/* Background track */}
        <circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={radius}
          fill="none"
          stroke="var(--theme-bg-tertiary)"
          strokeWidth={STROKE_WIDTH}
        />

        {/* Progress indicator or spinner */}
        {isDeterminate ? (
          <circle
            cx={diameter / 2}
            cy={diameter / 2}
            r={radius}
            fill="none"
            stroke="var(--theme-accent-primary)"
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 0.3s ease',
              transformOrigin: '50% 50%',
              transform: 'rotate(-90deg)',
            }}
          />
        ) : (
          <circle
            cx={diameter / 2}
            cy={diameter / 2}
            r={radius}
            fill="none"
            stroke="var(--theme-accent-primary)"
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={circumference * 0.25}
            strokeDashoffset={0}
            strokeLinecap="round"
            style={{
              transformOrigin: '50% 50%',
              transform: 'rotate(-90deg)',
              animation: prefersReducedMotion
                ? 'none'
                : 'progress-ring-spin 1s linear infinite',
            }}
          />
        )}
      </svg>

      <style>{`
        @keyframes progress-ring-spin {
          from {
            transform: rotate(-90deg);
          }
          to {
            transform: rotate(270deg);
          }
        }
      `}</style>
    </div>
  );
};

export default ProgressRing;
