# Server-sent events downstream, plain POSTs upstream

## Decision

The server pushes to clients over an event stream (`text/event-stream`) and
clients send to the server with ordinary JSON POSTs. No WebSockets.

## Why

The failure mode that actually matters is a phone that locked, slept, changed
towers and came back. An event stream reconnects on its own, and a fresh stream
opens with a full snapshot, so recovery needs no replay buffer and no
sequence-number bookkeeping. WebSocket reconnection is all bespoke code.

Event streams also survive intermediaries that mangle protocol upgrades, which
is the sort of thing found on guest wifi and cellular middleboxes but never on
the desk where the code was written.

What WebSockets would buy is a marginally cheaper upstream frame. The upstream
traffic here is a handful of small messages per player per round, sent over a
connection that is already warm, so the saving is not measurable against the
cost of writing reconnection logic twice.

## Consequences

- Two things must never buffer the stream: the compression middleware (already
  filtered out for `text/event-stream`) and any reverse proxy in front of the
  server. On nginx that means `proxy_buffering off` on the stream route.
  Without it the symptom is not an error — it is silence.
- Heartbeat events keep idle streams from being reaped by intermediaries.
- Revisit only if buzz latency measured on real phones says otherwise.
