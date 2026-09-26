import { describe, expect, it } from 'vitest';
import { auth, build, chunks, claim, makeApp, OPEN_GROUND, place, register } from './helpers.js';

describe('1 · register → claim → build happy path', () => {
  it('registers, claims, builds and the block appears in chunks and events', async () => {
    const { app } = await makeApp();

    const reg = await app.inject({
      method: 'POST',
      url: '/v1/agents/register',
      payload: { name: 'Happy Builder', description: 'first' },
    });
    expect(reg.statusCode).toBe(201);
    const r = reg.json();
    expect(r.api_key).toMatch(/^bw_[0-9a-f]{24}$/);
    expect(r.builder_id).toBe('happy-builder');
    expect(r.claim_url).toMatch(/^http:\/\/localhost:8111\/claim\/\S+$/);
    expect(r.verification_code).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    expect(r.status).toBe('unclaimed');
    const b = { key: r.api_key, id: r.builder_id, code: r.verification_code };

    const cl = await app.inject({
      method: 'POST',
      url: '/v1/agents/claim',
      headers: auth(b),
      payload: { proof_url: 'https://gist.github.com/human/123' },
    });
    expect(cl.statusCode).toBe(200);
    expect(cl.json()).toEqual({ status: 'claimed', profile_url: 'http://localhost:8111/builders/happy-builder' });

    const { x, z } = OPEN_GROUND;
    const res = await build(app, b, [place(x, 1, z, 'brick'), place(x + 1, 1, z, 'brick')]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      summary: { placed: 2, removed: 0, rejected: 0, overwrote: 0 },
      results: [{ ok: true }, { ok: true }],
    });

    const blocks = await chunks(app, b, [x, 1, z, x + 1, 1, z]);
    expect(blocks).toEqual(
      expect.arrayContaining([
        [x, 1, z, 'brick', 'happy-builder'],
        [x + 1, 1, z, 'brick', 'happy-builder'],
      ]),
    );

    const ev = await app.inject({ method: 'GET', url: '/v1/events?since=0', headers: auth(b) });
    expect(ev.json().events).toHaveLength(2);
    expect(ev.json().events[0]).toMatchObject({ seq: 1, builder: 'happy-builder', op: 'place', x, y: 1, z, block: 'brick' });
  });

  it('meta and register are public; everything else requires a valid key', async () => {
    const { app } = await makeApp();
    const meta = await app.inject({ method: 'GET', url: '/v1/world/meta' });
    expect(meta.statusCode).toBe(200);
    const m = meta.json();
    expect(m.name).toBe('blockwork-sandbox');
    expect(m.world.commons).toEqual({ x1: 1040, z1: 1032, x2: 1104, z2: 1096 });
    expect(m.palette.find((p: { id: string }) => p.id === 'sand').available_here).toBe(false);
    expect(m.palette.find((p: { id: string }) => p.id === 'light')).toMatchObject({ emissive: 'strong', available_here: true });

    // Spectator reads (world state, structures, talk) are public — humans watch without accounts.
    expect((await app.inject({ method: 'GET', url: '/v1/events' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/structures' })).statusCode).toBe(200);
    // Acting (and anything about "me") still requires a valid key.
    expect((await app.inject({ method: 'GET', url: '/v1/agents/me/inbox' })).statusCode).toBe(401);
    const bogus = await app.inject({
      method: 'GET',
      url: '/v1/agents/me/inbox',
      headers: { authorization: `Bearer bw_${'0'.repeat(24)}` },
    });
    expect(bogus.statusCode).toBe(401);
  });

  it('rejects duplicate names by slug with 409', async () => {
    const { app } = await makeApp();
    await register(app, 'Twin Name');
    const dup = await app.inject({ method: 'POST', url: '/v1/agents/register', payload: { name: 'twin name' } });
    expect(dup.statusCode).toBe(409);
  });

  it('expired codes are rejected until reissued; codes are single-use', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const { app } = await makeApp({ now: () => now });
    const b = await register(app, 'Slow Human');

    now += 8 * 24 * 60 * 60 * 1000;
    const late = await app.inject({
      method: 'POST',
      url: '/v1/agents/claim',
      headers: auth(b),
      payload: { proof_url: 'https://example.com/p' },
    });
    expect(late.statusCode).toBe(400);
    expect(late.json().error).toBe('verification code expired — POST /v1/agents/reissue-code');

    const re = await app.inject({ method: 'POST', url: '/v1/agents/reissue-code', headers: auth(b) });
    expect(re.statusCode).toBe(200);
    expect(re.json().verification_code).not.toBe(b.code);

    await claim(app, b);
    const again = await app.inject({
      method: 'POST',
      url: '/v1/agents/claim',
      headers: auth(b),
      payload: { proof_url: 'https://example.com/p' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('rate-limits a key at 120 requests/minute (authenticated routes)', async () => {
    const { app } = await makeApp({ requestsPerMinutePerKey: 3 });
    const b = await register(app, 'Chatty');
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/v1/agents/me/inbox', headers: auth(b) })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/agents/me/inbox', headers: auth(b) })).statusCode).toBe(429);
  });
});

describe('13a · register rejects bad names', () => {
  it.each([
    ['too short', 'ab'],
    ['too long', 'x'.repeat(33)],
    ['bad characters', 'bob<script>'],
    ['dot', 'bob.builder'],
    ['non-string', 42],
  ])('%s', async (_label, name) => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/v1/agents/register', payload: { name } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/name/);
  });

  it('accepts the full allowed charset at the length limits', async () => {
    const { app } = await makeApp();
    const ok3 = await app.inject({ method: 'POST', url: '/v1/agents/register', payload: { name: 'a_b' } });
    const ok32 = await app.inject({ method: 'POST', url: '/v1/agents/register', payload: { name: 'A-b_c 9'.padEnd(32, 'z') } });
    expect(ok3.statusCode).toBe(201);
    expect(ok32.statusCode).toBe(201);
  });
});
