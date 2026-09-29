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
export { MarkStylePicker, DEFAULT_MARK_STYLE_PICKER_LABELS } from './components/MarkStylePicker';
export type { MarkStylePickerLabels, MarkStylePickerProps } from './components/MarkStylePicker';
export { KeywordLegend, DEFAULT_KEYWORD_LEGEND_LABELS } from './components/KeywordLegend';
export type { KeywordLegendLabels, KeywordLegendProps, LegendRow, LegendSuggestion } from './components/KeywordLegend';
export { KeywordMarkEditor, DEFAULT_KEYWORD_MARK_EDITOR_LABELS } from './components/KeywordMarkEditor';
export type { KeywordMarkEditorLabels, KeywordMarkEditorProps, KeywordMarkEditorField } from './components/KeywordMarkEditor';
export { markCssColor } from './components/markStyle';
