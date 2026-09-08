import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../contexts/useI18n';
import { useIsRtl } from '../../contexts/useDirection';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { anchorAtPointerX } from '../../utils/overlayPosition';
import {
  useOnboardingStore,
  TOUR_STEP_COUNT,
} from '../../stores/useOnboardingStore';
import { TOUR_STEPS, resolveAnchorElement } from './tourSteps';
import { useReducedMotion } from './useReducedMotion';

/** Gap between the spotlight and the explanation card, in px. */
const CARD_GAP = 12;
/** Minimum distance the card keeps from the viewport edge, in px. */
const VIEWPORT_MARGIN = 12;
/** Fixed card width. Narrow enough to sit beside most anchors at 1024px. */
const CARD_WIDTH = 340;
/**
 * Assumed card height for placement maths. The card is measured after paint,
 * which is too late to choose a side without a visible jump, so this is a
 * deliberate over-estimate of the tallest step's copy.
 */
const CARD_HEIGHT_ESTIMATE = 230;
/** Padding added around the anchor rect so the spotlight does not clip it. */
const SPOTLIGHT_PADDING = 6;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function inflate(rect: DOMRect): Rect {
  return {
    top: rect.top - SPOTLIGHT_PADDING,
    left: rect.left - SPOTLIGHT_PADDING,
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
  };
}

/**
 * Guided tour overlay.
 *
 * Rendered only while `isTourActive` is true, so leaving the tour - by Escape,
 * by Done, or by the Skip button - unmounts every part of it at once. There is
 * no imperative DOM decoration to clean up and therefore no way to strand a
 * highlight on screen. That property is worth preserving: if a future step ever
 * needs to mark an element, mark it with React state, not `classList.add`.
 *
 * The overlay is modal by design (a tour that let you click through would lose
 * its own anchors mid-step), but it is only ever opened on demand from the Help
 * menu or the welcome bar - never on launch.
 */
