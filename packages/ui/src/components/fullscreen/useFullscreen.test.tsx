import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { FULLSCREEN_CLASS, useFullscreen } from './useFullscreen';
import { FullscreenButton } from './FullscreenButton';

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true });
}

function withEl(el: HTMLElement | null, options?: Parameters<typeof useFullscreen>[1]) {
  return renderHook(() => useFullscreen({ current: el }, options));
}

describe('useFullscreen', () => {
  afterEach(() => {
    setFullscreenElement(null);
    document.documentElement.style.overflow = '';
  });

  it('toggles the full state and asks the element for the real Fullscreen API when it can', async () => {
    const el = document.createElement('div');
    const request = vi.fn(async () => undefined);
    (el as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = request;
    const { result } = withEl(el, { native: true });
    expect(result.current.full).toBe(false);
    await act(async () => { result.current.toggle(); });
    expect(result.current.full).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.toggle(); });
    expect(result.current.full).toBe(false);
  });

  it('works as a full-window state when the Fullscreen API is missing, refused or switched off', async () => {
    const plain = withEl(document.createElement('div'), { native: true });
    act(() => plain.result.current.toggle());
    expect(plain.result.current.full).toBe(true);

    const refusing = document.createElement('div');
    (refusing as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = () => Promise.reject(new Error('no'));
    const r = withEl(refusing, { native: true });
    await act(async () => { r.result.current.toggle(); });
    expect(r.result.current.full).toBe(true);

    const off = document.createElement('div');
    const request = vi.fn(async () => undefined);
    (off as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = request;
    const o = withEl(off, { native: false });
    await act(async () => { o.result.current.toggle(); });
    expect(o.result.current.full).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('leaves the full state when the browser leaves its fullscreen', async () => {
    const el = document.createElement('div');
    (el as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = async () => undefined;
    const { result } = withEl(el, { native: true });
    await act(async () => { result.current.toggle(); });
    setFullscreenElement(el);
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(result.current.full).toBe(true);
    setFullscreenElement(null);
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(result.current.full).toBe(false);
  });

  it('exits the real fullscreen it owns when toggled off', async () => {
    const el = document.createElement('div');
    (el as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = async () => undefined;
    const exitFullscreen = vi.fn(async () => undefined);
    (document as unknown as { exitFullscreen: () => Promise<void> }).exitFullscreen = exitFullscreen;
    const { result } = withEl(el, { native: true });
    await act(async () => { result.current.toggle(); });
    setFullscreenElement(el);
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    await act(async () => { result.current.toggle(); });
    expect(exitFullscreen).toHaveBeenCalled();
    expect(result.current.full).toBe(false);
  });

  it('Escape leaves, unless already handled or switched off', () => {
    const el = document.createElement('div');
    const a = withEl(el, { native: false });
    act(() => a.result.current.enter());
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    handled.preventDefault();
    act(() => { document.dispatchEvent(handled); });
    expect(a.result.current.full).toBe(true);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })); });
    expect(a.result.current.full).toBe(false);

    const b = withEl(el, { native: false, escape: false });
    act(() => b.result.current.enter());
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })); });
    expect(b.result.current.full).toBe(true);
  });

  it('locks page scroll while full and restores it', () => {
    const { result } = withEl(document.createElement('div'), { native: false });
    act(() => result.current.enter());
    expect(document.documentElement.style.overflow).toBe('hidden');
    act(() => result.current.exit());
    expect(document.documentElement.style.overflow).toBe('');
  });
});

function Host({ escape }: { escape?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const fs = useFullscreen(ref, { native: false, escape });
  return (
    <div>
      <div ref={ref} data-testid="host" className={fs.full ? FULLSCREEN_CLASS : undefined}>
        <FullscreenButton full={fs.full} onToggle={fs.toggle} />
        <button type="button">inner</button>
      </div>
      <button type="button">outside</button>
    </div>
  );
}

describe('FullscreenButton + useFullscreen in a host', () => {
  it('swaps label and tooltip, marks the host, keeps Tab inside and restores focus on Escape', async () => {
    render(<Host />);
    const host = screen.getByTestId('host');
    const btn = screen.getByRole('button', { name: 'Full screen' });
    expect(btn).toHaveAttribute('title', 'Full screen');
    await userEvent.click(btn);
    expect(host).toHaveClass(FULLSCREEN_CLASS);
    const exit = screen.getByRole('button', { name: 'Exit full screen' });
    expect(exit).toHaveAttribute('title', 'Exit full screen');
    const inner = screen.getByRole('button', { name: 'inner' });
    inner.focus();
    await userEvent.tab();
    expect(exit).toHaveFocus(); // wrapped past the last control instead of reaching "outside"
    await userEvent.tab({ shift: true });
    expect(inner).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(host).not.toHaveClass(FULLSCREEN_CLASS);
    expect(screen.getByRole('button', { name: 'Full screen' })).toHaveFocus();
  });

  it('takes custom labels', () => {
    render(<FullscreenButton full={false} onToggle={() => {}} labels={{ enter: 'Plein écran' }} />);
    expect(screen.getByRole('button', { name: 'Plein écran' })).toBeInTheDocument();
  });
});
