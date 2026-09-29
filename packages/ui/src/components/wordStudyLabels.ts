/**
 * Labels for the word study components. Every string is a prop with an English default; templates use `{name}`
 * placeholders filled by `fillTemplate` (no plural logic: phrase the template so it reads for any count).
 */
export interface WordStudyLabels {
  lookupLabel: string;
  lookupPlaceholder: string;
  lookupSubmit: string;
  candidatesTitle: string;
  loading: string;
  /** `{occurrences}`, `{verses}` */
  totals: string;
  /** `{strongs}` */
  strongsNumber: string;
  moduleLabel: string;
  searchAll: string;
  openInDictionary: string;
  noticeNoModule: string;
  noticeNotTagged: string;
  noticeNoOccurrences: string;
  renderingsTitle: string;
  formsTitle: string;
  /** `{count}` = number of rolled-up entries */
  other: string;
  modeGroup: string;
  modeHead: string;
  modePhrase: string;
  clearFilter: string;
  bookDistributionTitle: string;
  familyTitle: string;
  relationSelf: string;
  relationParent: string;
  relationChild: string;
  relationRelated: string;
  semanticTitle: string;
  /** `{list}` */
  lexiconRenderings: string;
  occurrencesTitle: string;
  /** `{shown}`, `{total}` */
  showing: string;
  loadMore: string;
  noOccurrences: string;
  groupsTitle: string;
  newGroup: string;
  /** `{label}` */
  editGroupNamed: string;
  groupLabel: string;
  groupTerms: string;
  groupTermsHint: string;
  groupExclude: string;
  groupExcludeHint: string;
  groupStem: string;
  groupTermsRequired: string;
  save: string;
  cancel: string;
  delete: string;
}

export const DEFAULT_WORD_STUDY_LABELS: WordStudyLabels = {
  lookupLabel: 'Word to study',
  lookupPlaceholder: 'G25, agapao, or love, loved, lov*',
  lookupSubmit: 'Study',
  candidatesTitle: 'Did you mean',
  loading: 'Loading...',
  totals: '{occurrences} occurrences in {verses} verses',
  strongsNumber: "Strong's {strongs}",
  moduleLabel: 'Translation',
  searchAll: 'Search all',
  openInDictionary: 'Open in dictionary',
  noticeNoModule: 'No suitable Bible is installed for this study.',
  noticeNotTagged: "This translation has no Strong's tagging. Pick another translation.",
  noticeNoOccurrences: 'No occurrences found in this translation.',
  renderingsTitle: 'How it is rendered',
  formsTitle: 'Forms found',
  other: 'Other ({count})',
  modeGroup: 'Group by',
  modeHead: 'Main word',
  modePhrase: 'Full phrase',
  clearFilter: 'Show all',
  bookDistributionTitle: 'Where it occurs',
  familyTitle: 'Word family',
  relationSelf: 'This word',
  relationParent: 'Root',
  relationChild: 'Derived',
  relationRelated: 'Related',
  semanticTitle: 'Range of meaning',
  lexiconRenderings: "Strong's lists: {list}",
  occurrencesTitle: 'Occurrences',
  showing: 'Showing {shown} of {total}',
  loadMore: 'Load more',
  noOccurrences: 'No occurrences to show.',
  groupsTitle: 'Word groups',
  newGroup: 'New group',
  editGroupNamed: 'Edit {label}',
  groupLabel: 'Name',
  groupTerms: 'Words',
  groupTermsHint: 'One per line or comma-separated. lov* matches any word starting with "lov"; =loved matches that exact form only; "loving kindness" matches a phrase.',
  groupExclude: 'Never match',
  groupExcludeHint: 'Forms to skip, e.g. lovely.',
  groupStem: 'Use stemming for this language',
  groupTermsRequired: 'Enter at least one word.',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
};

/** Replace `{name}` placeholders; unknown names are left as written. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

export function mergeWordStudyLabels(labels?: Partial<WordStudyLabels>): WordStudyLabels {
  return labels ? { ...DEFAULT_WORD_STUDY_LABELS, ...labels } : DEFAULT_WORD_STUDY_LABELS;
}
