import { render, screen, act, fireEvent } from '@testing-library/react';
import { HoverCard } from './HoverCard';

// user-event awaits real timers, which hangs under vi.useFakeTimers() with Testing Library's async wrapper,
// so these tests drive fake timers with synchronous fireEvent calls.
const user = {
  // Real browsers fire over/out (bubbling) plus enter/leave (once per ancestor), for pointer and mouse.
  hover: (el: Element) => {
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
        n.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse' }));
        n.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      }
    });
  },
  unhover: (el: Element) => {
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
        n.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse' }));
        n.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      }
    });
  },
  click: (el: Element) => { act(() => { fireEvent.click(el, { detail: 1 }); }); },
  keyboard: (_: string) => { act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }); }); },
};

function setup(props: Partial<React.ComponentProps<typeof HoverCard>> = {}) {
  const utils = render(
    <HoverCard content={<span>card body</span>} showDelay={100} hideDelay={50} label="Preview" {...props}>
      <a href="#x">John 3:16</a>
    </HoverCard>,
  );
  return { ...utils };
}

describe('HoverCard', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('opens after the hover delay, not before', () => {
    setup();
    user.hover(screen.getByText('John 3:16'));
    expect(screen.queryByText('card body')).toBeNull();
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByText('card body')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('does not open if the pointer leaves before the delay', () => {
    setup();
    user.hover(screen.getByText('John 3:16'));
    user.unhover(screen.getByText('John 3:16'));
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText('card body')).toBeNull();
  });

  it('closes after the hide delay once the pointer leaves', () => {
    setup();
    user.hover(screen.getByText('John 3:16'));
    act(() => { vi.advanceTimersByTime(100); });
    user.unhover(screen.getByText('John 3:16'));
    expect(screen.getByText('card body')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.queryByText('card body')).toBeNull();
  });

  it('is hoverable: moving onto the card keeps it open', () => {
    setup();
    user.hover(screen.getByText('John 3:16'));
    act(() => { vi.advanceTimersByTime(100); });
    user.unhover(screen.getByText('John 3:16'));
    user.hover(screen.getByText('card body'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('card body')).toBeInTheDocument();
    user.unhover(screen.getByText('card body'));
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.queryByText('card body')).toBeNull();
  });

  it('is dismissible with Escape', () => {
    setup();
    user.hover(screen.getByText('John 3:16'));
    act(() => { vi.advanceTimersByTime(100); });
    user.keyboard('{Escape}');
    expect(screen.queryByText('card body')).toBeNull();
  });

  it('opens on keyboard focus and closes on blur, describing the trigger', () => {
    setup();
    act(() => { screen.getByText('John 3:16').focus(); });
    expect(screen.getByText('card body')).toBeInTheDocument();
    expect(screen.getByText('John 3:16').parentElement).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);
    act(() => { screen.getByText('John 3:16').blur(); });
    act(() => { vi.advanceTimersByTime(50); });
    expect(screen.queryByText('card body')).toBeNull();
  });

  it('click pins it open past the pointer leaving; an outside press closes it', () => {
    setup();
    user.hover(screen.getByText('John 3:16'));
    act(() => { vi.advanceTimersByTime(100); });
    user.click(screen.getByText('John 3:16'));
    expect(screen.getByRole('dialog', { name: 'Preview' })).toBeInTheDocument();
    user.unhover(screen.getByText('John 3:16'));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('card body')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('card body')).toBeNull();
  });

  it('a touch tap opens the card and suppresses the first click, a second tap goes through', () => {
    setup({ sheetBreakpoint: 0 });
    const trigger = screen.getByText('John 3:16').parentElement as HTMLElement;
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    const first = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => { trigger.dispatchEvent(first); });
    expect(first.defaultPrevented).toBe(true);
    expect(screen.getByText('card body')).toBeInTheDocument();
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    const second = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => { trigger.dispatchEvent(second); });
    expect(second.defaultPrevented).toBe(false);
  });

  it('a touch tap on a narrow viewport opens a bottom sheet', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    try {
      setup({ sheetTitle: 'John 3:16' });
      const trigger = screen.getByText('John 3:16').parentElement as HTMLElement;
      fireEvent.pointerDown(trigger, { pointerType: 'touch' });
      act(() => { trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
      expect(screen.getByRole('dialog', { name: 'John 3:16' })).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByText('card body')).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
    }
  });

  it('never opens when disabled', () => {
    setup({ disabled: true });
    user.hover(screen.getByText('John 3:16'));
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText('card body')).toBeNull();
  });

  it('reports open state changes', () => {
    const onOpenChange = vi.fn();
    setup({ onOpenChange });
    user.hover(screen.getByText('John 3:16'));
    act(() => { vi.advanceTimersByTime(100); });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
