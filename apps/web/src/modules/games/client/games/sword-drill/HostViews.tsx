/**
 * The big screen.
 *
 * During the search the reference is the only thing that matters, so it is the
 * largest thing in the room — people are reading it off the wall while turning
 * pages.
 *
 * The verse text itself is shown to the host from the start of the round now —
 * `drill.text`, present only in the host's own payload — so a host who does
 * not have the passage memorised can still confirm a reader's citation the
 * moment they hear it, rather than having to find and read the verse
 * themselves while the room waits. Deliberately smaller and quieter than the
 * reference, and never sent to a player's phone at all (see the server
 * module's doc comment): the room is still racing the reference on the wall,
 * not reading the answer off it.
 *
 * Once someone taps, the screen names who is reading, because the host and the
 * room need to know whose voice to listen for. It never keeps a list of anyone
 * the host moved on from. The button that passes the turn says "Next in line"
 * rather than "Wrong": a reading that went astray is heard by the room once and
 * then left behind, and nothing on this screen makes a record of it.
 *
 * The confirm buttons wait until the reader's phone has reported in. That is
 * what puts their "found it" on file for the host's ruling to land on, and it
 * stops a double tap from confirming the next person before they have said a
 * word.
 *
 * This game runs two different clocks under the same timer bar, and a host
 * confirming a reading watches the number change meaning without changing
 * shape: the room's overall search window (`HostQuestion`) and, once someone
 * reaches the head of the queue, that one reader's own answer window
 * (`HostAnswering`). Both are correct and intentional — a confirmation gives
 * back exactly the time spent judging rather than costing the search
 * anything, and a new reader always gets a full window of their own rather
 * than whatever the room happened to have left — but neither the room's
 * reducer nor the shared `TimerBar` says which clock is running, so from the
 * timer alone a fresh full bar for the next reader is indistinguishable from
 * a bug that restarted the search. `sd-hint`/`sd-reader-note` below say so in
 * words, in each of the two views, rather than changing the timer itself.
 *
 * In the room's default mode (`buzzModeOf`), a phone has no "Found it"
 * button at all: the host reads the reference aloud, listens for whoever
 * found it, and taps that player's own name in `CallOnPanel` to put them on
 * the buzzer — same queue, same confirm/next-in-line flow, as if they had
 * tapped it themselves. `buttons` mode (the original mechanic, still on
 * offer for a room that wants it) hides that panel; the phones carry their
 * own button instead.
 */

import type { HostViewProps } from '../../shell/gameViews.js';
import {
  buzzModeOf,
  confirmedIn,
  nameOf,
  namesOf,
  placeOf,
  readDrill,
  readReveal,
  tappedCount,
} from './payload.js';
import type { Drill } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="sd sd-host">
      <p class="sd-nothing">{line}</p>
    </section>
  );
}

function Reference({ drill, size }: { drill: Drill; size: 'huge' | 'large' }) {
  return (
    <div class="sd-reference">
      <p class={`sd-ref sd-ref-${size}`}>{drill.reference}</p>
      {drill.translation.length > 0 && <p class="sd-translation">{drill.translation}</p>}
      {drill.text !== undefined && (
        <p class="sd-host-hint" aria-label="Verse text, for the host only">
          {drill.text}
        </p>
      )}
    </div>
  );
}

/** Praise is public: the one list of names this game ever puts on the wall. */
function ConfirmedList({ heading, names }: { heading: string; names: readonly string[] }) {
  return (
    <div class="sd-praise">
      <p class="sd-label">{heading}</p>
      <ul class="sd-names">
        {names.map((name, index) => (
          <li key={`${index}:${name}`}>{name}</li>
        ))}
      </ul>
    </div>
  );
}

function tappedLine(count: number): string {
  return count === 1 ? '1 tapped Found it' : `${count} tapped Found it`;
}

/**
 * The host's own way to put a reader on the buzzer, in `hostCalls` mode:
 * every connected player not already reading, waiting, spent or confirmed —
 * i.e. exactly who `placeOf` would call `free` on their own phone. A tap
 * sends `{cmd: 'callOn'}`, which the reducer treats exactly as that player's
 * own buzz: it queues behind whoever the room is already listening to.
 */
