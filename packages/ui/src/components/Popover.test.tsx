import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover } from './Popover';

const RECT = { left: 300, right: 360, top: 200, bottom: 216 };

describe('Popover', () => {
  it('renders nothing when closed or without an anchor', () => {
    const { rerender } = render(<Popover open={false} anchor={RECT}>hello</Popover>);
    expect(screen.queryByText('hello')).toBeNull();
    rerender(<Popover open anchor={null}>hello</Popover>);
    expect(screen.queryByText('hello')).toBeNull();
  });

  it('portals into document.body with a dialog role and an accessible name', () => {
    const { container } = render(<Popover open anchor={RECT} label="Verse preview">hello</Popover>);
    expect(container.querySelector('.kth-popover')).toBeNull();
    const el = screen.getByRole('dialog', { name: 'Verse preview' });
    expect(el.parentElement).toBe(document.body);
  });

  it('stays in place with portal={false}', () => {
    const { container } = render(<Popover open anchor={RECT} portal={false}>hello</Popover>);
    expect(container.querySelector('.kth-popover')).not.toBeNull();
  });

  it('positions below a rectangle anchor (LTR: inline-start on its left edge)', () => {
    render(<Popover open anchor={RECT} width={200}>hello</Popover>);
    const el = screen.getByRole('dialog');
    expect(el.style.position).toBe('fixed');
    expect(el.style.left).toBe('300px');
    expect(el.style.top).toBe('220px');
    expect(el.style.width).toBe('200px');
    expect(el).toHaveAttribute('data-placement', 'below');
  });

  it('mirrors in RTL', () => {
    render(<Popover open anchor={RECT} width={200} dir="rtl">hello</Popover>);
    const el = screen.getByRole('dialog');
    expect(el.style.left).toBe('160px');
    expect(el).toHaveAttribute('dir', 'rtl');
  });

  it('uses the document direction when none is given', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    try {
      render(<Popover open anchor={RECT} width={200}>hello</Popover>);
      expect(screen.getByRole('dialog').style.left).toBe('160px');
    } finally {
      document.documentElement.removeAttribute('dir');
    }
  });

  it('places a point anchor 20px below by default (the desktop preview)', () => {
    render(<Popover open anchor={{ x: 100, y: 100 }} width={200}>hello</Popover>);
    const el = screen.getByRole('dialog');
    expect(el.style.left).toBe('100px');
    expect(el.style.top).toBe('120px');
  });

  it('flips above when there is no room below', () => {
    render(<Popover open anchor={{ left: 100, right: 120, top: 740, bottom: 756 }} width={200} estimatedHeight={200}>hello</Popover>);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'above');
  });

  it('Escape closes (dismissible)', async () => {
    const onClose = vi.fn();
    render(<Popover open anchor={RECT} onClose={onClose}>hello</Popover>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeOnEscape=false ignores Escape', async () => {
    const onClose = vi.fn();
    render(<Popover open anchor={RECT} onClose={onClose} closeOnEscape={false}>hello</Popover>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on an outside press but not on a press inside', () => {
    const onClose = vi.fn();
    render(<Popover open anchor={RECT} onClose={onClose}><button type="button">inside</button></Popover>);
    fireEvent.mouseDown(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.touchStart(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('insideRefs count as inside', () => {
    const onClose = vi.fn();
    const trigger = { current: document.createElement('button') };
    document.body.appendChild(trigger.current);
    render(<Popover open anchor={RECT} onClose={onClose} insideRefs={[trigger]}>hello</Popover>);
    fireEvent.mouseDown(trigger.current);
    expect(onClose).not.toHaveBeenCalled();
    trigger.current.remove();
  });

  it('a backdrop catches clicks and closes; the popup itself does not', () => {
    const onClose = vi.fn();
    render(<Popover open anchor={RECT} onClose={onClose} backdrop backdropClassName="my-overlay"><button type="button">inside</button></Popover>);
    fireEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.my-overlay') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is hoverable: forwards pointer enter/leave', async () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    render(<Popover open anchor={RECT} onMouseEnter={onEnter} onMouseLeave={onLeave}>hello</Popover>);
    await userEvent.hover(screen.getByRole('dialog'));
    expect(onEnter).toHaveBeenCalled();
    await userEvent.unhover(screen.getByRole('dialog'));
    expect(onLeave).toHaveBeenCalled();
  });

  it('autoFocus moves focus in and restores it on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<Popover open anchor={RECT} autoFocus>hello</Popover>);
    expect(screen.getByRole('dialog')).toHaveFocus();
    rerender(<Popover open={false} anchor={RECT} autoFocus>hello</Popover>);
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
