/**
 * The exercise runner.
 *
 * Everything else in this panel is a list. This is the part the extension is
 * actually for, and almost every decision in it was made deliberately rather
 * than inherited from a component library, so they are all written down here.
 *
 * LAYOUT. The passage is rendered once, as real scripture, and the exercise
 * happens *inside it*. A blank is an input sitting where its word sits, in its
 * own poetic line; a first-letter slot is the same. There is no answer box
 * below the passage. That arrangement was rejected explicitly, and it is worth
 * being clear about why it is worse than it looks: an answer box detaches what
 * you are typing from the line it belongs to, so the user reads the line, then
 * looks away to type, and the thing being trained - producing the next word
 * while looking at its context - never happens.
 *
 * WIDTHS. Every hidden word is sized to the *measured* width of the word it
 * hides (see `measure.ts`), so revealing it does not move anything. Overtyping
 * grows the input, which can push the rest of that line along; it never
 * repaginates the passage, because the input never gets narrower and the
 * surrounding blocks never change height for a single wrapped line.
 *
 * FEEDBACK. Wrong answers are red with a ✗ beside them, never struck through.
 * Striking through scripture was ruled out, and the reason is a good one - the
 * user's mistake gets a mark, but the words of the verse are not defaced.
 *
 * BLOCKING vs ADVANCING. The picker blocks: a wrong pick is marked so you can
 * see which one you clicked, and the same step comes back. The mark is
 * transient by design - it says "not that one", it does not keep a tally on
 * screen, and it is gone before the retry. The typed exercises do not block;
 * they show what was missed and move on.
 *
 * ## v1: one hidden-word mechanic, two answer modes
 *
 * `blanks` and `firstletters` used to be built out of two unrelated pieces of
 * code - one that showed the initial as a spoiler and asked you to retype it,
 * and one that asked for a whole word behind a Check button. Task 0004's
 * review called the first one out as a bug ("the first letters shouldn't be
 * visible") and asked for the two activities to differ only in *how many*
 * words are hidden, never in *how* a hidden word is answered. So there is now
 * one mechanic, `buildHiddenWordRenderer`, driven by `Step.answerMode`:
 *
 *   - `firstLetter` (the default) - a one-character box per hidden word, never
 *     pre-filled with anything. A correct letter reveals the whole word and
 *     moves on automatically; there is no Check button because there is
 *     nothing left to confirm once every box is resolved.
 *   - `fullWord` - a full-word box per hidden word, graded leniently on
 *     spelling but not on the letters themselves, confirmed with Check - this
 *     is what all of `blanks` looked like in v0.
 */

import type {
  AnswerMode,
  BlanksStep,
  FirstLettersStep,
  OrderingStep,
  PassageContext,
  PassageView,
  RefMatchStep,
  RefProvideStep,
  Rung,
  SessionSummary,
  SessionView,
  StepAnswer,
  StepResult,
} from '../core/types';
import { append, button, clear, el, focusQuietly, replace, textNode } from './dom';
import { breadcrumb, errorBanner, iconButton, levelBoxes, tabs } from './components';
import {
  RUNG_LABEL,
  formatScore,
  formatStepProgress,
  inLadderOrder,
  matchesFirstLetter,
  pickDueTarget,
} from './format';
import type { PanelHost } from './host';
import type { Flow, NavAction } from './state';
import { plainWord, renderPassage } from './scripture';
import type { WordRenderer } from './scripture';
import { resolveWrongPositions, revealedWord } from './stepResult';
import type { HiddenWords } from './stepResult';
import { tierLabel } from '../core/ladder';
import { tr, uiLocale } from './i18n';
import { listTargets, pickShuffledTarget } from './suggest';

/** How long a wrong pick stays marked before the picker is handed back clean. */
const WRONG_MARK_MS = 1400;

/** How long a correct pick shows as correct before the next step replaces it. */
const CORRECT_FLASH_MS = 420;

export class PracticeView {
  readonly root: HTMLElement;

  private readonly headEl: HTMLElement;
  private readonly contextEl: HTMLElement;
  private readonly exerciseEl: HTMLElement;
  private readonly feedbackEl: HTMLElement;
  private readonly actionsEl: HTMLElement;

  private session: SessionView;
  private context: PassageContext | null = null;
  private summary: SessionSummary | null = null;

  /**
   * The passage's own ladder, fetched alongside `loadContext` - see
   * `loadPassageView`. Only the chrome (`renderHead`'s tab strip and tier
   * text) ever reads it; it never touches `contextEl`/`exerciseEl`, so unlike
   * `renderContext` it needs no `this.interacted` guard for a late arrival.
   */
  private passageView: PassageView | null = null;

  /** Guards against a second submission while one is in flight. */
  private busy = false;

  /**
   * Guards against a second tab/shuffle click while one switch (end the
   * current session, then start the next) is already in flight. Never reset
   * back to `false`: once a switch has begun, `host.startSession` will - in
   * the real panel - replace this view outright, so there is nothing to
   * re-enable.
   */
  private switchingActivity = false;

  /**
   * True once the user has touched the current step.
   *
   * Context arrives after the first paint (see `loadContext`), and slotting it
   * in means rebuilding the passage - which destroys the very inputs the user
   * may already be typing into. On a slow first fetch that is a whole verse of
   * work thrown away for a cosmetic improvement. So the late arrival is only
   * applied to an untouched step; otherwise it waits for the next one.
   */
  private interacted = false;
  private disposed = false;
  private readonly timers = new Set<number>();

  constructor(
    private readonly host: PanelHost,
    session: SessionView,
    /**
     * The flow this session belongs to (`state.ts#Flow`). Only a non-`passage`
     * flow shows the Next skip button. Defaults to the session's own passage.
     */
    private readonly flow: Flow = { kind: 'passage', passageId: session.passageId },
  ) {
    this.session = session;

    this.headEl = el('header', { class: 'sm-practice-head' });
    this.contextEl = el('div', { class: 'sm-context' });
    this.exerciseEl = el('div', { class: 'sm-exercise' });

    // `aria-live` on a region that is ALWAYS present, never created on demand:
    // a live region inserted at the same moment as its text is frequently not
    // announced at all, because the announcement is triggered by a mutation
    // inside an existing region. It also holds its own minimum height so the
    // passage does not jump when a verdict appears.
    this.feedbackEl = el('div', {
      class: 'sm-feedback',
      attrs: { 'aria-live': 'assertive', role: 'status' },
    });
    this.actionsEl = el('div', { class: 'sm-exercise-actions' });

    this.root = el('section', { class: 'sm-screen sm-practice' }, [
      this.headEl,
      this.contextEl,
      this.exerciseEl,
      this.feedbackEl,
      this.actionsEl,
    ]);
  }

  /**
   * Attaches to the document and draws.
   *
   * Mounting is a method rather than something the caller does with `.root`
   * because width measurement needs a laid-out element: `getComputedStyle` on
   * a detached node returns nothing useful, and a blank measured before mount
   * gets the fallback estimate instead of the real font. Owning the moment of
   * insertion means the measure pass can be guaranteed to run after it.
   */
  mount(container: HTMLElement): void {
    container.appendChild(this.root);
    this.render();
    void this.loadContext();
    void this.loadPassageView();
  }

