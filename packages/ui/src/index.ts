// Barrel: export components and hooks only (never tests).
export { BookChapterPicker, DEFAULT_BOOK_CHAPTER_PICKER_LABELS } from './components/BookChapterPicker';
export type {
  BookChapterPickerLabels,
  BookChapterPickerProps,
  BookChapterPickerSearch,
  ReferenceSyntax,
} from './components/BookChapterPicker';
export { parseReference, filterBooks, getBookFilterText } from './components/bookReference';
export type { ParsedReference, ReferenceLookup } from './components/bookReference';
export { ReferencePicker, DEFAULT_REFERENCE_PICKER_LABELS } from './components/ReferencePicker';
export type { ReferencePickerLabels, ReferencePickerProps } from './components/ReferencePicker';
export { parseReferenceInput, suggestBooks } from './components/referenceInput';
export type { ReferenceValue, ReferenceInputOptions, ParseReferenceInputResult, BookSuggestion } from './components/referenceInput';
export { HighlightSwatch, DEFAULT_HIGHLIGHT_SWATCH_LABELS } from './components/HighlightSwatch';
export type { HighlightSwatchLabels, HighlightSwatchProps, HighlightSwatchValue } from './components/HighlightSwatch';
export { ExtensionPanelHost } from './components/ExtensionPanelHost';
export type { ExtensionPanelHostProps } from './components/ExtensionPanelHost';

// Genealogy explorer (task 0067). Layouts are computed by the app and passed in; nothing here imports them.
export { GenealogyView, DEFAULT_GENEALOGY_VIEW_LABELS } from './components/Genealogy/GenealogyView';
export type { GenealogyViewProps, GenealogyViewLabels, GenealogyViewport } from './components/Genealogy/GenealogyView';
export { PersonCard, DEFAULT_PERSON_CARD_LABELS } from './components/Genealogy/PersonCard';
export type { PersonCardProps, PersonCardLabels } from './components/Genealogy/PersonCard';
export { PersonSearch, DEFAULT_PERSON_SEARCH_LABELS } from './components/Genealogy/PersonSearch';
export type { PersonSearchProps, PersonSearchLabels } from './components/Genealogy/PersonSearch';
export { TribeLegend, DEFAULT_TRIBE_LEGEND_LABELS } from './components/Genealogy/TribeLegend';
export type { TribeLegendProps, TribeLegendLabels } from './components/Genealogy/TribeLegend';
export { LineageCompare, DEFAULT_LINEAGE_COMPARE_LABELS } from './components/Genealogy/LineageCompare';
export type { LineageCompareProps, LineageCompareLabels } from './components/Genealogy/LineageCompare';
export { GenealogyExplorer, DEFAULT_GENEALOGY_EXPLORER_LABELS } from './components/Genealogy/GenealogyExplorer';
export type { GenealogyExplorerProps, GenealogyExplorerLabels } from './components/Genealogy/GenealogyExplorer';
export { labelVisible, nearestInDirection, shapeOf } from './components/Genealogy/geometry';
