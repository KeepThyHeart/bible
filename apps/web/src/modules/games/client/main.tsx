/**
 * Entry of the standalone client, `games/play.html`: what a phone loads when it
 * joins a room (and the second screen, and solo play). It imports nothing of the
 * reading app, which is the point: a phone on cellular data gets the games and
 * nothing else.
 */
import { render } from 'preact';
import { App } from './App.js';
import { configureThemeHost } from './shell/theme.js';
import './styles/app.css';
import './registerGames.js';
import { installStandaloneI18n } from './shell/standaloneI18n.js';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root element');

// Tokens and the room's theme live on <html>, as before.
document.documentElement.classList.add('games-root');
configureThemeHost(null, false);

// The shell strings load before first paint (one small JSON); a failure falls back to English.
void installStandaloneI18n().finally(() => render(<App />, root));
