# Judging is a suggestion, and the default provider returns nothing

## Decision

Answers spoken or typed in the buzz games are adjudicated by the host, with one
tap. A judge provider may offer a suggestion alongside that tap. The default
provider offers none, and every game is fully playable in that state.

## Why

A host reading an answer aloud is already looking at the screen and already
deciding. The tap costs nothing and is instant. A model call costs an API key,
a network round trip, a bill, a prompt to tune, and a new way for the round to
stall — none of which the game needs in order to work.

Building the host path first also settles the harder question properly: a
curated list of acceptable answers does more for judging quality than any model
does, and if the model is present from the start there is less pressure to
build that list well.

## Consequences

- `JudgeProvider` is an interface with a null implementation as the default and
  an HTTP implementation speaking the OpenAI-shaped chat-completions dialect,
  which Together and most other hosts accept. Swapping hosts is configuration.
- A suggestion never becomes a verdict, and a provider that errors, times out
  or returns unparseable output degrades to no suggestion. The host is never
  blocked on it.
- The provider is called from the server only, one answer at a time, and is
  never shown another player's answer.
- An `ambiguous` suggestion is offered to the host as "ask to be specific",
  which grants the player a second, shorter window. After that it counts as
  wrong.
