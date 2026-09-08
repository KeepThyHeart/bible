import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ToastContainer from './ToastContainer';
import { useToastStore } from '../stores/useToastStore';
import { enT } from '../testing/enCatalog';

// The component resolves its own strings; mocking the hook keeps the test
// free of a ContextProvider while still asserting the shipped English.
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    locale: 'en' as const,
    i18n: {},
  }),
}));

describe('ToastContainer', () => {
  beforeEach(() => {
    // Reset zustand store between tests
    useToastStore.setState({ toasts: [] });
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a toast message', () => {
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Something went wrong', type: 'error' }],
    });

    render(<ToastContainer />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    useToastStore.setState({
      toasts: [
        { id: '1', message: 'Error occurred', type: 'error' },
        { id: '2', message: 'Check this out', type: 'warning' },
        { id: '3', message: 'All good', type: 'info' },
      ],
    });

    render(<ToastContainer />);
    expect(screen.getByText('Error occurred')).toBeInTheDocument();
    expect(screen.getByText('Check this out')).toBeInTheDocument();
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('uses role="alert" for error toasts and role="status" for others', () => {
    useToastStore.setState({
      toasts: [
        { id: '1', message: 'Error!', type: 'error' },
        { id: '2', message: 'Info', type: 'info' },
      ],
    });

    render(<ToastContainer />);
    expect(screen.getByText('Error!').closest('[role="alert"]')).toBeInTheDocument();
    expect(screen.getByText('Info').closest('[role="status"]')).toBeInTheDocument();
  });

  it('removes a toast when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    useToastStore.setState({
      toasts: [{ id: '1', message: 'Dismissable toast', type: 'info' }],
    });

    render(<ToastContainer />);
    expect(screen.getByText('Dismissable toast')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Dismiss'));

    // After clicking dismiss, the store should remove the toast
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
