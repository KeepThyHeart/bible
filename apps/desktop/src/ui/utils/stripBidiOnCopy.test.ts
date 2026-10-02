import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleCopyStripBidi } from './stripBidiOnCopy';

const FSI = '⁨';
const PDI = '⁩';

function fakeEvent(defaultPrevented = false) {
  const setData = vi.fn();
  const preventDefault = vi.fn();
  return { e: { defaultPrevented, clipboardData: { setData }, preventDefault } as unknown as ClipboardEvent, setData, preventDefault };
}

function select(text: string) {
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => text } as unknown as Selection);
}

afterEach(() => vi.restoreAllMocks());

describe('handleCopyStripBidi', () => {
  it('writes stripped plain text when the selection holds bidi controls', () => {
    select(`John ${FSI}3:16${PDI}`);
    const { e, setData, preventDefault } = fakeEvent();
    handleCopyStripBidi(e);
    expect(preventDefault).toHaveBeenCalled();
    expect(setData).toHaveBeenCalledWith('text/plain', 'John 3:16');
  });

  it('does nothing for ordinary text', () => {
    select('John 3:16');
    const { e, setData, preventDefault } = fakeEvent();
    handleCopyStripBidi(e);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });

  it('does not override a handler that already took over', () => {
    select(`${FSI}x${PDI}`);
    const { e, setData } = fakeEvent(true);
    handleCopyStripBidi(e);
    expect(setData).not.toHaveBeenCalled();
  });
});
