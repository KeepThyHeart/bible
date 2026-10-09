/**
 * @vitest-environment jsdom
 *
 * Rendering tests: the part of the panel that had never been executed.
 *
 * `panel.test.ts` covers the panel's *decisions* - which card is next, how a
 * date reads, how an ambiguous `StepResult` maps back onto answers - and says
 * in its own header that none of the rendering, none of the event handling and
 * none of the measurement is covered because "those need a browser". They do,
 * and this file supplies one. The exercises are what the extension is for and
 * essentially all of their behaviour lives in the DOM, so a suite that stops at
 * the pure helpers is testing the easy half.
 *
 * The pragma above turns on `jsdom` for this file only rather than changing
 * `vitest.config.ts`: the rest of the suite is deliberately DOM-free (see the
 * note at the top of `format.ts`) and giving every test a document would
 * quietly remove the pressure that keeps the logic testable.
 *
 * WHAT IS ASSERTED, AND WHAT IS NOT. These tests assert what a user would
 * experience - the words on screen, which element is distinguished from its
 * neighbours, what a screen reader would be given, whether an input is sized to
 * its word - and avoid asserting on class names or markup shape wherever the
 * behaviour can be reached another way. Class names are used to *locate* nodes
 * in a couple of places where nothing else identifies them; they are not the
 * thing being checked.
 *
 * WHAT JSDOM CANNOT DO, stated once here rather than implied at each site:
 *
 *   - It has no layout engine. Every `getBoundingClientRect()` is zero, which
 *     is exactly the condition `WordMeasurer.measure` documents as "the panel
 *     is not being laid out" and falls back from. So the width assertions
 *     below exercise the documented fallback (`estimateTextWidth`) and check
 *     that it is proportional and respects its floor. A real pixel width for a
 *     real font cannot be produced here and is not claimed.
 *   - It does not resolve `var()`. Computed colours come back as the literal
 *     token reference, so "is this red?" is answered by following the token to
 *     the hex fallback declared in `styles.css`.
 *   - It does not evaluate `::after { content }`. The ✗ on a *picker*
 *     candidate is drawn that way, so the picker tests assert the candidate is
 *     visually distinguished from its siblings rather than looking for a glyph
 *     that jsdom will never generate. (The ✗ inside a missed *word* is a real
 *     text node and is asserted directly.)
 *
 * The panel's real stylesheet is loaded into the document, because several of
 * the decisions being guarded here - poetry indentation, context that is legible
 * rather than blurred, and above all the absence of any strike-through - are
 * expressed in CSS and would be reintroduced there, not in TypeScript.
 */
// Ported unchanged from the extension, whose tests were not type-checked; fixtures here
// predate later type changes. Behaviour is covered by vitest, not tsc.
// @ts-nocheck

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AnalyticsView,
  AnswerMode,
  BlanksStep,
  FirstLettersStep,
  OrderingStep,
  PanelReply,
  PanelRequest,
  Passage,
  PassageContext,
  PassageView,
  PlanView,
  RefMatchStep,
  RefProvideStep,
  RequestMap,
  Rung,
  RungView,
  SessionView,
  SettingsView,
  Step,
  StepResult,
  VerseText,
} from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import type { Flow, NavAction } from '../src/ui/state';
import { WordMeasurer, blankWidthFor, estimateTextWidth, MIN_BLANK_WIDTH_PX } from '../src/ui/measure';
import { renderPassage } from '../src/ui/scripture';
import { PracticeView } from '../src/ui/practiceView';
import { renderPlan } from '../src/ui/planView';
import { renderPassageScreen } from '../src/ui/passageView';
import { renderSettings } from '../src/ui/settingsView';
import { renderAnalytics } from '../src/ui/analyticsView';
import { renderManagePassages } from '../src/ui/managePassagesView';
import { activityRow, iconButton, listSelector, modal, tierPips } from '../src/ui/components';
import { RUNG_LABEL } from '../src/ui/format';
import { tierLabel } from '../src/core/ladder';
import { SUGGESTED_LISTS } from '../src/core/suggestedLists';

const SPEECH_OFF = {
  state: 'unavailable',
  missingPermissions: [],
  engineLabel: '',
  onDevice: false,
  handsFree: false,
} as const satisfies import('../src/core/types').SpeechAvailability;
const RECITE_DEFAULTS: import('../src/core/types').ReciteSettings = {
  strictness: 'normal',
  promptStyle: 'reference',
  feedback: 'brief',
  readBack: false,
  autoAdvance: false,
  voiceCommands: false,
  hintDelayMs: 5000,
};


// ---------------------------------------------------------------------------
// The panel's own stylesheet
// ---------------------------------------------------------------------------

const STYLESHEET_PATH = resolve(__dirname, '../src/ui/memory.css');
const STYLESHEET_TEXT = readFileSync(STYLESHEET_PATH, 'utf8');

/**
 * Every style rule in the sheet, flattened out of its `@media` blocks.
 *
 * Captured once, before the hover rules are pruned (see `installStylesheet`),
 * and read from parsed rules rather than the raw file text: the file's own
 * header comment contains the words "line-through" while promising there is no
 * such declaration, so a text search would report the promise as a violation of
 * itself.
 */
const ALL_RULE_TEXTS: string[] = [];

function eachStyleRule(rules: CSSRuleList, visit: (rule: CSSStyleRule) => void): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) visit(rule);
    const grouping = rule as CSSRule & { cssRules?: CSSRuleList };
    if (grouping.cssRules) eachStyleRule(grouping.cssRules, visit);
  }
}

/** Drops `:hover` / `:active` rules from a sheet or an `@media` block. */
function pruneHoverRules(container: CSSStyleSheet | CSSGroupingRule): void {
  const rules = container.cssRules;
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules.item(i)!;
    if (rule instanceof CSSStyleRule && /:hover|:active/.test(rule.selectorText)) {
      container.deleteRule(i);
      continue;
    }
    const grouping = rule as CSSRule & { cssRules?: CSSRuleList; deleteRule?: unknown };
    if (grouping.cssRules && typeof grouping.deleteRule === 'function') {
      pruneHoverRules(rule as CSSGroupingRule);
    }
  }
}

/**
 * Loads the panel's real stylesheet, then removes its `:hover` and `:active`
 * rules.
 *
 * The removal is a harness fix, not a statement about the panel. jsdom resolves
 * `:hover` against the focused element, so a control that has just been given
 * focus - which the picker does deliberately after a wrong pick - computes as
 * permanently hovered, and any test asking "does this element look different
 * from its siblings?" would then be answering a question about focus. The
 * hover rules are still captured for the strike-through scan below.
 */
function installStylesheet(): void {
  const style = document.createElement('style');
  style.textContent = STYLESHEET_TEXT;
  document.head.appendChild(style);
  // The sheet is scoped under `.sm-app`; the harness mounts views under <body>.
  document.body.classList.add('sm-app');

  const sheet = style.sheet as CSSStyleSheet;
  eachStyleRule(sheet.cssRules, (rule) => ALL_RULE_TEXTS.push(rule.cssText));
  pruneHoverRules(sheet);
}

/**
 * Follows a custom property to the hex it ultimately falls back to.
 *
 * jsdom does not resolve `var()`, so a computed colour arrives as the literal
 * string `var(--sm-danger)`. The tokens in `styles.css` are all of the form
 * `var(--theme-x, #rrggbb)` - the host's theme if it is there, a stated hex if
 * it is not - so the hex is what this panel renders when it is opened outside
 * the host, and it is the only concrete colour available to assert on.
 */
function tokenFallbackHexes(token: string): string[] {
  const pattern = new RegExp(`${token}\\s*:\\s*([^;]+);`, 'g');
  const hexes: string[] = [];
  for (const match of STYLESHEET_TEXT.matchAll(pattern)) {
    const hex = /#([0-9a-fA-F]{6})/.exec(match[1] ?? '');
    if (hex) hexes.push(`#${hex[1]!.toLowerCase()}`);
  }
  return hexes;
}

function isRed(hex: string): boolean {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return r > 120 && r > g * 1.8 && r > b * 1.8;
}

// ---------------------------------------------------------------------------
// Reading the tree the way a user would
// ---------------------------------------------------------------------------

/**
 * Blocks that put a line break between what is on either side of them.
 *
 * `textContent` concatenates with nothing in between, so three poetic lines
 * come back as "…ungodly,nor standeth…" and a test on the words of the verse
 * fails on an artefact rather than on the rendering. A reader sees a line
 * break, which is whitespace, so that is what this treats it as.
 */
const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'UL', 'OL', 'SECTION', 'HEADER', 'FOOTER', 'FORM',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR',
]);

/**
 * The text a reader gets, with the presentational bits taken out.
 *
 * Verse labels and the ✗ glyph are marked `aria-hidden`; dropping them leaves
 * the scripture itself plus the words written for a screen reader, which is
 * what nearly every assertion here is about.
 */
function spokenText(node: Node): string {
  const parts: string[] = [];

  const walk = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      parts.push(current.nodeValue ?? '');
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    const element = current as Element;
    if (element.getAttribute('aria-hidden') === 'true') return;

    const block = BLOCK_TAGS.has(element.tagName);
    if (block) parts.push(' ');
    for (const child of Array.from(element.childNodes)) walk(child);
    if (block) parts.push(' ');
  };

  walk(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * A few computed properties, as one comparable string.
 *
 * Used to ask "does this element look different from its siblings?" without
 * naming the class that makes it so. `var()` is not resolved by jsdom, but the
 * token *reference* still differs between a marked and an unmarked candidate,
 * which is the whole question.
 */
function visualSignature(node: Element): string {
  const cs = getComputedStyle(node);
  return [cs.background, cs.backgroundColor, cs.color, cs.boxShadow].join('|');
}

/** Every element in a tree, the root included. */
function everyElement(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll('*'))];
}

/**
 * Anything that would draw a line through text, by any route.
 *
 * Three routes exist and all three are checked, because ruling out only the one
 * that happens to be in use today is how a rule like this comes back: an inline
 * style written by a view, a declaration in the stylesheet, and the elements
 * that are struck through by default with no CSS at all.
 */
function strikeThroughOffenders(root: Element): string[] {
  const offenders: string[] = [];

  for (const node of everyElement(root)) {
    if (['S', 'STRIKE', 'DEL'].includes(node.tagName)) {
      offenders.push(`<${node.tagName.toLowerCase()}> element`);
    }
    const inline = (node as HTMLElement).style;
    const declared = `${inline.textDecoration} ${inline.textDecorationLine}`;
    if (declared.includes('line-through')) offenders.push(`inline style on ${node.tagName}`);

    const cs = getComputedStyle(node);
    if (`${cs.textDecoration} ${cs.textDecorationLine}`.includes('line-through')) {
      offenders.push(`computed style on ${node.tagName}.${node.className}`);
    }
  }

  for (const rule of ALL_RULE_TEXTS) {
    if (rule.includes('line-through')) offenders.push(`rule ${rule.slice(0, 60)}`);
  }

  return offenders;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 2, 12, 9, 0, 0);

/**
 * Psalm 1:1 - three poetic lines at three different indent levels.
 *
 * The shape is the point. `Line.end` is documented as INCLUSIVE, and the cost
 * of reading it as exclusive is that the last word of every line disappears -
 * "the counsel of the", "the way of", "the seat of the" - which reads as a
 * slightly odd line break rather than as a bug. A fixture whose lines all end
 * on a memorable word makes that failure loud.
 */
const PSALM_1_1: VerseText = {
  verseId: 19001001,
  label: '1:1',
  words: [
    'Blessed', 'is', 'the', 'man', 'that', 'walketh', 'not', 'in', 'the',
    'counsel', 'of', 'the', 'ungodly,',
    'nor', 'standeth', 'in', 'the', 'way', 'of', 'sinners,',
    'nor', 'sitteth', 'in', 'the', 'seat', 'of', 'the', 'scornful.',
  ],
  lines: [
    { start: 0, end: 12, level: 1 },
    { start: 13, end: 19, level: 2 },
    { start: 20, end: 27, level: 3 },
  ],
  psalmTitle: null,
  paragraphStart: true,
};

const PSALM_1_2: VerseText = {
  verseId: 19001002,
  label: '1:2',
  words: [
    'But', 'his', 'delight', 'is', 'in', 'the', 'law', 'of', 'the', 'LORD;',
    'and', 'in', 'his', 'law', 'doth', 'he', 'meditate', 'day', 'and', 'night.',
  ],
  lines: [
    { start: 0, end: 9, level: 1 },
    { start: 10, end: 19, level: 2 },
  ],
  psalmTitle: null,
  paragraphStart: false,
};

const PSALM_1_3: VerseText = {
  verseId: 19001003,
  label: '1:3',
  words: [
    'And', 'he', 'shall', 'be', 'like', 'a', 'tree', 'planted', 'by', 'the',
    'rivers', 'of', 'water',
  ],
  lines: [
    { start: 0, end: 5, level: 1 },
    { start: 6, end: 12, level: 2 },
  ],
  psalmTitle: null,
  paragraphStart: false,
};

/** A superscription-bearing verse. The only "heading" the data ever carries. */
const PSALM_3_1: VerseText = {
  verseId: 19003001,
  label: '3:1',
  words: ['LORD,', 'how', 'are', 'they', 'increased', 'that', 'trouble', 'me!'],
  lines: [{ start: 0, end: 7, level: 1 }],
  psalmTitle: 'A Psalm of David, when he fled from Absalom his son.',
  paragraphStart: true,
};

/** Prose: `lines` is null, so it must not be broken into indented lines. */
const JOHN_3_16: VerseText = {
  verseId: 43003016,
  label: '3:16',
  words: [
    'For', 'God', 'so', 'loved', 'the', 'world,', 'that', 'he', 'gave', 'his',
    'only', 'begotten', 'Son.',
  ],
  lines: null,
  psalmTitle: null,
  paragraphStart: true,
};

const JOHN_3_17: VerseText = {
  ...JOHN_3_16,
  verseId: 43003017,
  label: '3:17',
  words: ['For', 'God', 'sent', 'not', 'his', 'Son', 'to', 'condemn', 'the', 'world.'],
  paragraphStart: false,
};

/** The passage under exercise, with a verse of context before it. */
function psalmContext(): PassageContext {
  return {
    passageId: 1,
    reference: 'Psalm 1:2-3',
    before: [PSALM_1_1],
    verses: [PSALM_1_2, PSALM_1_3],
    // Empty during an exercise, by design - the verses after the working point
    // are the answer to the ordering picker.
    after: [],
  };
}

function session(step: Step | null, over: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'session-1',
    passageId: 1,
    rung: 'blanks',
    step,
    correctFirst: 0,
    stepsTaken: 0,
    ...over,
  };
}

/**
 * `fullWord` by default: most of this describe block exercises the Check-
 * button, measured-width flow, which is what `blanks` looked like before task
 * 0004 made the answer mode a setting. The `firstLetter` describe block below
 * passes `'firstLetter'` explicitly to exercise the new default instead.
 */
function blanksStep(verse: VerseText, blankIndices: number[], answerMode: AnswerMode = 'fullWord'): BlanksStep {
  return {
    kind: 'blanks',
    verses: [verse],
    blanks: [{ verseId: verse.verseId, indices: blankIndices }],
    answerMode,
    stepNumber: 1,
    totalSteps: 2,
  };
}

/**
 * The standard pair of blanks: "his" (1) and "law" (6) in Psalm 1:2.
 *
 * Both sit in the verse's first poetic line, and both are three letters long
 * while rendering at visibly different widths - which is what makes them useful
 * for the sizing tests, since a character count cannot tell them apart.
 *
 * The working verse is deliberately one of `PassageContext.verses` rather than
 * one of `before`: `renderWorkingPassage` substitutes the step's copy of the
 * verse into the context by verse id, so a step whose verse is not in the
 * passage renders no exercise at all.
 */
const BLANKED = [1, 6];

/**
 * `tier` defaults to `1` (hard) rather than `0`: every pre-T14 call site in
 * this file omits it and expects the verse to be blanked immediately, with no
 * "Start" preview in the way - see `practiceView.ts#renderFirstLetters`,
 * which only shows the preview at `tier === 0`.
 */
function firstLettersStep(
  verse: VerseText,
  answerMode: AnswerMode = 'firstLetter',
  tier = 1,
): FirstLettersStep {
  return { kind: 'firstletters', verse, answerMode, tier, stepNumber: 1, totalSteps: 2 };
}

function orderingStep(): OrderingStep {
  return {
    kind: 'ordering',
    placed: [PSALM_1_1],
    candidates: [
      { verseId: 19001004, preview: 'The ungodly are not so', truncated: false },
      { verseId: 19001002, preview: 'But his delight is in the law of the LORD', truncated: true },
      { verseId: 19001003, preview: 'And he shall be like a tree planted', truncated: true },
    ],
    stepNumber: 2,
    totalSteps: 3,
  };
}

function stepResult(over: Partial<StepResult> = {}): StepResult {
  return { correct: false, wrong: [], blocking: false, ...over };
}

function emptyPlan(): PlanView {
  return {
    collectionId: 1,
    collectionName: 'My plan',
    lists: [{ id: 1, name: 'Default', passageCount: 0, verseCount: 0 }],
    scope: 'all',
    scopeVerseCount: 0,
    referenceActivitiesUnlocked: false,
    sortOrder: 'bible',
    passages: [],
    totalDue: 0,
    speech: SPEECH_OFF,
    reciteDueCount: 0,
    cardsWaiting: 0,
    defaultAnswerMode: 'firstLetter',
  };
}

function rungView(over: Partial<RungView> & Pick<RungView, 'rung'>): RungView {
  return {
    level: 0,
    dueAt: null,
    streak: 0,
    lastScore: null,
    applicable: true,
    resume: null,
    tiers: 2,
    tiersPassed: 0,
    bestScore: null,
    attempts: 0,
    nextTier: 0,
    ...over,
  };
}

function passageFixture(over: Partial<Passage> = {}): Passage {
  return {
    id: 10,
    collectionId: 1,
    moduleId: 'kjv',
    startVerseId: 19023001,
    endVerseId: 19023006,
    reference: 'Psalm 23:1-6',
    verseCount: 6,
    addedAt: NOW - 30 * 86_400_000,
    answerMode: null,
    reciteOn: false,
    ...over,
  };
}

function passageViewFixture(over: Partial<PassageView> = {}): PassageView {
  return {
    passage: passageFixture(),
    dueCount: 0,
    bestLevel: 0,
    wellLearned: false,
    rungs: [
      rungView({ rung: 'ordering', level: 3 }),
      rungView({ rung: 'refmatch', applicable: false }),
      rungView({ rung: 'blanks', level: 1, dueAt: NOW - 60_000 }),
      rungView({ rung: 'firstletters' }),
    ],
    ...over,
  };
}

function emptyAnalytics(): AnalyticsView {
  return {
    streakDays: 0,
    versesLearned: 0,
    passagesWellLearned: 0,
    calendar: [],
    recentlyReached: [],
    nextMilestone: { versesLearned: 5, toGo: 5 },
  };
}

// ---------------------------------------------------------------------------
// A stub host
// ---------------------------------------------------------------------------

type Handlers = {
  [K in PanelRequest['type']]?: (request: Extract<PanelRequest, { type: K }>) => PanelReply<RequestMap[K]>;
};

/**
 * Everything a view is allowed to reach, faked.
 *
 * `PanelHost` exists precisely so the screens can be rendered without the SDK
 * (see its own header), and this is the harness that claim was made for. The
 * measurer is real, not stubbed: the width behaviour under test is its
 * fallback path, and stubbing it would test the stub.
 */
class TestHost implements PanelHost {
  readonly requests: PanelRequest[] = [];
  readonly announcements: string[] = [];
  readonly navigations: NavAction[] = [];
  readonly sessionsStarted: { passageId: number; rung?: Rung; restart?: boolean; tier?: number }[] = [];
  readonly openedVerses: number[] = [];
  readonly flowsStarted: { flow: Flow; exclude?: ReadonlySet<number> }[] = [];
  reloads = 0;
  activeReference: string | null = null;
  readonly measurer: WordMeasurer;
  handlers: Handlers = {};

  constructor() {
    this.measurer = new WordMeasurer(document);
  }

  now(): number {
    return NOW;
  }

  request<R extends PanelRequest>(request: R): Promise<PanelReply<RequestMap[R['type']]>> {
    this.requests.push(request);
    const handler = this.handlers[request.type] as
      | ((r: PanelRequest) => PanelReply<RequestMap[R['type']]>)
      | undefined;
    if (!handler) {
      return Promise.resolve({
        ok: false,
        error: `No stub registered for "${request.type}".`,
      });
    }
    return Promise.resolve(handler(request));
  }

  go(action: NavAction): void {
    this.navigations.push(action);
  }

  reload(): void {
    this.reloads += 1;
  }

  async startSession(passageId: number, rung?: Rung, restart?: boolean, tier?: number, flow?: Flow): Promise<void> {
    void flow;
    this.sessionsStarted.push({ passageId, rung, restart, tier });
  }

  async startFlow(flow: Flow, exclude?: ReadonlySet<number>): Promise<void> {
    this.flowsStarted.push({ flow, exclude });
  }

  openInBible(verseId: number): void {
    this.openedVerses.push(verseId);
  }

  announce(message: string): void {
    this.announcements.push(message);
  }
}

