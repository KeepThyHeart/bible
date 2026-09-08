import { afterEach, vi } from 'vitest';

/**
 * The suite defaults to jsdom, but a few files opt into the `node` environment
 * with a `@vitest-environment node` pragma - `extension-runtime`'s realm tests
 * do, because esbuild refuses to run under jsdom (its `TextEncoder` produces a
 * cross-realm `Uint8Array` and esbuild asserts against exactly that).
 *
 * setupFiles run for every environment, so everything DOM-shaped below is
 * guarded. Under jsdom nothing changes; under node the DOM setup is skipped
 * instead of throwing `Element is not defined` before a single test collects.
 */
const hasDom = typeof globalThis.window !== 'undefined';

if (hasDom) {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');

  // Automatic cleanup after each test
  afterEach(() => {
    cleanup();
  });

  // Mock scrollIntoView for jsdom
  Element.prototype.scrollIntoView = vi.fn();

  // jsdom implements Element.prototype.getClientRects but not Range's.
  // ProseMirror's "scroll the selection into view" walks up from the caret and
  // calls `singleRect(textRange(...))` (prosemirror-view's `coordsAtPos`),
  // which throws `target.getClientRects is not a function` on a Range. The
  // throw happens off the call stack, so it surfaces as an unhandled error
  // that fails no test but is reported alongside the run - any test that
  // renders a real TipTap editor and moves the caret hits it.
  //
  // Returning empty rects is the honest answer: jsdom has no layout, so there
  // are no rectangles. ProseMirror already falls back to
  // `getBoundingClientRect()` when the list is empty.
  if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function getClientRects() {
      const list = [] as unknown as DOMRectList;
      return list;
    };
    Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return new DOMRect(0, 0, 0, 0);
    };
  }

  // Stub window.electron for component tests that reference it
  Object.defineProperty(window, 'electron', {
    value: {
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      diagnostics: {
        reportRendererError: vi.fn(),
      },
      window: {
        detachPane: vi.fn(),
      },
    },
    writable: true,
  });
}
