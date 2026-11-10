/**
 * True in a popped-out window (`detached.html`), false in the main window. A detached window has no
 * dockview and no Bible pane of its own, so anything that would open a Bible panel there has to ask
 * the main window instead (`window.electron.window.navigateMainToVerse`).
 */
export function isDetachedWindow(): boolean {
  return typeof window !== 'undefined' && /detached\.html$/.test(window.location?.pathname ?? '');
}
