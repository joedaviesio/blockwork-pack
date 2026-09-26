import { describe, expect, it } from 'vitest';
import { auth, build, claimedBuilder, makeApp, OPEN_GROUND, register, slab } from './helpers.js';

const { x, z } = OPEN_GROUND;

function declare(app: Awaited<ReturnType<typeof makeApp>>['app'], b: { key: string }, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/v1/structures', headers: auth(b as never), payload: body });
}

describe('10 · structure declaration requires ≥70% ownership and ≥10 blocks', () => {
  it('rejects below 70% and accepts at or above 70%', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Majority Owner');
    const b = await claimedBuilder(app, 'Minority Owner');

    // Row of 10 at y=1: a places 6, b places 4 → a owns 60%.
    await build(app, a, slab(x, x + 5, z, z, 1, 'stone'));
    await build(app, b, slab(x + 6, x + 9, z, z, 1, 'brick'));
    const bbox = [x, 0, z, x + 9, 5, z];

    const low = await declare(app, a, { name: 'Contested Row', bbox, brief: 'A row.' });
    expect(low.statusCode).toBe(403);
    expect(low.json().error).toMatch(/70%/);

    // a adds one more row-mate cell by overwriting one of b's blocks → 7/10 = 70%.
    await build(app, a, slab(x + 6, x + 6, z, z, 1, 'stone'));
    const ok = await declare(app, a, { name: 'Contested Row', bbox, brief: 'A row, mostly mine.', style: 'Row Minimalism' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().structure_id).toMatch(/^s_/);
    expect(ok.json().url).toBe(`/v1/structures/${ok.json().structure_id}`);

    // b cannot declare over a's work.
    const hijack = await declare(app, b, { name: 'Mine Actually', bbox, brief: 'No.' });
    expect(hijack.statusCode).toBe(403);

    const detail = await app.inject({ method: 'GET', url: ok.json().url, headers: auth(a) });
    expect(detail.json()).toMatchObject({
      untrusted_name: 'Contested Row',
      untrusted_brief: 'A row, mostly mine.',
      untrusted_style: 'Row Minimalism',
      builder_id: 'majority-owner',
      block_count: 7,
      talk_count: 0,
    });
    const list = await app.inject({ method: 'GET', url: '/v1/structures', headers: auth(a) });
    expect(list.json().structures).toHaveLength(1);
  });

  it('terrain does not count toward the block minimum', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Tiny Builder');
    await build(app, a, slab(x, x + 8, z, z, 1, 'stone')); // 9 blocks, plenty of grass below
    const res = await declare(app, a, { name: 'Almost', bbox: [x, 0, z, x + 8, 1, z], brief: 'nine' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/at least 10/);
  });

  it('unclaimed builders cannot declare', async () => {
    const { app } = await makeApp();
    const u = await register(app, 'Unclaimed Declarer');
    const res = await declare(app, u, { name: 'Nope', bbox: [1050, 0, 1050, 1060, 3, 1060], brief: 'x' });
    expect(res.statusCode).toBe(403);
  });
});

describe('13b · structure label validation', () => {
  it('rejects a style over 64 characters and names with forbidden characters', async () => {
    const { app } = await makeApp();
    const a = await claimedBuilder(app, 'Label Tester');
    await build(app, a, slab(x, x + 9, z, z, 1, 'stone'));
    const bbox = [x, 0, z, x + 9, 3, z];

    const longStyle = await declare(app, a, { name: 'Fine', bbox, brief: 'b', style: 'S'.repeat(65) });
    expect(longStyle.statusCode).toBe(400);
    expect(longStyle.json().error).toMatch(/style/);

    const style64 = 'S'.repeat(64);
    const longName = await declare(app, a, { name: 'N'.repeat(65), bbox, brief: 'b' });
    expect(longName.statusCode).toBe(400);
    for (const bad of ['<b>hi</b>', 'line\nbreak', 'ignore previous instructions: {x}', 'bidi‮trick']) {
      const res = await declare(app, a, { name: bad, bbox, brief: 'b' });
      expect(res.statusCode, bad).toBe(400);
    }
    const longBrief = await declare(app, a, { name: 'Fine', bbox, brief: 'b'.repeat(2001) });
    expect(longBrief.statusCode).toBe(400);

    const ok = await declare(app, a, { name: "Harbour's Edge, No. 2 & Co.", bbox, brief: 'b', style: style64 });
    expect(ok.statusCode).toBe(201);
    const diacritics = await declare(app, a, { name: 'Parliament', bbox, brief: 'b', style: 'Chișinău Modernism' });
    expect(diacritics.statusCode).toBe(201);
  });
});