function CallOnPanel({ snapshot, send }: HostViewProps) {
  const candidates = snapshot.players.filter(
    (player) => player.connected && placeOf(snapshot.buzz, player.id, snapshot.control?.spent ?? []).kind === 'free'
  );
  if (candidates.length === 0) return null;

  return (
    <div class="sd-call-on">
      <p class="sd-label">Who found it?</p>
      <div class="sd-call-on-grid" role="group" aria-label="Call on a reader">
        {candidates.map((player) => (
          <button
            key={player.id}
            type="button"
            class="sd-call-on-button"
            onClick={() => send({ cmd: 'callOn', playerId: player.id })}
          >
            {player.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The search. It comes back after the host has heard everyone in line, with
 * the round still open for anyone still turning pages, so the readers already
 * confirmed stay on the wall rather than vanishing until the reveal.
 */
export function HostQuestion(props: HostViewProps) {
  const { snapshot, view } = props;
  const drill = readDrill(view);
  if (!drill) return <Nothing line="Nothing to find this round." />;
  const tapped = tappedCount(snapshot.buzz, snapshot.control?.spent ?? []);
  const soFar = namesOf(snapshot.players, confirmedIn(snapshot.buzz));
  const hostCalls = buzzModeOf(snapshot.settings.gameOptions) === 'hostCalls';

  return (
    <section class="sd sd-host">
      <p class="sd-ask">Find it</p>
      <Reference drill={drill} size="huge" />
      <p class="sd-hint">
        {hostCalls
          ? 'Listen for a reader, keep your finger on the verse, and tap their name below.'
          : 'Tap Found it on your phone, keep your finger on the verse, and be ready to read it aloud.'}
      </p>
      {tapped > 0 && (
        <p class="sd-count" role="status">
          {tappedLine(tapped)}
        </p>
      )}
      {hostCalls && <CallOnPanel {...props} />}
      {soFar.length > 0 && (
        <>
          <ConfirmedList heading="Confirmed so far" names={soFar} />
          {/* The search clock (above) pauses the instant someone buzzes and
              picks back up, undiminished, once you rule on them — this is the
              search resuming, not restarting. See `sd-reader-note` for the
              other timer this round uses, while someone is reading aloud. */}
          <p class="sd-hint">The clock pauses while you confirm a reader — no search time is lost.</p>
        </>
      )}
    </section>
  );
}

export function HostAnswering(props: HostViewProps) {
  const { snapshot, view, send } = props;
  const drill = readDrill(view);
  if (!drill) return <Nothing line="Nothing to find this round." />;

  const queue = snapshot.buzz?.queue ?? [];
  const head = queue[0];
  // An empty queue in this phase is a snapshot caught mid-hand-over; the
  // search is what the room is doing, so the search is what it sees.
  if (!head) return <HostQuestion {...props} />;

  const name = nameOf(snapshot.players, head.playerId) ?? 'The next reader';
  // `pendingJudge` lives on the control block now: present only on the
  // screen that actually holds control (see `ControlPanel`'s own doc
  // comment on the protocol). A screen that has handed control away simply
  // never sees this become true, so the buttons below stay disabled there.
  const ready = snapshot.control?.pendingJudge?.playerId === head.playerId;
  const waiting = queue.length - 1;
  const soFar = namesOf(snapshot.players, confirmedIn(snapshot.buzz));
  const hostCalls = buzzModeOf(snapshot.settings.gameOptions) === 'hostCalls';

  return (
    <section class="sd sd-host">
      <Reference drill={drill} size="large" />
      <div class="sd-reader-card">
        <p class="sd-label">Reading aloud</p>
        <p class="sd-reader">{name}</p>
        {waiting > 0 && (
          <p class="sd-count">{waiting === 1 ? '1 more in line' : `${waiting} more in line`}</p>
        )}
        {/* The number above is now {name}'s own time to answer, not the room's
            search clock — a fresh window every time someone reaches the head
            of the queue, on purpose, so a new reader is never shorted by
            whatever the room used up finding the verse. */}
        <p class="sd-hint sd-reader-note">{name}’s own time to answer — the search clock is paused.</p>
      </div>
      <div class="sd-judge" role="group" aria-label={`Did ${name} find it?`}>
        <button
          type="button"
          class="sd-confirm"
          disabled={!ready}
          onClick={() => send({ cmd: 'judge', verdict: 'correct' })}
        >
          Confirm
        </button>
        <button
          type="button"
          class="sd-pass"
          disabled={!ready}
          onClick={() => send({ cmd: 'judge', verdict: 'incorrect' })}
        >
          Next in line
        </button>
      </div>
      {!ready && (
        <p class="sd-hint" role="status">
          Waiting for {name}’s phone…
        </p>
      )}
      {/* A second (or third) reader can still be waiting behind {name} — call
          them on now, so they are already queued the moment {name}'s turn
          ends, the same as a second phone tapping Found it while the first
          reads. */}
      {hostCalls && <CallOnPanel {...props} />}
      {soFar.length > 0 && <ConfirmedList heading="Confirmed so far" names={soFar} />}
    </section>
  );
}

/**
 * The reveal is where the verse finally appears, with the names of everyone
 * who was heard reading it. The count underneath is of taps, which is a fact
 * about the room and names nobody.
 */
export function HostReveal({ snapshot, reveal }: HostViewProps) {
  const detail = readReveal(reveal?.detail);
  if (!reveal || !detail) return <Nothing line="Nothing to show for this round." />;

  const names = namesOf(snapshot.players, detail.confirmed);
  const confirmed = detail.confirmed.length;
  const tapped = tappedCount(snapshot.buzz, snapshot.control?.spent ?? []);

  return (
    <section class="sd sd-host sd-reveal">
      <p class="sd-label">The verse</p>
      <h2 class="sd-answer">{detail.reference}</h2>
      {detail.text.length > 0 && (
        <figure class="sd-quote">
          <blockquote class="sd-verse">{detail.text}</blockquote>
          {detail.translation.length > 0 && (
            <figcaption class="sd-translation">{detail.translation}</figcaption>
          )}
        </figure>
      )}
      {names.length > 0 && <ConfirmedList heading="Found and read aloud" names={names} />}
      <p class="sd-count">
        {confirmed === 1 ? '1 confirmed' : `${confirmed} confirmed`}
        {tapped > 0 && ` · ${tappedLine(tapped)}`}
      </p>
    </section>
  );
}
