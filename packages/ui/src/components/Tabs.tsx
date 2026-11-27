import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { documentDir } from './popupUtils';

export interface TabItem {
  id: string;
  label: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab and panel ids. Default 'kth'. */
  idPrefix?: string;
  className?: string;
  dir?: 'ltr' | 'rtl';
}

/** Props for the consumer's panel: `<div {...tabPanelProps('plans', id)}>`. */
export function tabPanelProps(idPrefix: string, id: string): { role: 'tabpanel'; id: string; 'aria-labelledby': string } {
  return { role: 'tabpanel', id: `${idPrefix}-panel-${id}`, 'aria-labelledby': `${idPrefix}-tab-${id}` };
}

/** A tab list (the `.kth-tabs` look): roving tabindex, arrows (mirrored in RTL), Home/End, selection follows focus. */
export function Tabs(props: TabsProps) {
  const { tabs, value, onChange, label, idPrefix = 'kth', className, dir } = props;
  const listRef = useRef<HTMLDivElement>(null);

  const select = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    onChange(tab.id);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (tabs.length === 0) return;
    const current = Math.max(0, tabs.findIndex((t) => t.id === value));
    const rtl = (dir ?? documentDir()) === 'rtl';
    let next = -1;
    if (e.key === 'ArrowRight') next = rtl ? current - 1 : current + 1;
    else if (e.key === 'ArrowLeft') next = rtl ? current + 1 : current - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    select((next + tabs.length) % tabs.length);
  };

  const hasSelected = tabs.some((t) => t.id === value);
  return (
    <div ref={listRef} role="tablist" aria-label={label} className={className ? `kth-tabs ${className}` : 'kth-tabs'} dir={dir} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={selected || (!hasSelected && i === 0) ? 0 : -1}
            className="kth-tabs__tab"
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
