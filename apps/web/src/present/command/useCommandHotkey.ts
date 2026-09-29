import { useEffect } from 'preact/hooks';
import { focusCommandBox } from './CommandBox';

/**
 * Opt-in global hotkey for the command box: `/` (when not typing) and
 * Ctrl/Cmd+K (anywhere, including inside the notes editor) focus it.
 * `onFocusRequest`, when given, runs first and may return true to say the host
 * handled it itself (e.g. by mounting the solo overlay, which then focuses).
 */
export function useCommandHotkey(options: { enabled?: boolean; onFocusRequest?: () => boolean | void } = {}): void {
  const { enabled = true, onFocusRequest } = options;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
      if (!ctrlK && !slash) return;
      e.preventDefault();
      if (onFocusRequest?.() === true) return;
      focusCommandBox();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onFocusRequest]);
}
