import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../contexts/useI18n';

export interface PaneMenuOption {
  id: string;
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
}

interface PaneOptionsMenuProps {
  options: PaneMenuOption[];
  buttonClassName?: string;
  /** Use light (white) text for dark backgrounds */
  lightText?: boolean;
}

/**
 * Reusable ellipsis dropdown menu for pane options
 * Used for Pop Out and other pane-specific settings
 */
const PaneOptionsMenu: React.FC<PaneOptionsMenuProps> = ({
  options,
  buttonClassName = '',
  lightText = false
}) => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Escape closes the menu, matching every other popup in the app.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen]);

  const handleOptionClick = (option: PaneMenuOption) => {
    if (!option.disabled) {
      option.onClick();
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Ellipsis button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
          lightText
            ? 'text-white/80 hover:text-white hover:bg-white/20'
            : 'text-text-secondary hover:bg-background-hover'
        } ${buttonClassName}`}
        title={t('ui.paneOptions.menu')}
        aria-label={t('ui.paneOptions.menu')}
        aria-expanded={isOpen}
      >
        ⋮
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute end-0 top-full mt-1 bg-surface-elevated border border-border rounded-md shadow-lg z-50 min-w-[160px]"
          role="menu"
        >
          {options.map((option) => (
            <button
              key={option.id}
              onClick={() => handleOptionClick(option)}
              disabled={option.disabled}
              className={`w-full px-3 py-2 text-start text-sm flex items-center gap-2 transition-colors ${
                option.disabled
                  ? 'text-text-muted cursor-not-allowed'
                  : 'text-text-primary hover:bg-background-hover cursor-pointer'
              }`}
              role="menuitem"
            >
              {option.icon && <span className="text-base">{option.icon}</span>}
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PaneOptionsMenu;