/** Lets the stubbed replies - all immediate - reach the view. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

let container: HTMLElement;
let host: TestHost;
let view: PracticeView | null = null;

/**
 * Mounts a practice view with the standard Psalm 1 context available.
 *
 * `passageViewReply` defaults to `passageViewFixture()` - three applicable
 * activities (`ordering`, `blanks`, `firstletters`; `refmatch` is gated out) -
 * so the T13 tab strip has something to draw in every test that does not
 * override it, the same way `getContext` already defaults to `psalmContext()`.
 */
async function mountPractice(
  step: Step | null,
  over: Partial<SessionView> = {},
  contextReply?: PanelReply<PassageContext>,
  passageViewReply?: PanelReply<PassageView>,
): Promise<PracticeView> {
  host.handlers.getContext = () => contextReply ?? { ok: true, data: psalmContext() };
  host.handlers.getPassageView = () => passageViewReply ?? { ok: true, data: passageViewFixture() };
  const practice = new PracticeView(host, session(step, over));
  practice.mount(container);
  await settle();
  view = practice;
  return practice;
}

/** The verse the exercise is about, as the accessibility tree marks it. */
function workingVerse(root: HTMLElement): HTMLElement {
  const found = root.querySelectorAll<HTMLElement>('[aria-current="step"]');
  expect(found.length).toBe(1);
  return found[0]!;
}

beforeAll(() => {
  installStylesheet();
});

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  host = new TestHost();
});

afterEach(() => {
  view?.destroy();
  view = null;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 1. Scripture
// ---------------------------------------------------------------------------

describe('scripture rendering', () => {
  function render(verses: VerseText[]): HTMLElement {
    const wrapper = document.createElement('div');
    for (const block of renderPassage(verses, () => ({}))) wrapper.appendChild(block);
    container.appendChild(wrapper);
    return wrapper;
  }

  it('lays a poetic verse out as its lines, not as a paragraph', () => {
    const wrapper = render([PSALM_1_1]);
    const verse = wrapper.firstElementChild!;

    // Three lines in, three blocks out. A wrapped paragraph would be one.
    expect(verse.children.length).toBe(3);
    expect(spokenText(verse.children[0]!)).toBe(
      'Blessed is the man that walketh not in the counsel of the ungodly,',
    );
    expect(spokenText(verse.children[1]!)).toBe('nor standeth in the way of sinners,');
    expect(spokenText(verse.children[2]!)).toBe('nor sitteth in the seat of the scornful.');
  });

  it('treats Line.end as inclusive, so no line loses its last word', () => {
    const wrapper = render([PSALM_1_1]);
    const verse = wrapper.firstElementChild!;

    // The exclusive reading drops exactly these three words and nothing else,
    // which is why it survives a casual look at the screen.
    for (const lastWord of ['ungodly,', 'sinners,', 'scornful.']) {
      expect(spokenText(verse)).toContain(lastWord);
    }
    // Stronger: every word, once, in order.
    expect(spokenText(verse)).toBe(PSALM_1_1.words.join(' '));
  });

  it('indents each line further than the one above it', () => {
    const wrapper = render([PSALM_1_1]);
    const verse = wrapper.firstElementChild!;

    const indents = Array.from(verse.children).map((line) =>
      Number.parseFloat(getComputedStyle(line).paddingLeft),
    );

    expect(indents.every((n) => Number.isFinite(n))).toBe(true);
    expect(indents[0]!).toBeLessThan(indents[1]!);
    expect(indents[1]!).toBeLessThan(indents[2]!);
  });

  it('does not break prose into indented lines', () => {
    const wrapper = render([JOHN_3_16, JOHN_3_17]);

    // One paragraph, because `paragraphStart` is false on the second verse:
    // prose flows across verse boundaries.
    expect(wrapper.children.length).toBe(1);
    expect(wrapper.firstElementChild!.tagName).toBe('P');
    expect(spokenText(wrapper)).toBe(
      `${JOHN_3_16.words.join(' ')} ${JOHN_3_17.words.join(' ')}`,
    );

    // Nothing here is a poetic line, and nothing here is indented.
    const indented = everyElement(wrapper).filter(
      (n) => Number.parseFloat(getComputedStyle(n).paddingLeft) > 0,
    );
    expect(indented).toEqual([]);
  });

  it('starts a new paragraph where the data says to', () => {
    const wrapper = render([JOHN_3_16, { ...JOHN_3_17, paragraphStart: true }]);
    expect(wrapper.children.length).toBe(2);
  });

  it('recovers words the line markup leaves off the end of a verse', () => {
    // A module whose poetry markup does not cover the whole verse is a real
    // possibility, and a verse that silently lost its last seven words would be
    // very hard to spot - it would read as a slightly short line. The trailing
    // shortfall is emitted rather than dropped.
    //
    // Only the trailing shortfall: a gap *before* `lines[0].start` or between
    // two lines is still dropped, which is worth knowing when reading the
    // coverage tracking in `renderPoetryVerse`.
    const undercovered: VerseText = {
      ...PSALM_1_3,
      lines: [{ start: 0, end: 5, level: 1 }],
    };
    const wrapper = render([undercovered]);
    expect(spokenText(wrapper)).toBe(PSALM_1_3.words.join(' '));
  });

  it('renders a psalm superscription as its own block of text', () => {
    const wrapper = render([PSALM_3_1]);

    expect(wrapper.children.length).toBe(2);
    expect(spokenText(wrapper.children[0]!)).toBe(PSALM_3_1.psalmTitle);
    expect(spokenText(wrapper.children[1]!)).toBe(PSALM_3_1.words.join(' '));
  });

  it('emits no section headings - the superscription is text, not a heading', () => {
    const wrapper = render([PSALM_3_1, PSALM_1_1, JOHN_3_16]);

    // There are no headings in the data and none are invented. A superscription
    // rendered as an <h2> would be announced as a document landmark, which is a
    // claim about the text that USFM \d does not make.
    expect(wrapper.querySelectorAll('h1, h2, h3, h4, h5, h6').length).toBe(0);
    expect(wrapper.querySelectorAll('[role="heading"]').length).toBe(0);
  });

  it('keeps the verse label out of the reading text and out of the spoken text', () => {
    const wrapper = render([PSALM_1_1]);
    // Visible in the margin...
    expect(wrapper.textContent).toContain('1:1');
    // ...but not part of the verse as far as assistive tech is concerned.
    expect(spokenText(wrapper)).not.toContain('1:1');
  });
});

// ---------------------------------------------------------------------------
// 2. The working verse among its context
// ---------------------------------------------------------------------------

function crumbLabels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.sm-crumb-item')).map((n) => n.textContent ?? '');
}

describe('the working verse among its context', () => {
  it('shows the reference as the passage crumb as soon as context arrives, before any answer is submitted', async () => {
    // The breadcrumb's current crumb comes from `PassageContext.reference` alone, fetched
    // separately from the step and deliberately not awaited before the first
    // paint (see `practiceView.ts#loadContext`'s own header). Before this,
    // nothing re-rendered the head once that fetch resolved, so the title
    // sat blank until the next unrelated redraw (the first submitted
    // answer) - exactly what a review round flagged as the reference not
    // being prominent on this screen.
    const practice = await mountPractice(blanksStep(PSALM_1_2, [2, 16]));

    expect(crumbLabels(practice.root)).toEqual(['Home', 'Psalm 1:2-3', RUNG_LABEL.blanks]);
  });

  it('marks exactly one verse as the one being worked on', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, [2, 16]));

    const current = workingVerse(practice.root);
    expect(current.getAttribute('data-verse-id')).toBe(String(PSALM_1_2.verseId));
  });

  it('draws the working verse differently from every verse around it', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, [2, 16]));

    const current = workingVerse(practice.root);
    const others = Array.from(
      practice.root.querySelectorAll<HTMLElement>('[data-verse-id]'),
    ).filter((n) => n !== current);

    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(visualSignature(other)).not.toBe(visualSignature(current));
    }
  });

  it('renders context as real, readable text rather than placeholder shapes', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, [2, 16]));

    // Psalm 1:1 comes from `PassageContext.before`; Psalm 1:3 from the passage
    // itself. Both are context here, and both must be readable.
    const before = practice.root.querySelector<HTMLElement>(
      `[data-verse-id="${PSALM_1_1.verseId}"]`,
    )!;
    const after = practice.root.querySelector<HTMLElement>(
      `[data-verse-id="${PSALM_1_3.verseId}"]`,
    )!;

    expect(spokenText(before)).toBe(PSALM_1_1.words.join(' '));
    expect(spokenText(after)).toBe(PSALM_1_3.words.join(' '));
  });

  it('does not blur or ghost the context it just made readable', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, [2, 16]));

    // "A small step down in contrast, not a blur and not a 30%-opacity ghost"
    // is the stated rule, and it is a rule that a later styling tweak could
    // undo without anyone noticing the reading experience had gone.
    for (const node of everyElement(practice.root)) {
      const cs = getComputedStyle(node);
      expect(cs.filter).not.toContain('blur');
      expect(cs.webkitFilter ?? '').not.toContain('blur');
      const opacity = Number.parseFloat(cs.opacity);
      if (Number.isFinite(opacity)) expect(opacity).toBeGreaterThanOrEqual(0.6);
      expect(cs.visibility).not.toBe('hidden');
      expect(cs.color).not.toContain('transparent');
    }
  });

  it('renders nothing at all for the withheld verses after the working point', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, [2, 16]));

    // `PassageContext.after` is empty during an exercise. An "…" or an empty
    // bordered box would read as a passage that failed to load.
    const verses = Array.from(
      practice.root.querySelectorAll<HTMLElement>('[data-verse-id]'),
    ).map((n) => n.getAttribute('data-verse-id'));

    expect(verses.sort()).toEqual(
      [PSALM_1_1, PSALM_1_2, PSALM_1_3].map((v) => String(v.verseId)).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. The ordering picker blocks
// ---------------------------------------------------------------------------

describe('the ordering picker', () => {
  /** The candidates, in the order they are offered. */
  function candidates(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-choice'));
  }

  /** The one candidate that is drawn differently from the rest, if any. */
  function markedCandidate(root: HTMLElement): HTMLButtonElement | null {
    const all = candidates(root);
    const signatures = all.map(visualSignature);
    const odd = signatures
      .map((sig, i) => ({ sig, i }))
      .filter(({ sig }) => signatures.filter((s) => s === sig).length === 1);
    return odd.length === 1 ? all[odd[0]!.i]! : null;
  }

  async function pickWrong(): Promise<{ practice: PracticeView; step: OrderingStep }> {
    const step = orderingStep();
    const held = session(step, { rung: 'ordering' });
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        // Wrong, and the picker blocks: the SAME step comes back.
        result: stepResult({ correct: false, wrong: [19001004], blocking: true }),
        session: held,
        summary: null,
      },
    });

    const practice = await mountPractice(step, { rung: 'ordering' });
    vi.useFakeTimers();
    candidates(practice.root)[0]!.click();
    await settle();
    return { practice, step };
  }

  it('marks the candidate that was clicked', async () => {
    const { practice } = await pickWrong();

    const marked = markedCandidate(practice.root);
    expect(marked).not.toBeNull();
    expect(marked!.getAttribute('data-verse-id')).toBe('19001004');
  });

  it('keeps the same step on screen instead of advancing past a wrong pick', async () => {
    const { practice, step } = await pickWrong();

    // Same question, same three candidates, in the same order.
    expect(spokenText(practice.root)).toContain('Which verse comes next?');
    expect(
      candidates(practice.root).map((c) => c.getAttribute('data-verse-id')),
    ).toEqual(step.candidates.map((c) => String(c.verseId)));
  });

  it('says why, out loud, rather than only in colour', async () => {
    const { practice } = await pickWrong();

    const live = practice.root.querySelector<HTMLElement>('[aria-live]')!;
    expect(spokenText(live)).toContain('Not that one');
  });

  it('lets the mark expire - it says "not that one", it does not keep a tally', async () => {
    const { practice } = await pickWrong();
    expect(markedCandidate(practice.root)).not.toBeNull();

    // The blocked step is handed back clean. A mark that survived into the
    // retry would turn a hint into a scoreboard, which is explicitly not what
    // it is for; a second wrong pick would then leave two candidates marked and
    // the picker would look like it was accumulating a verdict.
    vi.advanceTimersByTime(2_000);

    expect(markedCandidate(practice.root)).toBeNull();
    const live = practice.root.querySelector<HTMLElement>('[aria-live]')!;
    expect(spokenText(live)).toBe('');
  });

  it('does not submit twice while a pick is still in flight', async () => {
    const step = orderingStep();
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: false, wrong: [19001004], blocking: true }),
        session: session(step, { rung: 'ordering' }),
        summary: null,
      },
    });

    const practice = await mountPractice(step, { rung: 'ordering' });
    vi.useFakeTimers();

    const buttons = candidates(practice.root);
    buttons[0]!.click();
    buttons[1]!.click();
    await settle();

    // Double-clicking a candidate must not score the step twice.
    expect(host.requests.filter((r) => r.type === 'submitStep').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Blanks
// ---------------------------------------------------------------------------

describe('blanks', () => {
  /** The measurement `measure.ts` will actually be able to take under jsdom. */
  function fallbackWidthFor(word: string, sample: Element): number {
    const parsed = Number.parseFloat(getComputedStyle(sample).fontSize);
    const fontPx = Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
    return blankWidthFor(estimateTextWidth(word, fontPx));
  }

  function blanks(root: HTMLElement): HTMLInputElement[] {
    return Array.from(root.querySelectorAll<HTMLInputElement>('.sm-blank'));
  }

  it('puts an input where the word goes, inside the line it belongs to', async () => {
    // "his" (index 1) and "law" (index 6) both sit in the first poetic line of
    // Psalm 1:2.
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    const current = workingVerse(practice.root);
    const inputs = blanks(practice.root);
    expect(inputs.length).toBe(2);

    // Both blanks are inside the first line, not in an answer box below the
    // passage - the arrangement that was explicitly rejected.
    const firstLine = current.children[0]!;
    for (const input of inputs) expect(firstLine.contains(input)).toBe(true);
  });

  it('still renders every word that was not blanked', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    const hidden = new Set(BLANKED);
    const expected = PSALM_1_2.words.filter((_, i) => !hidden.has(i)).join(' ');
    expect(spokenText(workingVerse(practice.root))).toBe(expected);
  });

  it('sizes each blank from a measurement rather than leaving it at a default', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    const current = workingVerse(practice.root);
    for (const [i, input] of blanks(practice.root).entries()) {
      const word = PSALM_1_2.words[BLANKED[i]!]!;
      expect(input.style.width).not.toBe('');
      // jsdom reports zero for every text metric, which is exactly the
      // condition `WordMeasurer.measure` documents and falls back from, so what
      // is being checked here is the fallback: the input carries the estimate,
      // not the browser's default input width and not a zero.
      expect(Number.parseFloat(input.style.width)).toBe(fallbackWidthFor(word, current));
    }
  });

  it('is proportional, not a character count - two 3-letter words differ', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    const [his, law] = blanks(practice.root);
    expect(PSALM_1_2.words[1]).toBe('his');
    expect(PSALM_1_2.words[6]).toBe('law');

    // `size=3` or `width: 3ch` would give these two the same box despite "law"
    // being visibly the wider word - `ch` is the advance of "0", so it cannot
    // tell an "i" from a "w". That is the failure this whole measurement path
    // exists to avoid, and it is invisible in a screenshot.
    expect(Number.parseFloat(law!.style.width)).toBeGreaterThan(
      Number.parseFloat(his!.style.width),
    );
  });

  it('respects the floor, so a one-letter word is still something you can hit', async () => {
    // "a" is word 5 of Psalm 1:3. Its estimate is about eight pixels.
    const practice = await mountPractice(blanksStep(PSALM_1_3, [5]));

    const input = blanks(practice.root)[0]!;
    expect(PSALM_1_3.words[5]).toBe('a');
    expect(Number.parseFloat(input.style.width)).toBe(MIN_BLANK_WIDTH_PX);
  });

  it('does NOT grow a blank that is overtyped (T17: it scrolls instead)', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    const input = blanks(practice.root)[0]!;
    const initial = Number.parseFloat(input.style.width);

    input.value = 'hishishishis';
    input.dispatchEvent(new Event('input'));
    expect(Number.parseFloat(input.style.width)).toBe(initial);
    expect(Number.parseFloat(input.parentElement!.style.width)).toBe(initial);
  });
});

// ---------------------------------------------------------------------------
// 4a. Blanks in firstLetter mode - the default answer mode (task 0004)
// ---------------------------------------------------------------------------

describe('blanks in firstLetter mode (the default)', () => {
  it('hides the blanked words completely - no letter shown, no Check button', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED, 'firstLetter'));

    const inputs = Array.from(practice.root.querySelectorAll<HTMLInputElement>('.sm-fl'));
    expect(inputs.length).toBe(BLANKED.length);
    for (const input of inputs) {
      expect(input.getAttribute('placeholder')).toBeNull();
      expect(input.getAttribute('maxlength')).toBe('1');
    }
    // firstLetter mode has nothing left to confirm once every slot resolves,
    // so there is no Check button at all - unlike fullWord mode above.
    expect(practice.root.querySelector('.sm-exercise-actions button')).toBeNull();
  });

  it('reveals the whole word on a correct letter and moves to the next blank', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED, 'firstLetter'));

    const input = practice.root.querySelectorAll<HTMLInputElement>('.sm-fl')[0]!; // "his"
    input.value = 'h';
    input.dispatchEvent(new Event('input'));

    expect(spokenText(workingVerse(practice.root))).toContain('his');
    // One blank left ("law"); the other word is not blanked at all.
    expect(practice.root.querySelectorAll('.sm-fl').length).toBe(1);
  });

  it('submits automatically once every blank is resolved, with no confirmation step', async () => {
    let submitted: unknown = null;
    host.handlers.submitStep = (req) => {
      submitted = req.answer;
      return {
        ok: true,
        data: { result: stepResult({ correct: true }), session: session(null), summary: null },
      };
    };

    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED, 'firstLetter'));
    const first = practice.root.querySelectorAll<HTMLInputElement>('.sm-fl')[0]!;
    first.value = 'h';
    first.dispatchEvent(new Event('input'));

    const second = practice.root.querySelectorAll<HTMLInputElement>('.sm-fl')[0]!;
    second.value = 'l';
    second.dispatchEvent(new Event('input'));
    await settle();

    expect(submitted).toMatchObject({ kind: 'blanks', words: ['his', 'law'] });
  });
});

// ---------------------------------------------------------------------------
// 5. Wrong answers
// ---------------------------------------------------------------------------

