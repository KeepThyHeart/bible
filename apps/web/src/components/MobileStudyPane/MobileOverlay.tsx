import { useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useModalFocus } from '../../hooks/useModalFocus';

interface MobileOverlayProps {
  /** Id of the element inside `title` that names the dialog. */
  titleId: string;
  title: ComponentChildren;
  /** Small label above the title (e.g. "Study"); not part of the dialog's accessible name. */
  paneLabel?: ComponentChildren;
  closeLabel: string;
  onClose: () => void;
  className?: string;
  children: ComponentChildren;
}

/**
 * A full-screen overlay of the mobile Study pane (Topics browser, Dictionary) as a real modal dialog:
 * named, the page behind inert, Tab kept inside, Escape closes, focus returns to the opener.
 * Mounted only while open.
 */
export function MobileOverlay({ titleId, title, paneLabel, closeLabel, onClose, className, children }: MobileOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, ref);
  return (
    <div
      ref={ref}
      class={`mobile-topics-overlay${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      }}
    >
      <div class="mobile-topics-overlay__header">
        <button type="button" class="mobile-topics-overlay__close" aria-label={closeLabel} onClick={onClose}>
          <i class="fa-solid fa-xmark" aria-hidden="true" />
        </button>
        <span class="mobile-topics-overlay__title">
          {paneLabel != null && <><span class="mobile-topics-overlay__pane-label">{paneLabel}</span>{' '}</>}
          <span id={titleId}>{title}</span>
        </span>
      </div>
      <div class="mobile-topics-overlay__body">{children}</div>
    </div>
  );
}
