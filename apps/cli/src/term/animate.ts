/**
 * Stepped scrolling — the only redraw in this app not caused by a keystroke.
 *
 * ## Why it is a list rather than a loop
 *
 * A scroll that moves in steps has to be interruptible, and the way to make it
 * interruptible is to have the caller own the clock. So nothing here waits,
 * draws or holds a timer: {@link scrollSteps} answers *what to draw and when*,
 * and the shell walks the list, abandoning it the moment a key arrives. That
 * also makes the interesting part — the arithmetic that keeps a long scroll from
 * taking longer than a short one — testable without a terminal or a fake clock.
 *
 * ## Three rules, and why each one exists
 *
 * 1. **The whole animation fits in a budget, whatever the distance.** A
 *    one-row nudge and a forty-row page turn take the same wall-clock time. The
 *    alternative — a fixed delay per row — makes `pagedown` in a long chapter a
 *    visibly slow operation, which is the opposite of what the animation is for.
 * 2. **The number of frames is capped.** Past a handful of steps the eye stops
 *    reading it as motion and starts reading it as flicker, and each frame is a
 *    real write to the terminal. Long scrolls therefore move further per frame
 *    rather than taking more frames.
 * 3. **The last step is exactly the destination.** Interpolation that rounds its
 *    way to somewhere near the target would leave the page one row out, and the
 *    error would be invisible until somebody noticed the cursor verse was not
 *    where the scroll had left it.
 */

/** One frame: wait this long since the previous draw, then draw this offset. */
export interface ScrollStep {
  readonly offset: number;
  readonly delayMs: number;
}

/**
 * The most frames any single scroll is drawn in.
 *
 * Six at ~100ms is a frame every 17ms or so, which reads as movement. More
 * frames would cost writes without adding smoothness anybody can see.
 */
const MAX_FRAMES = 6;

/** No frame is worth scheduling below this; the timer's own jitter is larger. */
const MIN_DELAY_MS = 8;

/**
 * The frames that carry a scroll from one offset to another.
 *
 * The list **excludes** `from`, which is already on screen, and its last entry
 * is always exactly `to`. A distance of zero, a budget of zero and a negative
 * budget all yield an empty list, which callers should read as "there is nothing
 * to animate — draw the destination": that is the honest answer for a scroll
 * that is not moving, and it is also the graceful degradation for a caller that
 * has no time to spend.
 *
 * Direction is taken from the sign of `to - from`, so scrolling up is the same
 * arithmetic run backwards rather than a second code path.
 */
export function scrollSteps(from: number, to: number, budgetMs: number): ScrollStep[] {
  const distance = Math.abs(to - from);
  if (distance === 0 || budgetMs <= 0) return [];

  // One frame per row until the cap, then fewer frames each covering more rows.
  // `distance` is the ceiling because a two-row scroll drawn in six frames would
  // repeat the same two offsets three times each.
  const frames = Math.min(distance, MAX_FRAMES);
  const delayMs = Math.max(MIN_DELAY_MS, Math.floor(budgetMs / frames));
  const step = (to - from) / frames;

  const steps: ScrollStep[] = [];
  for (let index = 1; index <= frames; index += 1) {
    // The final offset is assigned rather than interpolated, so rounding can
    // never leave the page short of where it was asked to go.
    const offset = index === frames ? to : Math.round(from + step * index);
    steps.push({ offset, delayMs });
  }
  return steps;
}
