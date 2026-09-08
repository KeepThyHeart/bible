import React from 'react';
import { useToastStore } from '../stores/useToastStore';
import { useI18n } from '../contexts/useI18n';

const ToastContainer: React.FC = () => {
  const { t } = useI18n();
  const { toasts, removeToast } = useToastStore();
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 end-4 z-[9999] flex flex-col gap-2 max-w-sm"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === 'error' ? 'alert' : 'status'}
          aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
          className="rounded-lg shadow-lg px-4 py-3 flex items-start gap-2 text-sm animate-in slide-in-from-right"
          style={{
            backgroundColor: toast.type === 'error' ? 'var(--theme-bg-error, #fef2f2)' :
                           toast.type === 'warning' ? 'var(--theme-bg-warning, #fffbeb)' :
                           'var(--theme-bg-tertiary)',
            color: toast.type === 'error' ? 'var(--theme-text-error, #dc2626)' :
                   toast.type === 'warning' ? 'var(--theme-text-warning, #d97706)' :
                   'var(--theme-text-primary)',
            border: '1px solid currentColor',
            opacity: 0.95,
          }}
        >
          <span className="flex-1">{toast.message}</span>
          <button
            className="ms-2 opacity-60 hover:opacity-100"
            onClick={() => removeToast(toast.id)}
            aria-label={t('toastContainer.dismiss')}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastContainer;
