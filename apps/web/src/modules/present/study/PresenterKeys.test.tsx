// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/preact';

const hook = vi.hoisted(() => vi.fn());
vi.mock('./usePresenterShortcuts', () => ({ usePresenterShortcuts: hook }));
import { PresenterKeys } from './PresenterKeys';

describe('PresenterKeys', () => {
  it('installs the clicker-key hook and renders nothing', () => {
    const { container } = render(<PresenterKeys />);
    expect(hook).toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });
});
