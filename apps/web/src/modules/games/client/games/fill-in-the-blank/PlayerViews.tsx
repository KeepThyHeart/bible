/**
 * The phone.
 *
 * The verse is on the projector in large type, so the copy here is a reminder
 * rather than the main reading: what the phone is really for is one box and one
 * button, reachable with a thumb.
 *
 * The box turns every phone convenience off. Autocorrect on a four-hundred-year
 * old vocabulary rewrites `saith` to `said` and `shew` to `show` between the
 * player's finger and the submit button, and a room cannot see why their right
 * answer was marked wrong. The answer matcher forgives archaic spelling; it
 * cannot forgive a word that was never sent.
 *
 * A sent answer can be changed until time runs out (`snapshot.canChangeAnswer`
 * — see the module's own doc comment on `answerPolicy`), so the box stays live
 * rather than being taken away: only the room's own deadline, or the server
 * saying this player has already had their word taken, closes it.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { PlayerViewProps } from '../../shell/gameViews.js';
import { asPrompt, asReveal, hasVerse } from './payload.js';
import { BlankedVerse, FilledVerse, NoVerse } from './VerseText.js';

function Question({ snapshot, view }: PlayerViewProps) {
  const prompt = asPrompt(view);

  // The verse is already up on the big screen; this phone's job during the
  // reading phase is only to say so, not to repeat it in a smaller type.
  if (snapshot.questionOnScreen) {
    return (
      <section class="fitb-phone">
        <p class="fitb-lead">Which word is missing?</p>
        <p class="fitb-hint">Look at the screen.</p>
      </section>
    );
  }

  return (
    <section class="fitb-phone">
      <p class="fitb-lead">Which word is missing?</p>
      {hasVerse(prompt) ? <BlankedVerse prompt={prompt} /> : <NoVerse />}
    </section>
  );
}

function Answering({ snapshot, view, send }: PlayerViewProps) {
  const prompt = asPrompt(view);
  const [text, setText] = useState('');
  const round = snapshot.round;
  const voting = snapshot.canChangeAnswer;
  // What the room has on file, once a phone reloads mid-round; a box the
  // player is actively typing into always wins over it.
  const sent = snapshot.yourAnswer?.type === 'text' ? snapshot.yourAnswer.text : null;
  const done = !voting && snapshot.youAnswered;

  // A new round is a new question, and a box still holding the last answer
  // invites someone to send it again without reading.
  useEffect(() => {
    setText('');
  }, [round]);

  const submit = useCallback(
    (event: Event) => {
      event.preventDefault();
      const answer = text.trim();
      if (answer === '' || done) return;
      send({ kind: 'answer', round, value: { type: 'text', text: answer } });
    },
    [send, round, text, done]
  );

  if (done) {
    return (
      <section class="fitb-phone">
        <p class="fitb-sent" role="status">
          Answer sent
        </p>
        {sent !== null && <p class="fitb-sent-word">{sent}</p>}
        <p class="fitb-hint">Waiting for the rest of the room.</p>
      </section>
    );
  }

  return (
    <section class="fitb-phone">
      {/* A screen already showing the verse makes this box the whole of what
          the phone is for — the compact layout `questionOnScreen` asks for.
          A room with no screen still needs the verse here to answer at all. */}
      {!snapshot.questionOnScreen && (hasVerse(prompt) ? <BlankedVerse prompt={prompt} /> : <NoVerse />)}
      <form class="fitb-form" onSubmit={submit}>
        <label class="fitb-label" for="fitb-answer">
          The missing word
        </label>
        <input
          id="fitb-answer"
          class="fitb-input"
          type="text"
          value={text}
          onInput={(event) => setText((event.currentTarget as HTMLInputElement).value)}
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          enterkeyhint="send"
        />
        <button type="submit" class="fitb-submit" disabled={text.trim() === ''}>
          Send
        </button>
      </form>
      {voting && sent !== null && (
        <p class="fitb-sent" role="status">
          Sent: {sent}. You can change it until time runs out.
        </p>
      )}
    </section>
  );
}

function Reveal({ reveal, yourResult }: PlayerViewProps) {
  if (reveal === null) return <NoVerse />;
  const detail = asReveal(reveal.detail);
  const submitted = yourResult?.submitted;

  return (
    <section class="fitb-phone fitb-reveal">
      <p class="fitb-word">{reveal.correctLabel}</p>
      {detail !== null && (
        <>
          <p class="fitb-ref">{detail.reference}</p>
          <FilledVerse reveal={detail} />
        </>
      )}
      {yourResult !== null && (
        <p class="fitb-verdict" data-correct={yourResult.correct ? 'true' : 'false'} role="status">
          {yourResult.note ?? (yourResult.correct ? 'Correct' : 'Not this time')}
        </p>
      )}
      {submitted?.type === 'text' && <p class="fitb-hint">You typed “{submitted.text}”</p>}
    </section>
  );
}

export const playerViews = { question: Question, answering: Answering, reveal: Reveal };
