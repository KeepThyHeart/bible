import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, cleanup, fireEvent } from '@testing-library/preact';
import { useUserScrollIntent } from './useUserScrollIntent';

afterEach(cleanup);

function setup(keysFromDocument: boolean) {
  const el = document.createElement('div');
  const inner = document.createElement('button');
  el.appendChild(inner);
  document.body.appendChild(el);
  let clock = 500;
  const { result } = renderHook(() => useUserScrollIntent({ getScrollElement: () => el, keysFromDocument, now: () => clock }));
  return { el, inner, result, tick: (n: number) => { clock += n; } };
}

describe('useUserScrollIntent', () => {
  it('marks wheel and touch inside the scroller, not outside', () => {
    const { el, result } = setup(false);
    expect(result.current.lastAt.current).toBe(-Infinity);
    fireEvent.wheel(document.body);
    expect(result.current.lastAt.current).toBe(-Infinity);
    fireEvent.wheel(el);
    expect(result.current.lastAt.current).toBe(500);
    result.current.clear();
    fireEvent.touchMove(el);
    expect(result.current.lastAt.current).toBe(500);
  });

  it('marks pointerdown only on the scroller itself', () => {
    const { el, inner, result } = setup(false);
    fireEvent.pointerDown(inner);
    expect(result.current.lastAt.current).toBe(-Infinity);
    fireEvent.pointerDown(el);
    expect(result.current.lastAt.current).toBe(500);
  });

  it('counts document keys only when keysFromDocument', () => {
    const a = setup(false);
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(a.result.current.lastAt.current).toBe(-Infinity);
    fireEvent.keyDown(a.inner, { key: 'ArrowDown' });
    expect(a.result.current.lastAt.current).toBe(500);
    cleanup();
    const b = setup(true);
    fireEvent.keyDown(document.body, { key: 'PageDown' });
    expect(b.result.current.lastAt.current).toBe(500);
  });
});
