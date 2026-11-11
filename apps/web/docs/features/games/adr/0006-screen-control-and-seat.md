# The screen, the controller and the seat are three things

## Decision

A room distributes three capabilities across devices: the **screen** (a viewer
kind carrying the public display), **control** (the authority to change the
room, plus the private adjudication panel), and a **seat** (a player with a
score). Any device may hold any combination. Control is held by exactly one
holder — the room's owner credential, or one player's session — and is granted
by writing a player id into room state, never by handing out a token.

## Why

The three were one device because the first one was a laptop at the front.
When the display is a TV the room is watching, a payload that carries a
player's unadjudicated answer to "the host" carries it to everyone — and ADR
0004's rule is that delivery, not rendering, is the leak.

Granting control as a bearer token would put the same problem in the other
hand: a token shown on a screen at the front of a room is a token the room
holds, and it cannot be un-issued. A session the server already authenticated
can simply be named.

One model rather than two modes because the scenarios differ in no rule, only
in addressing; because the assignment changes mid-evening when a TV is plugged
in or a leader hands over; and because two host paths would be two places
where privacy is enforced, which is the one thing ADR 0004 forbids.

## Consequences

- The screen's snapshot cannot carry `pendingJudge`, structurally, because the
  projection that builds it does not assemble one unless the credential that
  opened the stream is proved to be the owner's and that credential currently
  holds control.
- A screen opened from a display credential never receives the control block,
  whatever else is happening in the room. The owner token and the display
  token are both minted once, at creation, and neither is ever shown to the
  room; the display token travels only as a QR code, to one person adding a
  second screen.
- Handoff, reconnection and recovery are all one state change. A phone that
  locked keeps control; a controller nobody is attending (the owner's screen
  gone, or a player-controller disconnected) loses it to a waiting request
  after 45 seconds unanswered, which is the only reason a room whose screen
  went to sleep can be finished. The owner credential may always reclaim
  control regardless, as the one command it may send without holding it.
- The game seam is untouched: `viewer === null` in `viewFor` meant the screen
  before this decision and means it after. No game module changed except the
  two the task named directly: `questionOnScreen` adoption in fill-in-the-blank
  and who-said-it, and sword drill's read of `BuzzState.spent` once it moved
  off the public wire (see below).
- Solo and phone-led play become the same three calls — create, join, grant —
  with no mode flag in the protocol, the reducer or the shell. "Play too, and
  run it from here" in the screen lobby is exactly this: join, grant control
  to the new player, switch routes.
- A related, pre-existing leak surfaced by the same review: `BuzzState.spent`
  named a player who had already answered wrong, broadcast to the whole room.
  It is a different bug from the one this ADR exists to prevent, but the same
  shape of mistake, so it was fixed alongside it rather than left for a screen
  the whole room is watching to keep exposing — see `PublicBuzzState` in the
  protocol.

### Amended 2026-11-10

The organizer now runs the room from their own device, and the screen only
displays. That adds a viewer role and a way to open a screen, and tightens what
a controller is sent.

- **The remote is a viewer role.** The owner credential can open a stream with
  `as=remote`. It is not a screen and sets no screen presence, but it counts
  toward owner presence, so a room whose only open streams are a display and a
  sleeping remote still hands control to a waiting request after 45 seconds. It
  has no seat. Its snapshot is the screen's public view plus the control block
  while the owner credential holds control, and it is the only stream that is
  sent the answer preview (`ControlPanel.answer`). No screen, owner or not, and
  no player is ever sent it.
- **A screen can be opened by the game code alone.** A stream with no token is a
  display-only screen: no control block, no pending judgement, no answer. It
  shows what the room shows anyone who has the code, which is no more than
  joining does. Opens are limited per client address (IPv6 by /64), and an
  unknown or closed room answers exactly as a wrong code does, so the endpoint
  cannot be used to find live rooms. A request that presents any token is not
  counted.
- **A seated controller is never sent the answer.** A player who holds control
  is also competing, so the preview that suits an organizer who is not playing
  would spoil the round for them. Their judge card keeps the fact that a
  judgement is waiting and the player's answer, but its canonical answer,
  accepted answers and context note are blank until the reveal.
- **The owner screen's judge card carries nothing typed.** A laptop on a
  projector can hold control, and the room is watching it. Its judge card is
  projected without the player's text, the canonical answer, accepted answers
  or context note, so what the card says is only that there is an answer to
  check. In the games that need it the answers are spoken aloud, and a
  controller who wants to read them runs the room from a phone.
- **No credential that grants control is ever shown on a screen.** An earlier
  idea was a corner QR on the big screen for the organizer to scan and take over
  from their phone. It was rejected for the same reason as handing control over
  as a token: whatever is drawn on a screen the room is watching, the room
  holds, and it cannot be taken back. The organizer opens the room on their own
  device, which keeps the owner token, and the screen is told the code instead.