describe('a missed word', () => {
  async function submitOneWrong(): Promise<PracticeView> {
    const step = blanksStep(PSALM_1_2, BLANKED);
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        // `wrong: [1]` is a flat blank position - the second blank ("law"),
        // not a word index within the verse.
        result: stepResult({
          correct: false,
          wrong: [1],
          blocking: false,
          reveal: { words: ['his', 'law'] },
        }),
        session: session(null),
        summary: null,
      },
    });

    const practice = await mountPractice(step);
    const inputs = Array.from(practice.root.querySelectorAll<HTMLInputElement>('.sm-blank'));
    inputs[0]!.value = 'his';
    inputs[1]!.value = 'lore';

    practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();
    return practice;
  }

  it('shows the right word and the wrong answer beside it, both readable', async () => {
    const practice = await submitOneWrong();
    const text = spokenText(workingVerse(practice.root));

    // The verse is intact - "law" is back in its place in the line - and what
    // the user actually typed is shown next to it, named as a miss rather than
    // left to be inferred from a colour.
    expect(text).toContain('But his delight is in the law');
    expect(text).toContain('of the LORD;');
    expect(text).toContain('lore');
    expect(text).toContain('missed');
  });

  it('marks the miss with a ✗ that is not the only thing carrying the meaning', async () => {
    const practice = await submitOneWrong();
    const current = workingVerse(practice.root);

    // The glyph is present for a sighted reader...
    expect(current.textContent).toContain('✗');
    // ...and hidden from assistive tech, which gets words instead. A bare ✗ is
    // announced as "multiplication sign" or skipped entirely.
    const marks = Array.from(current.querySelectorAll('[aria-hidden="true"]')).filter((n) =>
      (n.textContent ?? '').includes('✗'),
    );
    expect(marks.length).toBe(1);
  });

  it('renders the wrong answer in red', async () => {
    const practice = await submitOneWrong();

    const typed = everyElement(workingVerse(practice.root)).find(
      (n) => n.children.length === 0 && n.textContent === 'lore',
    )!;
    expect(typed).toBeTruthy();

    // jsdom does not resolve custom properties, so the chain is followed by
    // hand: the element's colour is a danger token, and every value that token
    // is defined with in `styles.css` - light theme and dark - is a red.
    const colour = getComputedStyle(typed.parentElement ?? typed).color;
    const token = /var\((--[\w-]+)/.exec(colour)?.[1];
    expect(token, `expected a colour token, got ${JSON.stringify(colour)}`).toBeTruthy();
    expect(token).toContain('danger');

    const hexes = tokenFallbackHexes(token!);
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) expect(isRed(hex), `${token} = ${hex}`).toBe(true);
  });

  it('leaves the word that was right unmarked', async () => {
    const practice = await submitOneWrong();
    const current = workingVerse(practice.root);

    // Exactly one miss, not two: the resolution of `StepResult.wrong` onto
    // positions is what decides which words go red, and getting it wrong looks
    // like a scoring bug in the worker.
    expect((spokenText(current).match(/missed/g) ?? []).length).toBe(1);
    expect(spokenText(current)).toContain('But his delight');
  });

  it('never strikes scripture through, by any route', async () => {
    const practice = await submitOneWrong();

    // An explicit user decision: the mistake gets a mark, the words of the
    // verse are not defaced. Checked against inline styles, computed styles,
    // the elements that strike through with no CSS at all, and every rule in
    // the panel's own stylesheet - because the stylesheet is where a "tidy-up"
    // would reintroduce it.
    expect(strikeThroughOffenders(practice.root)).toEqual([]);
    expect(strikeThroughOffenders(document.body)).toEqual([]);
  });

  it('would notice if a strike-through were reintroduced', () => {
    // A rule this important must not be able to pass by being a no-op - an
    // empty rule list or a property jsdom does not model would make the check
    // above green forever. So the detector is shown catching each of the three
    // routes it claims to cover.
    expect(ALL_RULE_TEXTS.length).toBeGreaterThan(50);

    const planted = document.createElement('div');
    planted.innerHTML =
      '<span style="text-decoration: line-through">a</span><del>b</del>';
    container.appendChild(planted);

    const offenders = strikeThroughOffenders(planted);
    expect(offenders.some((o) => o.includes('inline style'))).toBe(true);
    expect(offenders.some((o) => o.includes('<del>'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. First letters
// ---------------------------------------------------------------------------

describe('first letters', () => {
  function slots(root: HTMLElement): HTMLInputElement[] {
    return Array.from(root.querySelectorAll<HTMLInputElement>('.sm-fl'));
  }

  it('shows nothing of the word - not even its first letter', async () => {
    // Task 0004, point 1: v0 put the initial in the box as a placeholder,
    // which turned this into a copy exercise rather than a recall one. The
    // box must be empty until the user types into it.
    const practice = await mountPractice(firstLettersStep(PSALM_1_3), { rung: 'firstletters' });

    const inputs = slots(practice.root);
    expect(inputs.length).toBe(PSALM_1_3.words.length);

    inputs.forEach((input) => {
      // No placeholder at all - not the letter, not anything derived from it.
      expect(input.getAttribute('placeholder')).toBeNull();
      expect(input.getAttribute('maxlength')).toBe('1');
      expect(input.value).toBe('');
    });
    expect(spokenText(workingVerse(practice.root))).toBe('');
  });

  it('reveals the WHOLE word on a correct initial - there is no partial tier', async () => {
    const practice = await mountPractice(firstLettersStep(PSALM_1_3), { rung: 'firstletters' });

    const input = slots(practice.root)[7]!; // "planted"
    input.value = 'p';
    input.dispatchEvent(new Event('input'));

    // Not "p...", not "pl", not "p_____": the word. The staged partial reveal
    // in the older design was cut, and a tier creeping back in would be a
    // change to what this rung actually trains.
    expect(spokenText(workingVerse(practice.root))).toBe('planted');
    expect(slots(practice.root).length).toBe(PSALM_1_3.words.length - 1);
  });

  it('reveals the word on a wrong initial too, and marks it missed', async () => {
    const practice = await mountPractice(firstLettersStep(PSALM_1_3), { rung: 'firstletters' });

    const input = slots(practice.root)[7]!; // "planted"
    input.value = 'x';
    input.dispatchEvent(new Event('input'));

    const text = spokenText(workingVerse(practice.root));
    // One attempt per word: the answer is given whether or not it was earned,
    // because the score is defined over first attempts and a retry loop would
    // drive every score to 1.0.
    expect(text).toContain('planted');
    expect(text).toContain('missed');
    expect(text).toContain('x');
    expect(strikeThroughOffenders(practice.root)).toEqual([]);
  });

  it('says which word was missed rather than leaving it to the colour', async () => {
    const practice = await mountPractice(firstLettersStep(PSALM_1_3), { rung: 'firstletters' });

    const input = slots(practice.root)[7]!;
    input.value = 'x';
    input.dispatchEvent(new Event('input'));

    const live = practice.root.querySelector<HTMLElement>('[aria-live]')!;
    expect(spokenText(live)).toContain('planted');
  });

  it('does not offer a slot for a token with no initial to ask for', async () => {
    const punctuated: VerseText = {
      ...PSALM_1_3,
      words: ['And', '—', 'he', 'shall'],
      lines: [{ start: 0, end: 3, level: 1 }],
    };
    const practice = await mountPractice(firstLettersStep(punctuated), {
      rung: 'firstletters',
    });

    // Three answerable words; the em dash is printed outright rather than
    // presented as an input that cannot be answered.
    expect(slots(practice.root).length).toBe(3);
    expect(spokenText(workingVerse(practice.root))).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// 7. Accessibility basics
// ---------------------------------------------------------------------------

describe('accessibility', () => {
  it('has the live region in the document before there is anything to announce', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    // A live region created at the same moment as its text is frequently not
    // announced at all - the announcement is triggered by a mutation inside a
    // region that was already there. So the region has to pre-exist, empty.
    const live = practice.root.querySelector<HTMLElement>('[aria-live]');
    expect(live).not.toBeNull();
    expect(live!.getAttribute('aria-live')).toBe('assertive');
    expect(spokenText(live!)).toBe('');
  });

  it('announces a result into that same region, not a replacement for it', async () => {
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: true, wrong: [] }),
        session: session(null),
        summary: null,
      },
    });
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    const live = practice.root.querySelector<HTMLElement>('[aria-live]')!;
    practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();

    expect(practice.root.querySelector('[aria-live]')).toBe(live);
    expect(spokenText(live)).not.toBe('');
  });

  it('uses real buttons for every control the picker offers', async () => {
    const practice = await mountPractice(orderingStep(), { rung: 'ordering' });

    const controls = Array.from(practice.root.querySelectorAll<HTMLElement>('.sm-choice'));
    expect(controls.length).toBe(3);
    for (const control of controls) {
      // Not a clickable div: Enter and Space, focus order and the button role
      // all come free, and none of them are reimplemented anywhere in here.
      expect(control.tagName).toBe('BUTTON');
      expect((control as HTMLButtonElement).type).toBe('button');
    }
  });

  it('gives every blank an accessible name that says which blank it is', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    const labels = Array.from(
      practice.root.querySelectorAll<HTMLInputElement>('.sm-blank'),
    ).map((n) => n.getAttribute('aria-label'));

    // An unlabelled inline input is announced as "edit text, blank", which in a
    // passage of them tells the user nothing about where they are.
    expect(labels).toEqual(['Missing word 1 of 2', 'Missing word 2 of 2']);
  });

  it('names a first-letter slot by position only, never by its initial', async () => {
    const practice = await mountPractice(firstLettersStep(PSALM_1_3), { rung: 'firstletters' });

    const first = practice.root.querySelector<HTMLInputElement>('.sm-fl')!;
    const label = first.getAttribute('aria-label') ?? '';
    // "Blessed"/"And" is word 1 of 13 in Psalm 1:3 - the position is exactly
    // what the label says, and nothing else: task 0004 point 1 asked that the
    // first letter never be shown, and a screen-reader spoiler would be just
    // as much a violation of that as the visible placeholder v0 had.
    expect(label).toBe('Missing word 1 of 13');
  });

  it('gives the home screen\'s sort select and menu trigger real accessible names', () => {
    const plan: PlanView = { ...emptyPlan(), passages: [passageViewFixture()] };
    const root = renderPlan(host, plan);
    container.appendChild(root);

    expect(root.querySelector<HTMLSelectElement>('#sm-passage-sort')!.getAttribute('aria-label')).toBeTruthy();
    expect(root.querySelector<HTMLElement>('.sm-menu-btn')!.getAttribute('aria-label')).toBeTruthy();
  });

  it('marks the working verse in the accessibility tree, not only in colour', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, [2, 16]));

    // The highlight is a tinted band, and a tint is not available to everyone
    // using this panel. `aria-current="step"` answers "which verse am I on"
    // without it.
    expect(workingVerse(practice.root).getAttribute('aria-current')).toBe('step');
  });
});

// ---------------------------------------------------------------------------
// 7a. The passage screen
// ---------------------------------------------------------------------------

describe('the plan row', () => {
  function planWith(pv: PassageView): PlanView {
    return {
      collectionId: 1,
      collectionName: 'My plan',
      lists: [{ id: 1, name: 'Default', passageCount: 1, verseCount: pv.passage.verseCount }],
      scope: 'all',
      scopeVerseCount: pv.passage.verseCount,
      referenceActivitiesUnlocked: false,
      sortOrder: 'bible',
      totalDue: 0,
      speech: SPEECH_OFF,
      reciteDueCount: 0,
      defaultAnswerMode: 'firstLetter',
      passages: [pv],
    };
  }

  it('draws one square per applicable activity, and none for one that does not apply', () => {
    const root = renderPlan(host, planWith(passageViewFixture()));
    container.appendChild(root);

    // The fixture has four rungs; `refmatch` is inapplicable.
    expect(root.querySelectorAll('.sm-activity-square').length).toBe(3);
  });

  it('colours a square green when that activity itself is mastered, and orange when only partly attempted', () => {
    const pv = passageViewFixture({
      rungs: [
        rungView({ rung: 'ordering', level: 5 }),
        rungView({ rung: 'refmatch', applicable: false }),
        rungView({ rung: 'blanks', level: 2 }),
        rungView({ rung: 'firstletters', level: 0 }),
      ],
    });
    const root = renderPlan(host, planWith(pv));
    container.appendChild(root);

    const squares = Array.from(root.querySelectorAll('.sm-activity-square'));
    expect(squares.map((s) => s.className)).toEqual([
      expect.stringContaining('sm-activity-square-done'), // ordering: mastered
      expect.stringContaining('sm-activity-square-partial'), // blanks: tried, not mastered
      expect.stringContaining('sm-activity-square-new'), // firstletters: never tried
    ]);
  });

  it('colours a square light green when it is not itself mastered but a harder activity carries it', () => {
    const pv = passageViewFixture({
      rungs: [
        rungView({ rung: 'ordering', level: 0 }),
        rungView({ rung: 'refmatch', applicable: false }),
        rungView({ rung: 'blanks', level: 1 }),
        rungView({ rung: 'firstletters', level: 5 }), // mastered - carries down to ordering and blanks
      ],
    });
    const root = renderPlan(host, planWith(pv));
    container.appendChild(root);

    const squares = Array.from(root.querySelectorAll('.sm-activity-square'));
    expect(squares[0]!.className).toContain('sm-activity-square-carried'); // ordering
    expect(squares[1]!.className).toContain('sm-activity-square-carried'); // blanks
    expect(squares[2]!.className).toContain('sm-activity-square-done'); // firstletters itself
  });

  it('opens the passage screen from the row, with no separate Practice or Show in Bible button on the row itself', () => {
    const pv = passageViewFixture();
    const root = renderPlan(host, planWith(pv));
    container.appendChild(root);

    const row = root.querySelector('.sm-row')!;
    // The whole row is one button; a review round asked that per-row actions
    // stay hidden until a passage is actually selected, since opening it
    // already puts Practice and Show in Bible one click away.
    expect(row.querySelectorAll('button').length).toBe(1);

    row.querySelector<HTMLButtonElement>('button')!.click();
    expect(host.navigations).toContainEqual({ type: 'goPassage', passageId: pv.passage.id });
  });
});

