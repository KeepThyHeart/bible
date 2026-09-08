/**
 * Two regressions in the Prayer tab's first-run path.
 *
 * 1. With no prayer lists at all, the tab rendered an *empty* `<select>` and the
 *    copy "Select a prayer list to view prayers", while "+ New Prayer" was
 *    hidden behind a selected list - so the only route to a first list was an
 *    unlabelled gear icon. There is now a distinct "no lists exist" state with
 *    a create action.
 * 2. New prayers were seeded with the literal text "Write your prayer here...",
 *    which was persisted as real content the user had to select and delete. It
 *    is a placeholder now, so the body starts empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PrayerTab from './PrayerTab';
import { enT } from '../../../testing/enCatalog';

const createPrayer = vi.fn().mockResolvedValue({ noteId: 1, title: 'Healing', content: '' });
const loadPrayerLists = vi.fn().mockResolvedValue(undefined);

const mockPrayerStore: Record<string, unknown> = {};
vi.mock('../../../stores/usePrayerStore', () => ({
  usePrayerStore: () => mockPrayerStore,
}));

vi.mock('../../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params) }),
}));

// The editor drags in TipTap and the list item drags in dnd-kit sensors;
// neither is under test here.
vi.mock('../prayer/PrayerEditor', () => ({ default: () => <div data-testid="prayer-editor" /> }));
vi.mock('../prayer/PrayerListItem', () => ({ default: () => <div data-testid="prayer-list-item" /> }));
vi.mock('../prayer/PrayerListConfigDialog', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="prayer-list-config-dialog">
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}));
vi.mock('../../TextInputDialog', () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: (v: string) => void }) =>
    isOpen ? (
      <button type="button" data-testid="confirm-title" onClick={() => onConfirm('Healing')}>
        confirm
      </button>
    ) : null,
}));

describe('PrayerTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockPrayerStore)) delete mockPrayerStore[key];
    Object.assign(mockPrayerStore, {
      currentPrayerNote: null,
      setCurrentPrayerNote: vi.fn(),
      createPrayer,
      deletePrayer: vi.fn(),
      selectedPrayerListId: null,
      selectPrayerList: vi.fn(),
      prayerLists: [],
      prayers: [],
      reorderPrayers: vi.fn(),
      updatePrayer: vi.fn(),
      loadPrayerLists: loadPrayerLists,
    });
  });

  it('reads the saved prayer lists in on mount', () => {
    // Nothing anywhere called this, so `prayerLists` stayed `[]` for the life
    // of the window and the tab showed its "no lists yet" state however many
    // the user had saved.
    render(<PrayerTab />);
    expect(loadPrayerLists).toHaveBeenCalledTimes(1);
  });

  it('offers a way to create the first prayer list when none exist', () => {
    render(<PrayerTab />);

    // No empty dropdown inviting a choice that cannot be made...
    expect(screen.queryByLabelText('prayerTab.prayerListLabel')).not.toBeInTheDocument();
    // ...and not the "pick one from the list" copy either.
    expect(screen.queryByText('Select a prayer list to view prayers')).not.toBeInTheDocument();

    const create = screen.getByTestId('prayer-create-first-list');
    expect(create).toHaveTextContent('+ New Prayer List');

    fireEvent.click(create);
    expect(screen.getByTestId('prayer-list-config-dialog')).toBeInTheDocument();
  });

  it('creates a new prayer with empty content, not seeded prompt text', async () => {
    Object.assign(mockPrayerStore, {
      prayerLists: [{ userCommentaryId: 7, name: 'Family' }],
      selectedPrayerListId: 7,
    });
    render(<PrayerTab />);

    fireEvent.click(screen.getByText('+ New Prayer'));
    fireEvent.click(screen.getByTestId('confirm-title'));

    await waitFor(() => expect(createPrayer).toHaveBeenCalled());
    expect(createPrayer.mock.calls[0][0]).toMatchObject({ title: 'Healing', content: '' });
  });
});
