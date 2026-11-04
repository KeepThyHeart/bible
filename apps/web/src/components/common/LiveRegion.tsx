import { useEffect, useState } from 'preact/hooks';
import { subscribeAnnouncements } from '../../utils/announcer';

/** The app's single polite live region; mounted once by the shell. Visually hidden. */
export function LiveRegion() {
  const [message, setMessage] = useState('');
  useEffect(() => subscribeAnnouncements(setMessage), []);
  return (
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region">
      {message}
    </div>
  );
}
