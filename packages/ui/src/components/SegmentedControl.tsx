import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { documentDir } from './popupUtils';

export interface SegmentedOption {
  id: string;
  label: ReactNode;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  /** Id of the chosen option. */
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the group (e.g. "View"). */
  label: string;
  className?: string;
  dir?: 'ltr' | 'rtl';
}

/**
 * A small single-choice switch (List / Week / Month), the `.kth-segmented` look. A radio group: one tab stop,
 * arrows move and choose (mirrored in RTL), Home/End go to the first/last option.
 */
export function SegmentedControl(props: SegmentedControlProps) {
  const { options, value, onChange, label, className, dir } = props;
  const groupRef = useRef<HTMLDivElement>(null);

  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    const current = Math.max(0, options.findIndex((o) => o.id === value));
    const rtl = (dir ?? documentDir()) === 'rtl';
    let next: number;
    if (e.key === 'ArrowRight') next = rtl ? current - 1 : current + 1;
    else if (e.key === 'ArrowLeft') next = rtl ? current + 1 : current - 1;
    else if (e.key === 'ArrowDown') next = current + 1;
    else if (e.key === 'ArrowUp') next = current - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    select((next + options.length) % options.length);
  };

  const hasSelected = options.some((o) => o.id === value);
  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={className ? `kth-segmented ${className}` : 'kth-segmented'}
      dir={dir}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const checked = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (!hasSelected && i === 0) ? 0 : -1}
            className="kth-segmented__option"
            data-id={o.id}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
