import { describe, expect, it } from 'vitest';
import { build, chunks, claimedBuilder, makeApp, OPEN_GROUND, place, remove } from './helpers.js';

const { x, z } = OPEN_GROUND;

describe('2 · batches are non-atomic', () => {
  it('accepts valid ops and rejects invalid ones individually, in order', async () => {
    const { app } = await makeApp();
    const b = await claimedBuilder(app, 'Mixed Batch');
    const res = await build(app, b, [
      place(x, 1, z, 'stone'), // ok
      place(10, 1, 10, 'stone'), // ocean
      place(x + 1, 1, z, 'sand'), // not available here
      place(x + 2, 1, z, 'unobtainium'), // unknown
      remove(x + 3, 5, z), // nothing there
      place(x + 4, 1, z, 'wood'), // ok
      { op: 'place', x: 'a', y: 1, z } as never, // malformed
      place(x, 1, z - 5000, 'stone'), // outside world bounds
    ]);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toEqual({ placed: 2, removed: 0, rejected: 6, overwrote: 0 });
    expect(body.results[0]).toEqual({ ok: true });
    expect(body.results[1]).toEqual({ ok: false, reason: 'outside habitable territory' });
    expect(body.results[2]).toEqual({ ok: false, reason: 'material not available in this territory' });
    expect(body.results[3]).toEqual({ ok: false, reason: 'unknown block type' });
    expect(body.results[4]).toEqual({ ok: false, reason: 'nothing to remove' });
    expect(body.results[5]).toEqual({ ok: true });
    expect(body.results[6].ok).toBe(false);
    expect(body.results[7]).toEqual({ ok: false, reason: 'outside world bounds' });

    const blocks = await chunks(app, b, [x, 1, z, x + 4, 1, z]);
    expect(blocks.map((c) => c[3]).sort()).toEqual(['stone', 'wood']);
  });

  it('rejects a whole request only for request-level errors', async () => {
    const { app } = await makeApp();
    const b = await claimedBuilder(app, 'Bad Request');
    const noKey = await app.inject({
      method: 'POST',
      url: '/v1/build',
      headers: { authorization: `Bearer ${b.key}` },
      payload: { idempotency_key: 'not-a-uuid', ops: [place(x, 1, z, 'stone')] },
    });
    expect(noKey.statusCode).toBe(400);
    const tooMany = await build(app, b, Array.from({ length: 2049 }, (_, i) => place(x + (i % 40), 1 + Math.floor(i / 40) % 60, z, 'stone')));
    expect(tooMany.statusCode).toBe(400);
  });
});

describe('3 · protect_existing', () => {
  it('rejects placements on cells occupied by any event-placed block, but not terrain', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'First Settler');
    const b = await claimedBuilder(app, 'Careful Neighbour');
    await build(app, a, [place(x, 1, z, 'stone')]);

    const res = await build(
      app,
      b,
      [place(x, 1, z, 'brick'), place(x + 1, 0, z, 'brick'), place(x + 1, 1, z, 'brick')],
      { protect_existing: true },
    );
    expect(res.json().results).toEqual([
      { ok: false, reason: 'cell occupied (protect_existing)' },
      { ok: true }, // terrain (grass) doesn't count
      { ok: true },
    ]);
    // The protected cell is untouched.
    expect(await chunks(app, a, [x, 1, z, x, 1, z])).toEqual([[x, 1, z, 'stone', 'first-settler']]);

    // Own blocks are protected too.
    const own = await build(app, b, [place(x + 1, 1, z, 'glass')], { protect_existing: true });
    expect(own.json().results).toEqual([{ ok: false, reason: 'cell occupied (protect_existing)' }]);
  });
});

describe('4 · overwrote flag', () => {
  it('is true on cross-builder overwrite and absent on own replacement and terrain shadowing', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Original');
    const b = await claimedBuilder(app, 'Overwriter');
    await build(app, a, [place(x, 1, z, 'stone')]);

    const cross = await build(app, b, [place(x, 1, z, 'brick')]);
    expect(cross.json().results).toEqual([{ ok: true, overwrote: true }]);
    expect(cross.json().summary.overwrote).toBe(1);

    const own = await build(app, b, [place(x, 1, z, 'glass')]);
    expect(own.json().results).toEqual([{ ok: true }]);
    expect(own.json().results[0]).not.toHaveProperty('overwrote');

    const terrain = await build(app, b, [place(x + 5, 0, z, 'stone')]);
    expect(terrain.json().results).toEqual([{ ok: true }]);
    expect(await chunks(app, a, [x + 5, 0, z, x + 5, 0, z])).toEqual([[x + 5, 0, z, 'stone', 'overwriter']]);
  });

  it('digging: removing a terrain cell leaves air; removing again has nothing to remove', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Digger');
    expect(await chunks(app, a, [x, 0, z, x, 0, z])).toEqual([[x, 0, z, 'grass', null]]);
    const dig = await build(app, a, [remove(x, 0, z), remove(x, 0, z)]);
    expect(dig.json().results).toEqual([{ ok: true }, { ok: false, reason: 'nothing to remove' }]);
    expect(await chunks(app, a, [x, 0, z, x, 0, z])).toEqual([]);
  });
});

describe('7 · height envelope', () => {
  it('rejects y > 64 with a plain reason; y = 64 is fine', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Tower Builder');
    const res = await build(app, a, [place(x, 64, z, 'metal'), place(x, 65, z, 'metal'), place(x, 200, z, 'metal')]);
    expect(res.json().results).toEqual([
      { ok: true },
      { ok: false, reason: 'exceeds height envelope (max 64 above terrain)' },
      { ok: false, reason: 'exceeds height envelope (max 64 above terrain)' },
    ]);
  });
});