const GuidedTour: React.FC = () => {
  const { t } = useI18n();
  const isRtl = useIsRtl();
  const reducedMotion = useReducedMotion();

  const stepIndex = useOnboardingStore((s) => s.tourStepIndex);
  const nextStep = useOnboardingStore((s) => s.nextStep);
  const previousStep = useOnboardingStore((s) => s.previousStep);
  const endTour = useOnboardingStore((s) => s.endTour);

  const step = TOUR_STEPS[Math.min(stepIndex, TOUR_STEPS.length - 1)]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEP_COUNT - 1;

  const [rect, setRect] = useState<Rect | null>(null);

  const cardRef = useFocusTrap<HTMLDivElement>(true);

  // Measure the anchor for this step, and keep the measurement fresh while the
  // window is resized or a pane scrolls underneath.
  useLayoutEffect(() => {
    let frame = 0;

    const measure = () => {
      const el = resolveAnchorElement(step);
      if (!el) {
        setRect(null);
        return;
      }
      const box = el.getBoundingClientRect();
      // A pane that is collapsed to nothing is not worth spotlighting.
      if (box.width < 8 || box.height < 8) {
        setRect(null);
        return;
      }
      setRect(inflate(box));
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [step]);

  // Escape leaves the tour from every step. Captured at the document so it
  // wins over pane-level handlers, and stopped so closing the tour does not
  // also close whatever is behind it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        endTour();
        return;
      }
      // Arrow navigation follows the reading direction, so "forward" is the
      // same physical key a user of that script would expect.
      const forwardKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
      const backwardKey = isRtl ? 'ArrowRight' : 'ArrowLeft';
      if (event.key === forwardKey) {
        event.preventDefault();
        nextStep();
      } else if (event.key === backwardKey) {
        event.preventDefault();
        previousStep();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [endTour, nextStep, previousStep, isRtl]);

  const handleSkip = useCallback(() => endTour(), [endTour]);

  /**
   * Where the explanation card sits.
   *
   * Vertically: below the anchor when there is room, otherwise above it,
   * otherwise centred. Horizontally: the card's *leading* edge lines up with
   * the anchor's leading edge, which `anchorAtPointerX` expresses correctly in
   * both directions (`left` in LTR, `right` in RTL).
   */
  const cardStyle = useMemo<React.CSSProperties>(() => {
    const viewportW = typeof window === 'undefined' ? 1024 : window.innerWidth;
    const viewportH = typeof window === 'undefined' ? 768 : window.innerHeight;

    if (!rect) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${CARD_WIDTH}px`,
      };
    }

    // A whole pane is taller than the space above or below it, so sitting the
    // card just inside its top edge reads as "this region" without covering
    // the app chrome. Small anchors (a search field, a button) get the usual
    // below-then-above treatment.
    const isTallAnchor = rect.height > viewportH * 0.5;
    const spaceBelow = viewportH - (rect.top + rect.height);
    let top: number;
    if (isTallAnchor) {
      top = rect.top + CARD_GAP * 2;
    } else if (spaceBelow > CARD_HEIGHT_ESTIMATE + CARD_GAP) {
      top = rect.top + rect.height + CARD_GAP;
    } else {
      top = rect.top - CARD_GAP - CARD_HEIGHT_ESTIMATE;
    }
    // Never let the card run off the bottom.
    top = Math.min(top, Math.max(VIEWPORT_MARGIN, viewportH - CARD_HEIGHT_ESTIMATE - VIEWPORT_MARGIN));

    // Leading edge of the anchor, in physical viewport coordinates.
    const anchorLeadingX = isRtl ? rect.left + rect.width : rect.left;
    // Clamp so the whole card stays on screen whichever way it grows.
    const minX = isRtl ? CARD_WIDTH + VIEWPORT_MARGIN : VIEWPORT_MARGIN;
    const maxX = isRtl ? viewportW - VIEWPORT_MARGIN : viewportW - CARD_WIDTH - VIEWPORT_MARGIN;
    const clampedX = Math.min(Math.max(anchorLeadingX, minX), Math.max(minX, maxX));

    return {
      top: `${Math.max(VIEWPORT_MARGIN, top)}px`,
      width: `${CARD_WIDTH}px`,
      transition: reducedMotion ? 'none' : 'top 150ms ease',
      ...anchorAtPointerX(clampedX),
    };
  }, [rect, isRtl, reducedMotion]);

  const titleId = 'onboarding-tour-title';
  const bodyId = 'onboarding-tour-body';

  const title = t(`${step.keyStem}.title`);
  const body = t(`${step.keyStem}.body`);
  const progress = t(
    'onboarding.tour.progress',
    { current: stepIndex + 1, total: TOUR_STEP_COUNT, },
  );

  const overlay = (
    <div className="fixed inset-0 z-[1000]" data-testid="guided-tour">
      {/*
        Scrim. When an anchor was found the scrim is drawn as an enormous
        spread-shadow around the anchor rect, which produces the cut-out for
        free; otherwise it is a plain full-screen fill.
      */}
      {rect ? (
        <div
          aria-hidden="true"
          data-testid="guided-tour-spotlight"
          className="absolute rounded-lg border-2 border-accent"
          style={{
            top: `${rect.top}px`,
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            boxShadow: '0 0 0 9999px var(--theme-bg-overlay)',
            pointerEvents: 'none',
            transition: reducedMotion ? 'none' : 'top 150ms ease, left 150ms ease, width 150ms ease, height 150ms ease',
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
        />
      )}

      {/*
        Transparent click shield. Keeps the app underneath inert for the
        duration of the tour without swallowing the card's own events.
      */}
      <div aria-hidden="true" className="absolute inset-0" />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="guided-tour-card"
        className="absolute bg-surface-elevated border border-border rounded-lg shadow-xl p-md text-start"
        style={cardStyle}
      >
        <p className="text-xs text-text-muted mb-xs">{progress}</p>

        <h2 id={titleId} className="text-base font-semibold text-text-heading mb-sm">
          {title}
        </h2>

        <p id={bodyId} className="text-sm text-text-secondary leading-relaxed mb-md">
          {body}
        </p>

        <div className="flex items-center justify-between gap-sm">
          <button
            type="button"
            onClick={handleSkip}
            data-testid="guided-tour-skip"
            className="text-xs text-text-secondary underline hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-xs py-xs"
          >
            {t('onboarding.tour.skip')}
          </button>

          <div className="flex items-center gap-sm">
            {!isFirst && (
              <button
                type="button"
                onClick={previousStep}
                data-testid="guided-tour-back"
                className="px-md py-xs text-sm rounded bg-control text-control-text border border-border hover:bg-control-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t('onboarding.tour.back')}
              </button>
            )}
            <button
              type="button"
              onClick={isLast ? endTour : nextStep}
              data-testid="guided-tour-next"
              className="px-md py-xs text-sm rounded bg-accent text-text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {isLast
                ? t('onboarding.tour.done')
                : t('onboarding.tour.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(overlay, document.body);
};

export default GuidedTour;
