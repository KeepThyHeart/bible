import { useEffect, useId } from 'react';
import { useHoverIntent, type UseHoverIntentOptions, type UseHoverIntentResult } from './useHoverIntent';
import { useAmbientPopupStore } from '../stores/useAmbientPopupStore';

/**
 * `useHoverIntent` wired into the shared ambient-popup coordinator (task
 * 0036, P0.1c; design amendment A6): claims the ambient-popup slot when the
 * popup shows, releases it when it hides, and hides itself the moment
 * another ambient popup claims the slot instead - "the extension hover
 * popup, the Strong's tooltip, the note-indicator hover preview and
 * `ExtensionVersePopup` claim it on open, and close when another owner
 * claims it."
 *
 * Drop-in replacement for `useHoverIntent` at every existing ambient-popup
 * call site (`InterlinearDisplay`'s Strong's tooltip, `useNoteTooltip`) -
 * same options, same return shape, with the coordination added rather than
 * each call site reimplementing "check if I still own the popup".
 */
export function useAmbientHoverIntent<T>(options: UseHoverIntentOptions<T>): UseHoverIntentResult<T> {
  const ownerId = useId();

  const intent = useHoverIntent<T>({
    ...options,
    onShow: (value) => {
      useAmbientPopupStore.getState().claim(ownerId);
      options.onShow(value);
    },
    onHide: () => {
      useAmbientPopupStore.getState().release(ownerId);
      options.onHide();
    },
  });

  useEffect(() => {
    return useAmbientPopupStore.subscribe((s) => {
      if (s.owner !== ownerId) intent.hideNow();
    });
    // `intent.hideNow` is stable (useHoverIntent memoizes it on `onHide`,
    // which the identity-check above already guards against churn from).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  return intent;
}
