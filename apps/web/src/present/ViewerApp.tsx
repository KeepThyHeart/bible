/**
 * The projection viewer: what the congregation sees.
 *
 * Everything here follows one rule, which is worth stating before the code:
 * **nothing but the presenter changes what is on this screen.** Not a dropped
 * connection, not a failed fetch, not a slow server. Those are all handled by
 * leaving the wall exactly as it was. The only things that clear the screen are
 * a new item, a blank, and the end of the session.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { HighlightRange, PresentState } from './protocol';
import { displayedState, usePresentStream, type PresentConnection } from './usePresentStream';
import { selectedVerses, usePassage, type ChapterVerse, type Passage } from './usePassage';
import { useHymn } from './useHymn';
import type { HymnDetail } from './hymns';
import { fontScaleForStep, prefersReducedMotion, shrinkToFit } from './typography';
import { MAX_OVERSCAN, useFullscreen, useOverscan, useSetupKeys, useWakeLock } from './viewerChrome';
import { tokenizeVerse } from './tokenize';
import { highlightSpanForVerse, sweepStep } from './highlight';
import { API_BASE } from '../utils/apiUrl';

/** The join code is the last path segment of `/present/v/<code>`. */
export function joinCodeFromLocation(pathname: string): string {
  const match = /\/present\/v\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : '';
}

export function ViewerApp(): preact.JSX.Element {
  const joinCode = useMemo(() => joinCodeFromLocation(window.location.pathname), []);
  /**
   * The same page, rendered small inside the controller as a preview.
   *
   * It is the real viewer in an iframe rather than a second renderer, so the
   * preview cannot drift from the wall -- and an iframe specifically, because
   * the typography is sized in viewport units. A preview drawn inside a pane
   * would measure the browser window and lie about what fits on a television,
   * which is the one thing a preview must not do.
   *
   * What it must *not* do is behave like a screen in a room: no wake lock, no
   * fullscreen offer, no keyboard of its own, and not counted as a viewer.
   */
  const isPreview = useMemo(
    () => new URLSearchParams(window.location.search).get('preview') === '1', [],
  );
  const connection = usePresentStream(joinCode, isPreview);
  const state = displayedState(connection);
  const passage = usePassage(state?.live ?? null);
  const hymn = useHymn(state?.live ?? null);

  const { overscan, adjust } = useOverscan();
  const { isFullscreen, toggle } = useFullscreen();
  useWakeLock(!isPreview && connection.status !== 'closed');
  useSetupKeys(useMemo(
    () => (isPreview ? null : { toggleFullscreen: toggle, adjustOverscan: adjust }),
    [isPreview, toggle, adjust],
  ));

  const theme = state?.display.theme ?? 'dark';
  useEffect(() => {
    document.documentElement.setAttribute('data-present-theme', theme);
  }, [theme]);

  const style = {
    '--present-font-vh': `${fontScaleForStep(state?.display.fontStep ?? 5)}`,
    '--present-overscan': `${overscan}%`,
  } as unknown as preact.JSX.CSSProperties;

  return (
    <div class="pv-root" style={style}>
      <div class="pv-safe">
        {renderBody(connection, state, passage, hymn, joinCode,
          isPreview || isFullscreen, toggle, overscan, isPreview)}
      </div>
      {/*
        The blanking curtain is a sibling of the content, not a swap for it.
        Unblanking has to bring back exactly what was there -- including the
        scroll position -- and the cheapest way to guarantee that is never to
        unmount it.
      */}
      <div class={`pv-curtain${state?.display.blanked ? ' pv-curtain--on' : ''}`} aria-hidden="true" />
    </div>
  );
}

function renderBody(
  connection: PresentConnection,
  state: PresentState | null,
  passage: Passage | null,
  hymn: HymnDetail | null,
  joinCode: string,
  isFullscreen: boolean,
  toggleFullscreen: () => void,
  overscan: number,
  isPreview: boolean,
): preact.JSX.Element {
  // A closed session takes the wall, even if something was on it. `closed` is
  // only ever sent because a presenter chose to end the session, or because
  // this viewer was refused at the door -- never because of a network problem,
  // which is handled by leaving the screen alone. Once a service is over,
  // leaving its last verse projected indefinitely helps nobody.
  if (connection.status === 'closed') {
    return <ClosedScreen reason={connection.reason} />;
  }
  if (!state?.live) {
    return (
      <Lobby
        joinCode={joinCode}
        isFullscreen={isFullscreen}
        onFullscreen={toggleFullscreen}
        overscan={overscan}
        isPreview={isPreview}
      />
    );
  }
  if (state.live.kind === 'hymn') {
    // No slide yet: the heading placeholder below, rather than an empty screen.
    if (hymn) return <HymnSlideView hymn={hymn} index={state.position.index} />;
    return <div class="pv-passage"><h1 class="pv-heading">&nbsp;</h1></div>;
  }
  if (state.live.kind === 'text') {
    return <TextSlide title={state.live.title} body={state.live.body} attribution={state.live.attribution} />;
  }
  if (state.live.kind === 'passage' && passage) {
    return (
      <PassageView
        passage={passage}
        verses={selectedVerses(passage, state.live)}
        anchor={state.position.index}
        fontStep={state.display.fontStep}
        highlight={state.position.highlight}
      />
    );
  }
  // A passage whose text has not arrived yet: show the heading rather than an
  // empty screen, so the wall is never blank while the presenter waits.
  return <div class="pv-passage"><h1 class="pv-heading">&nbsp;</h1></div>;
}

