import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { settingsStore, DEFAULT_SETTINGS } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';

/**
 * The "Aa" text-size button of a reading pane, and the popover it opens.
 *
 * One control, "Text size", with − and + around a step number (1–12, default
 * 5, as e-book readers number their sizes). It scales all text together —
 * Bible, commentary and the other panes, and the interface; see
 * `TEXT_SIZE_STEPS`. Exact sizes per area live in Settings, one link away; a
 * reader adjusting text should not first have to learn which kind is which.
 *
 * The popover holds still while the text behind it changes:
 *   - it is placed with `position: fixed` from the button's position at the
 *     moment it opens, not anchored to the button, which moves as the toolbar
 *     around it grows;
 *   - its own text has a fixed size (rem, not the app's text-size variables),
 *     so A+ stays under the pointer for the next click.
 */

interface TextSizeButtonProps {
  /** Which pane it sits in; only used for test ids. */
  target: 'bible' | 'study';
  /** Opens Settings at the full text options. */
  onMoreOptions?: () => void;
  /** Class for the button, so it matches the toolbar it sits in. */
  className?: string;
}

const VIEWPORT_MARGIN_PX = 8;

export function TextSizeButton({ target, onMoreOptions, className = '' }: TextSizeButtonProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = anchor !== null;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fontSize = useStore(settingsStore, () => settingsStore.fontSize);
  const studyFontSize = useStore(settingsStore, () => settingsStore.studyFontSize);
  const uiFontSize = useStore(settingsStore, () => settingsStore.uiFontSize);

  const step = useStore(settingsStore, () => settingsStore.getTextSizeStep());
  const atDefaults = fontSize === DEFAULT_SETTINGS.fontSize
    && studyFontSize === DEFAULT_SETTINGS.studyFontSize
    && uiFontSize === DEFAULT_SETTINGS.uiFontSize;

  const close = (refocus: boolean) => {
    setAnchor(null);
    setPos(null);
    if (refocus) buttonRef.current?.focus();
  };

  // Place once per opening: under the button, end-aligned, kept on screen.
  useLayoutEffect(() => {
    if (!anchor || !popoverRef.current) return;
    const width = popoverRef.current.offsetWidth;
    const rtl = getComputedStyle(buttonRef.current ?? document.body).direction === 'rtl';
    const preferred = rtl ? anchor.left : anchor.right - width;
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(preferred, window.innerWidth - width - VIEWPORT_MARGIN_PX));
    setPos({ top: anchor.bottom + 4, left });
  }, [anchor]);

  // Close on Escape (focus back to the button), a press outside, or a resize.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close(true);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close(false);
    };
    const onResize = () => close(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onResize);
    // Move focus into the popover so a keyboard user lands on the controls.
    popoverRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const reset = () => {
    settingsStore.setFontSize(DEFAULT_SETTINGS.fontSize);
    settingsStore.setStudyFontSize(DEFAULT_SETTINGS.studyFontSize);
    settingsStore.setUiFontSize(DEFAULT_SETTINGS.uiFontSize);
  };

  const title = t('settings.textSize.popoverTitle');

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class={`text-size__button ${className}`}
        onClick={() => (open ? close(false) : setAnchor(buttonRef.current!.getBoundingClientRect()))}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={`text-size-btn-${target}`}
      >
        <span class="text-size__glyph" aria-hidden="true">Aa</span>
      </button>
      {open && (
        <div
          ref={popoverRef}
          class="text-size__popover"
          role="dialog"
          aria-label={title}
          data-testid={`text-size-popover-${target}`}
          // Hidden for the one layout pass before its position is known.
          style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : { visibility: 'hidden' }}
        >
          <div class="text-size__row">
            <span class="text-size__label">{title}</span>
            <div class="text-size__stepper">
              <button
                type="button"
                class="text-size__step"
                onClick={() => settingsStore.stepTextSize(-1)}
                disabled={!settingsStore.canStepTextSize(-1)}
                aria-label={t('settings.textSize.decreaseAll')}
                title={t('settings.textSize.decreaseAll')}
              >
                <i class="fa-solid fa-minus" aria-hidden="true" />
              </button>
              <span class="text-size__value" aria-live="polite" data-testid="text-size-value">{step}</span>
              <button
                type="button"
                class="text-size__step"
                onClick={() => settingsStore.stepTextSize(1)}
                disabled={!settingsStore.canStepTextSize(1)}
                aria-label={t('settings.textSize.increaseAll')}
                title={t('settings.textSize.increaseAll')}
              >
                <i class="fa-solid fa-plus" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div class="text-size__footer">
            <button type="button" class="text-size__link" onClick={reset} disabled={atDefaults}>
              {t('settings.textSize.popoverReset')}
            </button>
            {onMoreOptions && (
              <button
                type="button"
                class="text-size__link"
                onClick={() => { close(false); onMoreOptions(); }}
              >
                {t('settings.textSize.moreOptions')}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
