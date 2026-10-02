import { describe, it, expect, vi } from 'vitest';
import { handleBidiCopy } from './bidiCopy';

function fakeEvent(defaultPrevented = false) {
  const setData = vi.fn();
  const e = { defaultPrevented, preventDefault: vi.fn(), clipboardData: { setData } } as unknown as ClipboardEvent;
  return { e, setData };
}

describe('handleBidiCopy', () => {
  it('strips bidi controls from the copied text', () => {
    const { e, setData } = fakeEvent();
    handleBidiCopy(e, () => 'a⁧b⁩c‏');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(setData).toHaveBeenCalledWith('text/plain', 'abc');
  });

  it('is a no-op for text without bidi controls', () => {
    const { e, setData } = fakeEvent();
    handleBidiCopy(e, () => 'plain text');
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it('skips when an app handler already handled the copy', () => {
    const { e, setData } = fakeEvent(true);
    handleBidiCopy(e, () => 'a⁧b');
    expect(setData).not.toHaveBeenCalled();
  });
});
