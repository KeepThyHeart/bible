/**
 * React provider that exposes the four core services to descendants:
 *
 *  - `ICommandRegistry`
 *  - `IWhenContextService`
 *  - `IKeybindingService`
 *  - `II18nService`
 *
 * The services are singletons (one renderer instance), but the provider
 * pattern keeps tests and Storybook-style harnesses able to substitute
 * fakes by passing the `services` prop instead of relying on module
 * singletons.
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { DirectionProvider } from '@bible/ui';
import type { ICommandRegistry } from '../services/ICommandRegistry';
import type { IWhenContextService } from '../services/IWhenContextService';
import type { IKeybindingService } from '../services/IKeybindingService';
import type { II18nService } from '../services/II18nService';
import { whenContextService } from '../services/WhenContextService';
import { i18nService } from '../services/I18nService';
import { CommandRegistry } from '../services/CommandRegistry';
import { KeybindingService } from '../services/KeybindingService';

export interface AppServices {
  registry: ICommandRegistry;
  whenContext: IWhenContextService;
  keybindings: IKeybindingService;
  i18n: II18nService;
}

const AppServicesContext = createContext<AppServices | null>(null);

/**
 * Build the default singleton wiring. Called once at app boot. Tests can
 * skip this and pass their own `AppServices` to `<ContextProvider>`.
 */
export function createDefaultServices(): AppServices {
  const registry = new CommandRegistry({ i18n: i18nService, whenContext: whenContextService });
  const keybindings = new KeybindingService({ registry, whenContext: whenContextService });
  return {
    registry,
    whenContext: whenContextService,
    keybindings,
    i18n: i18nService,
  };
}

interface ContextProviderProps {
  services: AppServices;
  children: ReactNode;
}

export function ContextProvider({ services, children }: ContextProviderProps) {
  return (
    <AppServicesContext.Provider value={services}>
      <UiDirectionBridge i18n={services.i18n}>{children}</UiDirectionBridge>
    </AppServicesContext.Provider>
  );
}

/**
 * Feeds the active UI direction into `@bible/ui`'s `<DirectionProvider>` so
 * shared components (`useDirection()`, pickers, swatches) follow the app's
 * locale, in the main window and in every detached window (task 0076).
 */
function UiDirectionBridge({ i18n, children }: { i18n: II18nService; children: ReactNode }) {
  const locale = useSyncExternalStore(
    (cb) => {
      const sub = i18n.onDidChangeLocale(cb);
      return () => sub.dispose();
    },
    () => i18n.currentLocale,
    () => i18n.currentLocale,
  );
  return <DirectionProvider value={{ ui: i18n.currentDirection, locale }}>{children}</DirectionProvider>;
}

/**
 * Internal hook used by the more specific hooks (`useCommands`, `useI18n`,
 * etc.). Throws if no provider is mounted, since every screen the user
 * sees should be wrapped in `<ContextProvider>`.
 */
export function useAppServices(): AppServices {
  const ctx = useContext(AppServicesContext);
  if (!ctx) {
    throw new Error('useAppServices must be used inside <ContextProvider>');
  }
  return ctx;
}