  destroy(): void {
    this.disposed = true;
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    this.root.remove();
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  /**
   * Fetches the surrounding verses.
   *
   * Deliberately not awaited before the first paint. The step itself carries
   * everything needed to start answering, and blocking the exercise behind a
   * context fetch would put a spinner between the user and the thing they
   * pressed a button to do. Context arrives and slots in above.
   */
  private async loadContext(): Promise<void> {
    const reply = await this.host.request({
      type: 'getContext',
      passageId: this.session.passageId,
    });
    if (this.disposed) return;
    if (!reply.ok) {
      // Not fatal: the exercise works without its surroundings, so this is
      // reported quietly rather than replacing the screen with an error.
      this.host.announce(reply.error);
      return;
    }
    this.context = reply.data;

    // The reference (`renderHead`'s title) comes from `this.context` alone -
    // see the header comment - and was otherwise stuck blank in the toolbar
    // until the next unrelated re-render (e.g. the first submitted answer),
    // since nothing here used to touch the head once context arrived. Safe
    // to redraw regardless of `interacted`: unlike `renderContext` below, it
    // never touches the exercise inputs the user may already be typing into.
    this.renderHead();
    if (this.interacted) return;

    this.renderContext();
    this.restoreExerciseFocus();
  }

  /**
   * Fetches the passage's own ladder, for the activity tab strip and the tier
   * label beside the activity name.
   *
   * Deliberately a second, independent request rather than folded into
   * `loadContext` - `getContext` and `getPassageView` answer different
   * questions and one failing must not take the other down with it. Like
   * `loadContext`'s own head redraw, this is safe to apply the moment it
   * arrives, `this.interacted` or not: `renderHead` never touches
   * `contextEl`/`exerciseEl`, so a late arrival here cannot clobber an input
   * the user is mid-typing into.
   */
  private async loadPassageView(): Promise<void> {
    const reply = await this.host.request({
      type: 'getPassageView',
      passageId: this.session.passageId,
    });
    if (this.disposed) return;
    if (!reply.ok) {
      this.host.announce(reply.error);
      return;
    }
    this.passageView = reply.data;
    this.renderHead();
  }

  /**
   * Puts the caret back after the passage has been rebuilt underneath it.
   *
   * Only reached on an untouched step, so "back" means the first slot - there
   * is no position to preserve, but there is a focus to not lose.
   */
  private restoreExerciseFocus(): void {
    focusQuietly(this.contextEl.querySelector<HTMLInputElement>('.sm-blank, .sm-fl'));
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(): void {
    this.renderHead();
    this.renderContext();
    this.renderExercise();
  }

  private renderHead(): void {
    const step = this.session.step;
    // `refmatch`/`refprovide`: the passage's own reference IS the answer being
    // asked for, so the passage crumb must not show it; a generic "Passage"
    // stands in. (The context is still loaded: `refProvideAnswer` needs it to
    // grade and to show the answer after the step.)
    const hidesReference = this.session.rung === 'refprovide' || this.session.rung === 'refmatch';
    const genericPassage = tr('memory.ui.practice.passage', 'Passage');
    const passageLabel = hidesReference ? genericPassage : (this.context?.reference || genericPassage);
    const passageId = this.session.passageId;
    const rung = this.session.rung;

    replace(this.headEl, [
      breadcrumb({
        // Home > passage > activity. Leaving mid-exercise is not "ending"
        // anything: the resume point is written to disk after every verse (see
        // `main.ts`), so going back picks up later. Each crumb ends the
        // session, then goes where it says.
        crumbs: [
          { label: tr('memory.ui.practice.home', 'Home'), onClick: () => void this.endSession({ type: 'goPlan' }) },
          { label: passageLabel, onClick: () => void this.endSession({ type: 'goPassage', passageId, rung }) },
          { label: RUNG_LABEL[rung] },
        ],
        actions: [
          step !== null
            ? el('span', { class: 'sm-crumbs-meta', text: formatStepProgress(step.stepNumber, step.totalSteps) })
            : null,
          // Only a flow with a rule to re-run has anywhere to skip to.
          this.flow.kind !== 'passage'
            ? button(tr('memory.ui.practice.next', 'Next'), () => void this.onNext(), {
                class: 'sm-btn sm-btn-quiet sm-btn-small',
                attrs: { 'aria-label': tr('memory.ui.practice.skipToNextPassage', 'Skip to the next passage') },
              })
            : null,
        ],
      }),
      el('div', { class: 'sm-practice-sub' }, [
        this.session.tiers > 1
          ? el('span', {
              class: 'sm-practice-tier',
              text: tr('memory.ui.practice.tierOf', '{label} (Tier {tier} of {tiers})', {
                label: tierLabel(this.session.rung, this.session.tier),
                tier: this.session.tier + 1,
                tiers: this.session.tiers,
              }),
            })
          : null,
        iconButton('🔀', tr('memory.ui.practice.shuffle', 'Shuffle - practise something else'), () => void this.shuffle()),
      ]),
      this.renderActivityTabs(),
      step !== null
        ? el('div', { class: 'sm-practice-progress' }, [
            el(
              'div',
              {
                class: 'sm-bar sm-bar-slim',
                attrs: {
                  role: 'progressbar',
                  'aria-valuemin': '0',
                  'aria-valuemax': String(Math.max(step.totalSteps, step.stepNumber)),
                  'aria-valuenow': String(step.stepNumber),
                },
              },
              [
                el('div', {
                  class: 'sm-bar-fill',
                  style: {
                    width: `${stepFraction(step.stepNumber, step.totalSteps) * 100}%`,
                  },
                }),
              ],
            ),
            el('span', {
              class: 'sm-step-tally',
              text: tr('memory.ui.practice.rightFirstTime', '{count} right first time', { count: this.session.correctFirst }),
            }),
          ])
        : null,
    ]);
  }

  /**
   * The step/tab strip: one tab per applicable activity on this passage, from
   * `this.passageView` (see `loadPassageView`). `null` - no strip at all -
   * until that fetch resolves, and also for a passage with only one
   * applicable activity: a strip with a single, unclickable tab would only
   * ever say "you are here, there is nowhere else to go" in a more
   * complicated way than showing nothing.
   *
   * The strip is drawn by `components.ts#tabs`, which marks the current tab
   * with `aria-selected`. It once used `aria-current="true"` rather than the more
   * usual `"step"` value the plan text names - `aria-current="step"` is
   * already this file's own vocabulary for the verse being worked on inside
   * the passage (`scripture.ts`'s `current` word renderer option), and a
   * second, unrelated element claiming the same value on the same screen
   * would break every test (and every screen reader query) that treats
   * `[aria-current="step"]` as identifying exactly one node.
   */
  private renderActivityTabs(): HTMLElement | null {
    if (this.passageView === null) return null;

    const applicable = inLadderOrder(this.passageView.rungs).filter((rv) => rv.applicable);
    if (applicable.length <= 1) return null;

    return tabs({
      items: applicable.map((rv) => ({ value: rv.rung, label: RUNG_LABEL[rv.rung] })),
      selected: this.session.rung,
      onSelect: (rung) => {
        if (rung !== this.session.rung) void this.switchActivity(this.session.passageId, rung);
      },
      ariaLabel: tr('memory.ui.practice.activitiesForPassage', 'Activities for this passage'),
    });
  }

  /**
   * Ends the current session and starts a different one, for the tab strip
   * and the shuffle button alike - both are "bail into something else mid-
   * screen", the only difference being whether the passage changes too.
   *
   * The old session is ended *before* the new one starts, and its reply is
   * not inspected - same reasoning as `endSession()` below: the resume point
   * for whatever was in progress is already on disk, and the user has already
   * committed to leaving. What matters here is the ORDER: ending first means
   * the old session id is never in flight at the same time as a new one, so
   * it can never be handed a stray submission after the switch.
   */
  private async switchActivity(passageId: number, rung: Rung): Promise<void> {
    if (this.disposed || this.switchingActivity) return;
    this.switchingActivity = true;

    await this.host.request({
      type: 'endSession',
      sessionId: this.session.sessionId,
    });
    if (this.disposed) return;

    void this.host.startSession(passageId, rung);
  }

  /**
   * The same shuffle the home screen offers (`planView.ts`), reached mid-
   * screen: re-fetches the plan (this view only ever held one passage's
   * worth of data) and hands it to `suggest.ts#pickShuffledTarget` - the one
   * shuffle implementation, not a second copy of its weighting.
   */
  private async shuffle(): Promise<void> {
    if (this.disposed || this.switchingActivity) return;

    const reply = await this.host.request({ type: 'getPlan' });
    if (this.disposed) return;
    if (!reply.ok) {
      this.host.announce(reply.error);
      return;
    }

    const now = this.host.now();
    const all = listTargets(reply.data, now);
    const current = all.find(
      (t) => t.passageId === this.session.passageId && t.rung === this.session.rung,
    );
    const others = current
      ? all.filter((t) => !(t.passageId === current.passageId && t.rung === current.rung))
      : all;
    if (others.length === 0) {
      this.host.announce(tr('memory.ui.practice.nothingElseToPractise', 'Nothing else to practise right now.'));
      return;
    }

    const target = pickShuffledTarget(reply.data, now, Math.random, current);
    if (target === null) {
      this.host.announce(tr('memory.ui.practice.nothingElseToPractise', 'Nothing else to practise right now.'));
      return;
    }
    void this.switchActivity(target.passageId, target.rung);
  }

  /**
   * Draws the scripture above the exercise.
   *
   * What counts as safe context depends entirely on the step, because for two
   * of the four kinds the surrounding text *is* the answer:
   *
   *   - ordering  - only the verses already placed. `PassageContext.verses`
   *     holds the whole passage including the one being guessed, so rendering
   *     it would print the answer directly above the picker.
   *   - refmatch  - the verse alone, and without its chapter:verse label,
   *     which would otherwise answer the question in the margin.
   *   - blanks / firstletters - the real passage, with the working verse
   *     highlighted. Here the surrounding verses give away nothing and are
   *     exactly the context that makes the exercise worth doing.
   *
   * `PassageContext.after` is empty during an exercise by design. Nothing is
   * rendered for it - no placeholder, no ellipsis, no empty bordered box that
   * reads as a failure to load.
   */
  private renderContext(): void {
    clear(this.contextEl);
    // The measurement list points at nodes that have just been discarded.
    // Left in place it would size elements that are no longer in the document,
    // which is harmless but hides real bugs behind writes that go nowhere.
    this.measured = [];
    this.interacted = false;
    const step = this.session.step;

    if (step === null) {
      this.contextEl.hidden = true;
      return;
    }
    this.contextEl.hidden = false;

    const before = this.context?.before ?? [];

    switch (step.kind) {
      case 'ordering':
        append(this.contextEl, renderPassage(before, () => ({ muted: true })));
        if (step.placed.length === 0 && before.length === 0) {
          this.contextEl.appendChild(
            el('p', {
              class: 'sm-context-note',
              text: tr('memory.ui.practice.startOfPassage', 'Start of the passage.'),
            }),
          );
        }
        append(this.contextEl, renderPassage(step.placed, () => ({})));
        break;

      case 'refmatch':
        // No `before`, no label: both would identify the verse.
        append(
          this.contextEl,
          renderPassage([step.verse], () => ({ current: true, showLabel: false })),
        );
        break;

      case 'refprovide':
        // The words ARE the given here - the whole point is supplying the
        // reference from them - so no label, same as `refmatch`.
        append(
          this.contextEl,
          renderPassage([step.verse], () => ({ current: true, showLabel: false })),
        );
        // The worker (`truncateForProvide`) already cut this at a word
        // boundary - never mid-word - when the verse ran long; this note only
        // says so, it never re-trims anything itself. See `RefProvideStep`'s
        // own doc comment on why the truncation decision belongs to the
        // worker, not the panel.
        if (step.truncatedPreview) {
          this.contextEl.appendChild(
            el('p', {
              class: 'sm-context-note',
              text: tr('memory.ui.practice.shownInPart', '… (shown in part - the reference is asked from what is given)'),
            }),
          );
        }
        break;

      case 'blanks':
        append(this.contextEl, renderPassage(before, () => ({ muted: true })));
        append(this.contextEl, this.renderBlanksPassage(step));
        break;

      case 'firstletters':
        append(this.contextEl, renderPassage(before, () => ({ muted: true })));
        append(
          this.contextEl,
          step.tier === 0 && this.firstLettersStartedFor !== step
            ? this.renderFirstLettersPreview(step)
            : this.renderWorkingPassage(step),
        );
        break;

      default:
        break;
    }

    this.applyMeasuredWidths();
  }

  /**
   * The passage with `step.verse` shown in full and unblanked - `firstletters`
   * tier 0 only, before "Start" is pressed (see `firstLettersStartedFor`).
   *
   * Easy tier shows the verse before asking for it back from memory, so the
   * recall being trained is "read it, then recite it" rather than "guess it
   * cold" - tier 1 skips straight to `renderWorkingPassage` for exactly the
   * opposite reason. Same verse-substitution as `renderWorkingPassage`: the
   * step's own copy stands in for whichever context verse shares its id, so
   * what is read here is exactly what gets hidden once the user presses
   * Start.
   */
  private renderFirstLettersPreview(step: FirstLettersStep): HTMLElement[] {
    const verses = this.context?.verses ?? [step.verse];
    const target = step.verse.verseId;
    return renderPassage(
      verses.map((v) => (v.verseId === target ? step.verse : v)),
      (verse) => (verse.verseId === target ? { current: true } : {}),
    );
  }

  /**
   * The passage with one verse made interactive - `firstletters` only.
   *
   * The interactive verse is rendered in its place inside the passage, not
   * lifted out of it. `verses` comes from the context when we have it and
   * falls back to the single verse the step carries, so the exercise is
   * playable in the window before the context request returns.
   */
  private renderWorkingPassage(step: FirstLettersStep): HTMLElement[] {
    const verses = this.context?.verses ?? [step.verse];
    const target = step.verse.verseId;
    const hidden = hiddenIndicesFor(step);
    const onAllResolved =
      step.answerMode === 'firstLetter'
        ? () => void this.submitHidden(step)
        : undefined;
    const renderWord = this.buildHiddenWordRenderer(hidden, step.answerMode, onAllResolved);

    return renderPassage(
      // Substituting the step's copy of the verse for the context's copy means
      // the word indices the exercise uses always match the words on screen,
      // even if the two arrived from different queries.
      verses.map((v) => (v.verseId === target ? step.verse : v)),
      (verse) =>
        verse.verseId === target
          ? { current: true, renderWord }
          : {},
    );
  }

  /**
   * The passage with `step.verses` made interactive - `blanks`, at any tier.
   *
   * At tier 0 this is a single verse, exactly like `renderWorkingPassage`
   * above; at tier 1 (see `session.ts`) `step.verses` is the whole passage, so
   * every verse in it becomes interactive at once. `this.hiddenCounter` gives
   * each hidden slot, across every verse, a running FLAT position matching the
   * exact order `StepAnswer.words` must be submitted in (`types.ts`'s own
   * documented contract: `step.blanks` in order, each entry's `indices` in
   * order) - `renderPassage` visits each verse's words in ascending order, so
   * counting hidden slots as they render produces that order for free.
   */
  private renderBlanksPassage(step: BlanksStep): HTMLElement[] {
    this.hiddenAnswers = [];
    this.hiddenPending = step.blanks.reduce((n, b) => n + b.indices.length, 0);
    this.hiddenInputs = [];
    this.hiddenCounter = 0;

    const interactive = new Set(step.verses.map((v) => v.verseId));
    const baseVerses = this.context?.verses ?? step.verses;
    const onAllResolved =
      step.answerMode === 'firstLetter' ? () => void this.submitBlanksHidden(step) : undefined;

    return renderPassage(
      baseVerses.map((v) => step.verses.find((sv) => sv.verseId === v.verseId) ?? v),
      (verse) => {
        if (!interactive.has(verse.verseId)) return {};
        const hidden = step.blanks.find((b) => b.verseId === verse.verseId)?.indices ?? [];
        const renderWord = this.buildBlanksWordRenderer(hidden, step.answerMode, onAllResolved);
        return { current: true, renderWord };
      },
    );
  }

  private renderExercise(): void {
    clear(this.exerciseEl);
    clear(this.actionsEl);
    this.setFeedback(null);

    if (this.summary !== null && this.session.step === null) {
      this.renderSummary(this.summary);
      return;
    }

    const step = this.session.step;
    if (step === null) {
      this.exerciseEl.appendChild(
        el('p', { class: 'sm-prompt', text: tr('memory.ui.practice.nothingLeft', 'Nothing left to do in this session.') }),
      );
      this.actionsEl.appendChild(
        button(tr('memory.ui.practice.done', 'Done'), () => void this.endSession(), { class: 'sm-btn sm-btn-primary' }),
      );
      return;
    }

    switch (step.kind) {
      case 'ordering':
        this.renderOrdering(step);
        return;
      case 'refmatch':
        this.renderRefMatch(step);
        return;
      case 'blanks':
        this.renderBlanks(step);
        return;
      case 'firstletters':
        this.renderFirstLetters(step);
        return;
      case 'refprovide':
        this.renderRefProvide(step);
        return;
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------
  // ordering - the next-verse picker
  // -------------------------------------------------------------------------

  /**
   * Candidates as previews of real text, chosen with one click or one Enter.
   *
   * No submit button. The user has made a choice the moment they press a
   * candidate, and an extra "confirm" step buys nothing except a second place
   * to lose your keyboard focus.
   */
  private renderOrdering(step: OrderingStep): void {
    this.exerciseEl.appendChild(
      el('h2', { class: 'sm-prompt', text: tr('memory.ui.practice.whichVerseNext', 'Which verse comes next?') }),
    );

    const list = el('ul', {
      class: 'sm-choices',
      attrs: { 'aria-label': tr('memory.ui.practice.chooseNextVerse', 'Choose the next verse') },
    });

    const buttons: HTMLButtonElement[] = [];

    step.candidates.forEach((candidate, index) => {
      const choice = el('button', {
        class: 'sm-choice',
        attrs: { 'data-verse-id': String(candidate.verseId) },
      });
      choice.type = 'button';
      append(choice, [
        // The letter is a keyboard-shortcut hint, not part of the scripture
        // text, so it is `aria-hidden` the same way the verdict mark is - a
        // screen reader already gets the candidate's text as the button's
        // accessible name and needs no separate announcement for a shortcut
        // it cannot use anyway.
        el('span', {
          class: 'sm-choice-letter',
          text: letterFor(index),
          attrs: { 'aria-hidden': 'true' },
        }),
        // The truncation mark is folded straight into the text rather than
        // drawn as a trailing sibling element. A sibling span sits outside the
        // text's own line flow, so on a preview that wraps it can land at the
        // top-right corner of the button looking like an unrelated control -
        // exactly the "faint dots, like a menu?" the task 0004 review flagged.
        el('span', {
          class: 'sm-choice-text',
          text: candidate.truncated ? `${candidate.preview}…` : candidate.preview,
        }),
        el('span', { class: 'sm-choice-mark', attrs: { 'aria-hidden': 'true' } }),
      ]);
      choice.addEventListener('click', () => void this.pickOrdering(step, candidate.verseId, choice));
      buttons.push(choice);
      list.appendChild(el('li', {}, [choice]));
    });

    // Buttons are already reachable with Tab; arrows are added on top because
    // in a list of four or five options Tab is a poor fit - it walks out of the
    // group at the end instead of wrapping, and there is no way back but
    // Shift+Tab. Roving arrows make the group behave like the list it looks
    // like, and Home/End reach the extremes.
    attachListKeys(list, buttons);
    // A second, independent shortcut on top of the arrows: pressing the
    // candidate's own letter (A, B, C, ...) picks it outright, from anywhere
    // in the list, without first moving focus onto it.
    attachLetterKeys(list, buttons, () => this.busy);

    this.exerciseEl.appendChild(list);
  }

  private async pickOrdering(
    step: OrderingStep,
    verseId: number,
    choice: HTMLButtonElement,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    const reply = await this.submit({ kind: 'ordering', verseId });
    if (this.disposed) return;
    if (reply === null) {
      this.busy = false;
      return;
    }

    const { result } = reply;

    if (result.correct) {
      this.busy = false;
      choice.classList.add('sm-choice-correct');
      this.setFeedback(tr('memory.ui.practice.yes', 'Yes.'), 'good');
      // A short pause before the next step so the confirmation is actually
      // seen. Without it the screen changes at the same instant as the click
      // and the user cannot tell whether they were right or the picker simply
      // moved on.
      this.after(CORRECT_FLASH_MS, () => this.advance());
      return;
    }

    // Wrong, and the picker blocks. The DOM is deliberately NOT re-rendered
    // here: re-rendering would replace the very button the mark is on, which
    // is the one piece of information the mark exists to carry. `busy` stays
    // true for the whole of the transient wrong-mark window rather than being
    // cleared immediately: a second pick - mouse or letter key - landing while
    // the "not that one" mark is still showing would submit against a step
    // that, from the user's perspective, has not finished telling them
    // anything yet.
    choice.classList.add('sm-choice-wrong');
    this.setFeedback(tr('memory.ui.practice.notThatOne', 'Not that one. Try again.'), 'bad');

    this.after(WRONG_MARK_MS, () => {
      this.busy = false;
      choice.classList.remove('sm-choice-wrong');
      this.setFeedback(null);
      // If the retried step is not the same set of candidates after all, the
      // displayed list is stale and has to be rebuilt. Normally it is
      // identical and nothing happens.
      const next = this.session.step;
      if (next !== null && next.kind === 'ordering' && !sameCandidates(step, next)) {
        this.renderAfterStepChange();
      } else {
        focusQuietly(choice);
      }
    });
  }

  // -------------------------------------------------------------------------
  // refmatch - which reference is this?
  // -------------------------------------------------------------------------

  private renderRefMatch(step: RefMatchStep): void {
    this.exerciseEl.appendChild(
      el('h2', { class: 'sm-prompt', text: tr('memory.ui.practice.whichReference', 'Which reference is this?') }),
    );

    const list = el('ul', {
      class: 'sm-choices sm-choices-compact',
      attrs: { 'aria-label': tr('memory.ui.practice.chooseReference', 'Choose the reference') },
    });
    const buttons: HTMLButtonElement[] = [];

    step.candidates.forEach((candidate, index) => {
      const choice = el('button', { class: 'sm-choice' });
      choice.type = 'button';
      append(choice, [
        // Same letter hint as the ordering picker, and for the same reason -
        // see `renderOrdering`'s own comment on why it is `aria-hidden`.
        el('span', {
          class: 'sm-choice-letter',
          text: letterFor(index),
          attrs: { 'aria-hidden': 'true' },
        }),
        el('span', { class: 'sm-choice-text', text: candidate.reference }),
        el('span', { class: 'sm-choice-mark', attrs: { 'aria-hidden': 'true' } }),
      ]);
      choice.addEventListener('click', () =>
        void this.pickRefMatch(candidate.id, choice),
      );
      buttons.push(choice);
      list.appendChild(el('li', {}, [choice]));
    });

    attachListKeys(list, buttons);
    // The same shared letter-shortcut helper `renderOrdering` uses - see its
    // own comment on `attachLetterKeys` for why the keydown logic lives in
    // one place rather than being copied here.
    attachLetterKeys(list, buttons, () => this.busy);
    this.exerciseEl.appendChild(list);
  }

  private async pickRefMatch(id: string, choice: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    const reply = await this.submit({ kind: 'refmatch', id });
    if (this.disposed) return;
    if (reply === null) {
      this.busy = false;
      return;
    }

    if (reply.result.correct) {
      this.busy = false;
      choice.classList.add('sm-choice-correct');
      this.setFeedback(tr('memory.ui.practice.yes', 'Yes.'), 'good');
      this.after(CORRECT_FLASH_MS, () => this.advance());
      return;
    }

    // Wrong, and the picker blocks - see `pickOrdering`'s own comment on why
    // `busy` stays true for the whole of the transient wrong-mark window
    // rather than being cleared immediately: a letter-key or mouse pick
    // landing while the "not that one" mark is still showing must not submit
    // against a step that, from the user's perspective, has not finished
    // telling them anything yet.
    choice.classList.add('sm-choice-wrong');
    this.setFeedback(tr('memory.ui.practice.notThatOne', 'Not that one. Try again.'), 'bad');
    this.after(WRONG_MARK_MS, () => {
      this.busy = false;
      choice.classList.remove('sm-choice-wrong');
      this.setFeedback(null);
      focusQuietly(choice);
    });
  }

  // -------------------------------------------------------------------------
  // refprovide - type the reference from memory
  // -------------------------------------------------------------------------

  /**
   * A single text field, graded worker-side (`session.ts#submitRefProvide`) -
   * this view never judges the typed text itself, only displays the verdict
   * it is handed back.
   */
  private renderRefProvide(step: RefProvideStep): void {
    this.exerciseEl.appendChild(
      el('h2', { class: 'sm-prompt', text: tr('memory.ui.practice.whatReference', 'What is the reference?') }),
    );

    const input = el('input', {
      class: 'sm-input sm-ref-input',
      type: 'text',
      placeholder: tr('memory.ui.practice.referencePlaceholder', 'e.g. John 3:16'),
      attrs: {
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        'aria-label': tr('memory.ui.practice.typeReference', 'Type the reference'),
      },
    });

    const submitText = () => void this.submitRefProvide(step, input);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitText();
    });

    this.exerciseEl.appendChild(input);
    this.actionsEl.appendChild(
      button(tr('memory.ui.practice.check', 'Check'), submitText, { class: 'sm-btn sm-btn-primary' }),
    );
    focusQuietly(input);
  }

  /**
   * Submits whatever is typed - including an empty field - and lets the
   * worker be the one to call it unrecognised (`session.ts#submitRefProvide`
   * treats a blank/unparseable string identically). Stopping an empty
   * submission locally, as an earlier rough version of this did, would give
   * an empty box no feedback at all and diverge from the worker's own D5
   * contract for no benefit.
   */
  private async submitRefProvide(step: RefProvideStep, input: HTMLInputElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const text = input.value.trim();

    const reply = await this.submit({ kind: 'refprovide', text });
    if (this.disposed) return;
    this.busy = false;
    if (reply === null) return;

    // Per resolved decision D5: an unrecognised reference re-prompts the SAME
    // step without penalty - it is not a wrong answer, so no verdict beyond
    // "try again" is shown, the step is never advanced, and - unlike the
    // graded-wrong case below - what the user typed is left exactly as it
    // was, still focused, so a near-miss (a typo, a missing colon) can be
    // fixed in place rather than retyped from scratch.
    if (reply.result.unrecognized) {
      this.setFeedback(tr('memory.ui.practice.unrecognisedReference', "I don't recognise that reference — try 'John 3:16'."), 'bad');
      focusQuietly(input);
      return;
    }

    if (reply.result.correct) {
      this.setFeedback(tr('memory.ui.practice.yes', 'Yes.'), 'good');
      this.after(CORRECT_FLASH_MS, () => this.advance());
      return;
    }

    // Recognised but wrong: graded immediately, single attempt, same as
    // `blanks`/`firstletters` - so the same "show what was missed, wait for
    // an explicit Next" pattern applies rather than the picker's quick
    // auto-advance, since there is a correct reference to actually read here.
    const correct = this.correctReferenceFor(step);
    this.setFeedback(
      correct
        ? tr('memory.ui.practice.notQuiteItsRef', "Not quite — it's {reference}.", { reference: correct })
        : tr('memory.ui.practice.notQuite', 'Not quite.'),
      'bad',
    );
    this.appendAdvanceButton(reply.summary);
  }

  /**
   * The correct reference for `step.verse`, built from the passage's own
   * `PassageContext.reference` (e.g. "1 John 3:1-21") plus the verse's own
   * `chapter:verse` label - never from anything the panel infers about the
   * verse's WORDS, since `refprovide` is graded from the typed text, not the
   * words (see `RefProvideStep`'s doc comment).
   *
   * `null` when the context has not arrived yet (a fast wrong answer,
   * arriving before `loadContext`'s reply) or its `reference` does not end in
   * the expected "chapter:verse[-verse]" shape - the feedback line falls back
   * to a bare "Not quite." rather than showing something wrong or half-built.
   */
  private correctReferenceFor(step: RefProvideStep): string | null {
    const reference = this.context?.reference ?? null;
    if (reference === null) return null;
    const match = /^(.+?)\s+\d+:\d+(?:-\d+)?$/.exec(reference);
    const book = match?.[1];
    return book ? `${book} ${step.verse.label}` : null;
  }

  // -------------------------------------------------------------------------
  // blanks / firstletters - one hidden-word mechanic, per `Step.answerMode`
  // -------------------------------------------------------------------------

  /**
   * `firstletters` tier 0 only: the step (by reference) for which "Start" has
   * been pressed, i.e. the verse is already blanked. Tier 1 never consults
   * this - it goes straight to blanks, per D-firstletters (`types.ts`'s
   * `FirstLettersStep.tier` doc comment).
   *
   * Keyed by step object identity rather than a plain boolean so it resets
   * itself for free: `submitStep`/`startSession` replies are freshly parsed
   * JSON, so a genuinely new step is never `===` the old one, while a
   * re-render of the SAME step (a late `getContext` arrival, for instance)
   * keeps comparing equal and does not re-show the preview out from under an
   * already-started exercise.
   */
  private firstLettersStartedFor: FirstLettersStep | null = null;

  /** Every element whose width is measured, paired with the text to measure. */
  private measured: { node: HTMLElement; text: string }[] = [];

  /** Answers gathered so far, indexed by `verse.words` position (both modes). */
  private hiddenAnswers: string[] = [];
  /** How many hidden slots are still unresolved, in `firstLetter` mode. */
  private hiddenPending = 0;
  /** Live `<input>` elements, in ascending word-index order, in `fullWord` mode. */
  private hiddenInputs: HTMLInputElement[] = [];
  /**
   * `blanks` only: the running count of hidden slots rendered so far, across
   * every verse of the step. Each slot's `data-word-index` and its position in
   * `hiddenAnswers` is this counter's value at the moment it renders, which is
   * what makes it a FLAT position rather than a word index - see
   * `renderBlanksPassage`'s doc comment for why that ordering matches the
   * worker's flattened `StepAnswer.words` contract for free. Reset once per
   * step in `renderBlanksPassage`, not per verse.
   */
  private hiddenCounter = 0;

  /**
   * Builds the per-word renderer for `firstletters` - a single verse, keyed by
   * its own word index directly (there is only one verse in play, so a word
   * index is already unambiguous). `blanks` has its own renderer,
   * `buildBlanksWordRenderer` below, because a `blanks` step can now cover
   * more than one verse (tier 1) and a bare word index would collide between
   * them.
   *
   * `onAllResolved` is provided only in `firstLetter` mode, where there is no
   * Check button: the step submits itself the instant the last hidden word is
   * decided.
   */
  private buildHiddenWordRenderer(
    hidden: HiddenWords,
    answerMode: AnswerMode,
    onAllResolved: (() => void) | undefined,
  ): WordRenderer {
    const hiddenSet = new Set(hidden.hiddenIndices);
    this.hiddenAnswers = [];
    this.hiddenPending = hidden.hiddenIndices.length;
    this.hiddenInputs = [];
    this.measured = [];

    return (word, index) => {
      if (!hiddenSet.has(index)) {
        this.hiddenAnswers[index] = word;
        return plainWord(word);
      }

      // A token with no letters or digits at all - a lone dash, a stray
      // bracket - has no initial to ask for and nothing to type. Printing it
      // outright is better than presenting a box that cannot be answered.
      if (word.trim() === '' || firstLetterMissing(word)) {
        this.hiddenAnswers[index] = word;
        this.hiddenPending -= 1;
        return plainWord(word);
      }

      const position = hidden.hiddenIndices.indexOf(index);
      const label = tr('memory.ui.practice.missingWord', 'Missing word {position} of {total}', {
        position: position + 1,
        total: hidden.hiddenIndices.length,
      });

      if (answerMode === 'firstLetter') {
        const input = el('input', {
          class: 'sm-fl',
          type: 'text',
          attrs: {
            maxlength: '1',
            autocomplete: 'off',
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
            'aria-label': label,
            'data-word-index': String(index),
          },
          // Deliberately no `placeholder`: v0 showed the initial here, which
          // made this a copy exercise rather than a recall one - see the file
          // header and the task 0004 review, point 1. The box stays empty
          // until the user types into it.
        });
        const slot = slotFor(input);
        this.measured.push({ node: slot, text: word });

        input.addEventListener('input', () => {
          this.interacted = true;
          if (input.value === '') return;
          const correct = matchesFirstLetter(input.value, word);
          this.hiddenAnswers[index] = correct ? word : input.value;
          const next = nextSlotAfter(input);
          fillSlot(input, correct ? correctWord(word, index) : missedWord(word, input.value));
          this.hiddenPending -= 1;
          this.setFeedback(correct ? null : tr('memory.ui.practice.missedWord', 'Missed: {word}', { word }), 'bad');
          if (this.hiddenPending > 0) {
            focusQuietly(next);
            return;
          }
          onAllResolved?.();
        });
        input.addEventListener('keydown', (ev) => {
          // Enter with nothing typed skips forward rather than submitting an
          // empty answer for a word the user is still thinking about.
          if (ev.key === 'Enter' && input.value === '') {
            ev.preventDefault();
            focusQuietly(nextSlotAfter(input));
          }
        });
        return slot;
      }

      // `fullWord`: a normal text box, confirmed by the Check button.
      const input = el('input', {
        class: 'sm-blank',
        type: 'text',
        attrs: {
          autocomplete: 'off',
          autocapitalize: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
          enterkeyhint: 'next',
          'aria-label': label,
          'data-word-index': String(index),
        },
      });
      const slot = slotFor(input);
      this.measured.push({ node: slot, text: word });
      this.hiddenInputs.push(input);

      input.addEventListener('input', () => {
        this.interacted = true;
        this.keepCaretVisible(input);
      });
      input.addEventListener('keydown', (ev) => this.onFullWordKey(ev, input));
      return slot;
    };
  }

  /**
   * The per-word renderer for one verse of a `blanks` step.
   *
   * `hiddenIndices` is that ONE verse's own hidden word indices (a `blanks`
   * entry's `indices`, per `types.ts`'s per-verse-ascending contract) - not
   * the whole step's. Every hidden slot claims the next value of
   * `this.hiddenCounter`, shared across every verse `renderBlanksPassage`
   * builds one of these for, so `hiddenAnswers` and each input's
   * `data-word-index` end up keyed by a position that is unique across the
   * whole step rather than by a word index that is only unique within one
   * verse.
   *
   * Deliberately does not reset `hiddenAnswers` / `hiddenPending` /
   * `hiddenInputs` / `measured` itself - `renderBlanksPassage` resets those
   * ONCE for the whole step, before building the first verse's renderer,
   * because several of these run in sequence sharing that state.
   */
  private buildBlanksWordRenderer(
    hiddenIndices: number[],
    answerMode: AnswerMode,
    onAllResolved: (() => void) | undefined,
  ): WordRenderer {
    const hiddenSet = new Set(hiddenIndices);

    return (word, index) => {
      if (!hiddenSet.has(index)) return plainWord(word);

      // A token with no letters or digits at all - a lone dash, a stray
      // bracket - has no initial to ask for and nothing to type. Printing it
      // outright is better than presenting a box that cannot be answered.
      if (word.trim() === '' || firstLetterMissing(word)) {
        const key = this.hiddenCounter++;
        this.hiddenAnswers[key] = word;
        this.hiddenPending -= 1;
        return plainWord(word);
      }

      const key = this.hiddenCounter++;
      const position = hiddenIndices.indexOf(index);
      const label = tr('memory.ui.practice.missingWord', 'Missing word {position} of {total}', {
        position: position + 1,
        total: hiddenIndices.length,
      });

      if (answerMode === 'firstLetter') {
        const input = el('input', {
          class: 'sm-fl',
          type: 'text',
          attrs: {
            maxlength: '1',
            autocomplete: 'off',
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
            'aria-label': label,
            'data-word-index': String(key),
          },
          // Deliberately no `placeholder` - see `buildHiddenWordRenderer`'s
          // own comment on the same choice.
        });
        const slot = slotFor(input);
        this.measured.push({ node: slot, text: word });

        input.addEventListener('input', () => {
          this.interacted = true;
          if (input.value === '') return;
          const correct = matchesFirstLetter(input.value, word);
          this.hiddenAnswers[key] = correct ? word : input.value;
          const next = nextSlotAfter(input);
          fillSlot(input, correct ? correctWord(word, key) : missedWord(word, input.value));
          this.hiddenPending -= 1;
          this.setFeedback(correct ? null : tr('memory.ui.practice.missedWord', 'Missed: {word}', { word }), 'bad');
          if (this.hiddenPending > 0) {
            focusQuietly(next);
            return;
          }
          onAllResolved?.();
        });
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && input.value === '') {
            ev.preventDefault();
            focusQuietly(nextSlotAfter(input));
          }
        });
        return slot;
      }

      // `fullWord`: a normal text box, confirmed by the Check button.
      const input = el('input', {
        class: 'sm-blank',
        type: 'text',
        attrs: {
          autocomplete: 'off',
          autocapitalize: 'off',
          autocorrect: 'off',
          spellcheck: 'false',
          enterkeyhint: 'next',
          'aria-label': label,
          'data-word-index': String(key),
        },
      });
      const slot = slotFor(input);
      this.measured.push({ node: slot, text: word });
      this.hiddenInputs.push(input);

      input.addEventListener('input', () => {
        this.interacted = true;
        this.keepCaretVisible(input);
      });
      input.addEventListener('keydown', (ev) => this.onFullWordKey(ev, input));
      return slot;
    };
  }

  private renderBlanks(step: BlanksStep): void {
    const count = step.blanks.reduce((n, b) => n + b.indices.length, 0);
    const prefix = tierPrefix(this.session.rung, this.session.tier, this.session.tiers);
    const wholePassage = step.verses.length > 1;

    this.exerciseEl.appendChild(
      el('h2', {
        class: 'sm-prompt',
        text:
          step.answerMode === 'firstLetter'
            ? wholePassage
              ? tr(
                  'memory.ui.practice.blanksFirstLetterWhole',
                  '{prefix}Type the first letter of each missing word across the whole passage.',
                  { prefix },
                )
              : tr(
                  'memory.ui.practice.blanksFirstLetterVerse',
                  '{prefix}Type the first letter of each missing word in the highlighted verse.',
                  { prefix },
                )
            : wholePassage
              ? tr(
                  'memory.ui.practice.blanksWordsWhole',
                  '{prefix}Type the missing {count, plural, one {word} other {words}} across the whole passage.',
                  { prefix, count },
                )
              : tr(
                  'memory.ui.practice.blanksWordsVerse',
                  '{prefix}Type the missing {count, plural, one {word} other {words}} in the highlighted verse.',
                  { prefix, count },
                ),
      }),
    );

    if (step.answerMode === 'firstLetter') {
      this.exerciseEl.appendChild(
        el('p', {
          class: 'sm-hint',
          text: wholePassage
            ? tr(
                'memory.ui.practice.hintLetterWhole',
                'No preview this time - a correct letter reveals the word and moves on, verse after verse.',
              )
            : tr('memory.ui.practice.hintLetterVerse', 'A correct letter reveals the word and moves on.'),
        }),
      );
      focusQuietly(this.contextEl.querySelector<HTMLInputElement>('.sm-fl'));
      return;
    }

    this.exerciseEl.appendChild(
      el('p', {
        class: 'sm-hint',
        text: wholePassage
          ? tr(
              'memory.ui.practice.hintEnterBlankWhole',
              'No preview this time - Enter moves to the next blank, across verses in order; Enter on the last one checks the whole passage.',
            )
          : tr(
              'memory.ui.practice.hintEnterBlankVerse',
              'Enter moves to the next blank; Enter on the last one checks your answer.',
            ),
      }),
    );
    this.actionsEl.appendChild(
      button(tr('memory.ui.practice.check', 'Check'), () => void this.submitBlanksHidden(step), { class: 'sm-btn sm-btn-primary' }),
    );
    focusQuietly(this.hiddenInputs[0] ?? null);
  }

  private renderFirstLetters(step: FirstLettersStep): void {
    const prefix = tierPrefix(this.session.rung, step.tier, this.session.tiers);

    // Easy tier's preview: the verse in full, read before it is asked for
    // back. Tier 1 never reaches this branch - `renderContext` sends it
    // straight to the blanked rendering, which is what makes the two tiers
    // look different, and the prompt below says so.
    if (step.tier === 0 && this.firstLettersStartedFor !== step) {
      this.exerciseEl.appendChild(
        el('h2', { class: 'sm-prompt', text: tr('memory.ui.practice.readThenStart', '{prefix}Read the verse, then press Start.', { prefix }) }),
      );
      this.exerciseEl.appendChild(
        el('p', {
          class: 'sm-hint',
          text: tr('memory.ui.practice.startHint', 'Start hides every word so you can recite it from memory.'),
        }),
      );
      this.actionsEl.appendChild(
        button(tr('memory.ui.practice.start', 'Start'), () => this.startFirstLetters(step), { class: 'sm-btn sm-btn-primary' }),
      );
      return;
    }

    if (step.answerMode === 'firstLetter') {
      this.exerciseEl.appendChild(
        el('h2', {
          class: 'sm-prompt',
          text: tr('memory.ui.practice.typeFirstLetterEachWord', '{prefix}Type the first letter of each word ({count} in this verse).', {
            prefix,
            count: step.verse.words.length,
          }),
        }),
      );
      this.exerciseEl.appendChild(
        el('p', {
          class: 'sm-hint',
          text:
            step.tier === 0
              ? tr(
                  'memory.ui.practice.hintWholeWordEasy',
                  'A correct letter reveals the whole word. There is one attempt per word.',
                )
              : tr(
                  'memory.ui.practice.hintWholeWordHard',
                  'No preview this time - a correct letter reveals the whole word. There is one attempt per word.',
                ),
        }),
      );
      focusQuietly(this.contextEl.querySelector<HTMLInputElement>('.sm-fl'));
      return;
    }

    this.exerciseEl.appendChild(
      el('h2', {
        class: 'sm-prompt',
        text: tr(
          'memory.ui.practice.typeEveryWord',
          '{prefix}Type every word in the verse ({count, plural, one {# word} other {# words}}).',
          { prefix, count: step.verse.words.length },
        ),
      }),
    );
    this.exerciseEl.appendChild(
      el('p', {
        class: 'sm-hint',
        text:
          step.tier === 0
            ? tr(
                'memory.ui.practice.hintEnterWordEasy',
                'Enter moves to the next word; Enter on the last one checks your answer.',
              )
            : tr(
                'memory.ui.practice.hintEnterWordHard',
                'No preview this time - Enter moves to the next word; Enter on the last one checks your answer.',
              ),
      }),
    );
    this.actionsEl.appendChild(
      button(tr('memory.ui.practice.check', 'Check'), () => void this.submitHidden(step), { class: 'sm-btn sm-btn-primary' }),
    );
    focusQuietly(this.hiddenInputs[0] ?? null);
  }

  /**
   * Blanks the verse and hands focus to the first slot - `firstletters` tier
   * 0's "Start" button. Re-renders just the context and exercise (not the
   * whole head/progress chrome) because nothing about the step itself has
   * changed, only how much of it is shown.
   */
  private startFirstLetters(step: FirstLettersStep): void {
    if (this.disposed || this.firstLettersStartedFor === step) return;
    this.firstLettersStartedFor = step;
    this.renderContext();
    this.renderExercise();
  }

  /**
   * Enter walks the full-word inputs; Enter on the last one submits.
   *
   * Tab already does the walking, so this is not the only way through - it is
   * the way that does not require the user to know that a passage full of
   * inline inputs is a tab sequence. Shift+Enter goes back for symmetry.
   */
  private onFullWordKey(ev: KeyboardEvent, input: HTMLInputElement): void {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();

    const index = this.hiddenInputs.indexOf(input);
    const step = this.session.step;
    if (index < 0 || step === null || (step.kind !== 'blanks' && step.kind !== 'firstletters')) return;

    if (ev.shiftKey) {
      focusQuietly(this.hiddenInputs[index - 1] ?? input);
      return;
    }
    const next = this.hiddenInputs[index + 1];
    if (next) {
      focusQuietly(next);
      return;
    }
    if (step.kind === 'blanks') void this.submitBlanksHidden(step);
    else void this.submitHidden(step);
  }

  /**
   * Keeps the caret in view in an overtyped input WITHOUT resizing anything.
   *
   * The box is a fixed-width slot (see `slotFor`); resizing it mid-typing
   * would reflow every later word on the line, which is the bug this replaced
   * (`growBlank`). The input scrolls its own text instead - browsers already
   * do this for the caret, and the explicit nudge covers the case where a
   * paste or IME commit leaves the scroll position short of the end.
   */
  private keepCaretVisible(input: HTMLInputElement): void {
    if (input.selectionStart === input.value.length) input.scrollLeft = input.scrollWidth;
  }

  /**
   * Submits a `firstletters` step, in either answer mode.
   *
   * In `fullWord` mode this is called from the Check button; in `firstLetter`
   * mode it is called automatically once every slot has resolved, and by then
   * `this.hiddenAnswers` is already complete because each slot writes into it
   * as it resolves. Still keyed by word index directly - `firstletters` is
   * always a single verse, so a word index is already unambiguous. `blanks`
   * has its own version, `submitBlanksHidden` below, keyed by the flat
   * position `buildBlanksWordRenderer` assigns instead.
   */
  private async submitHidden(step: FirstLettersStep): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    if (step.answerMode === 'fullWord') {
      for (const input of this.hiddenInputs) {
        const index = Number(input.dataset['wordIndex']);
        this.hiddenAnswers[index] = input.value.trim();
      }
    }

    const hidden = hiddenIndicesFor(step);
    const words = step.verse.words.map((_, i) => this.hiddenAnswers[i] ?? '');

    const reply = await this.submit({ kind: 'firstletters', words });
    if (this.disposed) return;
    this.busy = false;
    if (reply === null) return;

    const wrong = resolveWrongPositions(reply.result, hidden.hiddenIndices);

    if (step.answerMode === 'fullWord') {
      // Live `<input>`s are still on screen; replace each with its verdict.
      this.hiddenInputs.forEach((input, position) => {
        const wordIndex = hidden.hiddenIndices[position] ?? -1;
        const answer = revealedWord(reply.result, hidden, position, wordIndex, step.verse.words);
        const typed = input.value.trim();
        const missed = wrong.has(position);
        fillSlot(input, missed ? missedWord(answer, typed) : correctWord(answer, wordIndex));
      });
      this.hiddenInputs = [];
    } else {
      // `firstLetter` mode already replaced every slot as it resolved. The
      // worker's verdict is authoritative even where the panel already drew a
      // conclusion: if it marks a word wrong that the local first-letter check
      // accepted - a homograph, a normalisation difference - the display is
      // corrected to agree with the score the user is about to be given.
      wrong.forEach((position) => {
        const wordIndex = hidden.hiddenIndices[position] ?? -1;
        const node = this.contextEl.querySelector<HTMLElement>(
          `.sm-word-ok[data-word-index="${wordIndex}"]`,
        );
        const word = step.verse.words[wordIndex];
        if (node && word !== undefined) {
          node.replaceWith(missedWord(word, this.hiddenAnswers[wordIndex] ?? ''));
        }
      });
    }

    this.reportTyped(wrong.size, hidden.hiddenIndices.length, reply.summary);
  }

  /**
   * Submits a `blanks` step, at any tier, in either answer mode.
   *
   * The answer is built by reading `this.hiddenAnswers` in flat order (0, 1,
   * 2, ...) rather than by word index - exactly the order
   * `renderBlanksPassage`'s doc comment describes, and exactly what
   * `StepAnswer.words` for `blanks` is documented (`types.ts`) to expect.
   * `StepResult.wrong` for `blanks` is likewise already a set of flat
   * positions (see `session.ts#submitBlanks`), so unlike `submitHidden` above
   * there is no `resolveWrongPositions` translation step - the worker's
   * answer is already in the panel's own coordinate space.
   */
  private async submitBlanksHidden(step: BlanksStep): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    if (step.answerMode === 'fullWord') {
      for (const input of this.hiddenInputs) {
        const key = Number(input.dataset['wordIndex']);
        this.hiddenAnswers[key] = input.value.trim();
      }
    }

    const total = step.blanks.reduce((n, b) => n + b.indices.length, 0);
    const words = Array.from({ length: total }, (_, i) => this.hiddenAnswers[i] ?? '');

    const reply = await this.submit({ kind: 'blanks', words });
    if (this.disposed) return;
    this.busy = false;
    if (reply === null) return;

    const wrong = new Set(reply.result.wrong);
    const revealed = reply.result.reveal?.words ?? [];

    if (step.answerMode === 'fullWord') {
      // Live `<input>`s are still on screen; replace each with its verdict.
      this.hiddenInputs.forEach((input) => {
        const key = Number(input.dataset['wordIndex']);
        const answer = revealed[key] ?? '';
        const typed = input.value.trim();
        const missed = wrong.has(key);
        fillSlot(input, missed ? missedWord(answer, typed) : correctWord(answer, key));
      });
      this.hiddenInputs = [];
    } else {
      // `firstLetter` mode already replaced every slot as it resolved; correct
      // any the worker marks wrong that the local check accepted - same
      // reasoning as `submitHidden`'s own comment on this.
      let position = 0;
      for (const entry of step.blanks) {
        for (let i = 0; i < entry.indices.length; i += 1) {
          const key = position;
          position += 1;
          if (!wrong.has(key)) continue;
          const node = this.contextEl.querySelector<HTMLElement>(
            `.sm-word-ok[data-word-index="${key}"]`,
          );
          const word = revealed[key] ?? '';
          if (node) node.replaceWith(missedWord(word, this.hiddenAnswers[key] ?? ''));
        }
      }
    }

    this.reportTyped(wrong.size, total, reply.summary);
  }

  // -------------------------------------------------------------------------
  // Shared submit / advance machinery
  // -------------------------------------------------------------------------

  private async submit(
    answer: StepAnswer,
  ): Promise<{ result: StepResult; summary: SessionSummary | null } | null> {
    // Covers the two pickers, whose only interaction is the click that submits.
    // A late-arriving context must not rebuild the list out from under a mark
    // that is currently showing which candidate was wrong.
    this.interacted = true;

    const reply = await this.host.request({
      type: 'submitStep',
      sessionId: this.session.sessionId,
      answer,
    });
    if (this.disposed) return null;

    if (!reply.ok) {
      replace(this.feedbackEl, [errorBanner(reply.error)]);
      return null;
    }

    this.session = reply.data.session;
    this.summary = reply.data.summary;
    this.renderHead();
    return { result: reply.data.result, summary: reply.data.summary };
  }

  /**
   * The verdict line for a typed exercise, plus the button that moves on.
   *
   * Typed steps do not auto-advance the way the picker does. The user has just
   * been shown which words they missed, in place, inside the verse - taking
   * that away after a fixed delay would be taking away the only part of the
   * exercise that teaches anything.
   */
  private reportTyped(missed: number, total: number, summary: SessionSummary | null): void {
    const right = Math.max(0, total - missed);
    this.setFeedback(
      missed === 0
        ? tr('memory.ui.practice.allCorrect', 'All {total} correct.', { total })
        : tr('memory.ui.practice.someCorrect', '{right} of {total} correct.', { right, total }),
      missed === 0 ? 'good' : 'bad',
    );
    this.appendAdvanceButton(summary);
  }

  /**
   * The "Next"/"Finish" control shared by every non-blocking typed exercise
   * (`blanks`, `firstletters` via `reportTyped`, and `refprovide`'s own
   * graded-wrong case) - the user has just been shown what they missed, and
   * moving on is a deliberate action, not a timed auto-advance, so the
   * feedback stays readable until they choose to continue.
   */
  private appendAdvanceButton(summary: SessionSummary | null): void {
    clear(this.actionsEl);
    const label =
      summary !== null ? tr('memory.ui.practice.finish', 'Finish') : tr('memory.ui.practice.next', 'Next');
    const next = button(
      label,
      () => {
        if (summary !== null) {
          this.renderExercise();
          return;
        }
        this.advance();
      },
      { class: 'sm-btn sm-btn-primary' },
    );
    this.actionsEl.appendChild(next);
    focusQuietly(next);
  }

  /** Draws whatever the session now says the current step is. */
  private advance(): void {
    if (this.disposed) return;
    this.renderAfterStepChange();
  }

  private renderAfterStepChange(): void {
    this.renderHead();
    this.renderContext();
    this.renderExercise();
  }

  private renderSummary(summary: SessionSummary): void {
    this.contextEl.hidden = true;

    this.exerciseEl.appendChild(
      el('div', { class: 'sm-summary' }, [
        el('h2', { class: 'sm-summary-title', text: tr('memory.ui.practice.activityDone', '{activity} — done', { activity: RUNG_LABEL[summary.rung] }) }),
        summary.tiers > 1
          ? el('p', {
              class: 'sm-summary-tier',
              text: tr('memory.ui.practice.tierOf', '{label} (Tier {tier} of {tiers})', {
                label: tierLabel(summary.rung, summary.tier),
                tier: summary.tier + 1,
                tiers: summary.tiers,
              }),
            })
          : null,
        el('div', { class: 'sm-summary-level' }, [
          levelBoxes(summary.level),
          el('span', { class: 'sm-summary-level-text', text: tr('memory.ui.practice.levelOutOfFive', '{level}/5', { level: summary.level }) }),
        ]),
        el('p', {
          class: 'sm-summary-detail',
          text: tr('memory.ui.practice.summaryRightFirstTime', '{correct} of {total} right first time ({score}).', {
            correct: summary.correctFirst,
            total: summary.totalSteps,
            score: formatScore(summary.score),
          }),
        }),
        summary.passageWellLearned
          ? el('p', { class: 'sm-summary-good', text: tr('memory.ui.practice.wellLearned', 'This passage is well learned.') })
          : null,
        el('p', {
          class: 'sm-summary-detail',
          text:
            summary.nextDueAt !== null
              ? tr('memory.ui.practice.nextReview', 'Next review {date}.', {
                  date: new Date(summary.nextDueAt).toLocaleDateString(uiLocale()),
                })
              : tr('memory.ui.practice.noFurtherReview', 'No further review scheduled.'),
        }),
      ]),
    );

    this.actionsEl.appendChild(
      button(tr('memory.ui.practice.done', 'Done'), () => void this.endSession(), { class: 'sm-btn sm-btn-primary' }),
    );
    this.actionsEl.appendChild(
      button(
        tr('memory.ui.practice.practiceAgain', 'Practice again'),
        () =>
          void this.host.startSession(this.session.passageId, this.session.rung, undefined, undefined, this.flow),
        { class: 'sm-btn' },
      ),
    );
    // The wider plan can hold far more than one screenful of passages (task
    // 0004's review raised a plan of 250 individual verses); this is the
    // "just keep going" path so the user is never forced back through the
    // plan list to find whatever else is due.
    this.actionsEl.appendChild(
      button(tr('memory.ui.practice.nextDue', 'Next due'), () => void this.startNextDue(), { class: 'sm-btn sm-btn-quiet' }),
    );
  }

  private async startNextDue(): Promise<void> {
    const reply = await this.host.request({ type: 'getPlan' });
    if (this.disposed) return;
    if (!reply.ok) {
      this.host.announce(reply.error);
      return;
    }
    const target = pickDueTarget(reply.data, this.host.now());
    if (!target) {
      this.host.announce(tr('memory.ui.practice.nothingElseDue', 'Nothing else is due right now.'));
      void this.endSession();
      return;
    }
    void this.host.startSession(target.passageId, target.rung, undefined, undefined, this.flow);
  }

  /**
   * The Next button: "not this one right now". Ends the session as the
   * crumbs do, then re-runs this session's flow excluding the passage just
   * left. `flow` and the passage id are captured first because `endSession`
   * drives `sessionEnded`, which can destroy this view.
   */
  private async onNext(): Promise<void> {
    if (this.flow.kind === 'passage') return;
    const flow = this.flow;
    const exclude = new Set([this.session.passageId]);
    await this.endSession();
    void this.host.startFlow(flow, exclude);
  }

  private async endSession(dest: NavAction = { type: 'sessionEnded' }): Promise<void> {
    // The reply is not inspected: the user pressed Back, and the screen has to
    // change whether or not the worker had a summary to give. A failure here
    // is announced rather than trapping them in a session that is already over
    // as far as they are concerned. Progress up to the last completed verse is
    // already saved - see `main.ts#submitStep` - so this does not lose work.
    const reply = await this.host.request({
      type: 'endSession',
      sessionId: this.session.sessionId,
    });
    if (this.disposed) return;
    if (!reply.ok) this.host.announce(reply.error);
    this.host.go(dest);
  }

  // -------------------------------------------------------------------------
  // Measurement and feedback plumbing
  // -------------------------------------------------------------------------

  /**
   * Sizes every input to its word, in the font the passage is actually drawn
   * in.
   *
   * Runs after the passage is in the document, and adopts the font from the
   * highlighted verse rather than from `document.body`: the scripture face and
   * size come from the host's `--bible-font-*` tokens and are nothing like the
   * panel chrome's, so a measurement taken in the UI font would be wrong for
   * every hidden word by the same misleading-looking constant.
   */
  private applyMeasuredWidths(): void {
    if (this.measured.length === 0) return;
    this.applyWidths();
    this.armRemeasure();
  }

  /**
   * Writes the measured width onto every slot AND the input inside it, so the
   * two are always the same number. Reveal replaces the input inside the
   * slot; the slot's width is what holds the line still.
   */
  private applyWidths(): void {
    const source =
      this.contextEl.querySelector<HTMLElement>('.sm-verse-current') ?? this.contextEl;
    this.host.measurer.adoptFontFrom(source);

    for (const { node, text } of this.measured) {
      if (!node.isConnected) continue;
      const width = `${this.host.measurer.blankWidth(text)}px`;
      node.style.width = width;
      const input = node.querySelector<HTMLElement>('input');
      if (input) input.style.width = width;
    }
  }

  private layoutObserver: ResizeObserver | null = null;

  /**
   * Re-applies widths once the pane has real layout.
   *
   * A pane that is collapsed (or whose fonts have not settled) at first paint
   * measures as zero and `WordMeasurer` falls back to `estimateTextWidth`;
   * nothing else would ever revisit those widths. So when an estimate was used
   * a `ResizeObserver` waits for the first non-zero layout, then INVALIDATES
   * the measurer's cache (rather than reading stale values back) and
   * re-measures. It stays armed until a pass completes with no estimates.
   * `document.fonts.ready` triggers the same pass once, for the
   * fonts-settling case where measurements were real but in a fallback face.
   */
  private armRemeasure(): void {
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;

    const remeasure = (): void => {
      if (this.disposed || this.measured.length === 0) return;
      this.host.measurer.invalidate();
      this.applyWidths();
      if (!this.host.measurer.usedEstimate) {
        this.layoutObserver?.disconnect();
        this.layoutObserver = null;
      }
    };

    if (this.host.measurer.usedEstimate && typeof ResizeObserver !== 'undefined') {
      this.layoutObserver = new ResizeObserver((entries) => {
        const visible =
          entries.some((e) => e.contentRect.width > 0) ||
          this.contextEl.getBoundingClientRect().width > 0;
        if (visible) remeasure();
      });
      this.layoutObserver.observe(this.contextEl);
    }

    const fonts = (this.root.ownerDocument as Document & { fonts?: { ready?: Promise<unknown> } })
      .fonts;
    void fonts?.ready?.then(remeasure);
  }

  private setFeedback(message: string | null, tone: 'good' | 'bad' = 'good'): void {
    clear(this.feedbackEl);
    this.feedbackEl.className = `sm-feedback${message === null ? '' : ` sm-feedback-${tone}`}`;
    if (message === null) return;
    append(this.feedbackEl, [
      tone === 'bad'
        ? el('span', { class: 'sm-mark sm-mark-bad', text: '✗', attrs: { 'aria-hidden': 'true' } })
        : null,
      textNode(message),
    ]);
  }

  /** A cancellable timeout that is cleaned up if the view goes away first. */
  private after(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(id);
  }
}

