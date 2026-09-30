import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTimelineStore } from '@bible/core/browser';
import { TimelineView } from './TimelineView';
import { TimelineItemCard } from './TimelineItemCard';
import { TimelinePanel } from './TimelinePanel';
import { defaultFormatReference } from './labels';
import { FIXTURE } from './fixture';

describe('TimelineView', () => {
  it('renders bars, diamonds, lane labels and axis ticks', () => {
    const store = createTimelineStore(FIXTURE, { width: 800 });
    store.fit();
    const { container } = render(<TimelineView store={store} />);
    expect(container.querySelectorAll('[data-shape="bar"]').length).toBe(1);
    expect(container.querySelectorAll('[data-shape="diamond"]').length).toBe(1);
    expect(screen.getByRole('group', { name: 'Timeline' })).toBeTruthy();
    expect(screen.getByText('Kings')).toBeTruthy();
    expect(container.querySelectorAll('.kth-timeline-tick-label').length).toBeGreaterThan(0);
    expect(container.querySelector('.kth-timeline-band')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Solomon, .*BC/ })).toBeTruthy();
  });

  it('zooms with + and Home, pans with arrows', () => {
    const store = createTimelineStore(FIXTURE, { width: 800 });
    const { container } = render(<TimelineView store={store} />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    const full = store.getSnapshot().view;
    fireEvent.keyDown(svg, { key: '+' });
    const zoomed = store.getSnapshot().view;
    expect(zoomed.end - zoomed.start).toBeLessThan(full.end - full.start);
    fireEvent.keyDown(svg, { key: 'ArrowRight' });
    expect(store.getSnapshot().view.start).toBeGreaterThan(zoomed.start);
    fireEvent.keyDown(svg, { key: 'Home' });
    expect(store.getSnapshot().view).toEqual(full);
  });

  it('selects a mark on click and calls onSelect', async () => {
    const store = createTimelineStore(FIXTURE, { width: 800 });
    const onSelect = vi.fn();
    render(<TimelineView store={store} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: /^Solomon/ }));
    expect(store.getSnapshot().selectedId).toBe(1);
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe('TimelineItemCard', () => {
  it('shows dates, basis, chronologies and passage buttons', async () => {
    const onOpen = vi.fn();
    render(
      <TimelineItemCard
        item={FIXTURE.items[0]}
        chronologies={FIXTURE.chronologies}
        activeChronologyId="ussher"
        formatReference={defaultFormatReference}
        onOpenPassage={onOpen}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Solomon' })).toBeTruthy();
    expect(screen.getAllByText(/1015 BC to 976 BC/).length).toBeGreaterThan(0);
    expect(screen.getByText('Ussher Annals')).toBeTruthy();
    expect(screen.getByText(/Start between/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Read .*1 Kings 1:1-11:43/ }));
    expect(onOpen).toHaveBeenCalledWith(11_001_001, 11_011_043);
    expect(screen.getByRole('button', { name: /2 Chronicles 1:1-9:31/ })).toBeTruthy();
    expect(screen.getByText('Reviewed')).toBeTruthy();
  });
});

describe('TimelinePanel', () => {
  it('switches chronology and shows its description', async () => {
    render(<TimelinePanel dataset={FIXTURE} />);
    expect(screen.getByText('Literal reading.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Timeline settings' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Chronology' }), 'alt');
    expect(screen.getByText('Shorter.')).toBeTruthy();
  });

  it('opens the card for a selected mark and follows focusVerse', async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<TimelinePanel dataset={FIXTURE} onOpenPassage={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /^Solomon/ }));
    expect(screen.getByRole('region', { name: 'Solomon' })).toBeTruthy();
    rerender(<TimelinePanel dataset={FIXTURE} onOpenPassage={onOpen} focusVerse={11_008_010} />);
    expect(await screen.findByRole('region', { name: 'Temple dedicated' })).toBeTruthy();
  });

  it('toggles lanes from the settings popover', async () => {
    render(<TimelinePanel dataset={FIXTURE} />);
    expect(screen.queryByRole('button', { name: 'Kings' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Timeline settings' }));
    expect(screen.getByRole('dialog', { name: 'Timeline settings' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Kings', pressed: true }));
    expect(screen.getByRole('button', { name: 'Kings', pressed: false })).toBeTruthy();
  });

  it('searches, lists options and opens the card on Enter', async () => {
    render(<TimelinePanel dataset={FIXTURE} />);
    const box = screen.getByRole('combobox', { name: 'Search the timeline' });
    await userEvent.type(box, 'temple');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('region', { name: 'Temple dedicated' })).toBeTruthy();
    await userEvent.clear(box);
    await userEvent.type(box, 'zzzz');
    expect(screen.getByText('No matching events')).toBeTruthy();
  });

  it('zoom slider changes the span', () => {
    render(<TimelinePanel dataset={FIXTURE} />);
    const slider = screen.getByRole('slider', { name: 'Zoom' }) as HTMLInputElement;
    expect(slider.value).toBe('0');
    fireEvent.change(slider, { target: { value: '500' } });
    expect(Number((screen.getByRole('slider', { name: 'Zoom' }) as HTMLInputElement).value)).toBeGreaterThan(300);
    expect((screen.getByRole('slider', { name: 'Position' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('has no full-screen button unless allowed', () => {
    render(<TimelinePanel dataset={FIXTURE} />);
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull();
  });

  it('opens full screen; Escape closes only the settings popover first', async () => {
    render(<TimelinePanel dataset={FIXTURE} allowFullscreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByRole('dialog', { name: 'Full screen' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Timeline settings' }));
    expect(screen.getByRole('dialog', { name: 'Timeline settings' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Timeline settings' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Full screen' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Full screen' })).toBeNull();
  });
});
