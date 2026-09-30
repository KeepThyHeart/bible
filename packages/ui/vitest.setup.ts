import '@testing-library/jest-dom/vitest';

// jsdom has no canvas: return null (views guard for it) instead of logging "Not implemented" on every render.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
