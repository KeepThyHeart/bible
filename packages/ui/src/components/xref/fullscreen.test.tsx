import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useXrefFullscreen } from './fullscreen';

describe('useXrefFullscreen', () => {
  afterEach(() => {
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('toggles the full state and asks the element for native fullscreen when it can', async () => {
    const el = document.createElement('div');
    const request = vi.fn(async () => undefined);
    (el as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = request;
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(el);
      return useXrefFullscreen(ref);
    });
    expect(result.current.full).toBe(false);
    await act(async () => { result.current.toggle(); });
    expect(result.current.full).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.toggle(); });
    expect(result.current.full).toBe(false);
  });

  it('still works as a full-window state when the Fullscreen API is missing', () => {
    const { result } = renderHook(() => useXrefFullscreen({ current: document.createElement('div') }));
    act(() => result.current.toggle());
    expect(result.current.full).toBe(true);
  });

  it('leaves the full state when the browser leaves native fullscreen', async () => {
    const el = document.createElement('div');
    (el as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = async () => undefined;
    const { result } = renderHook(() => useXrefFullscreen({ current: el }));
    await act(async () => { result.current.toggle(); });
    Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(result.current.full).toBe(true);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(result.current.full).toBe(false);
  });
});
