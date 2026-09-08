import React from 'react';

export interface LinkButtonProps {
  label: string;
  onClick: () => void;
  isOpen?: boolean;
  count?: number;
  className?: string;
  title?: string;
}

/**
 * One entry in a Study-mode verse-links row (a commentary, a book, a note).
 *
 * Rendered as an inline text link rather than a bordered chip. A verse in a
 * study Bible can carry eighteen commentaries; as `px-2 py-1` bordered buttons
 * that row wrapped to four lines and pushed the next verse off the screen,
 * which is what the "make these links, not buttons" feedback was about. Link
 * styling costs a fraction of the vertical space and reads as what it is - a
 * jump to a resource, not a command.
 *
 * It stays a real `<button>`: these activate an in-app navigation, not a URL,
 * so `<a href>` would be a lie to assistive tech and to middle-click. Keyboard
 * focus, Enter/Space and the accessible name all come free from the element.
 */
const LinkButton: React.FC<LinkButtonProps> = ({
  label,
  onClick,
  isOpen = false,
  count,
  className = '',
  title
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline text-start underline-offset-2
        hover:underline focus-visible:underline
        ${isOpen ? 'font-semibold text-accent-strong' : 'text-accent hover:text-accent-strong'}
        ${className}
      `}
      title={title ?? (isOpen ? `${label} (currently open)` : label)}
    >
      <span>{label}</span>
      {count !== undefined && count > 1 && (
        <span className="ms-0.5 text-xs text-text-secondary">({count})</span>
      )}
    </button>
  );
};

export default LinkButton;
