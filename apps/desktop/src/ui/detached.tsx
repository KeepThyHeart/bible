import React from 'react';
import ReactDOM from 'react-dom/client';
import { ContextProvider, createDefaultServices } from './contexts/ContextProvider';
import { LocaleCatalogLoader } from './services/LocaleCatalogLoader';
import { bindDocumentDirection, restorePersistedLocale } from './utils/documentDirection';
import { DetachedWindow } from './components/DetachedWindow';

import './styles/globals.css';
import './styles/highlights.css';

// Create a minimal services bundle for the detached window.
// The detached window needs useI18n() (and transitively useAppServices()) to work.
const detachedServices = createDefaultServices();

// A detached pane is its OWN renderer context: separate `document`, separate
// I18nService instance, no catalogs and no locale unless we load them here.
// Without this block a popped-out pane always rendered English, LTR, no matter
// what the main window was set to.
bindDocumentDirection(detachedServices.i18n);
void new LocaleCatalogLoader(detachedServices.i18n)
  .loadAll()
  .then(() => restorePersistedLocale(detachedServices.i18n));

// Render the detached window.
// The component itself lives in ./components/DetachedWindow so it can be
// unit-tested - this module is bootstrap only and runs createRoot on import.
const root = ReactDOM.createRoot(document.getElementById('detached-root')!);
root.render(
  <React.StrictMode>
    <ContextProvider services={detachedServices}>
      <DetachedWindow />
    </ContextProvider>
  </React.StrictMode>
);