// ---------------------------------------------------------------------------
// Free functions
// ---------------------------------------------------------------------------

/**
 * "Easier tier: " / "Harder tier: ", or nothing at all.
 *
 * Only shown once an activity actually HAS more than one tier
 * (`ladder.ts#TIERS`) - for every real `blanks`/`firstletters` session that is
 * always true (both are 2-tier activities), but a fixture built without
 * `tiers` set (several of `panelRender.test.ts`'s older helpers predate tiers
 * entirely) must not print a nonsensical label, so the guard is on the data
 * rather than on the rung name.
 */
function tierPrefix(rung: Rung, tier: number, tiers: number): string {
  return tiers > 1 ? tr('memory.ui.practice.tierPrefix', '{label} tier: ', { label: tierLabel(rung, tier) }) : '';
}

function stepFraction(stepNumber: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  return Math.max(0, Math.min(1, (stepNumber - 1) / totalSteps));
}

function firstLetterMissing(word: string): boolean {
  return word.replace(/[^\p{L}\p{N}]/gu, '') === '';
}

/**
 * Every word index of a `firstletters` step's (single) verse - it hides all
 * of them. `blanks` no longer has a use for this shape now that a step can
 * cover more than one verse - see `submitBlanksHidden`, which works in flat
 * positions instead.
 */
