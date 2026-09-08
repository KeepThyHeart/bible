/**
 * Documentation content definitions. Pure data builder - takes the i18n `t`
 * function and returns the full ordered list of sections.
 */

import { DocSection, TFn } from './types';
import { getProductName } from '../../config/appConfig';

export function buildDocumentation(t: TFn): DocSection[] {
  // The product name is a build-time setting (BIBLE_PRODUCT_NAME), never a
  // translatable literal - see locales/GLOSSARY.md#product-name.
  const productName = getProductName();

  return [
  // -- Getting Started -------------------------------------------------
  {
    id: 'getting-started',
    title: t('documentationDialog.gettingStarted.title'),
    icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    content: [
      { type: 'paragraph', text: t('documentationDialog.gettingStarted.welcome', { productName }) },
      { type: 'heading', text: t('documentationDialog.gettingStarted.layoutHeading') },
      { type: 'paragraph', text: t('documentationDialog.gettingStarted.layoutIntro') },
      { type: 'list', items: [
        t('documentationDialog.gettingStarted.layoutItem1'),
        t('documentationDialog.gettingStarted.layoutItem2'),
      ]},
      { type: 'heading', text: t('documentationDialog.gettingStarted.firstStepsHeading') },
      { type: 'list', ordered: true, items: [
        t('documentationDialog.gettingStarted.firstStepsItem1'),
        t('documentationDialog.gettingStarted.firstStepsItem2'),
        t('documentationDialog.gettingStarted.firstStepsItem3'),
        t('documentationDialog.gettingStarted.firstStepsItem4'),
        t('documentationDialog.gettingStarted.firstStepsItem5'),
      ]},
      { type: 'heading', text: t('documentationDialog.gettingStarted.sessionsHeading') },
      { type: 'paragraph', text: t('documentationDialog.gettingStarted.sessionsBody') },
    ]
  },

  // -- Bible Pane ------------------------------------------------------
  {
    id: 'bible-pane',
    title: t('documentationDialog.biblePane.title'),
    icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    content: [
      { type: 'paragraph', text: t('documentationDialog.biblePane.intro') },
      { type: 'heading', text: t('documentationDialog.biblePane.navHeading') },
      { type: 'list', items: [
        t('documentationDialog.biblePane.navItem1'),
        t('documentationDialog.biblePane.navItem2'),
        t('documentationDialog.biblePane.navItem3'),
        t('documentationDialog.biblePane.navItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.biblePane.translationHeading') },
      { type: 'paragraph', text: t('documentationDialog.biblePane.translationBody') },
      { type: 'heading', text: t('documentationDialog.biblePane.displayModesHeading') },
      { type: 'paragraph', text: t('documentationDialog.biblePane.displayModesIntro') },
      { type: 'list', items: [
        t('documentationDialog.biblePane.displayModeSimple'),
        t('documentationDialog.biblePane.displayModeStandard'),
        t('documentationDialog.biblePane.displayModeStudy'),
      ]},
      { type: 'heading', text: t('documentationDialog.biblePane.parallelHeading') },
      { type: 'paragraph', text: t('documentationDialog.biblePane.parallelBody') },
      { type: 'heading', text: t('documentationDialog.biblePane.textSettingsHeading') },
      { type: 'paragraph', text: t('documentationDialog.biblePane.textSettingsIntro') },
      { type: 'list', items: [
        t('documentationDialog.biblePane.textSettingsItem1'),
        t('documentationDialog.biblePane.textSettingsItem2'),
        t('documentationDialog.biblePane.textSettingsItem3'),
        t('documentationDialog.biblePane.textSettingsItem4'),
      ]},
    ]
  },

  // -- Search ----------------------------------------------------------
  {
    id: 'search',
    title: t('documentationDialog.search.title'),
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    content: [
      { type: 'paragraph', text: t('documentationDialog.search.intro', { productName }) },
      { type: 'heading', text: t('documentationDialog.search.quickHeading') },
      { type: 'paragraph', text: t('documentationDialog.search.quickBody') },
      { type: 'list', items: [
        t('documentationDialog.search.quickItem1'),
        t('documentationDialog.search.quickItem2'),
        t('documentationDialog.search.quickItem3'),
        t('documentationDialog.search.quickItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.search.advancedHeading') },
      { type: 'paragraph', text: t('documentationDialog.search.advancedBody') },
      { type: 'list', items: [
        t('documentationDialog.search.advancedScope'),
        t('documentationDialog.search.advancedCase'),
        t('documentationDialog.search.advancedWholeWord'),
        t('documentationDialog.search.advancedFuzzy'),
        t('documentationDialog.search.advancedProximity'),
        t('documentationDialog.search.advancedAutoFuzzy'),
      ]},
      { type: 'heading', text: t('documentationDialog.search.resultsHeading') },
      { type: 'paragraph', text: t('documentationDialog.search.resultsBody') },
      { type: 'list', items: [
        t('documentationDialog.search.resultsItem1'),
        t('documentationDialog.search.resultsItem2'),
        t('documentationDialog.search.resultsItem3'),
        t('documentationDialog.search.resultsItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.search.savedHeading') },
      { type: 'paragraph', text: t('documentationDialog.search.savedBody') },
    ]
  },

  // -- Commentaries ----------------------------------------------------
  {
    id: 'commentaries',
    title: t('documentationDialog.commentaries.title'),
    icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
    content: [
      { type: 'paragraph', text: t('documentationDialog.commentaries.intro') },
      { type: 'heading', text: t('documentationDialog.commentaries.viewingHeading') },
      { type: 'list', items: [
        t('documentationDialog.commentaries.viewingItem1'),
        t('documentationDialog.commentaries.viewingItem2'),
        t('documentationDialog.commentaries.viewingItem3'),
      ]},
      { type: 'heading', text: t('documentationDialog.commentaries.navHeading') },
      { type: 'list', items: [
        t('documentationDialog.commentaries.navItem1'),
        t('documentationDialog.commentaries.navItem2'),
        t('documentationDialog.commentaries.navItem3'),
      ]},
      { type: 'heading', text: t('documentationDialog.commentaries.managingHeading') },
      { type: 'paragraph', text: t('documentationDialog.commentaries.managingBody') },
    ]
  },

  // -- Highlights & Annotations ----------------------------------------
  {
    id: 'highlights',
    title: t('documentationDialog.highlights.title'),
    icon: 'M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z',
    content: [
      { type: 'paragraph', text: t('documentationDialog.highlights.intro') },
      { type: 'heading', text: t('documentationDialog.highlights.highlightingHeading') },
      { type: 'list', ordered: true, items: [
        t('documentationDialog.highlights.highlightingItem1'),
        t('documentationDialog.highlights.highlightingItem2'),
        t('documentationDialog.highlights.highlightingItem3'),
        t('documentationDialog.highlights.highlightingItem4'),
      ]},
      { type: 'tip', text: t('documentationDialog.highlights.tip') },
      { type: 'heading', text: t('documentationDialog.highlights.removingHeading') },
      { type: 'paragraph', text: t('documentationDialog.highlights.removingBody') },
      { type: 'heading', text: t('documentationDialog.highlights.colorsHeading') },
      { type: 'paragraph', text: t('documentationDialog.highlights.colorsBody') },
    ]
  },

  // -- Bookmarks -------------------------------------------------------
  {
    id: 'bookmarks',
    title: t('documentationDialog.bookmarks.title'),
    icon: 'M6 4a2 2 0 012-2h8a2 2 0 012 2v17l-6-4.5L6 21V4z',
    content: [
      { type: 'paragraph', text: t('documentationDialog.bookmarks.intro') },
      { type: 'heading', text: t('documentationDialog.bookmarks.savingHeading') },
      { type: 'list', ordered: true, items: [
        t('documentationDialog.bookmarks.savingItem1'),
        t('documentationDialog.bookmarks.savingItem2'),
        t('documentationDialog.bookmarks.savingItem3'),
      ]},
      { type: 'heading', text: t('documentationDialog.bookmarks.namingHeading') },
      { type: 'paragraph', text: t('documentationDialog.bookmarks.namingBody') },
      { type: 'heading', text: t('documentationDialog.bookmarks.movingHeading') },
      { type: 'paragraph', text: t('documentationDialog.bookmarks.movingBody') },
      { type: 'heading', text: t('documentationDialog.bookmarks.managingHeading') },
      { type: 'paragraph', text: t('documentationDialog.bookmarks.managingBody') },
      { type: 'tip', text: t('documentationDialog.bookmarks.tip') },
    ]
  },

  // -- Notes -----------------------------------------------------------
  {
    id: 'notes',
    title: t('documentationDialog.notes.title'),
    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    content: [
      { type: 'paragraph', text: t('documentationDialog.notes.intro') },
      { type: 'heading', text: t('documentationDialog.notes.verseNotesHeading') },
      { type: 'paragraph', text: t('documentationDialog.notes.verseNotesBody') },
      { type: 'list', items: [
        t('documentationDialog.notes.verseNotesItem1'),
        t('documentationDialog.notes.verseNotesItem2'),
        t('documentationDialog.notes.verseNotesItem3'),
        t('documentationDialog.notes.verseNotesItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.notes.documentsHeading') },
      { type: 'paragraph', text: t('documentationDialog.notes.documentsBody') },
      { type: 'list', items: [
        t('documentationDialog.notes.documentsItem1'),
        t('documentationDialog.notes.documentsItem2'),
        t('documentationDialog.notes.documentsItem3'),
        t('documentationDialog.notes.documentsItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.notes.journalHeading') },
      { type: 'paragraph', text: t('documentationDialog.notes.journalBody') },
      { type: 'heading', text: t('documentationDialog.notes.editorHeading') },
      { type: 'paragraph', text: t('documentationDialog.notes.editorIntro') },
      { type: 'list', items: [
        t('documentationDialog.notes.editorItem1'),
        t('documentationDialog.notes.editorItem2'),
        t('documentationDialog.notes.editorItem3'),
        t('documentationDialog.notes.editorItem4'),
        t('documentationDialog.notes.editorItem5'),
        t('documentationDialog.notes.editorItem6'),
      ]},
    ]
  },

  // -- Prayer Lists ----------------------------------------------------
  {
    id: 'prayer',
    title: t('documentationDialog.prayer.title'),
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
    content: [
      { type: 'paragraph', text: t('documentationDialog.prayer.intro') },
      { type: 'heading', text: t('documentationDialog.prayer.managingHeading') },
      { type: 'list', items: [
        t('documentationDialog.prayer.managingItem1'),
        t('documentationDialog.prayer.managingItem2'),
        t('documentationDialog.prayer.managingItem3'),
      ]},
      { type: 'heading', text: t('documentationDialog.prayer.itemsHeading') },
      { type: 'list', items: [
        t('documentationDialog.prayer.itemsItem1'),
        t('documentationDialog.prayer.itemsItem2'),
        t('documentationDialog.prayer.itemsItem3'),
        t('documentationDialog.prayer.itemsItem4'),
        t('documentationDialog.prayer.itemsItem5'),
      ]},
      { type: 'tip', text: t('documentationDialog.prayer.tip') },
    ]
  },

  // -- Dictionaries & Lexicons -----------------------------------------
  {
    id: 'dictionaries',
    title: t('documentationDialog.dictionaries.title'),
    icon: 'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129',
    content: [
      { type: 'paragraph', text: t('documentationDialog.dictionaries.intro') },
      { type: 'heading', text: t('documentationDialog.dictionaries.usingHeading') },
      { type: 'list', items: [
        t('documentationDialog.dictionaries.usingItem1'),
        t('documentationDialog.dictionaries.usingItem2'),
        t('documentationDialog.dictionaries.usingItem3'),
        t('documentationDialog.dictionaries.usingItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.dictionaries.strongsHeading') },
      { type: 'paragraph', text: t('documentationDialog.dictionaries.strongsBody') },
      { type: 'list', items: [
        t('documentationDialog.dictionaries.strongsItem1'),
        t('documentationDialog.dictionaries.strongsItem2'),
        t('documentationDialog.dictionaries.strongsItem3'),
      ]},
      { type: 'heading', text: t('documentationDialog.dictionaries.occurrencesHeading') },
      { type: 'paragraph', text: t('documentationDialog.dictionaries.occurrencesBody') },
    ]
  },

  // -- Study Mode & Interlinear ----------------------------------------
  {
    id: 'study-mode',
    title: t('documentationDialog.studyMode.title'),
    icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    content: [
      { type: 'paragraph', text: t('documentationDialog.studyMode.intro') },
      { type: 'heading', text: t('documentationDialog.studyMode.enablingHeading') },
      { type: 'paragraph', text: t('documentationDialog.studyMode.enablingBody') },
      { type: 'heading', text: t('documentationDialog.studyMode.interlinearHeading') },
      { type: 'paragraph', text: t('documentationDialog.studyMode.interlinearIntro') },
      { type: 'list', items: [
        t('documentationDialog.studyMode.interlinearItem1'),
        t('documentationDialog.studyMode.interlinearItem2'),
        t('documentationDialog.studyMode.interlinearItem3'),
        t('documentationDialog.studyMode.interlinearItem4'),
        t('documentationDialog.studyMode.interlinearItem5'),
      ]},
      { type: 'heading', text: t('documentationDialog.studyMode.morphologyHeading') },
      { type: 'paragraph', text: t('documentationDialog.studyMode.morphologyIntro') },
      { type: 'list', items: [
        t('documentationDialog.studyMode.morphBlue'),
        t('documentationDialog.studyMode.morphGreen'),
        t('documentationDialog.studyMode.morphPurple'),
        t('documentationDialog.studyMode.morphOrange'),
      ]},
      { type: 'heading', text: t('documentationDialog.studyMode.xrefHeading') },
      { type: 'paragraph', text: t('documentationDialog.studyMode.xrefBody') },
    ]
  },

  // -- Copy & Export ---------------------------------------------------
  {
    id: 'copy-export',
    title: t('documentationDialog.copyExport.title'),
    icon: 'M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3',
    content: [
      { type: 'paragraph', text: t('documentationDialog.copyExport.intro', { productName }) },
      { type: 'heading', text: t('documentationDialog.copyExport.copyingHeading') },
      { type: 'list', items: [
        t('documentationDialog.copyExport.copyingItem1'),
        t('documentationDialog.copyExport.copyingItem2'),
        t('documentationDialog.copyExport.copyingItem3'),
      ]},
      { type: 'heading', text: t('documentationDialog.copyExport.formatHeading') },
      { type: 'paragraph', text: t('documentationDialog.copyExport.formatIntro') },
      { type: 'list', items: [
        t('documentationDialog.copyExport.formatItem1'),
        t('documentationDialog.copyExport.formatItem2'),
        t('documentationDialog.copyExport.formatItem3'),
        t('documentationDialog.copyExport.formatItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.copyExport.exportingHeading') },
      { type: 'paragraph', text: t('documentationDialog.copyExport.exportingBody') },
      { type: 'heading', text: t('documentationDialog.copyExport.backupHeading') },
      { type: 'paragraph', text: t('documentationDialog.copyExport.backupBody') },
    ]
  },

  // -- Module Manager --------------------------------------------------
  {
    id: 'module-manager',
    title: t('documentationDialog.moduleManager.title'),
    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
    content: [
      { type: 'paragraph', text: t('documentationDialog.moduleManager.intro') },
      { type: 'heading', text: t('documentationDialog.moduleManager.openingHeading') },
      { type: 'paragraph', text: t('documentationDialog.moduleManager.openingBody') },
      { type: 'heading', text: t('documentationDialog.moduleManager.installingHeading') },
      { type: 'list', items: [
        t('documentationDialog.moduleManager.installingItem1'),
        t('documentationDialog.moduleManager.installingItem2'),
        t('documentationDialog.moduleManager.installingItem3'),
        t('documentationDialog.moduleManager.installingItem4'),
        t('documentationDialog.moduleManager.installingItem5'),
      ]},
      { type: 'heading', text: t('documentationDialog.moduleManager.managingHeading') },
      { type: 'list', items: [
        t('documentationDialog.moduleManager.managingItem1'),
        t('documentationDialog.moduleManager.managingItem2'),
        t('documentationDialog.moduleManager.managingItem3'),
        t('documentationDialog.moduleManager.managingItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.moduleManager.fromFileHeading') },
      { type: 'paragraph', text: t('documentationDialog.moduleManager.fromFileBody') },
    ]
  },

  // -- Keyboard Shortcuts ----------------------------------------------
  {
    id: 'keyboard-shortcuts',
    title: t('documentationDialog.shortcuts.title'),
    icon: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8',
    content: [
      { type: 'paragraph', text: t('documentationDialog.shortcuts.intro') },
      { type: 'heading', text: t('documentationDialog.shortcuts.navHeading') },
      { type: 'shortcut-table', rows: [
        ['Alt + Left', t('documentationDialog.shortcuts.prevChapter')],
        ['Alt + Right', t('documentationDialog.shortcuts.nextChapter')],
        ['Ctrl + K', t('documentationDialog.shortcuts.focusSearch')],
        ['Ctrl + G', t('documentationDialog.shortcuts.goToRef')],
      ]},
      { type: 'heading', text: t('documentationDialog.shortcuts.editingHeading') },
      { type: 'shortcut-table', rows: [
        ['Ctrl + C', t('documentationDialog.shortcuts.copyText')],
        ['Ctrl + F', t('documentationDialog.shortcuts.findInPane')],
        ['Escape', t('documentationDialog.shortcuts.closeDialog')],
      ]},
      { type: 'heading', text: t('documentationDialog.shortcuts.viewHeading') },
      { type: 'shortcut-table', rows: [
        ['Ctrl + 0', t('documentationDialog.shortcuts.resetZoom')],
        ['Ctrl + Plus', t('documentationDialog.shortcuts.zoomIn')],
        ['Ctrl + Minus', t('documentationDialog.shortcuts.zoomOut')],
        ['Ctrl + /', t('documentationDialog.shortcuts.showShortcuts')],
      ]},
      { type: 'heading', text: t('documentationDialog.shortcuts.appHeading') },
      { type: 'shortcut-table', rows: [
        ['Ctrl + ,', t('documentationDialog.shortcuts.openPrefs')],
        ['Ctrl + Shift + I', t('documentationDialog.shortcuts.toggleDevtools')],
      ]},
      { type: 'tip', text: t('documentationDialog.shortcuts.macTip') },
    ]
  },

  // -- Tips & Tricks ---------------------------------------------------
  {
    id: 'tips',
    title: t('documentationDialog.tips.title'),
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    content: [
      { type: 'paragraph', text: t('documentationDialog.tips.intro', { productName }) },
      { type: 'heading', text: t('documentationDialog.tips.navHeading') },
      { type: 'list', items: [
        t('documentationDialog.tips.navItem1'),
        t('documentationDialog.tips.navItem2'),
        t('documentationDialog.tips.navItem3'),
      ]},
      { type: 'heading', text: t('documentationDialog.tips.workflowHeading') },
      { type: 'list', items: [
        t('documentationDialog.tips.workflowItem1'),
        t('documentationDialog.tips.workflowItem2'),
        t('documentationDialog.tips.workflowItem3'),
        t('documentationDialog.tips.workflowItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.tips.organizationHeading') },
      { type: 'list', items: [
        t('documentationDialog.tips.organizationItem1'),
        t('documentationDialog.tips.organizationItem2'),
        t('documentationDialog.tips.organizationItem3'),
        t('documentationDialog.tips.organizationItem4'),
      ]},
      { type: 'heading', text: t('documentationDialog.tips.safetyHeading') },
      { type: 'list', items: [
        t('documentationDialog.tips.safetyItem1'),
        t('documentationDialog.tips.safetyItem2'),
        t('documentationDialog.tips.safetyItem3'),
      ]},
    ]
  },
  ];
}
