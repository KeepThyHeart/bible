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
export { TimelineView } from './components/Timeline/TimelineView';
export type { TimelineViewProps } from './components/Timeline/TimelineView';
export { TimelineItemCard } from './components/Timeline/TimelineItemCard';
export type { TimelineItemCardProps } from './components/Timeline/TimelineItemCard';
export { TimelinePanel } from './components/Timeline/TimelinePanel';
export type { TimelinePanelProps } from './components/Timeline/TimelinePanel';
export { useTimelineStore } from './components/Timeline/useTimelineStore';
export {
  DEFAULT_TIMELINE_VIEW_LABELS,
  DEFAULT_TIMELINE_ITEM_CARD_LABELS,
  DEFAULT_TIMELINE_PANEL_LABELS,
  DEFAULT_TIMELINE_KIND_LABELS,
  defaultFormatReference,
} from './components/Timeline/labels';
export type { TimelineViewLabels, TimelineItemCardLabels, TimelinePanelLabels } from './components/Timeline/labels';
