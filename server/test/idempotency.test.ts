import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { auth, build, claimedBuilder, closeApp, makeApp, OPEN_GROUND, place, tempDataDir } from './helpers.js';

const { x, z } = OPEN_GROUND;

async function eventCount(app: Awaited<ReturnType<typeof makeApp>>['app'], b: { key: string }) {
  const res = await app.inject({ method: 'GET', url: '/v1/events?since=0&limit=5000', headers: auth(b as never) });
  return res.json().events.length as number;
}

describe('5 · idempotency', () => {
  it('replays the stored result without re-applying; a changed payload is a 409', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Retrier');
    const other = await claimedBuilder(app, 'Interloper');
    const key = randomUUID();
    const ops = [place(x, 1, z, 'stone'), place(x + 1, 1, z, 'stone')];

    const first = await build(app, a, ops, { key });
    expect(first.statusCode).toBe(200);
    expect(await eventCount(app, a)).toBe(2);

    // Someone overwrites one cell in between; a genuine re-apply would now report overwrote:true.
    await build(app, other, [place(x, 1, z, 'brick')]);
    expect(await eventCount(app, a)).toBe(3);

    const retry = await build(app, a, ops, { key });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(await eventCount(app, a)).toBe(3); // nothing re-applied

    // Same key, op objects with different key order → same canonical payload.
    const reordered = await build(app, a, ops.map((o) => ({ block: o.block, z: o.z, y: o.y, x: o.x, op: o.op })) as never, { key });
    expect(reordered.json()).toEqual(first.json());

    const changed = await build(app, a, [place(x, 2, z, 'stone')], { key });
    expect(changed.statusCode).toBe(409);
    const flagChanged = await build(app, a, ops, { key, protect_existing: true });
    expect(flagChanged.statusCode).toBe(409);
  });

  it('keys are scoped per builder', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Scope A');
    const b = await claimedBuilder(app, 'Scope B');
    const key = randomUUID();
    await build(app, a, [place(x, 1, z, 'stone')], { key });
    const res = await build(app, b, [place(x + 2, 1, z, 'wood')], { key });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.placed).toBe(1);
  });

  it('survives a restart (retained in the log) and expires after 24h', async () => {
    let now = Date.parse('2026-03-01T00:00:00Z');
    const dataDir = tempDataDir();
    const first = await makeApp({ dataDir, now: () => now });
    const a = await claimedBuilder(first.app, 'Persistent Retrier');
    const key = randomUUID();
    const ops = [place(x, 1, z, 'stone')];
    const original = await build(first.app, a, ops, { key });
    await closeApp(first.app);

    const second = await makeApp({ dataDir, now: () => now });
    const replay = await build(second.app, a, ops, { key });
    expect(replay.json()).toEqual(original.json());
    expect(await eventCount(second.app, a)).toBe(1);

    now += 25 * 60 * 60 * 1000;
    const expired = await build(second.app, a, [place(x, 3, z, 'stone')], { key });
    expect(expired.statusCode).toBe(200);
    expect(await eventCount(second.app, a)).toBe(2);
  });
});
