// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../../shared/protocol.js';
import * as api from './api.js';
import { OrganizeApp } from './OrganizeApp.js';
import { loadOwnerSession, loadSession } from './session.js';

vi.mock('./api.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api.js')>();
  return {
    ...original,
    fetchCatalog: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    sendIntent: vi.fn(),
  };
});

const catalog: Catalog = {
  games: [
    {
      id: 'fill-in-the-blank',
      name: 'Fill in the blank',
      supportsSolo: true,
      groupVote: 'none',
      usesFamiliarity: true,
      usesTranslation: true,
      usesSet: true,
      usesBuzz: false,
    },
    {
      id: 'sword-drill',
      name: 'Sword drill',
      supportsSolo: false,
      groupVote: 'none',
      usesFamiliarity: false,
      usesTranslation: true,
      usesSet: false,
      usesBuzz: true,
    },
  ],
  sets: [],
  translations: ['KJV'],
};

let host: HTMLDivElement;
let navigated: string[];

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  navigated = [];
  vi.mocked(api.fetchCatalog).mockResolvedValue(catalog);
  vi.mocked(api.createRoom).mockResolvedValue({
    ok: true,
    value: { code: 'ABCDE', ownerToken: 'owner-token', displayToken: 'display-token' },
  });
  vi.mocked(api.joinRoom).mockResolvedValue({ ok: true, value: { playerId: 'p1', sessionToken: 'player-token' } });
  vi.mocked(api.sendIntent).mockResolvedValue({ ok: true, value: {} });
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
  vi.clearAllMocks();
});

async function start(): Promise<void> {
  await act(async () => {
    render(<OrganizeApp onNavigate={(to) => navigated.push(to)} />, host);
  });
}

function button(label: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;
}

async function pick(name: string): Promise<void> {
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>('.org-card')].find((b) => b.textContent?.includes(name))!.click();
  });
}

/** Submits the options and lets the chain of mocked requests run to its end. */
async function open(): Promise<void> {
  await act(async () => {
    host.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

describe('setting up a game', () => {
  it('goes from the picker to the options for the chosen game', async () => {
    await start();
    expect(host.textContent).toContain('Pick a game');
    await pick('Sword drill');
    expect(host.querySelector('h1')?.textContent).toBe('Sword drill');
    expect(button('Open the game')).toBeDefined();
  });

  it('opens the room from this device for an organizer who is not playing', async () => {
    await start();
    await pick('Fill in the blank');
    await open();

    expect(api.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: 'fill-in-the-blank', rounds: 10, teamsEnabled: false })
    );
    expect(api.joinRoom).not.toHaveBeenCalled();
    expect(loadOwnerSession('ABCDE')).toMatchObject({ ownerToken: 'owner-token', displayToken: 'display-token' });

    expect(host.textContent).toContain('Show it on a big screen');
    expect(host.querySelector('.org-code')?.textContent).toBe('ABCDE');
    await act(async () => button('Continue').click());
    expect(navigated).toEqual(['/games/remote?room=ABCDE']);
  });

  it('joins, takes control and goes to the play page for an organizer who is playing too', async () => {
    localStorage.setItem('bible-games:name', 'Ruth');
    await start();
    await pick('Fill in the blank');
    await act(async () => {
      const box = host.querySelector<HTMLInputElement>('input[name="playing-too"]')!;
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await open();

    expect(api.joinRoom).toHaveBeenCalledWith('ABCDE', 'Ruth', null);
    expect(api.sendIntent).toHaveBeenCalledWith('ABCDE', 'owner-token', {
      kind: 'host',
      command: { cmd: 'grantControl', playerId: 'p1' },
    });
    expect(loadSession('ABCDE')).toMatchObject({ playerId: 'p1', token: 'player-token', name: 'Ruth' });

    await act(async () => button('Continue').click());
    expect(navigated).toEqual(['/games/play?room=ABCDE']);
  });

  it('shows the error and stays on the options when the room cannot be opened', async () => {
    vi.mocked(api.createRoom).mockResolvedValue({ ok: false, error: 'Server said 500.' });
    await start();
    await pick('Fill in the blank');
    await open();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Server said 500.');
    expect(host.textContent).not.toContain('Show it on a big screen');
  });

  it('does not open a second room when trying again after a failed join', async () => {
    vi.mocked(api.joinRoom).mockResolvedValueOnce({ ok: false, error: 'Name taken.' });
    localStorage.setItem('bible-games:name', 'Ruth');
    await start();
    await pick('Fill in the blank');
    await act(async () => {
      const box = host.querySelector<HTMLInputElement>('input[name="playing-too"]')!;
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await open();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Name taken.');
    await open();
    expect(api.createRoom).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Show it on a big screen');
  });

  it('sends this device to the screen route with the code, keeping the owner session it just saved', async () => {
    await start();
    await pick('Sword drill');
    await open();
    expect(host.textContent).toContain('This game is easier to run from a phone.');
    await act(async () => button('Use this device as the screen instead').click());
    expect(navigated).toEqual(['/games/screen?room=ABCDE']);
    expect(loadOwnerSession('ABCDE')?.ownerToken).toBe('owner-token');
  });

  it('goes to the remote when there is no big screen', async () => {
    await start();
    await pick('Fill in the blank');
    await open();
    await act(async () => button('No big screen, play on phones only').click());
    expect(navigated).toEqual(['/games/remote?room=ABCDE']);
  });
});
