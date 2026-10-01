/**
 * `api.ui` - panels, verse decorations, hovers, menus, notifications, dialogs and file pickers.
 */

import type { IUiApi } from '../../ExtensionApiTypes';
import { FAKE_DISPOSABLE, defineApiNamespace, fakeReturns } from '../defineApiNamespace';

export const uiNamespace = defineApiNamespace<IUiApi>()({
  name: 'ui',
  description: "Contribute UI to the app and show dialogs, notifications and file pickers.",
  since: '0.1.0',
  permissions: [
    {
      id: 'ui:contribute-pane',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.uiContributePane', text: 'Add its own panel to the app.' },
      since: '0.1.0',
    },
    {
      id: 'ui:verse-decorator',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.uiVerseDecorator', text: 'Add marks or badges beside verses.' },
      since: '0.1.0',
    },
    {
      id: 'ui:verse-hover',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.uiVerseHover',
        text: 'Show extra information when you hover over a verse.',
      },
      since: '0.1.0',
    },
    {
      id: 'ui:context-menu',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.uiContextMenu',
        text: 'Add items to menus you open with a right-click.',
      },
      since: '0.1.0',
    },
    {
      id: 'ui:notification',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.uiNotification', text: 'Show you brief notifications.' },
      since: '0.1.0',
    },
    {
      id: 'ui:status-bar',
      grant: 'prompt',
      consent: { key: 'extensionConsent.permission.uiStatusBar', text: 'Show an item in the status bar.' },
      since: '0.1.0',
    },
    {
      id: 'ui:media',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.uiMedia',
        text: 'Play audio or video in its panel without waiting for a click.',
      },
      since: '0.1.0',
    },
    {
      id: 'fs:read-user',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.fsReadUser',
        text: 'Read files you select with the system file picker.',
      },
      since: '0.1.0',
    },
    {
      id: 'fs:write-user',
      grant: 'prompt',
      consent: {
        key: 'extensionConsent.permission.fsWriteUser',
        text: 'Write files you select with the system file picker.',
      },
      since: '0.1.0',
    },
  ],
  methods: {
    registerPanelType: { permission: 'ui:contribute-pane', fake: FAKE_DISPOSABLE },
    registerVerseDecorator: { permission: 'ui:verse-decorator', fake: FAKE_DISPOSABLE },
    updateVerseDecorations: { permission: 'ui:verse-decorator' },
    invalidateVerseDecorations: { permission: 'ui:verse-decorator' },
    registerVerseHover: { permission: 'ui:verse-hover', fake: FAKE_DISPOSABLE },
    listThemeColorKeys: { permission: null, fake: fakeReturns([]) },
    registerContextMenu: { permission: 'ui:context-menu', fake: FAKE_DISPOSABLE },
    registerStatusBarItem: { permission: 'ui:status-bar', fake: FAKE_DISPOSABLE },
    updateStatusBarItem: { permission: 'ui:status-bar' },
    showNotification: { permission: 'ui:notification' },
    showQuickPick: { permission: null },
    showInputBox: { permission: null },
    showConfirm: { permission: null, fake: fakeReturns(false) },
    pickFile: { permission: 'fs:read-user' },
    saveFile: { permission: 'fs:write-user', fake: fakeReturns(false) },
    openSettings: { permission: null },
  },
  wire: {
    dispose: { permission: null, serves: 'every DisposableHandle returned by a ui.register* method' },
  },
  activationEvents: [
    {
      event: 'onView:',
      fired: true,
      description: 'Activate when the named panel type is opened (onView:<contentType>).',
      since: '0.1.0',
    },
  ],
  contributes: [
    {
      key: 'panelTypes',
      description: 'Panel types the extension adds to the app.',
      since: '0.1.0',
    },
  ],
});
