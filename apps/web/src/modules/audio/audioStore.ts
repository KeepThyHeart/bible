/**
 * The web app's audio store: the shared, framework-neutral `AudioStore` from
 * `@bible/audio`, adapted to the web reader. A "tab" is a `bibleStore` tab; Play
 * acts on the active one; following the reading into the next chapter is
 * `navigateTo(..., { follow: true })`, a page turn that leaves the selection,
 * the hash and the Study panes alone.
 */

import { AudioStore } from '@bible/audio';
import type { AudioModulesPort, AudioReaderPort } from '@bible/audio';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';

export {
  AudioStore, FollowStore, PositionStore,
} from '@bible/audio';
export type {
  AudioNotice, AudioSystem, AudioUiStatus, Availability, NoticeAction, PendingGate,
} from '@bible/audio';

export const webReaderPort: AudioReaderPort = {
  subscribe: listener => bibleStore.subscribe(listener),
  tab: id => bibleStore.tabs.find(t => t.id === id),
  activeTab: () => bibleStore.getActiveTab(),
  // The selection belongs to the active tab only.
  selectionStart: tabId => (tabId === bibleStore.activeTabId ? bibleStore.getSelectedRange()?.start ?? null : null),
  followTo: (tabId, book, chapter) => bibleStore.navigateTo(book, chapter, undefined, { follow: true, tabId }),
};

export const webModulesPort: AudioModulesPort = {
  subscribe: listener => moduleStore.subscribe(listener),
  languageOf: moduleAbbr => moduleStore.getBibleModules().find(m => m.abbreviation === moduleAbbr)?.language_code ?? '',
};

export const audioStore = new AudioStore({ reader: webReaderPort, modules: webModulesPort });
