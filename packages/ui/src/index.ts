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
export { defaultFormatRef, sectionVar, sectionVarOfVerse } from './components/xref/common';
export type { FormatRef } from './components/xref/common';
export { XrefHopper, DEFAULT_XREF_HOPPER_LABELS } from './components/xref/XrefHopper';
export type { XrefHopperProps, XrefHopperLabels } from './components/xref/XrefHopper';
export { XrefWebView, DEFAULT_XREF_WEB_LABELS } from './components/xref/XrefWebView';
export type { XrefWebViewProps, XrefWebViewLabels } from './components/xref/XrefWebView';
export { XrefArcView, DEFAULT_XREF_ARCS_LABELS } from './components/xref/XrefArcView';
export type { XrefArcViewProps, XrefArcViewLabels } from './components/xref/XrefArcView';
