import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info';
  duration?: number;
  /** One optional button; pressing it runs and dismisses the toast. */
  action?: { label: string; run(): void };
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type?: Toast['type'], duration?: number, action?: Toast['action']) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (message, type = 'error', duration, action) => {
    duration ??= action ? 8000 : 5000;
    const id = String(++nextId);
    set((state) => ({ toasts: [...state.toasts, { id, message, type, duration, ...(action ? { action } : {}) }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) }));
      }, duration);
    }
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),
}));