describe('the passage screen', () => {
  it('offers a "Practice Passage" link that starts the suggested activity', () => {
    // The fixture's suggested activity is `blanks` (see the "badges the
    // suggested activity" test below).
    const pv = passageViewFixture();
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    const link = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Practice Passage')!;
    expect(link).toBeTruthy();
    expect(link.className).not.toContain('sm-btn-primary'); // chrome-free, not a bordered callout.

    link.click();
    expect(host.sessionsStarted).toEqual([{ passageId: pv.passage.id, rung: 'blanks', restart: undefined }]);
  });

  it('draws one tab for every applicable activity, and explains the one that does not apply', () => {
    const pv = passageViewFixture();
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    const tabButtons = Array.from(root.querySelectorAll('[role="tab"]'));
    // Four rungs in the fixture; `refmatch` is inapplicable, so it gets a
    // line of explanation rather than a tab.
    expect(tabButtons.map((t) => t.textContent)).toEqual([
      RUNG_LABEL.ordering,
      RUNG_LABEL.blanks,
      RUNG_LABEL.firstletters,
    ]);
    expect(spokenText(root)).toContain('Matching a reference needs 25 verses in this list');
  });

  it('selects the suggested activity\'s tab by default, and badges it in the panel', () => {
    // The fixture's `blanks` is due; everything else is not.
    const root = renderPassageScreen(host, passageViewFixture(), 'firstLetter');
    container.appendChild(root);

    const selected = root.querySelector('[role="tab"][aria-selected="true"]')!;
    expect(selected.textContent).toBe(RUNG_LABEL.blanks);
    expect(root.querySelectorAll('.sm-badge-suggested').length).toBe(1);
  });

  it('shows the tab named by the remembered rung, and no suggested badge on another tab', () => {
    const root = renderPassageScreen(host, passageViewFixture(), 'firstLetter', 'ordering');
    container.appendChild(root);

    expect(root.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe(RUNG_LABEL.ordering);
    expect(root.querySelectorAll('.sm-badge-suggested').length).toBe(0);
  });

  it('selecting another tab goes to the passage with that rung', () => {
    const pv = passageViewFixture();
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    const tab = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (t) => t.textContent === RUNG_LABEL.firstletters,
    )!;
    tab.click();
    expect(host.navigations).toContainEqual({ type: 'goPassage', passageId: pv.passage.id, rung: 'firstletters' });
  });

  it('shows an untried activity with empty level boxes and no status text', () => {
    const pv = passageViewFixture({
      rungs: [
        rungView({ rung: 'ordering', level: 0, attempts: 0 }),
        rungView({ rung: 'refmatch', applicable: false }),
        rungView({ rung: 'blanks', level: 0, attempts: 0 }),
        rungView({ rung: 'firstletters', level: 0, attempts: 0 }),
      ],
    });
    const root = renderPassageScreen(host, pv, 'firstLetter', 'ordering');
    container.appendChild(root);

    const panel = root.querySelector('.sm-activity-card')!;
    expect(spokenText(panel)).not.toContain('Not tried yet');
    expect(panel.querySelectorAll('.sm-level-box-yellow, .sm-level-box-green').length).toBe(0);
  });

  it('shows a paused activity\'s progress with Restart and Resume, and tier pips', () => {
    const pv = passageViewFixture({
      rungs: [
        rungView({ rung: 'ordering', level: 2, tiers: 2, tiersPassed: 1, resume: { stepsDone: 2, totalSteps: 5 } }),
        rungView({ rung: 'refmatch', applicable: false }),
        rungView({ rung: 'blanks' }),
        rungView({ rung: 'firstletters' }),
      ],
    });
    const root = renderPassageScreen(host, pv, 'firstLetter', 'ordering');
    container.appendChild(root);

    const panel = root.querySelector<HTMLElement>('.sm-activity-card')!;
    expect(panel.querySelector('.sm-activity-row-progress')?.textContent).toBe('2/5');
    expect(panel.querySelector('.sm-tier-pips')).not.toBeNull();
    const labels = Array.from(panel.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Restart', 'Resume']);
  });

  it('Resume starts without restart; Restart asks for one', () => {
    const pv = passageViewFixture({
      rungs: [
        rungView({ rung: 'ordering', resume: { stepsDone: 1, totalSteps: 5 } }),
        rungView({ rung: 'refmatch', applicable: false }),
        rungView({ rung: 'blanks' }),
        rungView({ rung: 'firstletters' }),
      ],
    });
    const root = renderPassageScreen(host, pv, 'firstLetter', 'ordering');
    container.appendChild(root);

    const byLabel = (label: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-activity-card button')).find((b) => b.textContent === label)!;
    byLabel('Resume').click();
    byLabel('Restart').click();

    expect(host.sessionsStarted).toEqual([
      { passageId: pv.passage.id, rung: 'ordering', restart: undefined },
      { passageId: pv.passage.id, rung: 'ordering', restart: true },
    ]);
  });

  it('an inapplicable activity has no tab and no button, only its explanation', () => {
    const pv = passageViewFixture(); // refmatch is inapplicable in the default fixture.
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    const tabLabels = Array.from(root.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabLabels).not.toContain(RUNG_LABEL.refmatch);
    const blurb = Array.from(root.querySelectorAll('.sm-activity-blurb')).find((b) =>
      (b.textContent ?? '').includes(RUNG_LABEL.refmatch),
    )!;
    expect(blurb).toBeTruthy();
    expect(blurb.querySelector('button')).toBeNull();
  });

  it('names the 25-verse gate for a gated refprovide row too', () => {
    const pv = passageViewFixture({
      rungs: [
        rungView({ rung: 'ordering', level: 3 }),
        rungView({ rung: 'refmatch', applicable: false }),
        rungView({ rung: 'blanks', level: 1 }),
        rungView({ rung: 'firstletters' }),
        rungView({ rung: 'refprovide', applicable: false }),
      ],
    });
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    expect(spokenText(root)).toContain('Naming a reference needs 25 verses in this list');
  });

  it('opens a settings modal from the gear icon, with the answer-mode override and a reset-progress action', async () => {
    const pv = passageViewFixture();
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    const gear = root.querySelector<HTMLButtonElement>('[aria-label="Passage settings"]')!;
    gear.click();
    await settle();

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.querySelector('#sm-answer-mode')).toBeTruthy();
    expect(spokenText(dialog)).toContain('Reset progress for this passage');
    dialog.parentElement!.remove();
  });

  it('lets a passage override the answer mode from the modal, and tells the worker', async () => {
    host.handlers.setPassageAnswerMode = () => ({ ok: true, data: {} });
    const pv = passageViewFixture();
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    root.querySelector<HTMLButtonElement>('[aria-label="Passage settings"]')!.click();
    await settle();

    const select = document.querySelector<HTMLSelectElement>('#sm-answer-mode')!;
    select.value = 'fullWord';
    select.dispatchEvent(new Event('change'));
    await settle();

    const sent = host.requests.find((r) => r.type === 'setPassageAnswerMode');
    expect(sent).toMatchObject({ type: 'setPassageAnswerMode', passageId: pv.passage.id, mode: 'fullWord' });
    // Success closes the modal and reloads, rather than leaving it open on
    // top of a screen that is about to be replaced.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.reloads).toBe(1);
  });

  it('the settings modal traps focus and closes on Escape', async () => {
    const root = renderPassageScreen(host, passageViewFixture(), 'firstLetter');
    container.appendChild(root);

    const gear = root.querySelector<HTMLButtonElement>('[aria-label="Passage settings"]')!;
    gear.focus();
    gear.click();
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).not.toBe(gear);
    expect(dialog.contains(document.activeElement)).toBe(true);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(gear);
  });

  it('asks for confirmation before resetting progress, then dispatches resetPassageProgress and reloads', async () => {
    host.handlers.resetPassageProgress = () => ({ ok: true, data: emptyPlan() });
    const pv = passageViewFixture({ bestLevel: 4 });
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    root.querySelector<HTMLButtonElement>('[aria-label="Passage settings"]')!.click();
    await settle();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;

    const resetButton = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Reset progress for this passage',
    )!;
    resetButton.click();

    expect(spokenText(dialog)).toContain('Reset all progress on this passage?');
    expect(host.requests.filter((r) => r.type === 'resetPassageProgress')).toEqual([]);

    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Yes, reset')!;
    confirm.click();
    await settle();

    expect(host.requests).toContainEqual({ type: 'resetPassageProgress', passageId: pv.passage.id });
    // The worker's reply is handled without incident even though this
    // screen never reads its `PlanView` payload - it just reloads, which
    // re-fetches a fresh `getPassageView`. No crash, whatever another panel
    // was doing with a live session for the same passage.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.reloads).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7b. The settings screen
// ---------------------------------------------------------------------------

describe('the settings screen', () => {
  function settings(mode: AnswerMode = 'firstLetter'): SettingsView {
    return { defaultAnswerMode: mode, recite: RECITE_DEFAULTS, speech: SPEECH_OFF };
  }

  it('checks the radio matching the current default', () => {
    const root = renderSettings(host, settings('fullWord'), emptyPlan());
    container.appendChild(root);

    const checked = root.querySelector<HTMLInputElement>('input[type="radio"]:checked')!;
    expect(checked.value).toBe('fullWord');
  });

  it('tells the worker when the default is changed', async () => {
    host.handlers.setDefaultAnswerMode = () => ({ ok: true, data: {} });
    const root = renderSettings(host, settings('firstLetter'), emptyPlan());
    container.appendChild(root);

    const fullWord = root.querySelector<HTMLInputElement>('input[value="fullWord"]')!;
    fullWord.checked = true;
    fullWord.dispatchEvent(new Event('change'));
    await settle();

    expect(host.requests).toContainEqual({ type: 'setDefaultAnswerMode', mode: 'fullWord' });
  });

  it('lists only the passages that have overridden the default', () => {
    const plan: PlanView = {
      collectionId: 1,
      collectionName: 'My plan',
      totalDue: 0,
      speech: SPEECH_OFF,
      reciteDueCount: 0,
      defaultAnswerMode: 'firstLetter',
      passages: [
        passageViewFixture({ passage: passageFixture({ id: 1, reference: 'Psalm 23:1-6', answerMode: 'fullWord' }) }),
        passageViewFixture({ passage: passageFixture({ id: 2, reference: 'John 3:16', answerMode: null }) }),
      ],
    };
    const root = renderSettings(host, settings(), plan);
    container.appendChild(root);

    expect(spokenText(root)).toContain('Psalm 23:1-6');
    expect(spokenText(root)).not.toContain('John 3:16');
  });

  it('navigates to a passage screen from "Change"', () => {
    const plan: PlanView = {
      collectionId: 1,
      collectionName: 'My plan',
      totalDue: 0,
      speech: SPEECH_OFF,
      reciteDueCount: 0,
      defaultAnswerMode: 'firstLetter',
      passages: [
        passageViewFixture({ passage: passageFixture({ id: 7, reference: 'Psalm 23:1-6', answerMode: 'fullWord' }) }),
      ],
    };
    const root = renderSettings(host, settings(), plan);
    container.appendChild(root);

    const change = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === 'Change')!;
    change.click();

    expect(host.navigations).toContainEqual({ type: 'goPassage', passageId: 7 });
  });
});

// ---------------------------------------------------------------------------
// 8. Empty and error states
// ---------------------------------------------------------------------------

describe('empty and error states', () => {
  it('gives an empty plan something to read and something to do', () => {
    const root = renderPlan(host, emptyPlan());
    container.appendChild(root);

    const text = spokenText(root);
    expect(text).not.toBe('');
    expect(text).toContain('Nothing in your plan yet.');
    expect(text).toContain('Psalm 1:1-6');
    // The add-passage form itself now lives on Manage Passages (T11); the
    // empty plan points there rather than holding the field.
    expect(text).toContain('Manage Passages');

    // Announced as a status rather than left as anonymous text.
    expect(root.querySelector('[role="status"]')).not.toBeNull();
  });

  it('offers one-click add-and-start once the reader has a verse open, even with an empty plan', () => {
    host.activeReference = 'John 3:16';
    const root = renderPlan(host, emptyPlan());
    container.appendChild(root);

    // Task 0004: a first-time user should never see an empty list with
    // nothing to press. With a verse already open, one button both adds it
    // and starts practising it.
    const labels = Array.from(root.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels.some((l) => (l ?? '').includes('Add John 3:16 and start'))).toBe(true);
  });

  it('does not offer a start button at all with an empty plan and nothing being read', () => {
    const root = renderPlan(host, emptyPlan());
    container.appendChild(root);

    // A disabled primary button with no explanation looks broken. The screen
    // points at Manage Passages instead, where the add-passage form now lives.
    expect(spokenText(root)).toContain('Add a verse from Manage Passages to get started.');
    const labels = Array.from(root.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels.some((l) => (l ?? '').includes('Start practicing'))).toBe(false);
  });

  it('gives an empty analytics screen a way back rather than a wall of zeroes', () => {
    const root = renderAnalytics(host, emptyAnalytics());
    container.appendChild(root);

    expect(spokenText(root)).toContain('Nothing to show yet.');
    expect(root.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  // The add-passage form (single reference, paste-batch confirm, and all the
  // tests that exercised it) moved off this screen entirely in T10 - it now
  // lives on the Manage Passages screen (T11), which owns its own tests. What
  // stays here is `renderAddAndStart`'s one-click shortcut, covered above and
  // in the "the plan screen: Practice and the activity picker" block below.

  it('keeps the exercise usable when the surrounding context cannot be fetched', async () => {
    const reason = 'Could not reach the Scripture Memory worker (getContext): Timeout';
    const practice = await mountPractice(
      blanksStep(PSALM_1_1, [5, 9]),
      {},
      { ok: false, error: reason },
    );

    // Not fatal: the step carries everything needed to answer, so the failure
    // is reported and the exercise goes on with the step's own copy of the
    // verse. Replacing the screen with an error here would take away the thing
    // the user pressed a button to do.
    expect(host.announcements).toContain(reason);
    expect(practice.root.querySelectorAll('.sm-blank').length).toBe(2);
    expect(spokenText(workingVerse(practice.root))).toContain('Blessed is the man');
  });

  it('surfaces a rejected submission instead of silently doing nothing', async () => {
    const reason = 'That session has already ended.';
    host.handlers.submitStep = () => ({ ok: false, error: reason });

    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));
    practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();

    expect(spokenText(practice.root)).toContain(reason);
    expect(practice.root.querySelector('[role="alert"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. The ordering picker's letter shortcuts
// ---------------------------------------------------------------------------

describe('the ordering picker - letter shortcuts', () => {
  /** The candidates, in the order they are offered. */
  function candidates(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-choice'));
  }

  function press(list: Element, key: string, over: KeyboardEventInit = {}): void {
    list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...over }));
  }

  function submitAnswers(): { kind: string; verseId?: number }[] {
    return host.requests
      .filter((r): r is Extract<PanelRequest, { type: 'submitStep' }> => r.type === 'submitStep')
      .map((r) => r.answer as { kind: string; verseId?: number });
  }

  it('labels each candidate A, B, C, ... by its position in the list', async () => {
    const practice = await mountPractice(orderingStep(), { rung: 'ordering' });
    const letters = Array.from(
      practice.root.querySelectorAll<HTMLElement>('.sm-choice-letter'),
    ).map((el) => el.textContent);
    expect(letters).toEqual(['A', 'B', 'C']);
  });

  it('labels the sole remaining candidate on the last step A, and "a" picks it', async () => {
    const step = orderingStep();
    const lastStep: OrderingStep = { ...step, candidates: [step.candidates[0]!] };
    host.handlers.submitStep = () => ({
      ok: true,
      data: { result: stepResult({ correct: true }), session: session(null, { rung: 'ordering' }), summary: null },
    });

    const practice = await mountPractice(lastStep, { rung: 'ordering' });
    const letters = Array.from(
      practice.root.querySelectorAll<HTMLElement>('.sm-choice-letter'),
    ).map((el) => el.textContent);
    expect(letters).toEqual(['A']);

    press(practice.root.querySelector('.sm-choices')!, 'a');
    await settle();

    expect(submitAnswers()).toEqual([{ kind: 'ordering', verseId: lastStep.candidates[0]!.verseId }]);
  });

  it('pressing a candidate\'s letter activates it, the same as clicking it', async () => {
    const step = orderingStep();
    host.handlers.submitStep = () => ({
      ok: true,
      data: { result: stepResult({ correct: true }), session: session(null, { rung: 'ordering' }), summary: null },
    });

    const practice = await mountPractice(step, { rung: 'ordering' });
    // "B" is the second candidate - upper case, to also cover case-insensitivity.
    press(practice.root.querySelector('.sm-choices')!, 'B');
    await settle();

    expect(submitAnswers()).toEqual([{ kind: 'ordering', verseId: step.candidates[1]!.verseId }]);
  });

  it('leaves arrow-key navigation working unmodified alongside the letter shortcuts', async () => {
    const practice = await mountPractice(orderingStep(), { rung: 'ordering' });
    const buttons = candidates(practice.root);
    buttons[0]!.focus();

    press(practice.root.querySelector('.sm-choices')!, 'ArrowDown');

    expect(document.activeElement).toBe(buttons[1]);
  });

  it('ignores a letter typed with a modifier key held', async () => {
    const practice = await mountPractice(orderingStep(), { rung: 'ordering' });
    press(practice.root.querySelector('.sm-choices')!, 'b', { ctrlKey: true });
    await settle();
    expect(submitAnswers()).toEqual([]);
  });

  it('ignores an auto-repeated keystroke', async () => {
    const practice = await mountPractice(orderingStep(), { rung: 'ordering' });
    press(practice.root.querySelector('.sm-choices')!, 'b', { repeat: true });
    await settle();
    expect(submitAnswers()).toEqual([]);
  });

  it('ignores a letter typed into an input rather than aimed at the picker', async () => {
    const practice = await mountPractice(orderingStep(), { rung: 'ordering' });
    const list = practice.root.querySelector('.sm-choices')!;
    // No such control exists in the ordering step today, but the guard has to
    // hold regardless of what else might one day share the list's DOM.
    const stray = document.createElement('input');
    list.appendChild(stray);

    press(stray, 'b');
    await settle();

    expect(submitAnswers()).toEqual([]);
  });

  it('ignores a keystroke while a pick is already in flight, and does not queue it', async () => {
    const step = orderingStep();
    const practice = await mountPractice(step, { rung: 'ordering' });
    const list = practice.root.querySelector('.sm-choices')!;

    // No `submitStep` handler is registered, so the request the first
    // keystroke starts stays pending (resolved only by the harness's
    // "no stub" fallback on its own microtask) - `busy` is set synchronously
    // before that resolves, which is the window this asserts against.
    press(list, 'a');
    press(list, 'b');
    await settle();

    expect(host.requests.filter((r) => r.type === 'submitStep').length).toBe(1);
  });

  it('ignores a keystroke during the transient wrong-mark window rather than queuing it', async () => {
    const step = orderingStep();
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: false, wrong: [step.candidates[0]!.verseId], blocking: true }),
        session: session(step, { rung: 'ordering' }),
        summary: null,
      },
    });

    const practice = await mountPractice(step, { rung: 'ordering' });
    const list = practice.root.querySelector('.sm-choices')!;
    vi.useFakeTimers();

    candidates(practice.root)[0]!.click();
    await settle();
    expect(host.requests.filter((r) => r.type === 'submitStep').length).toBe(1);

    // Struck while the "not that one" mark is still showing: ignored, not
    // held onto for when the picker unlocks.
    press(list, 'b');
    await settle();
    expect(host.requests.filter((r) => r.type === 'submitStep').length).toBe(1);

    // Once the wrong mark has expired, the same letter works again.
    vi.advanceTimersByTime(2_000);
    await settle();
    press(list, 'b');
    await settle();
    expect(host.requests.filter((r) => r.type === 'submitStep').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 15. The modal (T9)
// ---------------------------------------------------------------------------

describe('the modal', () => {
  function fireKey(target: Element, key: string, opts: KeyboardEventInit = {}): void {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }),
    );
  }

  /** A button outside the modal, standing in for "whatever triggered it". */
  function makeTrigger(): HTMLButtonElement {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    container.appendChild(trigger);
    return trigger;
  }

  // The header's built-in `✕` close button is always the first focusable
  // element in document order, ahead of anything `body` supplies.
  function closeButtonOf(backdrop: Element): HTMLElement {
    return backdrop.querySelector<HTMLElement>('[aria-label="Close"]')!;
  }

  it('starts hidden and detached, and shows on open()', () => {
    const handle = modal({ title: 'Example', body: [document.createElement('p')] });
    expect(handle.element.hidden).toBe(true);
    expect(handle.element.isConnected).toBe(false);
    container.appendChild(handle.element);
    handle.open();
    expect(handle.element.hidden).toBe(false);
  });

  it('moves focus into the modal on open, to its first focusable element', () => {
    const trigger = makeTrigger();
    trigger.focus();

    const handle = modal({ title: 'Example', body: [document.createElement('p')] });
    container.appendChild(handle.element);
    handle.open();

    expect(document.activeElement).toBe(closeButtonOf(handle.element));
  });

  it('focuses the dialog itself when there is nothing focusable inside', () => {
    const trigger = makeTrigger();
    trigger.focus();

    const handle = modal({ title: 'Nothing to focus', body: ['Just text.'] });
    const dialog = handle.element.querySelector('[role="dialog"]')!;
    closeButtonOf(handle.element).remove();
    container.appendChild(handle.element);
    handle.open();

    expect(document.activeElement).toBe(dialog);
  });

  it('renders actions in a footer row', () => {
    const save = document.createElement('button');
    save.textContent = 'Save';
    const handle = modal({ title: 'Example', body: ['x'], actions: [save] });
    expect(handle.element.querySelector('.sm-modal-actions')?.contains(save)).toBe(true);
  });

  it('traps Tab within the modal, wrapping from the last focusable element to the first', () => {
    makeTrigger().focus();

    const only = document.createElement('button');
    only.textContent = 'Only content control';
    const handle = modal({ title: 'Example', body: [only] });
    container.appendChild(handle.element);
    handle.open();

    only.focus();
    fireKey(handle.element.querySelector('[role="dialog"]')!, 'Tab');

    expect(document.activeElement).toBe(closeButtonOf(handle.element));
  });

  it('traps Shift+Tab within the modal, wrapping from the first focusable element to the last', () => {
    makeTrigger().focus();

    const only = document.createElement('button');
    only.textContent = 'Only content control';
    const handle = modal({ title: 'Example', body: [only] });
    container.appendChild(handle.element);
    handle.open();

    closeButtonOf(handle.element).focus();
    fireKey(handle.element.querySelector('[role="dialog"]')!, 'Tab', { shiftKey: true });

    expect(document.activeElement).toBe(only);
  });

  it('closes when the built-in close button is clicked', () => {
    const trigger = makeTrigger();
    trigger.focus();

    const onClose = vi.fn();
    const handle = modal({ title: 'Example', body: [document.createElement('p')], onClose });
    container.appendChild(handle.element);
    handle.open();

    closeButtonOf(handle.element).click();

    expect(handle.element.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape, restores focus to the opener, and calls onClose once', () => {
    const trigger = makeTrigger();
    trigger.focus();

    const onClose = vi.fn();
    const first = document.createElement('button');
    const handle = modal({ title: 'Example', body: [first], onClose });
    container.appendChild(handle.element);
    handle.open();

    fireKey(handle.element.querySelector('[role="dialog"]')!, 'Escape');
    fireKey(handle.element.querySelector('[role="dialog"]')!, 'Escape');

    expect(handle.element.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click but not on a click inside the dialog', () => {
    makeTrigger().focus();

    const first = document.createElement('button');
    const handle = modal({ title: 'Example', body: [first] });
    container.appendChild(handle.element);
    handle.open();

    first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    handle.element.querySelector('[role="dialog"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(handle.element.hidden).toBe(false);

    handle.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(handle.element.hidden).toBe(true);
  });

  it('can be reopened after closing, and close() is a no-op when already closed', () => {
    const onClose = vi.fn();
    const handle = modal({ title: 'Example', body: ['x'], onClose });
    container.appendChild(handle.element);
    handle.close();
    expect(onClose).not.toHaveBeenCalled();
    handle.open();
    handle.close();
    handle.open();
    expect(handle.element.hidden).toBe(false);
  });

  it('is a real dialog, not a native <dialog> and not window.confirm', () => {
    const handle = modal({ title: 'Example', body: [document.createElement('p')] });
    const dialog = handle.element.querySelector('[role="dialog"]');
    expect(dialog?.tagName).not.toBe('DIALOG');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(handle.element.querySelector('h2')?.id);
  });
});

describe('iconButton, tierPips, listSelector and activityRow', () => {
  it('iconButton shows the glyph and names itself for assistive tech', () => {
    const onClick = vi.fn();
    const btn = iconButton('▶', 'Practice blanks', onClick);
    container.appendChild(btn);

    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('▶');
    expect(btn.getAttribute('aria-label')).toBe('Practice blanks');

    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('tierPips conveys the count in text, not only in colour', () => {
    const pips = tierPips(1, 3);
    container.appendChild(pips);

    expect(pips.getAttribute('aria-label')).toBe('1 of 3 tiers passed');
    expect(pips.querySelectorAll('.sm-tier-pip').length).toBe(3);
    expect(pips.querySelectorAll('.sm-tier-pip-passed').length).toBe(1);
  });

  it('listSelector renders every option and reports a change by id', () => {
    const onChange = vi.fn();
    const select = listSelector(
      [
        { id: 'all', name: 'All lists' },
        { id: 3, name: 'Memory verses' },
      ],
      'all',
      onChange,
    );
    container.appendChild(select);

    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['All lists', 'Memory verses']);

    select.value = '3';
    select.dispatchEvent(new Event('change'));

    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('activityRow lays out name, pips, level, schedule text and a play control', () => {
    const onPlay = vi.fn();
    const row = activityRow({
      rung: 'blanks',
      level: 2,
      tiers: 2,
      tiersPassed: 1,
      scheduleText: 'Due today',
      onPlay,
    });
    container.appendChild(row);

    expect(spokenText(row)).toContain('Due today');
    const playButton = row.querySelector('button')!;
    playButton.click();
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T10: the home screen rework - title, the Practice control, the activity
// picker, the shuffled recommendation, and the list picker.
// ---------------------------------------------------------------------------

describe('the home screen: title, Practice, the activity picker and the shuffle', () => {
  /** A one-list, N-passage plan, everything else defaulted from `emptyPlan()`. */
  function planWithPassages(passages: PassageView[], over: Partial<PlanView> = {}): PlanView {
    return { ...emptyPlan(), passages, ...over };
  }

  const TWO_LISTS = [
    { id: 1, name: 'Default', passageCount: 1, verseCount: 6 },
    { id: 2, name: 'Romans Road', passageCount: 0, verseCount: 0 },
  ];

  it('has a Home breadcrumb as its only crumb, with the hamburger menu beside it', () => {
    const root = renderPlan(host, planWithPassages([passageViewFixture()]));
    const h1 = root.querySelector('h1')!;
    expect(h1.textContent).toBe('Home');
    expect(h1.getAttribute('aria-current')).toBe('page');
    expect(root.querySelectorAll('.sm-crumb').length).toBe(0);
    expect(root.querySelector('.sm-menu')).not.toBeNull();
  });

  it('folds Manage Passages, Analytics and Settings into the menu, with no separate buttons left', () => {
    const root = renderPlan(host, planWithPassages([passageViewFixture()]));
    container.appendChild(root);

    const items = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items.map((b) => b.textContent)).toEqual(['Manage Passages', 'Analytics', 'Settings']);
    const outside = Array.from(root.querySelectorAll('button'))
      .filter((b) => b.getAttribute('role') !== 'menuitem')
      .map((b) => b.textContent);
    expect(outside).not.toContain('Analytics');
    expect(outside).not.toContain('Settings');
    expect(outside).not.toContain('Manage Passages');
    expect(outside).not.toContain('Practice');
    expect(root.querySelector('.sm-manage-passages-link')).toBeNull();

    items[0]!.click();
    items[1]!.click();
    items[2]!.click();
    expect(host.navigations).toEqual([
      { type: 'goManagePassages' },
      { type: 'goAnalytics' },
      { type: 'goSettings' },
    ]);
  });

  it('opens and closes the menu from its trigger, and closes it on Escape', () => {
    const root = renderPlan(host, planWithPassages([passageViewFixture()]));
    container.appendChild(root);

    const trigger = root.querySelector<HTMLButtonElement>('.sm-menu-btn')!;
    const panel = root.querySelector<HTMLElement>('.sm-menu-panel')!;
    expect(panel.hidden).toBe(true);
    trigger.click();
    expect(panel.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel.hidden).toBe(true);
  });

  it('draws six activity tiles in order, with the two reference tiles disabled while locked', () => {
    const plan = planWithPassages([passageViewFixture()], {
      referenceActivitiesUnlocked: false,
      scopeVerseCount: 12,
    });
    const root = renderPlan(host, plan);
    container.appendChild(root);

    const tiles = Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-tile-grid .sm-tile'));
    expect(tiles.map((t) => t.querySelector('.sm-tile-title')!.textContent)).toEqual([
      'Variety',
      'Match References',
      'Put in Order',
      'Fill in the Blanks',
      'First Letters',
      'Provide Reference',
    ]);
    const byTitle = (title: string) =>
      tiles.find((t) => t.querySelector('.sm-tile-title')!.textContent === title)!;
    expect(byTitle('Match References').disabled).toBe(true);
    expect(byTitle('Provide Reference').disabled).toBe(true);
    expect(byTitle('Put in Order').disabled).toBe(false);
    expect(root.querySelector('.sm-activity-picker')).toBeNull();
    expect(Array.from(root.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Practice by Activity');
  });

  it('shows the reference hint text on each locked tile, naming the shortfall', () => {
    const plan = planWithPassages([passageViewFixture()], {
      referenceActivitiesUnlocked: false,
      scopeVerseCount: 12,
    });
    const root = renderPlan(host, plan);
    container.appendChild(root);

    const warnings = Array.from(root.querySelectorAll('.sm-tile-warning'));
    expect(warnings.length).toBe(2);
    for (const warning of warnings) {
      expect(spokenText(warning)).toContain('25');
      expect(spokenText(warning)).toContain('13 more to go (12 so far)');
    }
    // A warning is inside a tile button, so it never nests a button.
    expect(root.querySelector('.sm-tile button')).toBeNull();
  });

  it('shows no locked warning once the reference activities are unlocked', () => {
    const plan = planWithPassages([passageViewFixture()], {
      referenceActivitiesUnlocked: true,
      scopeVerseCount: 30,
    });
    const root = renderPlan(host, plan);
    container.appendChild(root);

    expect(root.querySelector('.sm-reference-hint')).toBeNull();
    expect(Array.from(root.querySelectorAll('.sm-tile-warning')).some((w) => spokenText(w).includes('25'))).toBe(false);
  });

  it('pressing a tile starts its flow through the host', () => {
    const plan = planWithPassages([passageViewFixture()], { referenceActivitiesUnlocked: true });
    const root = renderPlan(host, plan);
    container.appendChild(root);

    const tiles = Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-tile'));
    tiles[0]!.click();
    tiles[3]!.click();
    expect(host.flowsStarted.map((f) => f.flow)).toEqual([
      { kind: 'variety' },
      { kind: 'activity', rung: 'blanks' },
    ]);
    expect(host.sessionsStarted).toEqual([]);
  });

  it('disables a tile whose activity has no applicable passage, with a readable warning', () => {
    // Only `ordering` is applicable on this passage.
    const pv = passageViewFixture({ rungs: [rungView({ rung: 'ordering', level: 1 })] });
    const plan = planWithPassages([pv], { referenceActivitiesUnlocked: true });
    const root = renderPlan(host, plan);
    container.appendChild(root);

    const blanksTile = Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-tile')).find(
      (t) => t.querySelector('.sm-tile-title')!.textContent === 'Fill in the Blanks',
    )!;
    expect(blanksTile.disabled).toBe(true);
    expect(spokenText(blanksTile.querySelector('.sm-tile-warning')!)).toContain('Nothing to practise');
  });

  it('lists passages in plan order for "bible" and by need for "need"', () => {
    const fresh = passageViewFixture({
      passage: passageFixture({ id: 1, reference: 'Genesis 1:1', addedAt: 1 }),
      bestLevel: 3,
      dueCount: 0,
      rungs: [rungView({ rung: 'blanks', level: 3, dueAt: null })],
    });
    const needy = passageViewFixture({
      passage: passageFixture({ id: 2, reference: 'John 3:16', addedAt: 2 }),
      bestLevel: 0,
      dueCount: 0,
      rungs: [rungView({ rung: 'blanks', level: 0, attempts: 0, dueAt: null })],
    });
    const refs = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('.sm-row-ref')).map((n) => n.textContent);

    const bible = renderPlan(host, planWithPassages([fresh, needy], { sortOrder: 'bible' }));
    expect(refs(bible)).toEqual(['Genesis 1:1', 'John 3:16']);
    const need = renderPlan(host, planWithPassages([fresh, needy], { sortOrder: 'need' }));
    expect(refs(need)).toEqual(['John 3:16', 'Genesis 1:1']);
  });

  it('headed "Practice by Passage", with a sort select reading the plan\'s sortOrder', () => {
    const root = renderPlan(host, planWithPassages([passageViewFixture()], { sortOrder: 'need' }));
    container.appendChild(root);

    expect(Array.from(root.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Practice by Passage');
    const select = root.querySelector<HTMLSelectElement>('#sm-passage-sort')!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Bible order', 'Needs practice']);
    expect(select.value).toBe('need');
  });

  it('persists a changed sort through setPassageSortOrder, then reloads', async () => {
    host.handlers.setPassageSortOrder = () => ({ ok: true, data: {} });
    const root = renderPlan(host, planWithPassages([passageViewFixture()]));
    container.appendChild(root);

    const select = root.querySelector<HTMLSelectElement>('#sm-passage-sort')!;
    select.value = 'need';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(host.requests).toContainEqual({ type: 'setPassageSortOrder', order: 'need' });
    expect(host.reloads).toBe(1);
  });

  it('announces the error and does not reload when the sort cannot be saved', async () => {
    host.handlers.setPassageSortOrder = () => ({ ok: false, error: 'nope' });
    const root = renderPlan(host, planWithPassages([passageViewFixture()]));
    container.appendChild(root);

    const select = root.querySelector<HTMLSelectElement>('#sm-passage-sort')!;
    select.value = 'need';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(host.announcements).toContain('nope');
    expect(host.reloads).toBe(0);
  });

  it('has no tiles or sort on an empty plan, and the one-click add-and-start path still works', async () => {
    host.activeReference = 'John 3:16';
    host.handlers.addPassage = (req) => ({ ok: true, data: { passage: passageFixture({ reference: req.reference }) } });
    const root = renderPlan(host, emptyPlan());
    container.appendChild(root);

    expect(root.querySelector('.sm-tile')).toBeNull();
    expect(root.querySelector('#sm-passage-sort')).toBeNull();

    const addButton = Array.from(root.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Add John 3:16 and start'),
    )!;
    addButton.click();
    await settle();

    expect(host.requests).toContainEqual({ type: 'addPassage', reference: 'John 3:16' });
    expect(host.sessionsStarted.length).toBe(1);
  });


  it('shows no list selector for a single-list plan', () => {
    const plan = planWithPassages([passageViewFixture()]);
    const root = renderPlan(host, plan);
    container.appendChild(root);

    expect(root.querySelector('.sm-list-selector')).toBeNull();
  });

  it('shows a list selector for a multi-list plan, and reads the current selection from plan.scope', () => {
    const plan = planWithPassages([passageViewFixture()], { lists: TWO_LISTS, scope: 2 });
    const root = renderPlan(host, plan);
    container.appendChild(root);

    const select = root.querySelector<HTMLSelectElement>('.sm-list-selector')!;
    expect(select).not.toBeNull();
    expect(select.value).toBe('2');
  });

  it('asks the worker to change scope, and reloads on success, when a different list is picked', async () => {
    host.handlers.setScope = () => ({ ok: true, data: emptyPlan() });
    const plan = planWithPassages([passageViewFixture()], { lists: TWO_LISTS });
    const root = renderPlan(host, plan);
    container.appendChild(root);

    const select = root.querySelector<HTMLSelectElement>('.sm-list-selector')!;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(host.requests).toContainEqual({ type: 'setScope', scope: { kind: 'list', id: 2 } });
    expect(host.reloads).toBeGreaterThan(0);
  });

  it('reflects whatever scope the worker sends on the next render, rather than a value remembered locally', () => {
    // Scope lives in the worker. A `planChanged` push makes `panel.ts` fetch a
    // fresh `PlanView` and call `renderPlan` again - simulated here by calling
    // it a second time with a different `scope` - and the selector must show
    // *that* value, not whatever the first render happened to pick.
    const plan1 = planWithPassages([passageViewFixture()], { lists: TWO_LISTS, scope: 2 });
    const root1 = renderPlan(host, plan1);
    expect(root1.querySelector<HTMLSelectElement>('.sm-list-selector')!.value).toBe('2');

    const plan2 = planWithPassages([passageViewFixture()], { lists: TWO_LISTS, scope: 'all' });
    const root2 = renderPlan(host, plan2);
    expect(root2.querySelector<HTMLSelectElement>('.sm-list-selector')!.value).toBe('all');
  });

});

// ---------------------------------------------------------------------------
// T11: the Manage Passages screen - add/remove, list management, and the
// suggested-lists gallery.
// ---------------------------------------------------------------------------

describe('the Manage Passages screen', () => {
  /** A plan with the given passages and lists, everything else from `emptyPlan()`. */
  function managePlan(passages: PassageView[], over: Partial<PlanView> = {}): PlanView {
    return { ...emptyPlan(), passages, ...over };
  }

  const TWO_LISTS = [
    { id: 1, name: 'Default', passageCount: 1, verseCount: 6 },
    { id: 2, name: 'Romans Road', passageCount: 0, verseCount: 0 },
  ];

  /**
   * `settle()` flushes six microtask ticks, plenty for the single-request
   * flows elsewhere in this file. A suggested list's "Create this list"
   * chains `createList`, `setScope`, and then one sequential `addPassage`
   * per reference (deliberately not `Promise.all` - see `addBatch`'s own
   * comment), so a ten-reference list needs more ticks than that to finish
   * inside one `await`. This flushes considerably more.
   */
  async function settleBatch(): Promise<void> {
    for (let i = 0; i < 60; i++) await Promise.resolve();
  }

  // -- the add-passage form, moved verbatim from the plan screen -----------

  it('keeps the add-passage input at id "sm-add-reference" so the placeholder wiring keeps working', () => {
    const root = renderManagePassages(host, managePlan([]));
    container.appendChild(root);

    expect(root.querySelector('#sm-add-reference')).not.toBeNull();
  });

  it('adds a single typed reference and reloads', async () => {
    host.handlers.addPassage = (req) => ({ ok: true, data: { passage: passageFixture({ reference: req.reference }) } });
    const root = renderManagePassages(host, managePlan([]));
    container.appendChild(root);

    const input = root.querySelector<HTMLInputElement>('#sm-add-reference')!;
    input.value = 'John 3:16';
    input.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(host.requests).toContainEqual({ type: 'addPassage', reference: 'John 3:16' });
    expect(host.reloads).toBeGreaterThan(0);
  });

  it('offers a paste-batch confirm for more than one candidate, and adds them sequentially on confirm', async () => {
    const order: string[] = [];
    host.handlers.addPassage = (req) => {
      order.push(req.reference);
      return { ok: true, data: { passage: passageFixture({ id: order.length, reference: req.reference }) } };
    };
    const root = renderManagePassages(host, managePlan([]));
    container.appendChild(root);

    const input = root.querySelector<HTMLInputElement>('#sm-add-reference')!;
    const pasteEvent = new Event('paste', { cancelable: true }) as ClipboardEvent & {
      clipboardData?: { getData: (type: string) => string };
    };
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: () => 'John 3:16\nRomans 8:28' },
    });
    input.dispatchEvent(pasteEvent);

    const popup = document.querySelector('.sm-modal-backdrop')!;
    expect(popup).not.toBeNull();

    const addAll = Array.from(popup.querySelectorAll<HTMLButtonElement>('.sm-modal-actions button')).find((b) =>
      (b.textContent ?? '').startsWith('Add'),
    )!;
    addAll.click();
    await settle();
    expect(document.querySelector('.sm-modal-backdrop')).toBeNull();

    // Sequential, not concurrent - the order the references were typed in.
    expect(order).toEqual(['John 3:16', 'Romans 8:28']);
  });

  it('a reference already present is reported by `created: false`, not treated as an error', async () => {
    // `store.addPassage` returns the existing row unchanged for a duplicate -
    // this is not a failure, and must not end up in the error slot.
    host.handlers.addPassage = () => ({
      ok: true,
      data: { passage: passageFixture({ reference: 'Psalm 23:1-6' }) },
    });
    const root = renderManagePassages(host, managePlan([]));
    container.appendChild(root);

    const input = root.querySelector<HTMLInputElement>('#sm-add-reference')!;
    input.value = 'Psalm 23:1-6';
    input.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(root.querySelector('.sm-error')).toBeNull();
    expect(host.announcements.some((a) => a.includes('Added'))).toBe(true);
  });

  // -- removing a passage ----------------------------------------------------

  it('removes a never-practiced passage immediately, with no confirmation step', async () => {
    host.handlers.removePassage = () => ({ ok: true, data: {} });
    const pv = passageViewFixture({ bestLevel: 0 });
    const root = renderManagePassages(host, managePlan([pv]));
    container.appendChild(root);

    root.querySelector<HTMLButtonElement>('.sm-remove button')!.click();
    await settle();

    expect(host.requests).toContainEqual({ type: 'removePassage', passageId: pv.passage.id });
    expect(host.reloads).toBeGreaterThan(0);
  });

  it('asks for confirmation before removing a passage with history', () => {
    const pv = passageViewFixture({ bestLevel: 3 });
    const root = renderManagePassages(host, managePlan([pv]));
    container.appendChild(root);

    root.querySelector<HTMLButtonElement>('.sm-remove button')!.click();

    expect(spokenText(root)).toContain('Its history is kept for 7 days, and adding it again restores it.');
    expect(host.requests.filter((r) => r.type === 'removePassage')).toEqual([]);
  });

  it('removing the last passage of a list leaves the (now empty) list in place', async () => {
    host.handlers.removePassage = () => ({ ok: true, data: {} });
    const pv = passageViewFixture({ bestLevel: 0 });
    const root = renderManagePassages(host, managePlan([pv], { lists: [{ id: 1, name: 'Default', passageCount: 1, verseCount: 6 }] }));
    container.appendChild(root);

    root.querySelector<HTMLButtonElement>('.sm-remove button')!.click();
    await settle();

    // No list-deleting request of any kind was ever sent - removing a
    // passage only ever removes the passage.
    expect(host.requests.some((r) => r.type === 'deleteList')).toBe(false);
    expect(host.requests).toContainEqual({ type: 'removePassage', passageId: pv.passage.id });
  });

  // -- moving a passage to another list ---------------------------------------

  it('moves a passage to a different list when the move-to-list control changes', async () => {
    host.handlers.movePassage = () => ({ ok: true, data: emptyPlan() });
    const pv = passageViewFixture({ passage: passageFixture({ id: 5, collectionId: 1 }) });
    const root = renderManagePassages(host, managePlan([pv], { lists: TWO_LISTS }));
    container.appendChild(root);

    const moveSelect = root.querySelector<HTMLSelectElement>(`[aria-label="Move ${pv.passage.reference} to a different list"]`)!;
    moveSelect.value = '2';
    moveSelect.dispatchEvent(new Event('change'));
    await settle();

    expect(host.requests).toContainEqual({ type: 'movePassage', passageId: 5, collectionId: 2 });
    expect(host.reloads).toBeGreaterThan(0);
  });

  // -- list management: create, rename, delete --------------------------------

  it('creates a new list from the create-list form', async () => {
    host.handlers.createList = () => ({ ok: true, data: emptyPlan() });
    const root = renderManagePassages(host, managePlan([], { lists: TWO_LISTS }));
    container.appendChild(root);

    const nameInput = root.querySelector<HTMLInputElement>('#sm-create-list-name')!;
    nameInput.value = 'Advent';
    nameInput.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(host.requests).toContainEqual({ type: 'createList', name: 'Advent' });
    expect(host.reloads).toBeGreaterThan(0);
  });

  it('refuses to submit an empty list name', () => {
    const root = renderManagePassages(host, managePlan([], { lists: TWO_LISTS }));
    container.appendChild(root);

    root.querySelector<HTMLInputElement>('#sm-create-list-name')!.value = '   ';
    root.querySelector('#sm-create-list-name')!.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(host.requests.some((r) => r.type === 'createList')).toBe(false);
    expect(spokenText(root)).toContain('Type a name for the new list first.');
  });

  it('renames a list', async () => {
    host.handlers.renameList = () => ({ ok: true, data: emptyPlan() });
    const root = renderManagePassages(host, managePlan([], { lists: TWO_LISTS }));
    container.appendChild(root);

    const renameButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-manage-list-actions button')).filter(
      (b) => b.textContent === 'Rename',
    );
    renameButtons[0]!.click();

    const input = root.querySelector<HTMLInputElement>('.sm-manage-list-rename input')!;
    expect(input.value).toBe('Default');
    input.value = 'My Verses';
    root.querySelector<HTMLButtonElement>('.sm-manage-list-rename button')!.click();
    await settle();

    expect(host.requests).toContainEqual({ type: 'renameList', id: 1, name: 'My Verses' });
    expect(host.reloads).toBeGreaterThan(0);
  });

  it('disables Delete on the only remaining list', () => {
    const root = renderManagePassages(
      host,
      managePlan([], { lists: [{ id: 1, name: 'Default', passageCount: 0, verseCount: 0 }] }),
    );
    container.appendChild(root);

    const deleteButton = Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-manage-list-actions button')).find(
      (b) => b.textContent === 'Delete',
    )!;
    expect(deleteButton.disabled).toBe(true);
  });

  it('deletes an empty list immediately, moving nothing, with no confirmation step', async () => {
    host.handlers.deleteList = () => ({ ok: true, data: emptyPlan() });
    const root = renderManagePassages(host, managePlan([], { lists: TWO_LISTS }));
    container.appendChild(root);

    const romansRow = Array.from(root.querySelectorAll('li.sm-manage-list-row')).find((row) =>
      spokenText(row).includes('Romans Road'),
    )!;
    romansRow.querySelector<HTMLButtonElement>('button:last-of-type')!.click();
    await settle();

    expect(host.requests).toContainEqual({ type: 'deleteList', id: 2, movePassagesTo: 1 });
    expect(root.querySelector('.sm-modal')).toBeNull();
  });

  it('asks where to move passages before deleting a list that has them, defaulting to Default', async () => {
    host.handlers.getListPracticeStats = () => ({ ok: true, data: { total: 3, practiced: 0 } });
    host.handlers.deleteList = () => ({ ok: true, data: emptyPlan() });
    const lists = [
      { id: 1, name: 'Default', passageCount: 0, verseCount: 0 },
      { id: 2, name: 'Romans Road', passageCount: 3, verseCount: 6 },
    ];
    const root = renderManagePassages(host, managePlan([], { lists }));
    container.appendChild(root);

    const romansRow = Array.from(root.querySelectorAll('li.sm-manage-list-row')).find((row) =>
      spokenText(row).includes('Romans Road'),
    )!;
    romansRow.querySelector<HTMLButtonElement>('button:last-of-type')!.click();
    await settle();

    const backdrop = document.querySelector('.sm-modal-backdrop');
    expect(backdrop).not.toBeNull();
    expect(spokenText(backdrop!)).toContain('Default');

    const confirm = Array.from(backdrop!.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').startsWith('Delete and move'),
    )!;
    confirm.click();
    await settle();

    expect(host.requests).toContainEqual({ type: 'deleteList', id: 2, movePassagesTo: 1 });
    backdrop?.remove();
  });

  // -- suggested lists ----------------------------------------------------

  it('lists every suggested list with its name, blurb and reference count', () => {
    const root = renderManagePassages(host, managePlan([]));
    container.appendChild(root);

    const text = spokenText(root.querySelector('.sm-suggested-lists')!);
    for (const list of SUGGESTED_LISTS) {
      expect(text).toContain(list.name);
      expect(text).toContain(list.blurb);
    }
    const firstRow = root.querySelector('.sm-suggested-list-row')!;
    expect(spokenText(firstRow)).toContain(`${SUGGESTED_LISTS[0]!.references.length}`);
  });

  it('"Copy references" drops the list into the add field\'s batch-confirm flow', () => {
    const root = renderManagePassages(host, managePlan([]));
    container.appendChild(root);

    const firstRow = root.querySelector('.sm-suggested-list-row')!;
    const copyButton = Array.from(firstRow.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Copy references',
    )!;
    copyButton.click();

    const batch = document.querySelector('.sm-modal-backdrop')!;
    expect(batch).not.toBeNull();
    const items = Array.from(batch.querySelectorAll('.sm-batch-list-item')).map((li) => li.textContent);
    expect(items).toEqual(SUGGESTED_LISTS[0]!.references);
    batch.remove();
  });

  it('"Create this list" creates a collection named after the list and adds every reference', async () => {
    const list = SUGGESTED_LISTS[0]!;
    const createdLists = [{ id: 1, name: 'Default', passageCount: 0, verseCount: 0 }, { id: 9, name: list.name, passageCount: 0, verseCount: 0 }];
    host.handlers.createList = () => ({ ok: true, data: { ...emptyPlan(), lists: createdLists } });
    host.handlers.setScope = () => ({ ok: true, data: emptyPlan() });
    const addedRefs: string[] = [];
    host.handlers.addPassage = (req) => {
      addedRefs.push(req.reference);
      return { ok: true, data: { passage: passageFixture({ id: addedRefs.length, reference: req.reference }) } };
    };

    const root = renderManagePassages(host, managePlan([]));
    container.appendChild(root);

    const row = Array.from(root.querySelectorAll('.sm-suggested-list-row')).find((r) => spokenText(r).includes(list.name))!;
    row.querySelector<HTMLButtonElement>('button')!.click(); // "Create this list" is the first button
    await settleBatch();

    expect(host.requests).toContainEqual({ type: 'createList', name: list.name });
    expect(host.requests).toContainEqual({ type: 'setScope', scope: { kind: 'list', id: 9 } });
    expect(addedRefs).toEqual(list.references);
    expect(host.announcements.some((a) => a.includes(list.name))).toBe(true);
  });

  it('"Create this list" a second time reuses the existing list rather than creating a duplicate', async () => {
    const list = SUGGESTED_LISTS[0]!;
    host.handlers.setScope = () => ({ ok: true, data: emptyPlan() });
    const addedRefs: string[] = [];
    host.handlers.addPassage = (req) => {
      addedRefs.push(req.reference);
      return { ok: true, data: { passage: passageFixture({ id: addedRefs.length, reference: req.reference }) } };
    };

    // Simulate the plan the worker would hand back after the first creation:
    // the list already exists by name.
    const plan = managePlan([], { lists: [{ id: 1, name: 'Default', passageCount: 0, verseCount: 0 }, { id: 9, name: list.name, passageCount: list.references.length, verseCount: 0 }] });
    const root = renderManagePassages(host, plan);
    container.appendChild(root);

    const row = Array.from(root.querySelectorAll('.sm-suggested-list-row')).find((r) => spokenText(r).includes(list.name))!;
    row.querySelector<HTMLButtonElement>('button')!.click();
    await settleBatch();

    expect(host.requests.some((r) => r.type === 'createList')).toBe(false);
    expect(host.requests).toContainEqual({ type: 'setScope', scope: { kind: 'list', id: 9 } });
  });

  it('reports a per-reference failure while still adding the rest of a suggested list', async () => {
    const list = SUGGESTED_LISTS.find((l) => l.references.length > 1)!;
    const createdLists = [{ id: 9, name: list.name, passageCount: 0, verseCount: 0 }];
    host.handlers.createList = () => ({ ok: true, data: { ...emptyPlan(), lists: createdLists } });
    host.handlers.setScope = () => ({ ok: true, data: emptyPlan() });
    const failing = list.references[0]!;
    let n = 0;
    host.handlers.addPassage = (req) => {
      n += 1;
      if (req.reference === failing) return { ok: false, error: `Could not parse "${req.reference}".` };
      return { ok: true, data: { passage: passageFixture({ id: n, reference: req.reference }) } };
    };

    const root = renderManagePassages(host, managePlan([]));
    container.appendChild(root);

    const row = Array.from(root.querySelectorAll('.sm-suggested-list-row')).find((r) => spokenText(r).includes(list.name))!;
    row.querySelector<HTMLButtonElement>('button')!.click();
    await settleBatch();

    expect(spokenText(row)).toContain(`Could not parse "${failing}"`);
    expect(host.announcements.some((a) => a.includes('failed'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T12: the passage-overview grid's alignment and narrow-width behaviour
// ---------------------------------------------------------------------------

describe('the passage screen: the tab panel', () => {
  it('is a tablist followed by one activity panel, not a grid of rows', () => {
    const root = renderPassageScreen(host, passageViewFixture(), 'firstLetter');
    container.appendChild(root);

    expect(root.querySelector('.sm-activity-table')).toBeNull();
    expect(root.querySelectorAll('[role="tablist"]').length).toBe(1);
    expect(root.querySelectorAll('.sm-activity-card').length).toBe(1);
  });

  it('puts the settings gear and Show in Bible in the breadcrumb actions', () => {
    const pv = passageViewFixture();
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    const actions = root.querySelector('.sm-crumbs-actions')!;
    expect(actions.querySelector('[aria-label="Passage settings"]')).not.toBeNull();
    const show = Array.from(actions.querySelectorAll('button')).find((b) => b.textContent === 'Show in Bible')!;
    show.click();
    expect(host.openedVerses).toEqual([pv.passage.startVerseId]);
  });
});

// ---------------------------------------------------------------------------
// T13: the practice screen's chrome - activity tabs, shuffle, tier display
// ---------------------------------------------------------------------------

describe('the practice screen: activity tabs, shuffle, and tier display', () => {
  // The tab strip is `components.ts#tabs()`, the same one the passage screen uses.
  /** The tab strip's own buttons, in document order. */
  function tabs(root: HTMLElement): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-tabs [role="tab"]'));
  }

  it('renders one tab per applicable activity, and marks the current one - never with aria-current="step"', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED), { rung: 'blanks' });

    const strip = practice.root.querySelector('.sm-tabs')!;
    expect(strip).toBeTruthy();
    expect(strip.getAttribute('role')).toBe('tablist');

    const labels = tabs(practice.root).map((t) => t.textContent);
    // `refmatch` is inapplicable on `passageViewFixture()` and must not appear.
    expect(labels).toEqual([RUNG_LABEL.ordering, RUNG_LABEL.blanks, RUNG_LABEL.firstletters]);

    const current = tabs(practice.root).find((t) => t.textContent === RUNG_LABEL.blanks)!;
    expect(current.getAttribute('aria-selected')).toBe('true');
    const others = tabs(practice.root).filter((t) => t !== current);
    for (const other of others) expect(other.getAttribute('aria-selected')).toBe('false');

    // `aria-current="step"` is already this file's own word for the verse
    // being worked on inside the passage (see `workingVerse()` and the
    // accessibility describe block above) - a tab claiming the same value
    // would make that query ambiguous, so the tab strip deliberately uses a
    // different value.
    expect(practice.root.querySelectorAll('[aria-current="step"]').length).toBe(1);
  });

  it('shows no tab strip at all when only one activity is applicable', async () => {
    const singlePassageView = passageViewFixture({
      rungs: [rungView({ rung: 'blanks', level: 1 })],
    });
    const practice = await mountPractice(
      blanksStep(PSALM_1_2, BLANKED),
      { rung: 'blanks' },
      undefined,
      { ok: true, data: singlePassageView },
    );

    expect(practice.root.querySelector('.sm-tabs')).toBeNull();
  });

  it('clicking another tab ends the in-flight session via endSession BEFORE starting the next, and never resubmits with the old session id', async () => {
    const order: string[] = [];
    let endedSessionId: string | null = null;
    host.handlers.endSession = (req) => {
      order.push('end');
      endedSessionId = req.sessionId;
      return { ok: true, data: { summary: null } };
    };
    const originalStartSession = host.startSession.bind(host);
    host.startSession = async (passageId, rung, restart, tier) => {
      order.push('start');
      return originalStartSession(passageId, rung, restart, tier);
    };

    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED), {
      passageId: 1,
      rung: 'blanks',
      sessionId: 'session-old',
    });

    const orderingTab = tabs(practice.root).find((t) => t.textContent === RUNG_LABEL.ordering)!;
    orderingTab.click();
    await settle();

    // Ended before started, with the OLD session's id - not the passage or
    // activity of the tab that was clicked.
    expect(order).toEqual(['end', 'start']);
    expect(endedSessionId).toBe('session-old');
    expect(host.sessionsStarted).toContainEqual({
      passageId: 1,
      rung: 'ordering',
      restart: undefined,
      tier: undefined,
    });

    // No `submitStep` (or anything else) is ever sent against the ended
    // session id after the switch.
    const afterEnd = host.requests.slice(host.requests.findIndex((r) => r.type === 'endSession') + 1);
    expect(afterEnd.some((r) => 'sessionId' in r && r.sessionId === 'session-old')).toBe(false);
  });

  it('clicking the current tab does nothing', async () => {
    host.handlers.endSession = () => ({ ok: true, data: { summary: null } });

    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED), { rung: 'blanks' });
    const currentTab = tabs(practice.root).find((t) => t.textContent === RUNG_LABEL.blanks)!;
    currentTab.click();
    await settle();

    expect(host.requests.some((r) => r.type === 'endSession')).toBe(false);
    expect(host.sessionsStarted.length).toBe(0);
  });

  it('shows the current tier beside the activity name when the activity has more than one tier', async () => {
    const practice = await mountPractice(null, { rung: 'ordering', tier: 1, tiers: 2 });

    expect(spokenText(practice.root)).toContain(tierLabel('ordering', 1));
    expect(spokenText(practice.root)).toContain('Tier 2 of 2');
  });

  it('omits the tier text for a single-tier activity', async () => {
    const practice = await mountPractice(null, { rung: 'refprovide', tier: 0, tiers: 1 });

    expect(practice.root.querySelector('.sm-practice-tier')).toBeNull();
  });

  it('reflects the tier in the end-of-session summary', async () => {
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: true, wrong: [] }),
        session: session(null, { rung: 'blanks', tier: 1, tiers: 2 }),
        summary: {
          passageId: 1,
          rung: 'blanks',
          tier: 1,
          tiers: 2,
          score: 1,
          correctFirst: 2,
          totalSteps: 2,
          nextDueAt: null,
          level: 5,
          passageWellLearned: false,
        },
      },
    });

    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED), { rung: 'blanks', tier: 1, tiers: 2 });
    practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();

    const finish = practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!;
    expect(finish.textContent).toBe('Finish');
    finish.click();
    await settle();

    expect(spokenText(practice.root)).toContain(tierLabel('blanks', 1));
    expect(spokenText(practice.root)).toContain('Tier 2 of 2');
  });

  it('does not rebuild the exercise inputs the user is typing into when the tab strip arrives after the first paint', async () => {
    let resolvePassageView!: (reply: PanelReply<PassageView>) => void;
    host.handlers.getContext = () => ({ ok: true, data: psalmContext() });
    host.handlers.getPassageView = () =>
      new Promise<PanelReply<PassageView>>((resolve) => {
        resolvePassageView = resolve;
      }) as unknown as PanelReply<PassageView>;

    const practice = new PracticeView(host, session(blanksStep(PSALM_1_2, BLANKED), { rung: 'blanks' }));
    practice.mount(container);
    await settle();
    view = practice;

    // No tab strip yet - the fetch has not resolved.
    expect(practice.root.querySelector('.sm-tabs')).toBeNull();

    const input = practice.root.querySelectorAll<HTMLInputElement>('.sm-blank')[0]!;
    input.value = 'his';
    input.dispatchEvent(new Event('input'));

    resolvePassageView({ ok: true, data: passageViewFixture() });
    await settle();

    // The tab strip is now present, but `contextEl` was never rebuilt: the
    // very same input node still holds what the user typed.
    expect(practice.root.querySelector('.sm-tabs')).not.toBeNull();
    const inputAfter = practice.root.querySelectorAll<HTMLInputElement>('.sm-blank')[0]!;
    expect(inputAfter).toBe(input);
    expect(inputAfter.value).toBe('his');
  });

  it('the shuffle control starts a different target', async () => {
    const plan: PlanView = {
      ...emptyPlan(),
      passages: [
        passageViewFixture({ passage: passageFixture({ id: 1, reference: 'Psalm 1:2-3' }) }),
        passageViewFixture({ passage: passageFixture({ id: 2, reference: 'Psalm 23:1-6' }) }),
      ],
    };
    host.handlers.getPlan = () => ({ ok: true, data: plan });
    host.handlers.endSession = () => ({ ok: true, data: { summary: null } });

    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED), {
      passageId: 1,
      rung: 'blanks',
      sessionId: 'session-old',
    });

    const shuffleButton = practice.root.querySelector<HTMLButtonElement>('.sm-practice-sub .sm-icon-btn')!;
    shuffleButton.click();
    await settle();

    expect(host.requests.some((r) => r.type === 'getPlan')).toBe(true);
    expect(
      host.requests.some((r) => r.type === 'endSession' && r.sessionId === 'session-old'),
    ).toBe(true);
    expect(host.sessionsStarted.length).toBe(1);
    const started = host.sessionsStarted[0]!;
    expect(started.passageId === 1 && started.rung === 'blanks').toBe(false);
  });

  it('announces there is nothing else when the shuffle has no other target to offer', async () => {
    const onlyPassageView = passageViewFixture({
      passage: passageFixture({ id: 10 }),
      rungs: [rungView({ rung: 'blanks', level: 1 })],
    });
    const plan: PlanView = { ...emptyPlan(), passages: [onlyPassageView] };
    host.handlers.getPlan = () => ({ ok: true, data: plan });

    const practice = await mountPractice(
      blanksStep(PSALM_1_2, BLANKED),
      { passageId: 10, rung: 'blanks', sessionId: 'session-old' },
      undefined,
      { ok: true, data: onlyPassageView },
    );

    const shuffleButton = practice.root.querySelector<HTMLButtonElement>('.sm-practice-sub .sm-icon-btn')!;
    shuffleButton.click();
    await settle();

    expect(host.announcements).toContain('Nothing else to practise right now.');
    expect(host.sessionsStarted.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T14: Fill in the Blanks and First Letters - difficulty tiers (panel)
// ---------------------------------------------------------------------------

describe('blanks, hard tier: the whole passage on one screen', () => {
  /** A plain prose verse - no poetry, no superscription - built to spec. */
  function makeVerse(id: number, label: string, words: string[]): VerseText {
    return { verseId: id, label, words, lines: null, psalmTitle: null, paragraphStart: true };
  }

  /**
   * A hard-tier `BlanksStep` over several verses. `indicesFor` decides each
   * verse's own `blanks.indices` - the per-verse-ascending part of the
   * contract `types.ts` documents; flattening `blanks` in order is the panel's
   * job, not this fixture's.
   */
  function hardBlanksStep(
    verses: VerseText[],
    indicesFor: (verse: VerseText) => number[],
    answerMode: AnswerMode = 'fullWord',
  ): BlanksStep {
    return {
      kind: 'blanks',
      verses,
      blanks: verses.map((v) => ({ verseId: v.verseId, indices: indicesFor(v) })),
      answerMode,
      stepNumber: 1,
      totalSteps: 1,
    };
  }

  it('names the tier in the prompt, so a hard-tier screen does not just look randomly different', async () => {
    const v1 = makeVerse(80000001, '1', ['One', 'Two']);
    const v2 = makeVerse(80000002, '2', ['Three', 'Four']);
    const step = hardBlanksStep([v1, v2], () => [0]);

    const practice = await mountPractice(
      step,
      { rung: 'blanks', tier: 1, tiers: 2 },
      { ok: true, data: { passageId: 1, reference: 'Test 1:1-2', before: [], verses: [v1, v2], after: [] } },
    );

    const prompt = practice.root.querySelector('.sm-prompt')!;
    expect(prompt.textContent).toContain(tierLabel('blanks', 1));
  });

  it('puts every verse of a 25-verse hard-tier step on screen at once, all measured, with Enter walking across verse boundaries in order', async () => {
    const verses = Array.from({ length: 25 }, (_, i) =>
      makeVerse(50000000 + i, String(i + 1), [`w${i}a`, `w${i}b`, `w${i}c`]),
    );
    const step = hardBlanksStep(verses, () => [0]);

    const practice = await mountPractice(
      step,
      { rung: 'blanks', tier: 1, tiers: 2 },
      { ok: true, data: { passageId: 1, reference: 'Test 1:1-25', before: [], verses, after: [] } },
    );

    // Every verse is interactive at once - no per-verse walk, no separate
    // "next verse" step.
    expect(practice.root.querySelectorAll('[aria-current="step"]').length).toBe(25);
    const inputs = Array.from(practice.root.querySelectorAll<HTMLInputElement>('.sm-blank'));
    expect(inputs.length).toBe(25);

    // The measured-width pass reached every one of them, not just whichever
    // verse happened to render first.
    for (const input of inputs) expect(input.style.width).not.toBe('');

    // Enter walks forward across verse boundaries, in verse order - the same
    // "the whole context is one tab sequence" behaviour `nextSlotAfter`
    // already gives a single verse, now exercised across 25 of them.
    for (let i = 0; i < inputs.length - 1; i++) {
      inputs[i]!.focus();
      inputs[i]!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      expect(document.activeElement).toBe(inputs[i + 1]);
    }
  });

  it('has no readable preview of the passage before the blanks are shown', async () => {
    const v1 = makeVerse(81000001, '1', ['One', 'Two', 'Three']);
    const v2 = makeVerse(81000002, '2', ['Four', 'Five']);
    const step = hardBlanksStep([v1, v2], () => [0]);

    const practice = await mountPractice(
      step,
      { rung: 'blanks', tier: 1, tiers: 2 },
      { ok: true, data: { passageId: 1, reference: 'Test 1:1-2', before: [], verses: [v1, v2], after: [] } },
    );

    // The hidden words never appear as plain text anywhere on screen - only
    // as inputs (or, once resolved, as revealed/missed markers).
    expect(spokenText(practice.root)).not.toContain('One');
    expect(spokenText(practice.root)).not.toContain('Four');
  });

  it('grades a wrong answer against the right word even with several verses of blanks flattened together', async () => {
    // Flat order (per `types.ts`'s documented contract - iterate `blanks` in
    // order, each entry's `indices` in order): Alpha=0, Gamma=1 (both v1),
    // Epsilon=2 (v2), Zeta=3 (v3).
    const v1 = makeVerse(60000001, '1', ['Alpha', 'Beta', 'Gamma']);
    const v2 = makeVerse(60000002, '2', ['Delta', 'Epsilon']);
    const v3 = makeVerse(60000003, '3', ['Zeta', 'Eta']);
    const step = hardBlanksStep([v1, v2, v3], (v) =>
      v.verseId === v1.verseId ? [0, 2] : v.verseId === v2.verseId ? [1] : [0],
    );

    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        // Only flat position 2 ("Epsilon") is wrong - a word index within v2
        // alone would ALSO be 1, which is why this is the case that catches an
        // indexing scheme that silently drifts between the two spaces.
        result: stepResult({
          correct: false,
          wrong: [2],
          blocking: false,
          reveal: { words: ['Alpha', 'Gamma', 'Epsilon', 'Zeta'] },
        }),
        session: session(null),
        summary: null,
      },
    });

    const practice = await mountPractice(
      step,
      { rung: 'blanks', tier: 1, tiers: 2 },
      { ok: true, data: { passageId: 1, reference: 'Test 1:1-3', before: [], verses: [v1, v2, v3], after: [] } },
    );

    const inputs = Array.from(practice.root.querySelectorAll<HTMLInputElement>('.sm-blank'));
    expect(inputs.length).toBe(4);
    inputs[0]!.value = 'Alpha';
    inputs[1]!.value = 'Gamma';
    inputs[2]!.value = 'Epsilon';
    inputs[3]!.value = 'Zeta';

    practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();

    const missed = Array.from(practice.root.querySelectorAll('.sm-word-missed'));
    expect(missed.length).toBe(1);
    expect(spokenText(missed[0]!)).toContain('Epsilon');
    for (const word of ['Alpha', 'Gamma', 'Zeta']) {
      expect(missed.some((n) => spokenText(n).includes(word)), `${word} should not be marked missed`).toBe(
        false,
      );
    }
  });

  it('submits the flattened positional answer array in the documented order', async () => {
    const v1 = makeVerse(62000001, '1', ['Alpha', 'Beta']);
    const v2 = makeVerse(62000002, '2', ['Gamma', 'Delta']);
    const step = hardBlanksStep([v1, v2], (v) => (v.verseId === v1.verseId ? [0] : [1]));

    let submitted: unknown = null;
    host.handlers.submitStep = (req) => {
      submitted = req.answer;
      return { ok: true, data: { result: stepResult({ correct: true }), session: session(null), summary: null } };
    };

    const practice = await mountPractice(
      step,
      { rung: 'blanks', tier: 1, tiers: 2 },
      { ok: true, data: { passageId: 1, reference: 'Test 1:1-2', before: [], verses: [v1, v2], after: [] } },
    );

    const inputs = Array.from(practice.root.querySelectorAll<HTMLInputElement>('.sm-blank'));
    inputs[0]!.value = 'Alpha';
    inputs[1]!.value = 'Delta';
    practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();

    expect(submitted).toMatchObject({ kind: 'blanks', words: ['Alpha', 'Delta'] });
  });

  it('prints a token with no letters plainly and does not wait on it to auto-submit', async () => {
    const v1 = makeVerse(70000001, '1', ['And', '—', 'he']);
    const v2 = makeVerse(70000002, '2', ['shall', 'be']);
    const step = hardBlanksStep(
      [v1, v2],
      (v) => (v.verseId === v1.verseId ? [0, 1, 2] : [0]),
      'firstLetter',
    );

    let submitted: unknown = null;
    let submitCount = 0;
    host.handlers.submitStep = (req) => {
      submitCount += 1;
      submitted = req.answer;
      return { ok: true, data: { result: stepResult({ correct: true }), session: session(null), summary: null } };
    };

    const practice = await mountPractice(
      step,
      { rung: 'blanks', tier: 1, tiers: 2 },
      { ok: true, data: { passageId: 1, reference: 'Test 1:1-2', before: [], verses: [v1, v2], after: [] } },
    );

    // Three indices were requested (0,1,2 in v1) but the dash has no initial
    // to ask for, so only "And" and "he" from v1, plus "shall" from v2, are
    // offered - three real slots, not four.
    const initialSlots = practice.root.querySelectorAll<HTMLInputElement>('.sm-fl');
    expect(initialSlots.length).toBe(3);
    expect(spokenText(practice.root)).toContain('—');

    // Resolve the three real slots. The dash must not block this - it was
    // excluded from `hiddenPending` at render time.
    const answers = ['a', 'h', 's'];
    for (const letter of answers) {
      const slot = practice.root.querySelector<HTMLInputElement>('.sm-fl')!;
      slot.value = letter;
      slot.dispatchEvent(new Event('input'));
    }
    await settle();

    expect(submitCount).toBe(1);
    expect(submitted).toMatchObject({ kind: 'blanks', words: ['And', '—', 'he', 'shall'] });
  });
});

describe('blanks, easy tier: unchanged single-verse behaviour', () => {
  it('still renders exactly one verse interactive, with no tier prefix leaking through unrelated fixtures', async () => {
    // `tiers` is left unset by `session()`'s default, matching every
    // pre-existing `blanksStep` fixture in this file - the tier name is only
    // ever shown once `session.tiers > 1`, so old single-tier callers keep
    // their original, unprefixed wording.
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));

    expect(practice.root.querySelectorAll('[aria-current="step"]').length).toBe(1);
    expect(practice.root.querySelectorAll('.sm-blank').length).toBe(2);
  });

  it('names the tier when the session says there is more than one', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED), {
      rung: 'blanks',
      tier: 0,
      tiers: 2,
    });

    const prompt = practice.root.querySelector('.sm-prompt')!;
    expect(prompt.textContent).toContain(tierLabel('blanks', 0));
  });
});

