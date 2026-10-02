import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTimelineStore } from '@bible/core/browser';
import { TimelineView } from './TimelineView';
import { TimelineItemCard } from './TimelineItemCard';
import { TimelinePanel } from './TimelinePanel';
import { TimelineZoomControls } from './TimelineZoomControls';
import { DEFAULT_TIMELINE_PANEL_LABELS, defaultFormatReference } from './labels';
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

  it('range slider: From and To flags are sliders that move their own edge and stay in sync', () => {
    const store = createTimelineStore(FIXTURE, { width: 800 });
    render(<TimelineZoomControls store={store} labels={DEFAULT_TIMELINE_PANEL_LABELS} />);
    const from = screen.getByRole('slider', { name: 'From' });
    const to = screen.getByRole('slider', { name: 'To' });
    expect(from.getAttribute('aria-valuetext')).toMatch(/BC|AD/);
    const full = store.getSnapshot().view;
    fireEvent.keyDown(from, { key: 'ArrowRight' });
    let v = store.getSnapshot().view;
    expect(v.start).toBeGreaterThan(full.start);
    expect(v.end).toBe(full.end);
    fireEvent.keyDown(to, { key: 'PageDown' });
    const v2 = store.getSnapshot().view;
    expect(v2.end).toBeLessThan(v.end);
    expect(v2.start).toBe(v.start);
    expect(Number(screen.getByRole('slider', { name: 'To' }).getAttribute('aria-valuenow'))).toBe(v2.end);
    fireEvent.keyDown(from, { key: 'Home' });
    expect(store.getSnapshot().view.start).toBe(full.start);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    v = store.getSnapshot().view;
    expect(Number(screen.getByRole('slider', { name: 'From' }).getAttribute('aria-valuenow'))).toBe(v.start);
  });

  it('has no full-screen button unless allowed', () => {
    render(<TimelinePanel dataset={FIXTURE} />);
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull();
  });

  const isFull = (root: Element | null) => root?.classList.contains('kth-fs-on') === true;
  const timelineRoot = () => document.querySelector('.kth-timeline') as HTMLElement;

  it('opens full screen; Escape closes only the settings popover first', async () => {
    render(<TimelinePanel dataset={FIXTURE} allowFullscreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(isFull(timelineRoot())).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Timeline settings' }));
    expect(screen.getByRole('dialog', { name: 'Timeline settings' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Timeline settings' })).toBeNull();
    expect(isFull(timelineRoot())).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(isFull(timelineRoot())).toBe(false);
  });

  it('keeps its state across full screen and returns focus to the toggle after Escape', async () => {
    render(<TimelinePanel dataset={FIXTURE} allowFullscreen />);
    const before = timelineRoot();
    await userEvent.click(screen.getByRole('button', { name: /^Solomon/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    // Same element (never re-mounted), selection kept, focus still inside.
    expect(timelineRoot()).toBe(before);
    expect(before.contains(document.activeElement)).toBe(true);
    expect(before.classList.contains('kth-timeline--fs-card')).toBe(true);
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(isFull(before)).toBe(false);
    expect(before.classList.contains('kth-timeline--fs-card')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByRole('button', { name: /^Solomon/ })).toBeTruthy();
  });

  it('lays out full screen with the card beside the view when an item is selected', async () => {
    render(<TimelinePanel dataset={FIXTURE} allowFullscreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    const root = timelineRoot;
    expect(root().classList.contains('kth-timeline--fs')).toBe(true);
    expect(root().classList.contains('kth-timeline--fs-card')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /^Solomon/ }));
    expect(root().classList.contains('kth-timeline--fs-card')).toBe(true);
  });

  it('the settings button toggles the popover closed and shows headings', async () => {
    render(<TimelinePanel dataset={FIXTURE} />);
    const btn = screen.getByRole('button', { name: 'Timeline settings' });
    await userEvent.click(btn);
    expect(screen.getByRole('dialog', { name: 'Timeline settings' })).toBeTruthy();
    expect(screen.getByText('Lanes', { selector: '.kth-timeline-settings__heading' })).toBeTruthy();
    expect(screen.getByText('Show', { selector: '.kth-timeline-settings__heading' })).toBeTruthy();
    await userEvent.click(btn);
    expect(screen.queryByRole('dialog', { name: 'Timeline settings' })).toBeNull();
  });

  it('search Escape clears text first and does not exit full screen; empty Escape passes through', async () => {
    render(<TimelinePanel dataset={FIXTURE} allowFullscreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    const box = screen.getByRole('combobox', { name: 'Search the timeline' }) as HTMLInputElement;
    await userEvent.type(box, 'temple');
    await userEvent.keyboard('{Escape}'); // closes the list
    expect(isFull(timelineRoot())).toBe(true);
    await userEvent.keyboard('{Escape}'); // clears the text
    expect(box.value).toBe('');
    expect(isFull(timelineRoot())).toBe(true);
    await userEvent.keyboard('{Escape}'); // empty: exits
    expect(isFull(timelineRoot())).toBe(false);
  });

  it('shows no-results as a status outside the listbox', async () => {
    render(<TimelinePanel dataset={FIXTURE} />);
    await userEvent.type(screen.getByRole('combobox', { name: 'Search the timeline' }), 'zzzz');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('No matching events');
    expect(status.closest('[role="listbox"]')).toBeNull();
    expect(status.tagName).not.toBe('LI');
  });

  it('range flags read a short window with a precise date', () => {
    const store = createTimelineStore(FIXTURE, { width: 800 });
    render(<TimelineZoomControls store={store} labels={DEFAULT_TIMELINE_PANEL_LABELS} />);
    const b = store.getBounds();
    act(() => store.setView({ start: b.start + 10, end: b.start + 12 }));
    expect(screen.getByRole('slider', { name: 'From' }).getAttribute('aria-valuetext')).toMatch(/\d+:\d\d/);
  });
});
