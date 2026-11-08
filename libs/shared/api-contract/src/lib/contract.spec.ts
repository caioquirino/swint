import { describe, expect, it } from 'vitest';
import { contract } from './contract.js';

type Routed = { '~orpc': { route: { method?: string; path?: string } } };
const route = (p: unknown) => (p as Routed)['~orpc'].route;

describe('contract', () => {
  it('exposes the expected procedures with REST routes', () => {
    expect(route(contract.me.get)).toMatchObject({ method: 'GET', path: '/me' });
    expect(route(contract.templates.update)).toMatchObject({ method: 'PUT', path: '/templates/{id}' });
    expect(route(contract.sessions.extend)).toMatchObject({ method: 'POST', path: '/sessions/{id}/extend' });
    expect(route(contract.sessions.regenerateInvite)).toMatchObject({ method: 'POST', path: '/sessions/{id}/invite' });
    expect(route(contract.room.get)).toMatchObject({ method: 'GET', path: '/room/{sessionId}' });
  });

  it('has exactly the agreed procedure set', () => {
    const names = Object.entries(contract).flatMap(([group, procs]) =>
      Object.keys(procs as object).map((p) => `${group}.${p}`),
    );
    expect(names.sort()).toEqual(
      [
        'me.get',
        'room.get',
        'sessions.cancel',
        'sessions.create',
        'sessions.end',
        'sessions.extend',
        'sessions.get',
        'sessions.list',
        'sessions.regenerateInvite',
        'sessions.start',
        'templates.archive',
        'templates.create',
        'templates.get',
        'templates.getSeed',
        'templates.list',
        'templates.update',
      ].sort(),
    );
  });
});
