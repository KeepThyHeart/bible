import type { ReactNode } from 'react';

export interface NoticeProps {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons. */
  actions?: ReactNode;
  /** Default 'note' ('alert' for tone 'error'). */
  role?: 'status' | 'alert' | 'note';
  className?: string;
}

const TONE_CLASS = {
  info: 'kth-notice kth-notice--info',
  warning: 'kth-notice kth-notice--warning',
  error: 'kth-notice kth-notice--error',
  success: 'kth-notice kth-notice--success',
} as const;

/** An inline message strip (the non-modal "message box"). */
export function Notice(props: NoticeProps) {
  const { tone = 'info', title, children, actions, role, className } = props;
  const base = TONE_CLASS[tone] ?? TONE_CLASS.info;
  return (
    <div className={className ? `${base} ${className}` : base} role={role ?? (tone === 'error' ? 'alert' : 'note')}>
      <div className="kth-notice__body">
        {title ? <strong className="kth-notice__title">{title}</strong> : null}
        {children ? <div className="kth-notice__text">{children}</div> : null}
      </div>
      {actions ? <div className="kth-notice__actions">{actions}</div> : null}
    </div>
  );
}
