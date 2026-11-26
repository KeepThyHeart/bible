/**
 * The reusable verse selector, injected into Memory by each host (design-r2 section 2b).
 *
 * Structural on purpose: `@bible/memory/ui` imports nothing from `@bible/*`, so these types mirror
 * `VerseSelectorProps` of `@bible/ui` without importing it. A host passes
 * `{ mount: mountVerseSelector }` as `MemoryUiOptions.verseSelector`.
 */

/** A valid selection: one verse, or an inclusive verse-id range. */
export interface VerseSelectionLike {
  verseId: number;
  endVerseId?: number;
  ref: string;
  wholeChapter?: boolean;
}

/** Looks up the preview text for a range; `null` when it cannot (the selector shows its own status). */
export type VerseTextLookupLike = (
  range: { verseId: number; endVerseId?: number },
  signal: AbortSignal,
) => Promise<readonly { verseId: number; text: string }[] | null>;

export interface VerseSelectorPortProps {
  id?: string;
  /** The only seed (uncontrolled): typed text such as "John 3:16". */
  initialReference?: string;
  /** Every valid change; `null` when the input is cleared or invalid. */
  onChange(selection: VerseSelectionLike | null): void;
  /** Enter with a valid selection. */
  onSubmit?(selection: VerseSelectionLike): void;
  /** Absent: no preview. */
  lookup?: VerseTextLookupLike;
  previewMaxVerses?: number;
  crossChapter?: boolean;
  wholeChapter?: boolean;
  locale?: string;
  dir?: 'ltr' | 'rtl';
  disabled?: boolean;
  autoFocus?: boolean;
  labels?: Record<string, string>;
}

export interface VerseSelectorHandle {
  update(props: Partial<VerseSelectorPortProps>): void;
  dispose(): void;
}

export interface VerseSelectorPort {
  mount(container: HTMLElement, props: VerseSelectorPortProps): VerseSelectorHandle;
}
