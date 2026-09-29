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
export { DEFAULT_WORD_STUDY_LABELS, fillTemplate } from './components/wordStudyLabels';
export type { WordStudyLabels } from './components/wordStudyLabels';
export { WordStudyHeader } from './components/WordStudyHeader';
export type { WordStudyHeaderProps } from './components/WordStudyHeader';
export { RenderingChart } from './components/RenderingChart';
export type { RenderingChartProps } from './components/RenderingChart';
export { BookDistributionStrip } from './components/BookDistributionStrip';
export type { BookDistributionStripProps } from './components/BookDistributionStrip';
export { WordFamilyList } from './components/WordFamilyList';
export type { WordFamilyListProps } from './components/WordFamilyList';
export { SemanticRangeSummary } from './components/SemanticRangeSummary';
export type { SemanticRangeSummaryProps } from './components/SemanticRangeSummary';
export { OccurrenceRow, highlightWords } from './components/OccurrenceRow';
export type { OccurrenceRowProps } from './components/OccurrenceRow';
export { WordGroupEditor } from './components/WordGroupEditor';
export type { WordGroupEditorProps } from './components/WordGroupEditor';
export { WordStudyView } from './components/WordStudyView';
export type { WordStudyViewProps, WordStudyFilters } from './components/WordStudyView';
export { Popover } from './components/Popover';
export type { PopoverProps } from './components/Popover';
export { HoverCard } from './components/HoverCard';
export type { HoverCardProps } from './components/HoverCard';
export { BottomSheet, DEFAULT_BOTTOM_SHEET_LABELS } from './components/BottomSheet';
export type { BottomSheetProps, BottomSheetLabels } from './components/BottomSheet';
export { useHoverIntent } from './components/useHoverIntent';
export type { UseHoverIntentOptions } from './components/useHoverIntent';
export { SettingsForm, DEFAULT_SETTINGS_FORM_LABELS } from './components/SettingsForm';
export type { SettingsFormLabels, SettingsFormProps } from './components/SettingsForm';
