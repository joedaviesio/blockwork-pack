import { describe, expect, it } from 'vitest';
import { auth, build, chunks, claimedBuilder, closeApp, makeApp, OPEN_GROUND, place, slab, tempDataDir } from './helpers.js';

const { x, z } = OPEN_GROUND;

function hide(app: Awaited<ReturnType<typeof makeApp>>['app'], body: Record<string, unknown>, token = 'sandbox-admin') {
  return app.inject({ method: 'POST', url: '/v1/admin/hide', headers: { 'x-admin-token': token }, payload: body });
}

async function events(app: Awaited<ReturnType<typeof makeApp>>['app'], b: { key: string }) {
  return (await app.inject({ method: 'GET', url: '/v1/events?since=0&limit=5000', headers: auth(b as never) })).json();
}

describe('12 · admin hide (tombstones)', () => {
  it('hidden events vanish from chunks and events; unhide restores; the earlier state shows through', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Victim');
    const vandal = await claimedBuilder(app, 'Vandal');
    await build(app, a, [place(x, 1, z, 'stone'), place(x + 1, 1, z, 'stone')]); // seq 1, 2
    await build(app, vandal, [place(x, 1, z, 'obsidian'), place(x + 2, 0, z, 'obsidian')]); // seq 3, 4

    expect(await chunks(app, a, [x, 1, z, x, 1, z])).toEqual([[x, 1, z, 'obsidian', 'vandal']]);

    expect((await hide(app, { event_seqs: [3, 4], hidden: true }, 'wrong')).statusCode).toBe(403);
    const h = await hide(app, { event_seqs: [3, 4], hidden: true });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ action: 'hide', admin_seq: 5, events_affected: 2 });

    // The victim's stone is back; the terrain under the vandal's y=0 block reappears.
    const after = await chunks(app, a, [x, 0, z, x + 2, 1, z]);
    expect(after).toEqual(expect.arrayContaining([[x, 1, z, 'stone', 'victim'], [x + 2, 0, z, 'grass', null]]));
    expect(after.some((c) => c[4] === 'vandal')).toBe(false);
    const ev = await events(app, a);
    expect(ev.events.map((e: { seq: number }) => e.seq)).toEqual([1, 2]);
    expect(ev.next_since).toBe(5);

    const u = await hide(app, { event_seqs: [3, 4], hidden: false });
    expect(u.json()).toMatchObject({ action: 'unhide', admin_seq: 6 });
    expect(await chunks(app, a, [x, 1, z, x, 1, z])).toEqual([[x, 1, z, 'obsidian', 'vandal']]);
    expect((await events(app, a)).events.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it('hiding a structure removes it from listings, chunks, summaries and events; unhide restores', async () => {
    const dataDir = tempDataDir();
    const first = await makeApp({ dataDir });
    const app = first.app;
    const a = await claimedBuilder(app, 'Offender');
    await build(app, a, slab(x, x + 4, z, z + 1, 1, 'brick'));
    const decl = await app.inject({
      method: 'POST',
      url: '/v1/structures',
      headers: auth(a),
      payload: { name: 'Offensive Thing', bbox: [x, 0, z, x + 4, 3, z + 1], brief: 'bad' },
    });
    const id = decl.json().structure_id;

    const h = await hide(app, { structure_id: id, hidden: true });
    expect(h.json()).toMatchObject({ events_affected: 10, structure_id: id });
    expect(await chunks(app, a, [x, 1, z, x + 4, 1, z + 1])).toEqual([]);
    expect((await events(app, a)).events).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/v1/structures', headers: auth(a) })).json().structures).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/v1/structures/${id}`, headers: auth(a) })).statusCode).toBe(404);
    const sum = (await app.inject({ method: 'GET', url: `/v1/region/summary?bbox=${x - 5},${z - 5},${x + 10},${z + 10}`, headers: auth(a) })).json();
    expect(sum.summary).not.toContain('Offensive Thing');

    // Tombstones survive a restart (they are events too).
    await closeApp(app);
    const second = await makeApp({ dataDir });
    expect(await chunks(second.app, a, [x, 1, z, x + 4, 1, z + 1])).toEqual([]);

    await hide(second.app, { structure_id: id, hidden: false });
    expect(await chunks(second.app, a, [x, 1, z, x + 4, 1, z + 1])).toHaveLength(10);
    expect((await second.app.inject({ method: 'GET', url: `/v1/structures/${id}`, headers: auth(a) })).statusCode).toBe(200);
  });
});
