import type { IWhenContextService } from '../services/IWhenContextService';
import { appHost, appHostStore } from './appHost';

/** Publish the boolean when-context key `studyActive` (Study is the app on screen). */
export function publishActiveAppContext(whenContext: Pick<IWhenContextService, 'set'>): void {
  const publish = (): void => whenContext.set('studyActive', appHost.getSnapshot().activeId === 'study');
  publish();
  appHostStore.subscribe(publish);
}
