import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';
import {
  PropsSlotOutlet,
  StudyLayoutOutlet,
  helpShortcutRows,
  phoneBackHandlers,
  readerToolbarActions,
  studyLayoutItems,
} from './slots';

afterEach(cleanup);

describe('PropsSlotOutlet', () => {
  it('renders nothing for an empty slot and passes the props to every registered component', () => {
    const tab = { id: 'tab-1' } as never;
    const { container, unmount } = render(<PropsSlotOutlet slot={readerToolbarActions} props={{ tab }} />);
    expect(container.innerHTML).toBe('');
    const a = readerToolbarActions.register(({ tab: t }) => <b data-testid="a">{(t as { id: string }).id}</b>);
    const b = readerToolbarActions.register(() => <i data-testid="b" />);
    const view = render(<PropsSlotOutlet slot={readerToolbarActions} props={{ tab }} />);
    expect(view.getByTestId('a').textContent).toBe('tab-1');
    expect(view.getByTestId('b')).toBeTruthy();
    a.dispose();
    b.dispose();
    unmount();
  });
});

describe('StudyLayoutOutlet', () => {
  it('shows an item only in its layout and placement, and removes it when disposed', () => {
    const open = (section?: string) => section;
    const items = [
      studyLayoutItems.register({ layout: 'desktop', placement: 'overlay', Component: () => <i data-testid="desktop" /> }),
      studyLayoutItems.register({ layout: 'phone', placement: 'dock', Component: () => <i data-testid="phone-dock" /> }),
      studyLayoutItems.register({ layout: 'both', placement: 'dialogs', Component: ({ onOpenSettings }) => <i data-testid="both" data-open={String(onOpenSettings === open)} /> }),
    ];
    const desktop = render(<StudyLayoutOutlet layout="desktop" placement="overlay" onOpenSettings={open} />);
    expect(desktop.queryByTestId('desktop')).toBeTruthy();
    expect(desktop.queryByTestId('phone-dock')).toBeNull();
    const phone = render(<StudyLayoutOutlet layout="phone" placement="dock" onOpenSettings={open} />);
    expect(phone.queryByTestId('phone-dock')).toBeTruthy();
    const dialogs = render(<StudyLayoutOutlet layout="phone" placement="dialogs" onOpenSettings={open} />);
    expect(dialogs.getByTestId('both').getAttribute('data-open')).toBe('true');
    for (const handle of items) handle.dispose();
    const after = render(<StudyLayoutOutlet layout="desktop" placement="overlay" onOpenSettings={open} />);
    expect(after.container.querySelector('[data-testid="desktop"]')).toBeNull();
  });
});

describe('phone back handlers and Help rows', () => {
  it('are plain registrations that vanish on dispose', () => {
    const back = phoneBackHandlers.register(() => true);
    const rows = helpShortcutRows.register(() => null);
    expect(phoneBackHandlers.list()).toHaveLength(1);
    expect(helpShortcutRows.list()).toHaveLength(1);
    back.dispose();
    rows.dispose();
    expect(phoneBackHandlers.list()).toEqual([]);
    expect(helpShortcutRows.list()).toEqual([]);
  });
});

describe('stable keys', () => {
  it('disposing one slot item does not remount the others', async () => {
    const mounts = vi.fn();
    const First = () => <i data-testid="first" />;
    const Second = () => {
      useEffect(() => mounts(), []);
      return <i data-testid="second" />;
    };
    const firstProps = readerToolbarActions.register(First);
    const secondProps = readerToolbarActions.register(Second);
    render(<PropsSlotOutlet slot={readerToolbarActions} props={{ tab: {} as never }} />);
    const f = studyLayoutItems.register({ layout: 'both', placement: 'dock', Component: First });
    const s = studyLayoutItems.register({ layout: 'both', placement: 'dock', Component: Second });
    render(<StudyLayoutOutlet layout="phone" placement="dock" onOpenSettings={() => {}} />);
    expect(mounts).toHaveBeenCalledTimes(2);
    await act(() => {
      firstProps.dispose();
      f.dispose();
    });
    expect(mounts).toHaveBeenCalledTimes(2);
    secondProps.dispose();
    s.dispose();
  });
});
