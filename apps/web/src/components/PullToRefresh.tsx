import { useRef, useState, useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface PullToRefreshProps {
  children: ComponentChildren;
  class?: string;
  /** Called when the user completes a pull-to-refresh gesture. */
  onRefresh?: () => void;
  /** Minimum pull distance (px) to trigger refresh. Default 64. */
  threshold?: number;
}

type PullState = 'idle' | 'pulling' | 'ready' | 'refreshing';

/**
 * Wraps a scrollable container and adds pull-to-refresh gesture support.
 * Only activates when the container is scrolled to the top.
 */
export function PullToRefresh({
  children,
  class: className,
  onRefresh,
  threshold = 64,
}: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const pullDistanceRef = useRef(0);
  const [state, setState] = useState<PullState>('idle');
  const [pullPx, setPullPx] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      // Only start tracking if scrolled to top
      if (el.scrollTop > 0 || state === 'refreshing') return;
      startYRef.current = e.touches[0].clientY;
      pullDistanceRef.current = 0;
      active = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy < 0) {
        // Scrolling up — cancel pull
        active = false;
        setState('idle');
        setPullPx(0);
        return;
      }
      // Dampen the pull distance for a natural feel
      const dampened = Math.min(dy * 0.4, threshold * 2);
      pullDistanceRef.current = dampened;
      setPullPx(dampened);
      setState(dampened >= threshold ? 'ready' : 'pulling');

      // Prevent native scroll while pulling down from top
      if (el.scrollTop === 0 && dy > 10) {
        e.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (!active) return;
      active = false;
      if (pullDistanceRef.current >= threshold) {
        setState('refreshing');
        setPullPx(0);
        if (onRefresh) {
          onRefresh();
        } else {
          window.location.reload();
        }
        // Reset after a short delay (in case onRefresh doesn't navigate away)
        setTimeout(() => {
          setState('idle');
        }, 2000);
      } else {
        setState('idle');
        setPullPx(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [state, threshold, onRefresh]);

  const indicatorClass = [
    'pull-to-refresh',
    state === 'pulling' || state === 'ready' ? 'pull-to-refresh--pulling' : '',
    state === 'ready' ? 'pull-to-refresh--ready' : '',
    state === 'refreshing' ? 'pull-to-refresh--refreshing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={containerRef} class={className}>
      <div
        class={indicatorClass}
        style={state === 'pulling' || state === 'ready'
          ? { height: `${Math.min(pullPx, 48)}px` }
          : undefined}
      >
        {state === 'refreshing' ? (
          <>
            <div class="pull-to-refresh__spinner" />
            Refreshing...
          </>
        ) : (state === 'pulling' || state === 'ready') ? (
          <>
            <i class={`fa-solid fa-arrow-down pull-to-refresh__arrow`} />
            {state === 'ready' ? 'Release to refresh' : 'Pull to refresh'}
          </>
        ) : null}
      </div>
      {children}
    </div>
  );
}
