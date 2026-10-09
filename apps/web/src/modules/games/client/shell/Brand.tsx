/**
 * The app's own name, wherever a screen needs to say what this is.
 *
 * One place to say it: every loading screen, error screen, the join screen
 * and the host's lobby all opened this line as their own literal JSX before,
 * which is how "Bible Games" as three separate words survived while the name
 * everywhere else in the room (the join link, the room code) grew a
 * "Group Bible Games" identity around it. Drawing it from one component means
 * a future wording change is one file, not eleven.
 */

import { gt } from './t.js';

export function Brand() {
  return (
    <div class="brand-block">
      <h1 class="brand">{gt('games.brand.title', 'Group Bible Games')}</h1>
      <p class="brand-sub">{gt('games.brand.by', 'By Keep Thy Heart')}</p>
    </div>
  );
}