function hiddenIndicesFor(step: FirstLettersStep): HiddenWords {
  return {
    verseWordCount: step.verse.words.length,
    hiddenIndices: step.verse.words.map((_, i) => i),
  };
}

function sameCandidates(a: OrderingStep, b: OrderingStep): boolean {
  if (a.candidates.length !== b.candidates.length) return false;
  return a.candidates.every((c, i) => c.verseId === b.candidates[i]?.verseId);
}

/**
 * The fixed-width box every hidden word lives in, before AND after reveal.
 *
 * `applyWidths` sizes it (`blankWidthFor(measure(word))`, floor included) and
 * it never changes size afterwards: the input, the revealed word and the
 * missed-word marker all render INSIDE it, so revealing a word cannot move
 * anything after it on the line.
 */
function slotFor(input: HTMLInputElement): HTMLElement {
  return el('span', { class: 'sm-slot' }, [input]);
}

/** Swaps a resolved word into the slot the input was in (not next to it). */
function fillSlot(input: HTMLInputElement, revealed: HTMLElement): void {
  const slot = input.parentElement;
  if (slot?.classList.contains('sm-slot')) slot.replaceChildren(revealed);
  else input.replaceWith(revealed);
}

/**
 * A correct word, put back into the passage.
 *
 * `data-word-index` is carried so a later correction from the worker can find
 * the node again - see `submitHidden`.
 */
