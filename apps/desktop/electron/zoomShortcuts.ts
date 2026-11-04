/**
 * Zoom-in aliases (B-045). The View menu's accelerator is the unshifted
 * Ctrl+= (the key most keyboards have for "zoom in"). Ctrl+Shift+= produces
 * key "+" and does not match that accelerator, so it is handled here. "=" is
 * deliberately not matched: the menu already handles it and handling it twice
 * would zoom two steps.
 */
export interface ZoomKeyInput {
  type: string;
  key: string;
  control?: boolean;
  meta?: boolean;
}

export function isZoomInAlias(input: ZoomKeyInput): boolean {
  return (!!input.control || !!input.meta) && input.key === '+' && input.type === 'keyDown';
}