describe('first letters, easy tier: a preview before the blanks', () => {
  it('shows the verse in full, with a Start control, and no blanks yet', async () => {
    const step = firstLettersStep(PSALM_1_3, 'firstLetter', 0);
    const practice = await mountPractice(step, { rung: 'firstletters', tier: 0, tiers: 2 });

    expect(practice.root.querySelectorAll('.sm-fl').length).toBe(0);
    expect(spokenText(workingVerse(practice.root))).toBe(PSALM_1_3.words.join(' '));

    const prompt = practice.root.querySelector('.sm-prompt')!;
    expect(prompt.textContent).toContain(tierLabel('firstletters', 0));

    const start = Array.from(practice.root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Start',
    );
    expect(start).toBeTruthy();
  });

  it('pressing Start blanks the verse and focuses the first slot', async () => {
    const step = firstLettersStep(PSALM_1_3, 'firstLetter', 0);
    const practice = await mountPractice(step, { rung: 'firstletters', tier: 0, tiers: 2 });

    const start = Array.from(practice.root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Start',
    )!;
    start.click();
    await settle();

    const slots = practice.root.querySelectorAll<HTMLInputElement>('.sm-fl');
    expect(slots.length).toBe(PSALM_1_3.words.length);
    expect(document.activeElement).toBe(slots[0]);
    // The preview text is gone - the verse is genuinely hidden now, not shown
    // alongside the inputs.
    expect(spokenText(workingVerse(practice.root))).toBe('');
  });

  it('pressing Start on a fullWord-mode easy tier focuses the first full-word blank', async () => {
    const step = firstLettersStep(PSALM_1_3, 'fullWord', 0);
    const practice = await mountPractice(step, { rung: 'firstletters', tier: 0, tiers: 2 });

    expect(practice.root.querySelectorAll('.sm-blank').length).toBe(0);
    const start = Array.from(practice.root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Start',
    )!;
    start.click();
    await settle();

    const slots = practice.root.querySelectorAll<HTMLInputElement>('.sm-blank');
    expect(slots.length).toBe(PSALM_1_3.words.length);
    expect(document.activeElement).toBe(slots[0]);
  });
});

