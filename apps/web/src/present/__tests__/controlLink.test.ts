import { describe, it, expect } from 'vitest';
import { buildControlLink, buildViewerLink, parseControlLink } from '../controlLink';
import type { ControllerSession } from '../../stores/presentStore';

/**
 * The handoff link is the only place a control token ever appears in a URL, so
 * the rules about *where* in the URL are the thing worth defending. Everything
 * here is about that boundary: what counts as a handoff link, what is refused,
 * and what is safe to put in front of a room.
 */

const SESSION: ControllerSession = {
  sessionId: 'K3M7QP2XR5TV8W0Y',
  joinCode: 'ABCD2345',
  controlToken: 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5',
  expiresAt: '2026-01-01T00:00:00.000Z',
};

describe('reading a handoff link', () => {
  it('round-trips a session through a link', () => {
    const link = buildControlLink(SESSION, 'https://bible.example.org');
    const [pathname, hash] = link.split('#');
    const parsed = parseControlLink({
      pathname: pathname.replace('https://bible.example.org', ''),
      hash: `#${hash}`,
    });
    expect(parsed).toEqual(SESSION);
  });

  it('keeps the token in the fragment, never the path or query', () => {
    // A fragment is not sent to the server, so the token stays out of access
    // logs and Referer headers. This is the whole reason for the shape.
    const link = buildControlLink(SESSION, 'https://bible.example.org');
    const beforeHash = link.split('#')[0];
    expect(beforeHash).not.toContain(SESSION.controlToken);
    expect(beforeHash).toBe(`https://bible.example.org/present/c/${SESSION.sessionId}`);
  });

  it('is null for an ordinary page load', () => {
    expect(parseControlLink({ pathname: '/', hash: '' })).toBeNull();
    expect(parseControlLink({ pathname: '/', hash: '#/KJV/43/3' })).toBeNull();
  });

  it('is null for the viewer URL, which grants no control', () => {
    expect(parseControlLink({ pathname: '/present/v/ABCD2345', hash: '' })).toBeNull();
  });

  it('refuses a control path with no token', () => {
    expect(parseControlLink({
      pathname: `/present/c/${SESSION.sessionId}`, hash: '#j=ABCD2345',
    })).toBeNull();
  });

  it('refuses a token that is not the shape the server mints', () => {
    // A short or oddly-charactered token is not a truncated session, it is
    // someone else's guess; sending it would just burn a request.
    expect(parseControlLink({
      pathname: `/present/c/${SESSION.sessionId}`, hash: '#t=short&j=ABCD2345',
    })).toBeNull();
    expect(parseControlLink({
      pathname: `/present/c/${SESSION.sessionId}`,
      hash: `#t=${'a'.repeat(40)}%20drop&j=ABCD2345`,
    })).toBeNull();
  });

  it('refuses a join code outside the alphabet the server uses', () => {
    // Crockford base32 excludes I, L, O and U precisely so they cannot be
    // confused when read aloud; a code containing one did not come from here.
    expect(parseControlLink({
      pathname: `/present/c/${SESSION.sessionId}`,
      hash: `#t=${SESSION.controlToken}&j=ABCDILOU`,
    })).toBeNull();
  });

  it('refuses a session id that is not one', () => {
    expect(parseControlLink({
      pathname: '/present/c/../../etc',
      hash: `#t=${SESSION.controlToken}&j=ABCD2345`,
    })).toBeNull();
  });

  it('accepts a link with no expiry rather than dropping the session', () => {
    // The expiry is a convenience for the receiving device; the server is the
    // authority either way, and refusing the handoff over a missing hint would
    // strand a presenter mid-service.
    const parsed = parseControlLink({
      pathname: `/present/c/${SESSION.sessionId}`,
      hash: `#t=${SESSION.controlToken}&j=${SESSION.joinCode}`,
    });
    expect(parsed?.controlToken).toBe(SESSION.controlToken);
    expect(parsed?.expiresAt).toBe('');
  });
});

describe('the viewer link', () => {
  it('carries the join code and nothing else', () => {
    const link = buildViewerLink('ABCD2345', 'https://bible.example.org');
    expect(link).toBe('https://bible.example.org/present/v/ABCD2345');
  });

  it('is safe to show on the screen it points at', () => {
    // The projector may display its own URL bar, and the lobby shows this link
    // as a QR code to a whole room.
    const link = buildViewerLink(SESSION.joinCode, 'https://bible.example.org');
    expect(link).not.toContain(SESSION.controlToken);
    expect(link).not.toContain(SESSION.sessionId);
  });
});