// ---------------------------------------------------------------------------
// Passage
// ---------------------------------------------------------------------------

function PassageView(props: {
  passage: Passage;
  verses: ChapterVerse[];
  anchor: number;
  fontStep: number;
  highlight: HighlightRange | null;
}): preact.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLParagraphElement>(null);
  const previousKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const target = anchorRef.current;
    if (!scroller || !target) return;

    // Fit first, scroll second: shrinking a verse changes its height, and
    // scrolling to a position measured before that lands in the wrong place.
    shrinkToFit(target, scroller.clientHeight);

    // Jumping to a different passage should not animate a scroll through the
    // whole of the previous one. Moving *within* a passage should.
    const isNewPassage = previousKey.current !== props.passage.key;
    previousKey.current = props.passage.key;

    scroller.scrollTo({
      top: Math.max(target.offsetTop - scroller.offsetTop, 0),
      behavior: isNewPassage || prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [props.passage.key, props.anchor, props.fontStep, props.verses]);

  return (
    <div class="pv-passage">
      {/*
        Book and chapter only. A reference with a verse in it changes on every
        advance, which turns a fixed heading into a flicker at the top of the
        screen -- and the congregation can see which verse is which from the
        numbers in the text.
      */}
      <h1 class="pv-heading">{props.passage.bookName} {props.passage.chapter}</h1>
      <div class="pv-scroll" ref={scrollRef}>
        {props.verses.map(verse => (
          <p
            key={verse.verse_id}
            ref={verse.verse === props.anchor ? anchorRef : undefined}
            class={`pv-verse${verse.verse === props.anchor ? ' pv-verse--anchor' : ''}`}
          >
            <span class="pv-versenum">{verse.verse}</span>
            <VerseText html={verse.text_html} verseId={verse.verse_id} highlight={props.highlight} />
          </p>
        ))}
        {/*
          Trailing space so the last verse can still be scrolled to the top of
          the screen. Without it the final verses of a chapter can never be the
          thing the congregation is looking at.
        */}
        <div class="pv-tail" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * One verse, rendered word by word.
 *
 * Every word gets its own element even when nothing is highlighted, rather than
 * only the verses a highlight touches. Two reasons, and the second is the one
 * that decides it:
 *
 *  - Switching a verse between an `innerHTML` blob and word spans at the moment
 *    a highlight arrives risks a reflow, and a line of text shifting on a wall
 *    is exactly the kind of thing a congregation notices.
 *  - It is the same markup a controller needs in order to let someone *pick*
 *    words, so there is one rendering of a verse in this codebase rather than
 *    two that have to agree.
 *
 * The cost is real but small: a long chapter is a few thousand inline spans,
 * built once when the passage changes rather than on every advance.
 */
function VerseText(props: {
  html: string;
  verseId: number;
  highlight: HighlightRange | null;
}): preact.JSX.Element {
  // Tokenizing is pure and depends only on the text, so it survives every
  // highlight change and every scroll.
  const tokens = useMemo(() => tokenizeVerse(props.html), [props.html]);
  const span = highlightSpanForVerse(props.verseId, tokens.length, props.highlight);

  return (
    <span class="pv-text">
      {tokens.map((token, index) => {
        const step = sweepStep(index, span);
        const classes = ['pv-w'];
        if (token.isChristWords) classes.push('pv-w--christ');
        if (token.isDivineName) classes.push('pv-w--divine');
        if (token.isItalic) classes.push('pv-w--supplied');
        if (step >= 0) classes.push('pv-w--hl');

        return (
          <span
            // Keyed by position, not content: a verse has repeated words, and
            // the index *is* the identity here -- it is what the protocol
            // addresses.
            key={index}
            class={classes.join(' ')}
            data-word-index={index}
            style={step >= 0 ? { '--pv-sweep': String(step) } as unknown as preact.JSX.CSSProperties : undefined}
          >
            {token.displayText}
            {token.hasTrailingSpace ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Other item kinds
// ---------------------------------------------------------------------------

function TextSlide(props: { title?: string; body: string; attribution?: string }): preact.JSX.Element {
  return (
    <div class="pv-passage">
      {props.title ? <h1 class="pv-heading">{props.title}</h1> : null}
      <div class="pv-scroll">
        {/*
          Rendered as text nodes, never as markup. This is the one thing on this
          screen that a presenter typed, and it is going in front of a room.
        */}
        {props.body.split(/\n{2,}/).map((para, i) => (
          <p class="pv-verse" key={i}>{para}</p>
        ))}
        {props.attribution ? <p class="pv-attribution">{props.attribution}</p> : null}
        <div class="pv-tail" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * One slide of a hymn.
 *
 * Deliberately barer than the passage view. A congregation singing is reading
 * ahead of the words, not studying them, so there is no verse numbering, no
 * section label and no highlighting -- just the lines, centred, as large as
 * they will go.
 *
 * The attribution footer is rendered from the library's metadata rather than
 * typed by whoever prepared the service. That is what keeps the licensing story
 * honest without asking a presenter to think about it: the credit is correct
 * because it came from the file that had to declare itself public domain.
 */
function HymnSlideView(props: { hymn: HymnDetail; index: number }): preact.JSX.Element {
  const slide = props.hymn.slides[Math.max(0, Math.min(props.index, props.hymn.slides.length - 1))];
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    // A hymn slide is packed to a character budget, not measured, so a long
    // stanza can still overflow a short screen. Shrinking is the same fallback
    // the passage view needs for Esther 8:9.
    if (el?.parentElement) shrinkToFit(el, el.parentElement.clientHeight);
  }, [props.hymn.id, props.index]);

  if (!slide) return <div class="pv-hymn" />;

  return (
    <div class="pv-hymn">
      <div class="pv-hymn-body" ref={bodyRef}>
        {slide.lines.map((line, index) => (
          <p class="pv-hymn-line" key={index}>{line}</p>
        ))}
      </div>
      <p class="pv-hymn-footer">
        <span class="pv-hymn-title">{props.hymn.title}</span>
        {props.hymn.attribution ? <span class="pv-hymn-credit">{props.hymn.attribution}</span> : null}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby and endings
// ---------------------------------------------------------------------------

function Lobby(props: {
  joinCode: string;
  isFullscreen: boolean;
  onFullscreen: () => void;
  overscan: number;
  isPreview: boolean;
}): preact.JSX.Element {
  return (
    <div class="pv-lobby">
      <p class="pv-lobby-label">Ready</p>
      {/*
        The code to scan, on the screen everyone in the room is already looking
        at. This is the better placement than the controller: nobody has to pass
        a phone around, and it costs the viewer bundle nothing because the
        server draws it.

        It encodes the viewer URL only, so sharing it onward conveys no
        privilege -- which is what makes "viewers can pass the code on" safe by
        construction rather than by policy. It leaves the screen the moment
        anything is presented.
      */}
      <img
        class="pv-lobby-qr"
        src={`${API_BASE}/api/present/j/${encodeURIComponent(props.joinCode)}/qr.svg`}
        alt=""
      />
      <p class="pv-lobby-code">{formatCode(props.joinCode)}</p>
      <p class="pv-lobby-hint">Waiting for the presenter.</p>
      {/*
        Fullscreen can only be entered from a real gesture, so the lobby has to
        offer something to click. This is the only control on the viewer, and it
        is gone the moment anything is being presented.
      */}
      {props.isFullscreen || props.isPreview ? null : (
        <button type="button" class="pv-lobby-button" onClick={props.onFullscreen}>
          Enter fullscreen
        </button>
      )}
      {props.isPreview ? null : (
        <p class="pv-lobby-keys">
          F for fullscreen &middot; [ and ] adjust the margin
          {props.overscan > 0 ? ` (${props.overscan} of ${MAX_OVERSCAN})` : ''}
        </p>
      )}
    </div>
  );
}

function ClosedScreen(props: { reason: string }): preact.JSX.Element {
  const message = props.reason === 'locked'
    ? 'This session is not accepting new viewers.'
    : props.reason === 'full'
      ? 'This session is full.'
      : 'The session has ended.';
  return (
    <div class="pv-lobby">
      <p class="pv-lobby-hint">{message}</p>
    </div>
  );
}

/** Grouped in fours, because that is how someone reads it aloud to a room. */
function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}
