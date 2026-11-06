import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { focusAfterSearch } from './TopSearchBar';

describe('focusAfterSearch with a verse target', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    document.body.innerHTML = `
      <div data-panel-id="p1" data-tour-pane="bible">
        <h2 id="heading" tabindex="-1" data-pane-focus>John 3</h2>
        <div id="v16" data-verse-id="43003016"></div>
      </div>`;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('focuses the verse row with preventScroll, not the chapter heading', () => {
    const row = document.getElementById('v16')!;
    const spy = vi.spyOn(row, 'focus');
    focusAfterSearch('bible', 43003016);
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(row);
    expect(document.activeElement).not.toBe(document.getElementById('heading'));
  });

  it('falls back to the pane focus target without a verse', () => {
    focusAfterSearch('bible');
    expect(document.activeElement).toBe(document.getElementById('heading'));
  });
});
