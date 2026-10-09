# Buzz ordering is by corrected client time

## Decision

The buzz queue is ordered by each player's buzz timestamp translated into
server time using that player's measured clock offset, clamped to the interval
between the reveal instant and the moment the server actually received the
buzz. How much of the question the player had read is recorded, displayed and
used as a sanity check — but it does not order the queue.

## Why

Ordering by the moment the server heard a buzz punishes whoever has the worse
connection, which over cellular is most of the room.

Ordering by characters read is the same ordering expressed differently: with a
common reveal instant and a fixed streaming rate, characters read is a linear
function of elapsed local time, so ranking by one ranks by the other. But it is
a worse way to compute it. It is a figure the client derives and reports, so it
cannot be verified, and any tolerance wide enough to allow for honest rendering
jitter is also wide enough to under-report through. It structurally favours the
phone that renders late, since a slow renderer reports fewer characters read.

Corrected client time is a single number with a defensible bound. The clamp is
not a fudge: a buzz cannot honestly have happened before the reveal, and cannot
have happened after the server heard it, so anything outside that interval is
provably wrong and gets pulled to the edge.

## Consequences

- Clock sync is load-bearing, not decorative. It is built and tested before any
  game needs it.
- Characters read still earns its keep: it is the "buzzed at 38%" figure on the
  reveal, it is the prefix a judge must be shown, and a large disagreement
  between it and the corrected time identifies a phone whose renderer drifted.
- A buzz the server had to clamp is flagged, so systematic clock trouble is
  visible rather than silently deciding rounds.
