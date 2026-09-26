import { describe, expect, it } from 'vitest';
import { expandGenerator } from '../src/api/build.js';
import { makeApp, register, claim, auth } from './helpers.js';

const uuid = (n: string) => `00000000-0000-4000-8000-0000000000${n}`;

describe('generator expansion (pure)', () => {
  it('solid box volume and hollow box shell', () => {
    const solid = expandGenerator({ op: 'box', from: [0, 0, 0], to: [3, 2, 3], block: 'stone' });
    expect(Array.isArray(solid) && solid.length).toBe(4 * 3 * 4);
    const hollow = expandGenerator({ op: 'box', from: [0, 0, 0], to: [3, 2, 3], block: 'stone', hollow: true });
    // shell = volume minus the interior (2×1×2)
    expect(Array.isArray(hollow) && hollow.length).toBe(4 * 3 * 4 - 4);
  });

  it('walls have no floor or roof', () => {
    const walls = expandGenerator({ op: 'walls', from: [0, 0, 0], to: [4, 3, 4], block: 'brick' });
    expect(Array.isArray(walls)).toBe(true);
    const cells = walls as [number, number, number][];
    // interior floor cell absent, perimeter cell present at every y
    expect(cells.some(([x, y, z]) => x === 2 && z === 2)).toBe(false);
    expect(cells.filter(([x, , z]) => x === 0 && z === 0).length).toBe(4);
  });

  it('cylinder is hollow by default and dedupes cells', () => {
    const cyl = expandGenerator({ op: 'cylinder', center: [10, 0, 10], r: 4, h: 2, block: 'snow' }) as [number, number, number][];
    const keys = new Set(cyl.map((c) => c.join(',')));
    expect(keys.size).toBe(cyl.length);
    // no cell at the exact center (hollow)
    expect(cyl.some(([x, y, z]) => x === 10 && y === 0 && z === 10)).toBe(false);
  });

  it('dome is a shell with its peak at r and nothing below center', () => {
    const dome = expandGenerator({ op: 'dome', center: [0, 0, 0], r: 5, block: 'glass' }) as [number, number, number][];
    expect(dome.every(([, y]) => y >= 0)).toBe(true);
    expect(dome.some(([x, y, z]) => x === 0 && z === 0 && y === 5)).toBe(true);
    expect(dome.some(([x, y, z]) => x === 0 && y === 0 && z === 0)).toBe(false);
  });

  it('arch rises to half its span and lands on both feet', () => {
    const arch = expandGenerator({ op: 'arch', from: [0, 1, 0], to: [12, 1, 0], block: 'stone' }) as [number, number, number][];
    const maxY = Math.max(...arch.map(([, y]) => y));
    expect(maxY).toBe(1 + 6);
    expect(arch.some(([x, y]) => x === 0 && y === 1)).toBe(true);
    expect(arch.some(([x, y]) => x === 12 && y === 1)).toBe(true);
  });

  it('rejects malformed and oversized generators; ignores non-generators', () => {
    expect(expandGenerator({ op: 'place', x: 1, y: 1, z: 1, block: 'stone' })).toBe(null);
    expect(expandGenerator({ op: 'dome', center: [0, 0, 0], r: 99, block: 'stone' })).toHaveProperty('reason');
    expect(expandGenerator({ op: 'box', from: [0, 0], to: [1, 1, 1], block: 'stone' })).toHaveProperty('reason');
    expect(expandGenerator({ op: 'box', from: [0, 0, 0], to: [1, 1, 1], block: 'plutonium' })).toHaveProperty('reason');
  });
});

describe('generators through the API', () => {
  it('aggregated result, quota charging, and normal checks apply per expanded block', async () => {
    const { app } = await makeApp();
    const b = await register(app, 'Domewright');
    await claim(app, b);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/build',
      headers: auth(b),
      payload: {
        idempotency_key: uuid('01'),
        ops: [{ op: 'cylinder', center: [1100, 0, 1200], r: 5, h: 4, block: 'stone' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const agg = body.results[0];
    expect(agg.ok).toBe(true);
    expect(agg.expanded).toBeGreaterThan(0);
    expect(agg.placed).toBe(agg.expanded);
    expect(body.summary.placed).toBe(agg.placed);

    // height envelope applies inside a generator: a tall box gets partial rejections with the plain reason
    const tall = await app.inject({
      method: 'POST',
      url: '/v1/build',
      headers: auth(b),
      payload: {
        idempotency_key: uuid('02'),
        ops: [{ op: 'box', from: [1120, 60, 1200], to: [1120, 70, 1200], block: 'stone' }],
      },
    });
    const t = tall.json().results[0];
    expect(t.placed).toBe(5); // y 60..64
    expect(Object.keys(t.reasons).join('')).toContain('height envelope');
  });

  it('a generator exceeding the per-call block budget is rejected whole', async () => {
    const { app } = await makeApp();
    const b = await register(app, 'Bulkwright');
    await claim(app, b);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/build',
      headers: auth(b),
      payload: {
        idempotency_key: uuid('03'),
        ops: [{ op: 'box', from: [1100, 0, 1100], to: [1131, 3, 1131], block: 'stone' }], // 32×4×32 = 4096 > 2048
      },
    });
    const r = res.json().results[0];
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('budget');
  });

  it('edicts inside a generator return bare codes in the reason tally', async () => {
    const { app } = await makeApp();
    const b = await register(app, 'Lawprober');
    await claim(app, b);
    // fixture district THE_GRID [800,800)-(864,864): gold denied (EDICT-1)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/build',
      headers: auth(b),
      payload: {
        idempotency_key: uuid('04'),
        ops: [{ op: 'line', from: [798, 1, 810], to: [806, 1, 810], block: 'gold' }],
      },
    });
    const r = res.json().results[0];
    expect(r.reasons['EDICT-1']).toBeGreaterThan(0);
    // cells outside the district placed fine
    expect(r.placed).toBeGreaterThan(0);
    // bare code only — no explanatory text anywhere in the reasons keys
    for (const k of Object.keys(r.reasons)) {
      if (k.startsWith('EDICT')) expect(k).toBe('EDICT-1');
    }
  });
});
