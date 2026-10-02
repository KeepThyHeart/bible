import '@testing-library/jest-dom/vitest';

// jsdom has no canvas: return null (views guard for it) instead of logging "Not implemented" on every render.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// Reference-engine locale data loads on demand (task 0077); the apps load the
// UI language at startup. Load the ones the shared components' tests use.
import { loadReferenceLocales } from '@bible/core/browser';
await loadReferenceLocales(['es', 'zh-Hans']);