function correctWord(word: string, wordIndex?: number): HTMLElement {
  return el('span', {
    class: 'sm-word sm-word-ok',
    text: word,
    attrs: wordIndex === undefined ? {} : { 'data-word-index': String(wordIndex) },
  });
}

/**
 * A missed word: the right words in the passage, the wrong answer beside them.
 *
 * The verse itself is left intact and readable. What is marked is the *answer*
 * - red, with a ✗ - and it sits next to the word rather than on top of it.
 * There is no strike-through anywhere in this panel, on scripture or on
 * anything else; it was ruled out and it is not a style choice that gets
 * quietly reintroduced by a later tweak.
 */
function missedWord(answer: string, typed: string): HTMLElement {
  const shown = typed.trim();
  return el('span', {
    class: 'sm-word sm-word-missed',
    // Marker decision (D3): what was typed is kept OUT of the inline flow. It
    // is drawn by CSS as a small label absolutely positioned under the slot
    // (`.sm-word-wrong`), so a long wrong answer cannot widen the line; the
    // same text is also on the `title` for hover and in sr-only text.
    attrs: shown === '' ? {} : { title: tr('memory.ui.practice.youTyped', 'You typed: {typed}', { typed: shown }) },
  }, [
    el('span', { class: 'sm-word-answer', text: answer }),
    el('span', { class: 'sm-word-wrong' }, [
      // The ✗ is hidden from assistive tech and replaced by words. Read aloud,
      // a bare cross is either skipped or announced as "multiplication sign",
      // and the sighted reading - "here is the answer, here is what you put" -
      // has to be reconstructed in language for anyone not seeing the colour.
      el('span', { class: 'sm-mark sm-mark-bad', text: '✗', attrs: { 'aria-hidden': 'true' } }),
      shown === ''
        ? el('span', { class: 'sm-sr-only', text: tr('memory.ui.practice.srMissed', '(missed)') })
        : el('span', { class: 'sm-sr-only', text: tr('memory.ui.practice.srMissedYouTyped', '(missed, you typed') }),
      shown === '' ? null : el('span', { class: 'sm-word-typed', text: shown }),
      shown === '' ? null : el('span', { class: 'sm-sr-only', text: ')' }),
    ]),
  ]);
}

