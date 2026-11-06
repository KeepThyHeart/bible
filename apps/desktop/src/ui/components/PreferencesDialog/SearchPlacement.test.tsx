/**
 * Search tabs (task 0210): the "Search results open" fieldset in Preferences > Search.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchPlacementFieldset } from './SearchSection';
import { usePreferencesStore } from '../../stores/usePreferencesStore';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

beforeEach(() => {
  usePreferencesStore.setState({ searchResultsPlacement: 'below' });
});

describe('SearchPlacementFieldset', () => {
  it('renders the heading, the intro and all three radios with their help text', () => {
    render(<SearchPlacementFieldset />);

    expect(screen.getByRole('radiogroup', { name: 'preferencesDialog.searchPlacementHeading' })).toBeInTheDocument();
    expect(screen.getByText('preferencesDialog.searchPlacementIntro')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /preferencesDialog\.searchPlacementBelow/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /preferencesDialog\.searchPlacementRight/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /preferencesDialog\.searchPlacementTab/ })).toBeInTheDocument();
    expect(screen.getByText('preferencesDialog.searchPlacementTabHelp')).toBeInTheDocument();
    expect(screen.getByText('preferencesDialog.searchPlacementBelowHelp')).toBeInTheDocument();
    expect(screen.getByText('preferencesDialog.searchPlacementRightHelp')).toBeInTheDocument();
  });

  it('shows below selected by default', () => {
    render(<SearchPlacementFieldset />);
    expect(screen.getByTestId('search-placement-below')).toBeChecked();
    expect(screen.getByTestId('search-placement-right')).not.toBeChecked();
  });

  it('reflects a stored right preference', () => {
    usePreferencesStore.setState({ searchResultsPlacement: 'right' });
    render(<SearchPlacementFieldset />);
    expect(screen.getByTestId('search-placement-right')).toBeChecked();
    expect(screen.getByTestId('search-placement-below')).not.toBeChecked();
  });

  it('selecting right calls the store setter and the selection follows', async () => {
    const setter = vi.fn(usePreferencesStore.getState().setSearchResultsPlacement);
    usePreferencesStore.setState({ setSearchResultsPlacement: setter });
    const user = userEvent.setup();
    render(<SearchPlacementFieldset />);

    await user.click(screen.getByTestId('search-placement-right'));

    expect(setter).toHaveBeenCalledWith('right');
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('right');
    expect(screen.getByTestId('search-placement-right')).toBeChecked();
  });

  it('clicking the label text of an option also selects it, and below can be re-selected', async () => {
    const user = userEvent.setup();
    render(<SearchPlacementFieldset />);

    await user.click(screen.getByText('preferencesDialog.searchPlacementRight'));
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('right');

    await user.click(screen.getByText('preferencesDialog.searchPlacementBelow'));
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('below');
  });

  it('the options are listed below, tab, right', () => {
    render(<SearchPlacementFieldset />);
    const ids = screen.getAllByRole('radio').map((r) => r.getAttribute('data-testid'));
    expect(ids).toEqual(['search-placement-below', 'search-placement-tab', 'search-placement-right']);
  });

  it('reflects a stored tab preference', () => {
    usePreferencesStore.setState({ searchResultsPlacement: 'tab' });
    render(<SearchPlacementFieldset />);
    expect(screen.getByTestId('search-placement-tab')).toBeChecked();
    expect(screen.getByTestId('search-placement-below')).not.toBeChecked();
    expect(screen.getByTestId('search-placement-right')).not.toBeChecked();
  });

  it('selecting tab calls the setter, the selection follows, and the others can be re-selected', async () => {
    const setter = vi.fn(usePreferencesStore.getState().setSearchResultsPlacement);
    usePreferencesStore.setState({ setSearchResultsPlacement: setter });
    const user = userEvent.setup();
    render(<SearchPlacementFieldset />);

    await user.click(screen.getByTestId('search-placement-tab'));
    expect(setter).toHaveBeenCalledWith('tab');
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('tab');
    expect(screen.getByTestId('search-placement-tab')).toBeChecked();

    await user.click(screen.getByText('preferencesDialog.searchPlacementRight'));
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('right');
    await user.click(screen.getByText('preferencesDialog.searchPlacementTab'));
    expect(usePreferencesStore.getState().searchResultsPlacement).toBe('tab');
  });
});