describe('first letters, hard tier: no preview', () => {
  it('goes straight to blanks - no Start control, no readable verse first', async () => {
    const step = firstLettersStep(PSALM_1_3, 'firstLetter', 1);
    const practice = await mountPractice(step, { rung: 'firstletters', tier: 1, tiers: 2 });

    const slots = practice.root.querySelectorAll<HTMLInputElement>('.sm-fl');
    expect(slots.length).toBe(PSALM_1_3.words.length);
    expect(
      Array.from(practice.root.querySelectorAll('button')).some((b) => b.textContent === 'Start'),
    ).toBe(false);

    const prompt = practice.root.querySelector('.sm-prompt')!;
    expect(prompt.textContent).toContain(tierLabel('firstletters', 1));
  });
});

describe('first letters, easy tier: navigating away mid-preview', () => {
  it('leaves no dangling DOM once destroyed, even if a late reply arrives afterwards', async () => {
    let releaseContext = (): void => {};
    const pending = new Promise<PanelReply<PassageContext>>((resolve) => {
      releaseContext = () => resolve({ ok: true, data: psalmContext() });
    });
    host.handlers.getContext = () => pending as unknown as PanelReply<PassageContext>;

    const step = firstLettersStep(PSALM_1_3, 'firstLetter', 0);
    const practice = new PracticeView(host, session(step, { rung: 'firstletters', tier: 0, tiers: 2 }));
    practice.mount(container);
    await settle();

    // The preview is up, waiting on the user - and on the still-pending
    // context fetch.
    expect(practice.root.querySelectorAll('.sm-fl').length).toBe(0);
    expect(
      Array.from(practice.root.querySelectorAll('button')).some((b) => b.textContent === 'Start'),
    ).toBe(true);

    practice.destroy();

    // The late `getContext` reply must not resurrect anything into a view
    // that has already gone - `loadContext`'s `if (this.disposed) return`
    // guard is what this exercises.
    releaseContext();
    await settle();

    expect(container.children.length).toBe(0);
    expect(document.querySelectorAll('.sm-fl').length).toBe(0);
    expect(document.querySelectorAll('button').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 13. Reference activities - refmatch and refprovide (T15)
// ---------------------------------------------------------------------------

describe('refmatch - which reference is this?', () => {
  /** The passage under exercise: a lone verse, no siblings, no `before`. */
  function johnContext(): PassageContext {
    return { passageId: 2, reference: 'John 3:16', before: [], verses: [JOHN_3_16], after: [] };
  }

  function refMatchStep(over: Partial<RefMatchStep> = {}): RefMatchStep {
    return {
      kind: 'refmatch',
      verse: JOHN_3_16,
      candidates: [
        { id: 'cand-a', reference: 'John 3:16' },
        { id: 'cand-b', reference: 'Mark 1:1' },
        { id: 'cand-c', reference: 'Genesis 1:1' },
      ],
      tier: 0,
      stepNumber: 1,
      totalSteps: 3,
      ...over,
    };
  }

  function press(list: Element, key: string, over: KeyboardEventInit = {}): void {
    list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...over }));
  }

  function refmatchAnswers(): { kind: string; id?: string }[] {
    return host.requests
      .filter((r): r is Extract<PanelRequest, { type: 'submitStep' }> => r.type === 'submitStep')
      .map((r) => r.answer as { kind: string; id?: string });
  }

  it('labels each candidate A, B, C, ... by its position in the list, same as the ordering picker', async () => {
    const practice = await mountPractice(refMatchStep(), { rung: 'refmatch' }, { ok: true, data: johnContext() });

    const letters = Array.from(
      practice.root.querySelectorAll<HTMLElement>('.sm-choice-letter'),
    ).map((el) => el.textContent);
    expect(letters).toEqual(['A', 'B', 'C']);
  });

  it("pressing a candidate's letter picks it, without first moving focus onto it", async () => {
    const step = refMatchStep();
    host.handlers.submitStep = () => ({
      ok: true,
      data: { result: stepResult({ correct: true }), session: session(null, { rung: 'refmatch' }), summary: null },
    });

    const practice = await mountPractice(step, { rung: 'refmatch' }, { ok: true, data: johnContext() });
    // "C" is the third candidate - upper case, same case-insensitivity the
    // ordering picker's own shortcut has.
    press(practice.root.querySelector('.sm-choices')!, 'C');
    await settle();

    expect(refmatchAnswers()).toEqual([{ kind: 'refmatch', id: 'cand-c' }]);
  });

  it('leaves arrow-key navigation working alongside the letter shortcuts', async () => {
    const practice = await mountPractice(refMatchStep(), { rung: 'refmatch' }, { ok: true, data: johnContext() });
    const buttons = Array.from(practice.root.querySelectorAll<HTMLButtonElement>('.sm-choice'));
    buttons[0]!.focus();

    press(practice.root.querySelector('.sm-choices')!, 'ArrowDown');

    expect(document.activeElement).toBe(buttons[1]);
  });

  it('ignores a letter typed with a modifier key held, same guard as the ordering picker', async () => {
    const practice = await mountPractice(refMatchStep(), { rung: 'refmatch' }, { ok: true, data: johnContext() });
    press(practice.root.querySelector('.sm-choices')!, 'c', { metaKey: true });
    await settle();
    expect(refmatchAnswers()).toEqual([]);
  });

  it('is playable end to end with the keyboard alone: press a letter, get a verdict, move on', async () => {
    const step = refMatchStep();
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: true }),
        session: session(null, { rung: 'refmatch' }),
        summary: null,
      },
    });

    const practice = await mountPractice(step, { rung: 'refmatch' }, { ok: true, data: johnContext() });
    vi.useFakeTimers();
    press(practice.root.querySelector('.sm-choices')!, 'A');
    await settle();

    expect(spokenText(practice.root)).toContain('Yes.');
    vi.advanceTimersByTime(1_000);

    expect(practice.root.querySelector('p.sm-prompt')?.textContent).toContain(
      'Nothing left to do in this session.',
    );
  });
});

