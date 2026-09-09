/**
 * Entry point for the projection viewer bundle.
 *
 * Separate from `main.tsx` on purpose, and it should stay that way: this bundle
 * must not reach the reading app's stores, providers, plugin host, service
 * worker or icon font. It renders Scripture on a wall and does nothing else,
 * and every import added here is something the machine plugged into the
 * television has to download before a service can start.
 */

import { render } from 'preact';
import { ViewerApp } from './ViewerApp';
import './viewer.css';

const root = document.getElementById('present-viewer');
if (root) render(<ViewerApp />, root);
