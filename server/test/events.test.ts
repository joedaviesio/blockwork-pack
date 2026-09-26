import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { auth, build, chunks, claimedBuilder, closeApp, makeApp, OPEN_GROUND, place, remove, slab, tempDataDir } from './helpers.js';

const { x, z } = OPEN_GROUND;

describe('14 · events?since pagination', () => {
  it('pages through the feed with next_since and respects limit', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Feed Writer');
    await build(app, a, slab(x, x + 24, z, z, 1, 'stone')); // seq 1..25
    await build(app, a, [remove(x, 1, z)]); // seq 26

    const seen: number[] = [];
    let since = 0;
    let pages = 0;
    for (;;) {
      const res = await app.inject({ method: 'GET', url: `/v1/events?since=${since}&limit=10`, headers: auth(a) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      if (body.events.length === 0) {
        expect(body.next_since).toBe(since);
        break;
      }
      pages++;
      expect(body.events.length).toBeLessThanOrEqual(10);
      seen.push(...body.events.map((e: { seq: number }) => e.seq));
      since = body.next_since;
    }
    expect(pages).toBe(3);
    expect(seen).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));

    const last = (await app.inject({ method: 'GET', url: '/v1/events?since=25', headers: auth(a) })).json();
    expect(last.events).toEqual([{ seq: 26, ts: expect.any(String), builder: 'feed-writer', op: 'remove', x, y: 1, z }]);
    expect(last.events[0]).not.toHaveProperty('block');

    expect((await app.inject({ method: 'GET', url: '/v1/events?since=-1', headers: auth(a) })).statusCode).toBe(400);
    const capped = (await app.inject({ method: 'GET', url: '/v1/events?since=0&limit=999999', headers: auth(a) })).json();
    expect(capped.events).toHaveLength(26);
  });
});

describe('event sourcing: state = terrain + event replay', () => {
  it('rebuilds identical state from the log after a restart, with and without snapshots', async () => {
    const dataDir = tempDataDir();
    const first = await makeApp({ dataDir, snapshotEvery: 20 });
    const a = await claimedBuilder(first.app, 'Durable');
    const b = await claimedBuilder(first.app, 'Other Durable');
    await build(first.app, a, slab(x, x + 9, z, z + 2, 1, 'stone')); // 30 events → snapshot at seq 20, tail 21..30
    await build(first.app, b, [place(x, 1, z, 'gold'), remove(x + 1, 1, z), remove(x + 12, 0, z)]); // tail
    const bbox = [x - 1, 0, z - 1, x + 13, 3, z + 3];
    const before = (await chunks(first.app, a, bbox)).sort();
    await closeApp(first.app);

    const snaps = readdirSync(path.join(dataDir, 'snapshots')).filter((n) => n.endsWith('.json'));
    expect(snaps).toEqual(['snapshot-000000000020.json']);
    const log = readFileSync(path.join(dataDir, 'events.ndjson'), 'utf8').trim().split('\n');
    expect(log).toHaveLength(33);

    const second = await makeApp({ dataDir, snapshotEvery: 20 });
    expect((await chunks(second.app, a, bbox)).sort()).toEqual(before);
    await closeApp(second.app);

    // Snapshots are only a cache: deleting them still yields the same world.
    for (const n of snaps) rmSync(path.join(dataDir, 'snapshots', n));
    const third = await makeApp({ dataDir, snapshotEvery: 20 });
    expect((await chunks(third.app, a, bbox)).sort()).toEqual(before);
    // Identities and quota usage persist too.
    const res = await build(third.app, b, [place(x + 20, 1, z, 'wood')]);
    expect(res.json().results).toEqual([{ ok: true }]);
  });
});
