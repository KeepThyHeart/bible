# Privacy is enforced by projection, not by the client

## Decision

Room state is turned into a snapshot per viewer, on the server, before it is
sent. A player's score, rank and personal result exist only in that player's
snapshot. The big screen's standings are trimmed to a top three unless the host
has explicitly turned individual scores on.

## Why

The governing rule of the whole design is that praise is public and mistakes
are private. The screen at the front of the room shows how the group did — "9 of
12 got it" — and a top three. It never shows a bottom of the leaderboard and it
never names a wrong answer.

A rule like that cannot live in the client. Anything sent to a device is
readable on that device, so hiding a field in a view means the field was
already delivered. Worse, a rendering bug then becomes a social injury in front
of a youth group, which is precisely the failure this project cannot afford.

Filtering during projection makes the guarantee structural. The big screen
cannot render a last place because the data for it was never sent.

## Consequences

- Projection lives with the reducer, as a pure function of state plus viewer,
  and is unit tested in its own right — including negative assertions that a
  field is absent.
- A host who needs the full ordering to adjust a score asks for it explicitly
  and receives it as a one-off private message, not as part of steady state.
- Reveal aggregates are counts per option by construction. There is no shape in
  the protocol that carries who answered what.
