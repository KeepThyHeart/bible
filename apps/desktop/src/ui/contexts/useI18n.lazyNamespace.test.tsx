/**
 * B-071: a component that rendered `[key]` before its lazy namespace arrived must re-render when it does
 * (the locale does not change, so the hook has to watch the catalog revision too).
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nService } from '../services/I18nService';
import { ContextProvider } from './ContextProvider';
import { useI18n } from './useI18n';
import type { AppServices } from './ContextProvider';

const Probe: React.FC = () => {
  const { t } = useI18n();
  const label = React.useMemo(() => t('lazyPane.title'), [t]);
  return <p data-testid="label">{label}</p>;
};

describe('useI18n with a lazily loaded namespace (B-071)', () => {
  it('re-renders memoized strings once the namespace loads', async () => {
    const i18n = new I18nService();
    i18n.registerNamespace('lazyPane');
    i18n.setNamespaceSource(async (_locale, namespace) => (namespace === 'lazyPane' ? { 'lazyPane.title': 'Loaded title' } : undefined));
    const services = { registry: {}, whenContext: {}, keybindings: {}, i18n } as unknown as AppServices;
    render(<ContextProvider services={services}><Probe /></ContextProvider>);
    await waitFor(() => expect(screen.getByTestId('label')).toHaveTextContent('Loaded title'));
  });
});
