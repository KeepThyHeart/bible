import type { PanelContentType } from '../useLayoutStore';

/**
 * The dockview content types that a `BookPane` can be registered under.
 *
 * Two first-class content types, one component. `'dictionary'` is not an alias
 * for `'book'`: each has its own entry point, its own pane slot (Dictionary is
 * in the default layout and in Study Mode's column) and its own store. What
 * they share is `BookPane`, which renders either kind and opens
 * on whichever half its content type names. So anything resolving "the panel
 * that holds book and dictionary tabs" - session save (`sessionPanelState`) and
 * session restore (`panelIdFromLayout` in AppInitService) alike - has to accept
 * either.
 */
export const BOOK_DICT_PANEL_TYPES: readonly PanelContentType[] = ['book', 'dictionary'];
