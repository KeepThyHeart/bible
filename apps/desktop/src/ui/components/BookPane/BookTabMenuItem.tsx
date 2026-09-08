import React from 'react';

/** Simple context menu item for internal book/dictionary tab context menu */
export const BookTabMenuItem: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    type="button"
    role="menuitem"
    tabIndex={0}
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      padding: '6px 12px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: '13px',
      color: 'var(--theme-text-primary)',
      textAlign: 'start',
    }}
    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)'; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
  >
    {label}
  </button>
);
