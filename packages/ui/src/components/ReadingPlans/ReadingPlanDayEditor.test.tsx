import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadingPlans } from '@bible/core/browser';
import { ReadingPlanDayEditor } from './ReadingPlanDayEditor';

type Day = ReadingPlans.PlanDay;
const john3: Day = { readings: [{ start: 43_003_001, end: 43_003_036 }] };

function Harness({ initial, spy }: { initial: Day[]; spy: (d: Day[]) => void }) {
  const [days, setDays] = useState(initial);
  return <ReadingPlanDayEditor days={days} onChange={(d) => { spy(d); setDays(d); }} />;
}
function setup(initial: Day[]) {
  const spy = vi.fn();
  render(<Harness initial={initial} spy={spy} />);
  return { spy, user: userEvent.setup() };
}
const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[spy.mock.calls.length - 1][0] as Day[];

describe('ReadingPlanDayEditor', () => {
  it('shows the empty text and adds a day with its input focused', async () => {
    const { spy, user } = setup([]);
    expect(screen.getByText(/No days yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add day/ }));
    expect(last(spy)).toEqual([{ readings: [] }]);
    expect(screen.getByRole('combobox', { name: 'Add a passage to day 1' })).toHaveFocus();
    expect(screen.getByText('No passages yet')).toBeInTheDocument();
  });

  it('typing John 1-3 + Enter adds a chip to the active day and clears the input', async () => {
    const { spy, user } = setup([{ readings: [] }]);
    const input = screen.getByRole('combobox', { name: 'Add a passage to day 1' });
    await user.type(input, 'John 1-3{Enter}');
    expect(screen.getByText('John 1-3')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(last(spy)).toEqual([{ readings: [{ start: 43_001_001, end: 43_003_036 }] }]);
  });

  it('takes several passages in a row, including a single verse', async () => {
    const { spy, user } = setup([{ readings: [] }]);
    const input = screen.getByRole('combobox', { name: 'Add a passage to day 1' });
    await user.type(input, 'John 3{Enter}');
    await user.type(input, 'John 3:16{Enter}');
    const day = last(spy)[0];
    expect(day.readings).toEqual([{ start: 43_003_001, end: 43_003_036 }, { start: 43_003_016, end: 43_003_016 }]);
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
  });

  it('shows the invalid message and adds nothing for a non-passage', async () => {
    const { spy, user } = setup([{ readings: [] }]);
    await user.type(screen.getByRole('combobox'), 'zzz{Enter}');
    expect(screen.getAllByText(/That is not a passage/).some((el) => el.classList.contains('kth-combobox__error'))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('renders only one input for many days and moves it on request', async () => {
    const { user } = setup([john3, john3, { readings: [] }]);
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Add a passage to day 3' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a passage to day 1' }));
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Add a passage to day 1' })).toHaveFocus();
  });

  it('removes a passage and a day', async () => {
    const { spy, user } = setup([john3, { readings: [{ start: 44_001_001, end: 44_001_026 }] }]);
    await user.click(screen.getByRole('button', { name: 'Remove John 3 from day 1' }));
    expect(last(spy)[0].readings).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Delete day 1' }));
    expect(last(spy)).toHaveLength(1);
    expect(last(spy)[0].readings[0].start).toBe(44_001_001);
  });

  it('moves days up and down and disables the ends', async () => {
    const a: Day = { readings: [{ start: 43_001_001, end: 43_001_051 }] };
    const { spy, user } = setup([a, john3]);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByRole('button', { name: 'Move day 1 up' })).toBeDisabled();
    expect(within(items[1]).getByRole('button', { name: 'Move day 2 down' })).toBeDisabled();
    await user.click(within(items[0]).getByRole('button', { name: 'Move day 1 down' }));
    expect(last(spy)).toEqual([john3, a]);
    await user.click(screen.getAllByRole('button', { name: 'Move day 2 up' })[0]);
    expect(last(spy)).toEqual([a, john3]);
  });
});