/** The next unanswered slot after `input`, if there is one. */
function nextSlotAfter(input: HTMLInputElement): HTMLInputElement | null {
  const root = input.closest('.sm-context') ?? input.ownerDocument.body;
  const slots = Array.from(root.querySelectorAll<HTMLInputElement>('.sm-fl, .sm-blank'));
  const index = slots.indexOf(input);
  return index >= 0 ? (slots[index + 1] ?? null) : null;
}

/**
 * Arrow-key navigation over a group of buttons.
 *
 * The picker has to be fully operable without a mouse, and Tab alone is a
 * clumsy way to move inside a list of options: it never wraps, and it walks
 * straight out of the group past the last item. Up/Down (and Left/Right, since
 * the list is a single column that becomes a row on a wide pane) move within
 * the group and wrap; Home and End jump to the ends.
 */
function attachListKeys(list: HTMLElement, buttons: HTMLButtonElement[]): void {
  if (buttons.length === 0) return;

  list.addEventListener('keydown', (ev) => {
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;

    let target = -1;
    switch (ev.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        target = (current + 1) % buttons.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        target = (current - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = buttons.length - 1;
        break;
      default:
        return;
    }

    ev.preventDefault();
    focusQuietly(buttons[target] ?? null);
  });
}

/**
 * The letter shown on a picker candidate: A, B, C, D, ... by its position in
 * the list. Only `a`-`z` are ever needed - `PICKER_CHOICES` in `session.ts`
 * is 4 - so a candidate past `z` (26th) simply gets no letter rather than a
 * two-character label that would not match any single keystroke.
 */
function letterFor(index: number): string {
  return index < 26 ? String.fromCharCode('a'.charCodeAt(0) + index).toUpperCase() : '';
}

/**
 * `a`-`z` shortcuts for the ordering picker: pressing a candidate's own
 * letter picks it, from anywhere in the list, without first moving focus onto
 * it with Tab or the arrows `attachListKeys` installs above.
 *
 * Deliberately narrow about when it fires - a stray letter typed into some
 * other control on the page, or one arriving mid-flight while a pick is being
 * graded or its "not that one" mark is still showing, must not be silently
 * queued and applied once the picker is ready again. It has to be ignored
 * outright, which is why `isLocked` is read at keydown time rather than the
 * event being allowed to sit anywhere.
 */
function attachLetterKeys(
  list: HTMLElement,
  buttons: HTMLButtonElement[],
  isLocked: () => boolean,
): void {
  if (buttons.length === 0) return;

  list.addEventListener('keydown', (ev) => {
    // A held-down key auto-repeating must not be able to walk through several
    // candidates from one physical press.
    if (ev.repeat) return;
    // Ctrl/Alt/Meta combinations are reserved for the browser and the OS
    // (Ctrl+A "select all" is the obvious collision); Shift is left alone
    // because a shifted letter is still the same letter and needs no
    // modifier to be typed.
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    const target = ev.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    if (isLocked()) return;

    if (ev.key.length !== 1) return;
    const letter = ev.key.toLowerCase();
    if (letter < 'a' || letter > 'z') return;

    const index = letter.charCodeAt(0) - 'a'.charCodeAt(0);
    const button = buttons[index];
    if (!button) return;

    ev.preventDefault();
    button.click();
  });
}
