import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { ViewerApp } from './ViewerApp';
import type { PresentState } from './protocol';

const stateWith = (blanked: boolean): PresentState => ({
  display: { theme: 'light', fontStep: 5, blanked },
  live: { kind: 'quote', text: 'The Lord is my shepherd' },
  position: { index: 0, highlights: [] },
  session: { joinsLocked: false },
  viewers: 1,
} as unknown as PresentState);

// 0209 R2 W7 item 5: while the controller blanks the screen, the viewer must not leave the passage in the accessibility tree.
describe('ViewerApp blanked', () => {
  it('hides the content from assistive technology and says the screen is blank', () => {
    const { container } = render(<ViewerApp localState={stateWith(true)} />);
    const safe = container.querySelector('.pv-safe')!;
    expect(safe.getAttribute('aria-hidden')).toBe('true');
    expect((safe as HTMLElement).inert).toBe(true);
    expect(container.querySelector('[role="status"]')!.textContent).toBe('Screen is blank');
  });

  it('exposes the content again when unblanked', () => {
    const { container } = render(<ViewerApp localState={stateWith(false)} />);
    const safe = container.querySelector('.pv-safe')!;
    expect(safe.hasAttribute('aria-hidden')).toBe(false);
    expect((safe as HTMLElement).inert).toBeFalsy();
    expect(container.querySelector('[role="status"]')!.textContent).toBe('');
  });
});