describe('refprovide - supply the reference from memory', () => {
  /** The passage under exercise: a lone verse, so `context.reference` alone
   *  names its book - see `correctReferenceFor`'s own doc comment. */
  function johnContext(): PassageContext {
    return { passageId: 2, reference: 'John 3:16', before: [], verses: [JOHN_3_16], after: [] };
  }

  function refProvideStep(over: Partial<RefProvideStep> = {}): RefProvideStep {
    return {
      kind: 'refprovide',
      verse: JOHN_3_16,
      truncatedPreview: false,
      stepNumber: 1,
      totalSteps: 3,
      ...over,
    };
  }

  function refInput(root: HTMLElement): HTMLInputElement {
    return root.querySelector<HTMLInputElement>('.sm-ref-input')!;
  }

  function submittedTexts(): string[] {
    return host.requests
      .filter((r): r is Extract<PanelRequest, { type: 'submitStep' }> => r.type === 'submitStep')
      .map((r) => (r.answer as { kind: string; text?: string }).text ?? '');
  }

  it('is playable end to end with the keyboard alone: type, press Enter, see the verdict', async () => {
    const step = refProvideStep();
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: true, reveal: { verseId: JOHN_3_16.verseId } }),
        session: session(null, { rung: 'refprovide' }),
        summary: null,
      },
    });

    const practice = await mountPractice(step, { rung: 'refprovide' }, { ok: true, data: johnContext() });
    vi.useFakeTimers();
    const input = refInput(practice.root);
    input.value = 'John 3:16';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();

    expect(submittedTexts()).toEqual(['John 3:16']);
    expect(spokenText(practice.root)).toContain('Yes.');
    vi.advanceTimersByTime(1_000);

    expect(practice.root.querySelector('p.sm-prompt')?.textContent).toContain(
      'Nothing left to do in this session.',
    );
  });

  it('submitting an empty string is sent to the worker, not swallowed locally', async () => {
    host.handlers.submitStep = (req) => {
      const text = (req.answer as { text: string }).text;
      return {
        ok: true,
        data: {
          result: stepResult({ correct: false, blocking: true, unrecognized: text === '' }),
          session: session(refProvideStep(), { rung: 'refprovide' }),
          summary: null,
        },
      };
    };

    const practice = await mountPractice(refProvideStep(), { rung: 'refprovide' }, { ok: true, data: johnContext() });
    const input = refInput(practice.root);
    input.value = '';
    practice.root.querySelector<HTMLButtonElement>('.sm-btn-primary')!.click();
    await settle();

    expect(submittedTexts()).toEqual(['']);
  });

  it('treats an empty submission as unrecognised, not as a wrong answer', async () => {
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: false, blocking: true, unrecognized: true }),
        session: session(refProvideStep(), { rung: 'refprovide' }),
        summary: null,
      },
    });

    const practice = await mountPractice(refProvideStep(), { rung: 'refprovide' }, { ok: true, data: johnContext() });
    const input = refInput(practice.root);
    input.value = '';
    practice.root.querySelector<HTMLButtonElement>('.sm-btn-primary')!.click();
    await settle();

    expect(spokenText(practice.root)).toContain("I don't recognise that reference");
    expect(spokenText(practice.root)).not.toContain('Not quite');
  });

  it('an unrecognised result re-prompts the SAME step, leaving the input focused with its text intact', async () => {
    const step = refProvideStep();
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: false, blocking: true, unrecognized: true }),
        session: session(step, { rung: 'refprovide' }),
        summary: null,
      },
    });

    const practice = await mountPractice(step, { rung: 'refprovide' }, { ok: true, data: johnContext() });
    const input = refInput(practice.root);
    input.value = 'Zzyzx 9:9';
    practice.root.querySelector<HTMLButtonElement>('.sm-btn-primary')!.click();
    await settle();

    // Not cleared, and not replaced by a fresh input either - it is the same
    // node the user typed into, still holding what they typed.
    expect(refInput(practice.root)).toBe(input);
    expect(input.value).toBe('Zzyzx 9:9');
    expect(document.activeElement).toBe(input);
  });

  it('an unrecognised re-prompt does not advance stepNumber or move the progress bar', async () => {
    const step = refProvideStep({ stepNumber: 2, totalSteps: 5 });
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: false, blocking: true, unrecognized: true }),
        // The worker returns the SAME step object (same stepNumber/totalSteps)
        // on an unrecognised result - see `session.ts#submitRefProvide`'s own
        // doc comment on why this is not graded at all.
        session: session(step, { rung: 'refprovide' }),
        summary: null,
      },
    });

    const practice = await mountPractice(step, { rung: 'refprovide' }, { ok: true, data: johnContext() });
    const metaBefore = practice.root.querySelector('.sm-crumbs-meta')!.textContent;
    const fillBefore = practice.root.querySelector<HTMLElement>('.sm-bar-fill')!.style.width;

    const input = refInput(practice.root);
    input.value = 'not a book';
    practice.root.querySelector<HTMLButtonElement>('.sm-btn-primary')!.click();
    await settle();

    expect(practice.root.querySelector('.sm-crumbs-meta')!.textContent).toBe(metaBefore);
    expect(practice.root.querySelector<HTMLElement>('.sm-bar-fill')!.style.width).toBe(fillBefore);
    // Still the refprovide exercise, not a summary or a different step.
    expect(refInput(practice.root)).not.toBeNull();
  });

  it('a graded wrong answer shows the correct reference and waits for an explicit Next rather than auto-advancing', async () => {
    const step = refProvideStep();
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: false, reveal: { verseId: JOHN_3_16.verseId } }),
        session: session(null, { rung: 'refprovide' }),
        summary: null,
      },
    });

    const practice = await mountPractice(step, { rung: 'refprovide' }, { ok: true, data: johnContext() });
    vi.useFakeTimers();
    const input = refInput(practice.root);
    input.value = 'Mark 1:1';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();

    // `johnContext().reference` is "John 3:16" and `JOHN_3_16.label` is
    // "3:16" - `correctReferenceFor` combines them into "John 3:16".
    expect(spokenText(practice.root)).toContain('John 3:16');

    // No auto-advance: a "Next" control is waiting, not a fresh step.
    vi.advanceTimersByTime(5_000);
    const next = practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button');
    expect(next).not.toBeNull();
    expect(next!.textContent).toBe('Next');
    expect(refInput(practice.root)).not.toBeNull();

    next!.click();
    expect(practice.root.querySelector('p.sm-prompt')?.textContent).toContain(
      'Nothing left to do in this session.',
    );
  });

  it('shows a long verse visibly truncated, at a whole word rather than mid-word', async () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i + 1}`);
    const longVerse: VerseText = {
      verseId: 43003099,
      label: '3:99',
      words: words.slice(0, 25),
      lines: null,
      psalmTitle: null,
      paragraphStart: true,
    };
    const step = refProvideStep({ verse: longVerse, truncatedPreview: true });

    const practice = await mountPractice(step, { rung: 'refprovide' }, { ok: true, data: johnContext() });

    // Every rendered word is a whole word from the (already word-boundary-cut)
    // fixture - nothing is sliced further by the panel, and the last word is
    // intact rather than cut off mid-way through.
    const spoken = spokenText(practice.root.querySelector('.sm-context')!);
    expect(spoken).toContain(longVerse.words.join(' '));
    expect(spoken).toContain('word25');
    expect(spoken).not.toContain('word26');
    // And the truncation is visible, not silent.
    expect(spoken).toContain('shown in part');
  });

  it('shows no truncation note for a verse that was not truncated', async () => {
    const step = refProvideStep({ truncatedPreview: false });
    const practice = await mountPractice(step, { rung: 'refprovide' }, { ok: true, data: johnContext() });

    expect(spokenText(practice.root.querySelector('.sm-context')!)).not.toContain('shown in part');
  });
});

// ---------------------------------------------------------------------------
// 10. The analytics screen (T16): the wellLearned wording and refprovide's
//     vocabulary reaching "Recently reached"
// ---------------------------------------------------------------------------

describe('the analytics screen: wellLearned wording and refprovide vocabulary', () => {
  /**
   * `store.ts#analytics` already does the actual work T16 asked this screen
   * to rely on - it counts a passage only once `ladder.ts#passageWellLearned`
   * is true (every applicable activity satisfied, not `bestLevel >= 4`), and
   * it already runs against `store.ts#getScope()`, the same list-or-all scope
   * `setScope` drives elsewhere. There is nothing left for the panel to
   * filter a second time, so what these tests hold the screen to is just
   * that it renders whatever `AnalyticsView` it was handed honestly - in
   * particular, using the same "well learned" words the passage screen's own
   * badge uses (`passageView.ts`'s `sm-badge-learned`), so a user who has
   * seen that badge recognises the number here as the same claim.
   */
  function analyticsFixture(over: Partial<AnalyticsView> = {}): AnalyticsView {
    return {
      streakDays: 3,
      versesLearned: 12,
      passagesWellLearned: 2,
      calendar: [],
      recentlyReached: [],
      nextMilestone: { versesLearned: 15, toGo: 3 },
      ...over,
    };
  }

  it('captions the well-learned count with the same "well learned" wording as the passage badge', () => {
    const root = renderAnalytics(host, analyticsFixture());
    container.appendChild(root);

    expect(spokenText(root)).toContain('2 passages well learned');
  });

  it('singularises the well-learned caption for exactly one passage', () => {
    const root = renderAnalytics(host, analyticsFixture({ passagesWellLearned: 1 }));
    container.appendChild(root);

    expect(spokenText(root)).toContain('1 passage well learned');
  });

  it('labels a refprovide milestone with RUNG_LABEL, not the raw rung id', () => {
    const root = renderAnalytics(
      host,
      analyticsFixture({
        recentlyReached: [
          { passageId: 1, reference: 'John 3:16', rung: 'refprovide', level: 5, at: NOW - 1_000 },
        ],
      }),
    );
    container.appendChild(root);

    const text = spokenText(root);
    expect(text).toContain(RUNG_LABEL.refprovide);
    expect(text).not.toContain('refprovide');
  });
});

// ---------------------------------------------------------------------------
// T17. Fill in the Blanks: width stability
// ---------------------------------------------------------------------------

