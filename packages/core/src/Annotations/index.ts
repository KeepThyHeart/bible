/**
 * Framework-free annotation logic shared by every surface that paints verse
 * text: user highlights/underlines, extension decorations, find-in-page marks
 * and the DOM-selection-to-word-range mapping that creates new annotations.
 *
 * Nothing here imports React, a store, IPC or a platform API. Inputs
 * (highlights, find state, decorations) come in as plain arguments; the apps
 * own the framework glue (Zustand hooks, components) and call in.
 *
 * - `WordRendering`: `wordRenderAttrs`, `renderVerseWords` and helpers.
 * - `DecorationResolver`: extension decoration targets -> per-word paint.
 * - `ThemeColorResolver`: theme colour key -> `var(--theme-*-rgb)`.
 * - `VerseWordTextCache`: rendered word text per verse, for `occurrence` targets.
 * - `CapturedSelection`: DOM selection -> verse/word indices, and its snapshot.
 */
export * from './WordRendering';
export * from './DecorationResolver';
export * from './ThemeColorResolver';
export * from './VerseWordTextCache';
export * from './CapturedSelection';
