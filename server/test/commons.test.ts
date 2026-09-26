import { describe, expect, it } from 'vitest';
import { build, claimedBuilder, COMMONS_SPOT, makeApp, OPEN_GROUND, place, register, slab } from './helpers.js';

const UNCLAIMED_REASON = 'unclaimed builders build in the Commons — have your human claim you';

describe('6 · unclaimed builders and the Commons', () => {
  it('rejects unclaimed builds outside the Commons and accepts them inside', async () => {
    const { app } = await makeApp();
    const u = await register(app, 'Feral Agent');
    const res = await build(app, u, [
      place(OPEN_GROUND.x, 1, OPEN_GROUND.z, 'stone'),
      place(COMMONS_SPOT.x, 1, COMMONS_SPOT.z, 'stone'),
      place(1039, 1, 1050, 'stone'), // one west of the Commons edge
      place(1040, 1, 1032, 'stone'), // Commons corner (inclusive)
      place(1103, 1, 1095, 'stone'), // opposite corner (inclusive)
      place(1104, 1, 1095, 'stone'), // just outside (half-open)
    ]);
    expect(res.json().results).toEqual([
      { ok: false, reason: UNCLAIMED_REASON },
      { ok: true },
      { ok: false, reason: UNCLAIMED_REASON },
      { ok: true },
      { ok: true },
      { ok: false, reason: UNCLAIMED_REASON },
    ]);
  });

  it('enforces the 800-block total quota for unclaimed builders', async () => {
    const { app } = await makeApp();
    const u = await register(app, 'Quota Tester');
    // 3 layers of 16×16 = 768 blocks, then 64 more = 832 total.
    const first = await build(app, u, [
      ...slab(1044, 1059, 1040, 1055, 1, 'stone'),
      ...slab(1044, 1059, 1040, 1055, 2, 'stone'),
      ...slab(1044, 1059, 1040, 1055, 3, 'stone'),
    ]);
    expect(first.json().summary.placed).toBe(768);

    const second = await build(app, u, slab(1044, 1059, 1040, 1043, 1, 'wood'));
    const body = second.json();
    expect(body.summary.placed).toBe(32);
    expect(body.summary.rejected).toBe(32);
    expect(body.results[31]).toEqual({ ok: true });
    expect(body.results[32].reason).toMatch(/^block quota exhausted/);

    // Once claimed, the builder moves to the daily quota.
    const cl = await app.inject({
      method: 'POST',
      url: '/v1/agents/claim',
      headers: { authorization: `Bearer ${u.key}` },
      payload: { proof_url: 'https://example.com/proof' },
    });
    expect(cl.statusCode).toBe(200);
    const after = await build(app, u, [place(OPEN_GROUND.x, 1, OPEN_GROUND.z, 'stone')]);
    expect(after.json().results).toEqual([{ ok: true }]);
  });

  it('claimed builders may also build in the Commons', async () => {
    const { app } = await makeApp();
    const c = await claimedBuilder(app, 'Civic Minded');
    const res = await build(app, c, [place(COMMONS_SPOT.x, 1, COMMONS_SPOT.z, 'light')]);
    expect(res.json().results).toEqual([{ ok: true }]);
  });

  it('enforces the claimed daily quota', async () => {
    const { app } = await makeApp({ claimedDailyQuota: 5 });
    const c = await claimedBuilder(app, 'Daily Limit');
    const res = await build(app, c, slab(OPEN_GROUND.x, OPEN_GROUND.x + 6, OPEN_GROUND.z, OPEN_GROUND.z, 1, 'stone'));
    expect(res.json().summary).toMatchObject({ placed: 5, rejected: 2 });
  });
});

describe('9 · the Commons is never edict-rejected', () => {
  it('accepts a deny-listed pattern (gold, and high placements) inside the Commons', async () => {
    const { app, ctx } = await makeApp();
    // Point a throwaway fixture rule at the Commons itself: the engine must still skip it.
    ctx.rules.push({ code: 'EDICT-9', district: [1040, 1032, 1104, 1096], deny_blocks: ['gold'], above_y: 5 });
    const u = await register(app, 'Commons Gilder');
    const ops = [...slab(1060, 1063, 1060, 1063, 1, 'gold')];
    for (let y = 2; y <= 20; y++) ops.push(place(1060, y, 1060, 'gold'));
    const res = await build(app, u, ops);
    const body = res.json();
    expect(body.summary.rejected).toBe(0);
    expect(body.results.every((r: { ok: boolean; edict?: string }) => r.ok && r.edict === undefined)).toBe(true);
  });
});
