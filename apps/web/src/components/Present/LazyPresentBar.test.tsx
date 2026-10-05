// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/preact';

const fake = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../../stores/presentStore', async () => {
  const { Store: S } = await import('../../stores/Store');
  class Fake extends S { get session() { return fake.session; } poke() { this.notify(); } }
  return { presentStore: new Fake() };
});
const barLoaded = vi.fn();
vi.mock('./PresentBar', () => { barLoaded(); return { PresentBar: () => <div data-testid="bar" /> }; });

import { presentStore } from '../../stores/presentStore';
import { LazyPresentBar } from './LazyPresentBar';

describe('LazyPresentBar', () => {
  it('renders nothing and does not load the bar until a session is live', async () => {
    const { queryByTestId } = render(<LazyPresentBar />);
    expect(queryByTestId('bar')).toBeNull();
    expect(barLoaded).not.toHaveBeenCalled();
    fake.session = { joinCode: 'X' };
    (presentStore as unknown as { poke(): void }).poke();
    await waitFor(() => expect(queryByTestId('bar')).not.toBeNull());
  });
});
