/**
 * Whether the Bible content is currently showing the interlinear spinner
 * *instead of* the verses.
 *
 * BibleContent renders that spinner as an exclusive branch — while it is up,
 * there is no `[data-verse-id]` node in the DOM at all. Two places need that
 * answer: BibleContent, to decide what to render, and BiblePane, whose
 * scroll-to-verse effect has nothing to measure until the verses are back.
 *
 * It lives here because the two used to spell the condition out separately and
 * the copies disagreed (the pane omitted `studyShowInterlinear`), so the pane
 * would scroll against a DOM holding a spinner and silently do nothing — the
 * "typing John 3:16 only scrolls on the second try" bug.
 */
export function isInterlinearPending(
  displayMode: string,
  studyShowInterlinear: boolean,
  interlinearLoading: boolean | undefined,
): boolean {
  return displayMode === 'study' && studyShowInterlinear && !!interlinearLoading;
}
