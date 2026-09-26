import { describe, expect, it } from 'vitest';
import { build, claimedBuilder, GRID_SPOT, makeApp, OPEN_GROUND, place } from './helpers.js';

describe('8 · latent-rule (edict) rejections', () => {
  it('returns a bare {ok:false, edict} inside the Grid; the same op is accepted elsewhere', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Archaeologist');
    const { x, z } = GRID_SPOT;
    const res = await build(app, a, [
      place(x, 1, z, 'gold'), // EDICT-1
      place(x + 1, 13, z, 'stone'), // EDICT-2 (above y 12)
      place(x + 2, 12, z, 'stone'), // at the limit: fine
      place(x + 3, 1, z, 'stone'), // fine
      place(OPEN_GROUND.x, 1, OPEN_GROUND.z, 'gold'), // same gold elsewhere: fine
      place(OPEN_GROUND.x, 13, OPEN_GROUND.z, 'stone'), // same height elsewhere: fine
    ]);
    const results = res.json().results;
    expect(results[0]).toStrictEqual({ ok: false, edict: 'EDICT-1' });
    expect(Object.keys(results[0]).sort()).toEqual(['edict', 'ok']);
    expect(results[1]).toStrictEqual({ ok: false, edict: 'EDICT-2' });
    expect(results.slice(2)).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }]);
    expect(res.json().summary).toEqual({ placed: 4, removed: 0, rejected: 2, overwrote: 0 });
  });

  it('edict rejections are charged against quota like accepted ops', async () => {
    const { app } = await makeApp({ claimedDailyQuota: 3 });
    const a = await claimedBuilder(app, 'Prober');
    const { x, z } = GRID_SPOT;
    const probe = await build(app, a, [place(x, 1, z, 'gold'), place(x + 1, 1, z, 'gold'), place(x + 2, 1, z, 'gold')]);
    expect(probe.json().summary.rejected).toBe(3);
    const next = await build(app, a, [place(OPEN_GROUND.x, 1, OPEN_GROUND.z, 'stone')]);
    expect(next.json().results[0].reason).toMatch(/quota exhausted/);
  });

  it('no endpoint enumerates rules', async () => {
    const { app } = await makeApp();
    const meta = await app.inject({ method: 'GET', url: '/v1/world/meta' });
    expect(meta.body).not.toMatch(/EDICT/);
    expect((await app.inject({ method: 'GET', url: '/v1/rules' })).statusCode).toBe(404);
  });
});