describe('blanks width stability (T17)', () => {
  // his(1) is(3) in(4) law(6) of(7): one 3-letter, three 2-letter, one 3-letter.
  const INDICES = [1, 3, 4, 6, 7];

  function slots(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('.sm-slot'));
  }

  /** Cumulative left edge of each slot, from the CSS widths alone (no layout in jsdom). */
  function lefts(root: HTMLElement): number[] {
    let x = 0;
    return slots(root).map((s) => {
      const left = x;
      x += Number.parseFloat(s.style.width);
      return left;
    });
  }

  async function reveal(wrongPositions: number[], typed: string[]): Promise<PracticeView> {
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({
          correct: wrongPositions.length === 0,
          wrong: wrongPositions,
          blocking: false,
          reveal: { words: INDICES.map((i) => PSALM_1_2.words[i]!) },
        }),
        session: session(null),
        summary: null,
      },
    });
    const practice = await mountPractice(blanksStep(PSALM_1_2, INDICES));
    const inputs = Array.from(practice.root.querySelectorAll<HTMLInputElement>('.sm-blank'));
    typed.forEach((t, i) => {
      inputs[i]!.value = t;
    });
    // Snapshot BEFORE the reveal.
    (practice as unknown as { __before: unknown }).__before = {
      widths: slots(practice.root).map((n) => n.style.width),
      lefts: lefts(practice.root),
      inputWidths: inputs.map((n) => n.style.width),
    };
    practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();
    return practice;
  }

  it('reveals every word (right and wrong) without changing any slot width or later position', async () => {
    const typed = ['his', 'zzzzzzzzzzzzzzzzzzzzzzzzzzz', 'in', 'law', 'of'];
    const practice = await reveal([1], typed);
    const before = (practice as unknown as { __before: { widths: string[]; lefts: number[]; inputWidths: string[] } }).__before;

    expect(practice.root.querySelectorAll('.sm-blank').length).toBe(0);
    expect(slots(practice.root).map((n) => n.style.width)).toEqual(before.widths);
    expect(lefts(practice.root)).toEqual(before.lefts);
    // The pre-reveal input and its slot carried the same number.
    expect(before.inputWidths).toEqual(before.widths);
    // Nothing revealed is a sibling of a slot: it all lives INSIDE one.
    const revealed = practice.root.querySelectorAll('.sm-word-ok, .sm-word-missed');
    expect(revealed.length).toBe(INDICES.length);
    for (const node of Array.from(revealed)) expect(node.parentElement!.classList.contains('sm-slot')).toBe(true);
  });

  it('gives one- and two-letter words the same floor box before and after reveal', async () => {
    const practice = await reveal([], INDICES.map((i) => PSALM_1_2.words[i]!));
    const before = (practice as unknown as { __before: { widths: string[] } }).__before;
    const all = slots(practice.root).map((n) => Number.parseFloat(n.style.width));
    // "is", "in", "of" are all two letters: each sits at the floor.
    expect([all[1], all[2], all[4]]).toEqual([MIN_BLANK_WIDTH_PX, MIN_BLANK_WIDTH_PX, MIN_BLANK_WIDTH_PX]);
    expect(slots(practice.root).map((n) => n.style.width)).toEqual(before.widths);
  });

  it('keeps a one-letter word at the floor after reveal too', async () => {
    host.handlers.submitStep = () => ({
      ok: true,
      data: {
        result: stepResult({ correct: true, wrong: [], blocking: false, reveal: { words: ['a'] } }),
        session: session(null),
        summary: null,
      },
    });
    const practice = await mountPractice(blanksStep(PSALM_1_3, [5]));
    const slot = slots(practice.root)[0]!;
    expect(Number.parseFloat(slot.style.width)).toBe(MIN_BLANK_WIDTH_PX);
    practice.root.querySelector<HTMLInputElement>('.sm-blank')!.value = 'a';
    practice.root.querySelector<HTMLButtonElement>('.sm-exercise-actions button')!.click();
    await settle();
    expect(slots(practice.root)[0]).toBe(slot);
    expect(Number.parseFloat(slot.style.width)).toBe(MIN_BLANK_WIDTH_PX);
  });

  it('does not resize the box or the slot when a word is overtyped, and scrolls the caret into view', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));
    const input = practice.root.querySelector<HTMLInputElement>('.sm-blank')!;
    const slot = input.parentElement!;
    const before = [slot.style.width, input.style.width];

    let scrolled = -1;
    Object.defineProperty(input, 'scrollWidth', { value: 480, configurable: true });
    Object.defineProperty(input, 'scrollLeft', {
      get: () => scrolled,
      set: (v: number) => {
        scrolled = v;
      },
      configurable: true,
    });
    input.value = 'hishishishishishishis';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input'));

    expect([slot.style.width, input.style.width]).toEqual(before);
    expect(scrolled).toBe(480);
  });

  it('wires the CSS that makes overtyping scroll and the slot fixed', () => {
    const css = readFileSync(resolve(__dirname, '../src/ui/memory.css'), 'utf8');
    const rule = (sel: string): string => {
      const m = css.match(new RegExp(`(?:^|\\n)\\.sm-app ${sel.replace(/[.>]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
      return m?.[1] ?? '';
    };
    expect(rule('.sm-slot')).toMatch(/display:\s*inline-block/);
    expect(css).toMatch(/\.sm-app \.sm-blank,\s*\.sm-app \.sm-fl\s*\{[^}]*overflow-x:\s*hidden/);
    expect(rule('.sm-slot .sm-word-wrong')).toMatch(/position:\s*absolute/);
  });

  it('keeps a long "you typed" marker inside the slot, out of the line, with no reflow', async () => {
    const practice = await reveal([1], ['his', 'a-very-long-wrong-answer-indeed', 'in', 'law', 'of']);
    const before = (practice as unknown as { __before: { widths: string[]; lefts: number[] } }).__before;
    const missed = practice.root.querySelector<HTMLElement>('.sm-word-missed')!;
    const typed = missed.querySelector<HTMLElement>('.sm-word-typed')!;

    expect(typed.textContent).toBe('a-very-long-wrong-answer-indeed');
    expect(missed.getAttribute('title')).toBe('You typed: a-very-long-wrong-answer-indeed');
    expect(typed.closest('.sm-slot')).toBe(missed.parentElement);
    expect(lefts(practice.root)).toEqual(before.lefts);
    expect(slots(practice.root).map((n) => n.style.width)).toEqual(before.widths);
  });

  it('also holds for first-letter mode reveals (slot survives the input)', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED, 'firstLetter'));
    const before = slots(practice.root).map((n) => n.style.width);
    const input = practice.root.querySelector<HTMLInputElement>('.sm-fl')!;
    input.value = 'h';
    input.dispatchEvent(new Event('input'));
    expect(slots(practice.root).map((n) => n.style.width)).toEqual(before);
    expect(practice.root.querySelector('.sm-slot > .sm-word-ok')).not.toBeNull();
  });

  it('falls back to non-zero, proportional estimates under jsdom zero layout', async () => {
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));
    const [his, law] = slots(practice.root).map((n) => Number.parseFloat(n.style.width));
    expect(his).toBeGreaterThan(0);
    expect(law).toBeGreaterThan(his!);
    expect(host.measurer.usedEstimate).toBe(true);
  });

  describe('re-measuring once the pane has real layout', () => {
    let callbacks: ((entries: { contentRect: { width: number } }[]) => void)[];
    let visible: boolean;

    beforeEach(() => {
      callbacks = [];
      visible = false;
      class FakeRO {
        constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
          callbacks.push(cb);
        }
        observe(): void {}
        disconnect(): void {}
      }
      vi.stubGlobal('ResizeObserver', FakeRO);
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const w = visible && this.getAttribute('aria-hidden') === 'true' && this.tagName === 'SPAN' ? 100 : 0;
        return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('re-applies measured widths, invalidating the estimated ones, when the pane becomes visible', async () => {
      const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED));
      const estimated = slots(practice.root).map((n) => n.style.width);
      expect(host.measurer.usedEstimate).toBe(true);
      expect(callbacks.length).toBeGreaterThan(0);

      // Still collapsed: a zero-width callback must not trigger a pass.
      callbacks.forEach((cb) => cb([{ contentRect: { width: 0 } }]));
      expect(slots(practice.root).map((n) => n.style.width)).toEqual(estimated);

      visible = true;
      callbacks.forEach((cb) => cb([{ contentRect: { width: 300 } }]));

      const measured = slots(practice.root).map((n) => n.style.width);
      expect(measured).not.toEqual(estimated);
      expect(measured).toEqual([`${blankWidthFor(100)}px`, `${blankWidthFor(100)}px`]);
      // Inputs follow their slot.
      for (const input of Array.from(practice.root.querySelectorAll<HTMLInputElement>('.sm-blank'))) {
        expect(input.style.width).toBe(input.parentElement!.style.width);
      }
      expect(host.measurer.usedEstimate).toBe(false);
    });

    it('WordMeasurer.invalidate drops cached widths and the estimate flag', () => {
      const m = new WordMeasurer(document);
      visible = true;
      expect(m.measure('word')).toBe(100);
      visible = false;
      expect(m.measure('word')).toBe(100); // cached
      m.invalidate();
      expect(m.measure('word')).toBeGreaterThan(0);
      expect(m.usedEstimate).toBe(true);
      m.invalidate();
      expect(m.usedEstimate).toBe(false);
      m.dispose();
    });
  });
});

// ---------------------------------------------------------------------------
// Item 2: the "Add several passages at once..." popup
// ---------------------------------------------------------------------------

describe('the batch-add popup', () => {
  function renderManage(): HTMLElement {
    const root = renderManagePassages(host, { ...emptyPlan() });
    container.appendChild(root);
    return root;
  }

  function popup(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.sm-modal-backdrop');
  }

  function popupButton(label: string): HTMLButtonElement {
    return Array.from(popup()!.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').startsWith(label),
    )!;
  }

  function openFromLink(root: HTMLElement): void {
    Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => b.textContent === 'Add several passages at once…')!
      .click();
  }

  function stubAdd(order: string[] = []): string[] {
    host.handlers.addPassage = (req) => {
      order.push(req.reference);
      return { ok: true, data: { passage: passageFixture({ id: order.length, reference: req.reference }) } };
    };
    return order;
  }

  it('shows the link and no inline batch-confirm slot', () => {
    const root = renderManage();
    expect(spokenText(root)).toContain('Add several passages at once…');
    expect(root.querySelector('.sm-batch-confirm')).toBeNull();
    expect(popup()).toBeNull();
  });

  it('opens a blank popup from the link, focusing the textarea', async () => {
    const root = renderManage();
    openFromLink(root);

    const textarea = popup()!.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(textarea.value).toBe('');
    expect(document.activeElement).toBe(textarea);
    expect(popup()!.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    popup()!.remove();
  });

  it('asks for at least one reference when Find references finds none', () => {
    const root = renderManage();
    openFromLink(root);
    popupButton('Find references').click();

    expect(popup()!.querySelector('.sm-error')).not.toBeNull();
    expect(popup()!.querySelector('.sm-batch-list')).toBeNull();
    popup()!.remove();
  });

  it('Find references shows the confirm list; Back returns with the text intact', () => {
    const root = renderManage();
    openFromLink(root);
    const textarea = popup()!.querySelector<HTMLTextAreaElement>('textarea')!;
    textarea.value = 'John 3:16\nRomans 8:28';
    popupButton('Find references').click();

    const items = Array.from(popup()!.querySelectorAll('.sm-batch-list-item')).map((li) => li.textContent);
    expect(items).toEqual(['John 3:16', 'Romans 8:28']);
    expect(popupButton('Add 2 passages')).toBeTruthy();

    popupButton('Back').click();
    expect(popup()!.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('John 3:16\nRomans 8:28');
    popup()!.remove();
  });

  it('Add N passages adds sequentially, announces, reloads and closes the popup', async () => {
    const order = stubAdd();
    const root = renderManage();
    openFromLink(root);
    popup()!.querySelector<HTMLTextAreaElement>('textarea')!.value = 'John 3:16\nRomans 8:28';
    popupButton('Find references').click();
    popupButton('Add 2 passages').click();
    await settle();

    expect(order).toEqual(['John 3:16', 'Romans 8:28']);
    expect(host.announcements.some((a) => a.includes('Added 2 passages'))).toBe(true);
    expect(host.reloads).toBeGreaterThan(0);
    expect(popup()).toBeNull();
  });

  it('a partial failure keeps the popup open and names the failed line', async () => {
    host.handlers.addPassage = (req) =>
      req.reference === 'Romans 8:28'
        ? { ok: false, error: 'No such book' }
        : { ok: true, data: { passage: passageFixture({ id: 1, reference: req.reference }) } };
    const root = renderManage();
    openFromLink(root);
    popup()!.querySelector<HTMLTextAreaElement>('textarea')!.value = 'John 3:16\nRomans 8:28';
    popupButton('Find references').click();
    popupButton('Add 2 passages').click();
    await settle();

    expect(popup()).not.toBeNull();
    expect(spokenText(popup()!)).toContain('Romans 8:28: No such book');
    expect(popupButton('Add 2 passages').disabled).toBe(false);
    popup()!.remove();
  });

  it('a multi-reference Enter opens the popup pre-filled and on the confirm list', () => {
    const root = renderManage();
    const input = root.querySelector<HTMLInputElement>('#sm-add-reference')!;
    input.value = 'John 3:16 and Romans 8:28';
    input.closest('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(Array.from(popup()!.querySelectorAll('.sm-batch-list-item')).map((li) => li.textContent)).toEqual([
      'John 3:16',
      'Romans 8:28',
    ]);
    popup()!.remove();
  });

  it('Escape closes the popup, removes it and restores focus to the link', () => {
    const root = renderManage();
    const link = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Add several passages at once…',
    )!;
    link.focus();
    link.click();

    popup()!
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(popup()).toBeNull();
    expect(document.activeElement).toBe(link);
  });
});

// ---------------------------------------------------------------------------
// Navigation: breadcrumbs on every screen
// ---------------------------------------------------------------------------

describe('breadcrumbs replace the toolbar on every screen', () => {
  it('the passage screen shows Home > reference, and Home goes to the plan', () => {
    const pv = passageViewFixture();
    const root = renderPassageScreen(host, pv, 'firstLetter');
    container.appendChild(root);

    expect(crumbLabels(root)).toEqual(['Home', pv.passage.reference]);
    expect(root.querySelector('.sm-toolbar')).toBeNull();
    root.querySelector<HTMLButtonElement>('.sm-crumb')!.click();
    expect(host.navigations).toContainEqual({ type: 'goPlan' });
  });

  it('settings, analytics and Manage Passages show Home > their name', () => {
    const screens: [HTMLElement, string][] = [
      [renderSettings(host, { defaultAnswerMode: 'firstLetter', recite: RECITE_DEFAULTS, speech: SPEECH_OFF }, emptyPlan()), 'Settings'],
      [renderAnalytics(host, emptyAnalytics()), 'Analytics'],
      [renderManagePassages(host, emptyPlan()), 'Manage Passages'],
    ];
    for (const [root, name] of screens) {
      expect(crumbLabels(root)).toEqual(['Home', name]);
      expect(root.querySelector('h1')!.textContent).toBe(name);
      expect(root.querySelector('.sm-back')).toBeNull();
    }
  });

  it('the practice screen shows Home > passage > activity, each crumb ending the session and going there', async () => {
    host.handlers.endSession = () => ({ ok: true, data: { summary: null } });
    const practice = await mountPractice(blanksStep(PSALM_1_2, BLANKED), { rung: 'blanks', passageId: 7 });

    expect(crumbLabels(practice.root)).toEqual(['Home', 'Psalm 1:2-3', RUNG_LABEL.blanks]);
    expect(practice.root.querySelector('.sm-crumb-current')!.textContent).toBe(RUNG_LABEL.blanks);
    const crumbs = practice.root.querySelectorAll<HTMLButtonElement>('.sm-crumb');
    expect(crumbs).toHaveLength(2);

    crumbs[0].click();
    await settle();
    expect(host.requests.some((r) => r.type === 'endSession')).toBe(true);
    expect(host.navigations).toContainEqual({ type: 'goPlan' });

    crumbs[1].click();
    await settle();
    expect(host.navigations).toContainEqual({ type: 'goPassage', passageId: 7, rung: 'blanks' });
  });
});

// ---------------------------------------------------------------------------
// Navigation: the practice screen's Next skip button
// ---------------------------------------------------------------------------

describe('the practice screen: Next skips within a tile flow', () => {
  async function mountWithFlow(flow: Flow): Promise<PracticeView> {
    host.handlers.getContext = () => ({ ok: true, data: psalmContext() });
    host.handlers.getPassageView = () => ({ ok: true, data: passageViewFixture() });
    host.handlers.endSession = () => ({ ok: true, data: { summary: null } });
    const practice = new PracticeView(host, session(blanksStep(PSALM_1_2, BLANKED), { passageId: 7, rung: 'blanks' }), flow);
    practice.mount(container);
    await settle();
    view = practice;
    return practice;
  }

  const nextButton = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('.sm-crumbs-actions button')).find((b) => b.textContent === 'Next');

  it('is hidden for a passage flow, and for a view built without a flow', async () => {
    const withFlow = await mountWithFlow({ kind: 'passage', passageId: 7 });
    expect(nextButton(withFlow.root)).toBeUndefined();

    const bare = await mountPractice(blanksStep(PSALM_1_2, BLANKED), { rung: 'blanks' });
    expect(nextButton(bare.root)).toBeUndefined();
  });

  it('is shown for variety and activity flows', async () => {
    const variety = await mountWithFlow({ kind: 'variety' });
    expect(nextButton(variety.root)).toBeDefined();
    variety.destroy();

    const activity = await mountWithFlow({ kind: 'activity', rung: 'blanks' });
    expect(nextButton(activity.root)).toBeDefined();
  });

  it('ends the session, then restarts the same flow excluding the passage just left', async () => {
    const order: string[] = [];
    const practice = await mountWithFlow({ kind: 'activity', rung: 'blanks' });
    host.handlers.endSession = () => {
      order.push('end');
      return { ok: true, data: { summary: null } };
    };
    const originalStartFlow = host.startFlow.bind(host);
    host.startFlow = async (flow, exclude) => {
      order.push('flow');
      return originalStartFlow(flow, exclude);
    };

    nextButton(practice.root)!.click();
    await settle();

    expect(order).toEqual(['end', 'flow']);
    expect(host.flowsStarted).toHaveLength(1);
    expect(host.flowsStarted[0]!.flow).toEqual({ kind: 'activity', rung: 'blanks' });
    expect([...host.flowsStarted[0]!.exclude!]).toEqual([7]);
  });
});

describe('Manage Passages lists table', () => {
  let host: TestHost;
  let container: HTMLElement;
  beforeEach(() => {
    host = new TestHost();
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
    document.querySelectorAll('.sm-modal-backdrop').forEach((n) => n.remove());
  });

  const managePlan = (passages: PassageView[], over: Partial<PlanView> = {}): PlanView => ({
    ...emptyPlan(),
    passages,
    ...over,
  });
  const LISTS = [
    { id: 1, name: 'Default', passageCount: 2, verseCount: 5 },
    { id: 2, name: 'Romans Road', passageCount: 3, verseCount: 6 },
  ];
  const rowFor = (root: HTMLElement, name: string): Element =>
    Array.from(root.querySelectorAll('li.sm-manage-list-row')).find((r) => spokenText(r).includes(name))!;
  const btn = (scope: Element, label: string): HTMLButtonElement | undefined =>
    Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === label);

  it('shows passage and verse counts per row', () => {
    const root = renderManagePassages(host, managePlan([], { lists: LISTS, scope: 1 }));
    container.appendChild(root);
    expect(spokenText(rowFor(root, 'Romans Road'))).toContain('3 passages, 6 verses');
  });

  it('marks the scoped list Current with no Switch button, and offers Switch on the others', () => {
    const root = renderManagePassages(host, managePlan([], { lists: LISTS, scope: 1 }));
    container.appendChild(root);
    const current = rowFor(root, 'Default');
    expect(spokenText(current)).toContain('Current');
    expect(btn(current, 'Switch to this list')).toBeUndefined();
    expect(btn(rowFor(root, 'Romans Road'), 'Switch to this list')).toBeDefined();
  });

  it('Switch to this list sends setScope for that list and reloads', async () => {
    host.handlers.setScope = () => ({ ok: true, data: emptyPlan() });
    const root = renderManagePassages(host, managePlan([], { lists: LISTS, scope: 1 }));
    container.appendChild(root);
    btn(rowFor(root, 'Romans Road'), 'Switch to this list')!.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'setScope', scope: { kind: 'list', id: 2 } });
    expect(host.reloads).toBeGreaterThan(0);
  });

  it('keeps an All lists way to select the all scope', async () => {
    host.handlers.setScope = () => ({ ok: true, data: emptyPlan() });
    const root = renderManagePassages(host, managePlan([], { lists: LISTS, scope: 1 }));
    container.appendChild(root);
    const all = root.querySelector('.sm-manage-all-lists-row')!;
    expect(spokenText(all)).toContain('5 passages');
    btn(all, 'Switch to all lists')!.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'setScope', scope: { kind: 'all' } });

    const current = renderManagePassages(host, managePlan([], { lists: LISTS, scope: 'all' }));
    expect(spokenText(current.querySelector('.sm-manage-all-lists-row')!)).toContain('Current');
  });

  it('explains why the only list cannot be deleted', () => {
    const root = renderManagePassages(host, managePlan([], { lists: [LISTS[0]!] }));
    container.appendChild(root);
    const row = rowFor(root, 'Default');
    expect(btn(row, 'Delete')!.disabled).toBe(true);
    expect(spokenText(row)).toContain('only list cannot be deleted');
  });

  it('with practice history, warns N of M and gates Delete on the exact list name', async () => {
    host.handlers.getListPracticeStats = () => ({ ok: true, data: { total: 3, practiced: 2 } });
    host.handlers.deleteList = () => ({ ok: true, data: emptyPlan() });
    const root = renderManagePassages(host, managePlan([], { lists: LISTS }));
    container.appendChild(root);
    btn(rowFor(root, 'Romans Road'), 'Delete')!.click();
    await settle();

    expect(host.requests).toContainEqual({ type: 'getListPracticeStats', id: 2 });
    const backdrop = document.querySelector('.sm-modal-backdrop')!;
    expect(spokenText(backdrop)).toContain('practice history on 2 of 3 passages');
    const confirm = Array.from(backdrop.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').startsWith('Delete and move'),
    )!;
    expect(confirm.disabled).toBe(true);

    const input = backdrop.querySelector<HTMLInputElement>('.sm-manage-delete-confirm')!;
    input.value = 'romans road';
    input.dispatchEvent(new Event('input'));
    expect(confirm.disabled).toBe(true);
    input.value = 'Romans Road';
    input.dispatchEvent(new Event('input'));
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await settle();
    expect(host.requests).toContainEqual({ type: 'deleteList', id: 2, movePassagesTo: 1 });
  });

  it('without practice history there is no name gate', async () => {
    host.handlers.getListPracticeStats = () => ({ ok: true, data: { total: 3, practiced: 0 } });
    const root = renderManagePassages(host, managePlan([], { lists: LISTS }));
    container.appendChild(root);
    btn(rowFor(root, 'Romans Road'), 'Delete')!.click();
    await settle();
    const backdrop = document.querySelector('.sm-modal-backdrop')!;
    expect(backdrop.querySelector('.sm-manage-delete-confirm')).toBeNull();
    const confirm = Array.from(backdrop.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      (b.textContent ?? '').startsWith('Delete and move'),
    )!;
    expect(confirm.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reference activities hide the reference in the heading
// ---------------------------------------------------------------------------

describe('the practice heading during reference activities', () => {
  const johnContext = (): PassageContext => ({
    passageId: 2,
    reference: 'John 3:16',
    before: [],
    verses: [JOHN_3_16],
    after: [],
  });

  it('hides the passage reference from the crumbs during refmatch', async () => {
    const step: RefMatchStep = {
      kind: 'refmatch',
      verse: JOHN_3_16,
      candidates: [
        { id: 'a', reference: 'John 3:16' },
        { id: 'b', reference: 'Mark 1:1' },
      ],
      tier: 0,
      stepNumber: 1,
      totalSteps: 3,
    };
    const practice = await mountPractice(step, { rung: 'refmatch' }, { ok: true, data: johnContext() });
    const crumb = practice.root.querySelector<HTMLElement>('.sm-crumb-current')!;
    expect(crumb.textContent).toBe(RUNG_LABEL.refmatch);
    expect(crumbLabels(practice.root)).toEqual(['Home', 'Passage', RUNG_LABEL.refmatch]);
    expect(practice.root.querySelector('.sm-crumbs')!.textContent).not.toContain('John 3:16');
  });

  it('hides the passage reference from the crumbs during refprovide', async () => {
    const practice = await mountPractice(null, { rung: 'refprovide', tier: 0, tiers: 1 }, { ok: true, data: johnContext() });
    const crumb = practice.root.querySelector<HTMLElement>('.sm-crumb-current')!;
    expect(crumb.textContent).toBe(RUNG_LABEL.refprovide);
    expect(crumbLabels(practice.root)).toEqual(['Home', 'Passage', RUNG_LABEL.refprovide]);
    expect(practice.root.querySelector('.sm-crumbs')!.textContent).not.toContain('John 3:16');
  });

  it('still shows the reference for a blanks session', async () => {
    const practice = await mountPractice(null, { rung: 'blanks' }, { ok: true, data: johnContext() });
    expect(crumbLabels(practice.root)).toEqual(['Home', 'John 3:16', RUNG_LABEL.blanks]);
  });
});

describe('stylesheet: hidden popovers stay hidden', () => {
  it('has a [hidden] rule for every class that sets display on a toggled element', () => {
    // `.sm-menu-panel { display: flex }` and `.sm-modal-backdrop`'s display beat the
    // UA `[hidden]` default, so each needs its own `[hidden] { display: none }`.
    for (const cls of ['.sm-menu-panel', '.sm-modal-backdrop']) {
      expect(STYLESHEET_TEXT).toContain(`${cls}[hidden]`);
    }
  });
});
