import React from 'react';
import type { CommandQueryResult } from '../types/Command';

interface TopSearchBarCommandResultProps {
  command: CommandQueryResult;
  isSelected: boolean;
  onClick: () => void;
}

/**
 * Renders a single command result row inside the TopSearchBar dropdown.
 * Shows the command title, optional category, and keyboard shortcut.
 */
const TopSearchBarCommandResult: React.FC<TopSearchBarCommandResultProps> = ({
  command,
  isSelected,
  onClick,
}) => {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`w-full px-3 py-2 text-start transition-colors cursor-pointer ${
        isSelected ? 'bg-accent-soft' : 'hover:bg-accent-light'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          {/* Icon */}
          {command.icon && (
            <span className="text-text-secondary text-sm flex-shrink-0">{command.icon}</span>
          )}
          {/* Title */}
          <span className="text-sm font-medium text-text-heading truncate">
            {command.category ? `${command.category}: ${command.title}` : command.title}
          </span>
        </div>
        {/* Shortcut badge */}
        {command.shortcut && (
          <kbd className="ms-2 bidi-isolate flex-shrink-0 px-1.5 py-0.5 bg-background-tertiary border border-border-secondary rounded text-xs font-mono text-text-secondary">
            {command.shortcut}
          </kbd>
        )}
      </div>
    </button>
  );
};

export default TopSearchBarCommandResult;
