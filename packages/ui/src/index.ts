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
export { defaultFormatRef, sectionVar, sectionVarOfVerse } from './components/xref/common';
export type { FormatRef } from './components/xref/common';
export { XrefHopper, DEFAULT_XREF_HOPPER_LABELS } from './components/xref/XrefHopper';
export type { XrefHopperProps, XrefHopperLabels } from './components/xref/XrefHopper';
export { XrefWebView, DEFAULT_XREF_WEB_LABELS } from './components/xref/XrefWebView';
export type { XrefWebViewProps, XrefWebViewLabels } from './components/xref/XrefWebView';
export { XrefCompassView, DEFAULT_XREF_COMPASS_LABELS } from './components/xref/XrefCompassView';
export type { XrefCompassViewProps, XrefCompassLabels } from './components/xref/XrefCompassView';
export { useXrefFullscreen } from './components/xref/fullscreen';
export { XrefArcView, DEFAULT_XREF_ARCS_LABELS } from './components/xref/XrefArcView';
export type { XrefArcViewProps, XrefArcViewLabels } from './components/xref/XrefArcView';
export { Popover } from './components/Popover';
export type { PopoverProps } from './components/Popover';
export { HoverCard } from './components/HoverCard';
export type { HoverCardProps } from './components/HoverCard';
export { BottomSheet, DEFAULT_BOTTOM_SHEET_LABELS } from './components/BottomSheet';
export type { BottomSheetProps, BottomSheetLabels } from './components/BottomSheet';
export { FullscreenPanel, DEFAULT_FULLSCREEN_PANEL_LABELS } from './components/FullscreenPanel';
export type { FullscreenPanelProps, FullscreenPanelLabels } from './components/FullscreenPanel';
export { useHoverIntent } from './components/useHoverIntent';
export type { UseHoverIntentOptions } from './components/useHoverIntent';
export { SettingsForm, DEFAULT_SETTINGS_FORM_LABELS } from './components/SettingsForm';
export type { SettingsFormLabels, SettingsFormProps } from './components/SettingsForm';

export { MeasurePopup, DEFAULT_MEASURE_POPUP_LABELS } from './components/MeasurePopup';
export type { MeasurePopupProps, MeasurePopupLabels } from './components/MeasurePopup';

export { AssetList, DEFAULT_ASSET_LIST_LABELS } from './components/AssetList';
export type { AssetListProps, AssetListLabels, AssetListRow, AssetListStatus } from './components/AssetList';

export { SimilarList, DEFAULT_SIMILAR_LIST_LABELS, similarityStep } from './components/Similar/SimilarList';
export type { SimilarListProps, SimilarListLabels, SimilarListRow } from './components/Similar/SimilarList';
