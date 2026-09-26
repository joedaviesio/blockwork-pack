import { existsSync, readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { WORLD_NAME } from '../config.js';
import { sendError, type AppContext } from '../server.js';
import { COMMONS, HEIGHT_ENVELOPE, ISLAND, SPAWN, WORLD_SIZE } from '../world/districts.js';
import { PALETTE, availableOnIsland } from '../world/palette.js';
import { terrainAt } from '../world/terrain.js';
import { summariseRegion } from '../world/muse.js';

/** Parse "a,b,c" into integers; null if any part is not an integer. */
export function parseIntList(raw: unknown, allowedLengths: number[]): number[] | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map((p) => p.trim());
  if (!allowedLengths.includes(parts.length)) return null;
  const nums = parts.map((p) => (/^-?\d+$/.test(p) ? Number(p) : NaN));
  return nums.every(Number.isSafeInteger) ? nums : null;
}

function inRange(n: number): boolean {
  return n >= 0 && n < WORLD_SIZE;
}

export function registerWorldRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { state, config } = ctx;

  app.get('/v1/world/meta', { config: { public: true } }, async () => {
    const available = new Set(availableOnIsland());
    return {
      name: WORLD_NAME,
      // habitable_bbox [x1, z1, x2, z2) is the canonical machine-readable bounds key.
      habitable_bbox: [ISLAND.x1, ISLAND.z1, ISLAND.x2, ISLAND.z2],
      world: {
        size: WORLD_SIZE,
        island: { x1: ISLAND.x1, z1: ISLAND.z1, x2: ISLAND.x2, z2: ISLAND.z2 },
        spawn: SPAWN,
        commons: { x1: COMMONS.x1, z1: COMMONS.z1, x2: COMMONS.x2, z2: COMMONS.z2 },
        height_envelope: HEIGHT_ENVELOPE,
      },
      palette: PALETTE.map((p) => ({ ...p, name: p.id, color: p.hex, available_here: available.has(p.id) })),
      links: { skill: '/skill.md' },
    };
  });

  // skill.md is public documentation (not an API route), served as-is when present.
  app.get('/skill.md', { config: { public: true } }, async (_req, reply) => {
    if (!existsSync(config.skillPath)) return sendError(reply, 404, 'skill.md not found');
    return reply.type('text/markdown; charset=utf-8').send(readFileSync(config.skillPath, 'utf8'));
  });

  app.get('/v1/chunks', { config: { public: true } }, async (req, reply) => {
    const q = req.query as { bbox?: unknown };
    const nums = parseIntList(q.bbox, [6]);
    if (!nums) return sendError(reply, 400, 'bbox must be x1,y1,z1,x2,y2,z2 (integers)');
    const [ax, ay, az, bx, by, bz] = nums;
    const b = {
      x1: Math.min(ax, bx), y1: Math.min(ay, by), z1: Math.min(az, bz),
      x2: Math.max(ax, bx), y2: Math.max(ay, by), z2: Math.max(az, bz),
    };
    if (![b.x1, b.y1, b.z1, b.x2, b.y2, b.z2].every(inRange)) {
      return sendError(reply, 400, `bbox must lie within the world (0–${WORLD_SIZE - 1})`);
    }
    const { x: mx, y: my, z: mz } = config.chunkMax;
    if (b.x2 - b.x1 + 1 > mx || b.y2 - b.y1 + 1 > my || b.z2 - b.z1 + 1 > mz) {
      return sendError(reply, 400, `bbox too large (max ${mx}×${my}×${mz})`);
    }

    const blocks: [number, number, number, string, string | null][] = [];
    // Terrain (computed, y=0 only) unless shadowed by a placed block or dug out.
    if (b.y1 <= 0 && b.y2 >= 0) {
      const tx1 = Math.max(b.x1, ISLAND.x1);
      const tx2 = Math.min(b.x2, ISLAND.x2 - 1);
      const tz1 = Math.max(b.z1, ISLAND.z1);
      const tz2 = Math.min(b.z2, ISLAND.z2 - 1);
      for (let x = tx1; x <= tx2; x++) {
        for (let z = tz1; z <= tz2; z++) {
          if (state.placedAt(x, 0, z) || state.isTerrainRemoved(x, 0, z)) continue;
          const t = terrainAt(x, z);
          if (t) blocks.push([x, 0, z, t, null]);
        }
      }
    }
    for (const c of state.placedInBox(b)) blocks.push([c.x, c.y, c.z, c.block, c.builder]);

    return { bbox: [b.x1, b.y1, b.z1, b.x2, b.y2, b.z2], blocks };
  });

  app.get('/v1/region/summary', { config: { public: true } }, async (req, reply) => {
    const q = req.query as { bbox?: unknown };
    // Accept x1,z1,x2,z2 (spec) or x1,y1,z1,x2,y2,z2 (skill.md example; y ignored).
    const nums = parseIntList(q.bbox, [4, 6]);
    if (!nums) return sendError(reply, 400, 'bbox must be x1,z1,x2,z2 (or x1,y1,z1,x2,y2,z2)');
    const [ax, az, bx, bz] = nums.length === 4 ? nums : [nums[0], nums[2], nums[3], nums[5]];
    const area = { x1: Math.min(ax, bx), z1: Math.min(az, bz), x2: Math.max(ax, bx), z2: Math.max(az, bz) };
    if (![area.x1, area.z1, area.x2, area.z2].every(inRange)) {
      return sendError(reply, 400, `bbox must lie within the world (0–${WORLD_SIZE - 1})`);
    }
    const side = config.summaryMaxSide;
    if (area.x2 - area.x1 + 1 > side || area.z2 - area.z1 + 1 > side) {
      return sendError(reply, 400, `bbox too large (max ${side}×${side} columns)`);
    }
    return summariseRegion(ctx, area);
  });

  app.get('/v1/events', { config: { public: true } }, async (req, reply) => {
    const q = req.query as { since?: string; limit?: string };
    const since = q.since === undefined ? 0 : Number(q.since);
    const limitRaw = q.limit === undefined ? config.eventsDefaultLimit : Number(q.limit);
    if (!Number.isSafeInteger(since) || since < 0) return sendError(reply, 400, 'since must be a non-negative integer');
    if (!Number.isSafeInteger(limitRaw) || limitRaw < 1) return sendError(reply, 400, 'limit must be a positive integer');
    const limit = Math.min(limitRaw, config.eventsMaxLimit);

    const { events, scannedTo } = state.eventsSince(since, limit);
    return {
      events: events.map((e) => {
        const out: Record<string, unknown> = { seq: e.seq, ts: e.ts, builder: e.builder, op: e.op, x: e.x, y: e.y, z: e.z };
        if (e.block !== undefined) out.block = e.block;
        return out;
      }),
      next_since: Math.max(since, scannedTo),
    };
  });

}
