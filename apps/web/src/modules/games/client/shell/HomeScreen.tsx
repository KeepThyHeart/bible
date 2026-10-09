/**
 * The very first screen: nobody has typed a code or claimed to be hosting
 * yet.
 *
 * Before this round, `/` *was* the join form — there was no way to become a
 * host from inside the app at all; the URL had to be told out of band. Two
 * doors now, sized for how often each is actually taken: almost everyone who
 * opens this app is joining a room someone else already started, so that is
 * the one big button. Hosting is the deliberate, smaller link underneath it,
 * for the one person in the room who is running it.
 */

import { Brand } from './Brand.js';
import { gt } from './t.js';

export interface HomeScreenProps {
  onJoin(): void;
  onHost(): void;
}

export function HomeScreen({ onJoin, onHost }: HomeScreenProps) {
  return (
    <main class="screen screen-home centre">
      <Brand />
      <p class="home-tagline">
        {gt('games.home.tagline', 'Bible trivia and party games for a group, played on everyone’s own phone.')}
      </p>

      <button type="button" class="btn-primary" onClick={onJoin}>
        {gt('games.home.join', 'Join a room')}
      </button>

      <div class="or-rule" aria-hidden="true">
        {gt('games.common.or', 'or')}
      </div>

      <button type="button" class="btn-quiet" onClick={onHost}>
        {gt('games.home.host', 'Host a room')}
      </button>
    </main>
  );
}
