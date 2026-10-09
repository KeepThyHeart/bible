/**
 * The entity detail view renders the buttons that feature modules register for an entity's
 * category (`host/entityActions`). The view names no feature: with nothing registered there is
 * no button, and a registered action runs with the entity.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));
vi.mock('../shared/TopicSearchBar', () => ({ default: () => <div data-testid="topic-search-bar" /> }));
vi.mock('../shared/TopicCard', () => ({ default: () => null }));

import EntityDetailView from './EntityDetailView';
import { entityActions, registerEntityAction } from '../../modules/host/entityActions';
import { enT } from '../../testing/enCatalog';

function view(category: string) {
  return (
    <EntityDetailView
      entity={{ id: 'abraham', name: 'Abraham', category }}
      associations={[]} relationships={[]} aliases={[]} facets={[]} topicLinks={[]} loading={false}
      onEntityClick={vi.fn()} onSearchSelect={vi.fn()} onTopicLinkClick={vi.fn()}
    />
  );
}

const run = vi.fn();
const action = {
  id: 'fixture.action', categories: ['people'], labelKey: 'entityDetailView.showFamilyTree', testId: 'fixture-action', run,
};

afterEach(() => {
  for (const item of entityActions.list()) entityActions.unregister(item.id);
  run.mockClear();
});

describe('EntityDetailView entity actions', () => {
  it('shows no action button when no module registered one', () => {
    render(view('people'));
    expect(screen.queryByTestId('fixture-action')).toBeNull();
  });

  it('shows a registered action for its category only, and runs it with the entity', async () => {
    const reg = registerEntityAction('fixture', action);
    const { rerender } = render(view('people'));
    await userEvent.click(screen.getByTestId('fixture-action'));
    expect(run).toHaveBeenCalledWith({ id: 'abraham', category: 'people' });
    expect(screen.getByTestId('fixture-action')).toHaveTextContent('Show family tree');
    rerender(view('places'));
    expect(screen.queryByTestId('fixture-action')).toBeNull();
    reg.dispose();
  });

  it('removes the button when the action is disposed (module switched off)', () => {
    const reg = registerEntityAction('fixture', action);
    render(view('people'));
    expect(screen.getByTestId('fixture-action')).toBeInTheDocument();
    act(() => reg.dispose());
    expect(screen.queryByTestId('fixture-action')).toBeNull();
  });
});
