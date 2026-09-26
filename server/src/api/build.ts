import type { FastifyInstance } from 'fastify';
import { me, sendError, iso, type AppContext } from '../server.js';
import { evaluateRules } from '../rules/latent.js';
import { HEIGHT_ENVELOPE, inCommons, inWorld, onIsland } from '../world/districts.js';
import { isAvailableAt, isKnownBlock } from '../world/palette.js';
import { isUuid, sha256Hex } from '../util/ids.js';

export type OpResult =
  | { ok: true; overwrote?: true }
  | { ok: false; reason: string }
  | { ok: false; edict: string }
  | GeneratorResult;

export interface GeneratorResult {
  ok: boolean;
  expanded: number;
  placed: number;
  rejected: number;
  overwrote: number;
  reasons: Record<string, number>;
  reason?: string; // set when ok:false (op invalid before expansion)
}

export interface BuildResponse {
  summary: { placed: number; removed: number; rejected: number; overwrote: number };
  results: OpResult[];
}

interface Op {
  op: 'place' | 'remove';
  x: number;
  y: number;
  z: number;
  block?: string;
}

export const REASONS = {
  invalidOp: 'invalid op — expected place/remove {x,y,z,block} or a generator (box, walls, line, cylinder, dome, arch)',
  unknownBlock: 'unknown block type',
  outsideWorld: 'outside world bounds',
  outsideTerritory: 'outside habitable territory',
  unclaimed: 'unclaimed builders build in the Commons — have your human claim you',
  material: 'material not available in this territory',
  height: `exceeds height envelope (max ${HEIGHT_ENVELOPE} above terrain)`,
  quotaDaily: 'daily block quota exhausted — try again tomorrow (UTC)',
  occupied: 'cell occupied (protect_existing)',
  nothing: 'nothing to remove',
  budget: 'generator expansion exceeds the per-call block budget — split the shape into smaller calls',
} as const;

const GENERATORS = new Set(['box', 'walls', 'line', 'cylinder', 'dome', 'arch']);
const MAX_R = 32;
const MAX_H = 64;

const isInt = (n: unknown): n is number => Number.isSafeInteger(n);
const vec3 = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every(isInt) ? (v as [number, number, number]) : null;

/** Shape check for a primitive op; returns a normalised op or a rejection reason. */
function parseOp(raw: unknown): Op | { reason: string } {
  if (typeof raw !== 'object' || raw === null) return { reason: REASONS.invalidOp };
  const o = raw as Record<string, unknown>;
  if (o.op !== 'place' && o.op !== 'remove') return { reason: REASONS.invalidOp };
  if (![o.x, o.y, o.z].every(isInt)) return { reason: REASONS.invalidOp };
  const op: Op = { op: o.op, x: o.x as number, y: o.y as number, z: o.z as number };
  if (o.op === 'place') {
    if (o.block === undefined) return { reason: REASONS.invalidOp };
    if (!isKnownBlock(o.block)) return { reason: REASONS.unknownBlock };
    op.block = o.block;
  }
  return op;
}

/**
 * Expand a generator op into cell coordinates (deduped). Returns null when the
 * op isn't a generator; {reason} when it is one but malformed.
 */
export function expandGenerator(raw: unknown): [number, number, number][] | { reason: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.op !== 'string' || !GENERATORS.has(o.op)) return null;
  if (!isKnownBlock(o.block)) return { reason: REASONS.unknownBlock };

  const cells = new Map<string, [number, number, number]>();
  const put = (x: number, y: number, z: number) => cells.set(`${x},${y},${z}`, [x, y, z]);

  if (o.op === 'box' || o.op === 'walls') {
    const a = vec3(o.from), b = vec3(o.to);
    if (!a || !b) return { reason: REASONS.invalidOp };
    const [x1, y1, z1] = a.map((v, i) => Math.min(v, b[i])) as [number, number, number];
    const [x2, y2, z2] = a.map((v, i) => Math.max(v, b[i])) as [number, number, number];
    const hollow = o.op === 'walls' || o.hollow === true;
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) {
      const onShell = x === x1 || x === x2 || z === z1 || z === z2;
      const onCap = y === y1 || y === y2;
      if (o.op === 'walls') { if (onShell) put(x, y, z); continue; }
      if (!hollow || onShell || onCap) put(x, y, z);
    }
  } else if (o.op === 'line') {
    const a = vec3(o.from), b = vec3(o.to);
    if (!a || !b) return { reason: REASONS.invalidOp };
    const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
    for (let i = 0; i <= steps; i++) {
      put(
        Math.round(a[0] + ((b[0] - a[0]) * i) / steps),
        Math.round(a[1] + ((b[1] - a[1]) * i) / steps),
        Math.round(a[2] + ((b[2] - a[2]) * i) / steps)
      );
    }
  } else if (o.op === 'cylinder') {
    const c = vec3(o.center);
    const r = o.r, h = o.h;
    if (!c || !isInt(r) || !isInt(h) || r < 1 || r > MAX_R || h < 1 || h > MAX_H) return { reason: REASONS.invalidOp };
    const hollow = o.hollow !== false; // hollow by default
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      if (hollow && d2 <= (r - 1) * (r - 1)) continue;
      for (let dy = 0; dy < h; dy++) put(c[0] + dx, c[1] + dy, c[2] + dz);
    }
  } else if (o.op === 'dome') {
    const c = vec3(o.center);
    const r = o.r;
    if (!c || !isInt(r) || r < 1 || r > MAX_R) return { reason: REASONS.invalidOp };
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = 0; dy <= r; dy++) {
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= r + 0.4 && d > r - 0.9) put(c[0] + dx, c[1] + dy, c[2] + dz);
    }
  } else if (o.op === 'arch') {
    const a = vec3(o.from), b = vec3(o.to);
    if (!a || !b || a[1] !== b[1]) return { reason: REASONS.invalidOp };
    const span = Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2);
    if (span < 2 || span > MAX_R * 2) return { reason: REASONS.invalidOp };
    const steps = Math.ceil(span) * 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      put(
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + Math.sin(t * Math.PI) * (span / 2)),
        Math.round(a[2] + (b[2] - a[2]) * t)
      );
    }
  }
  return [...cells.values()];
}

/** Canonical form for hashing, so key order inside op objects doesn't matter. */
function payloadHash(protectExisting: boolean, ops: unknown[]): string {
  const canon = ops.map((raw) => {
    const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return [o.op ?? null, o.x ?? null, o.y ?? null, o.z ?? null, o.block ?? null,
      o.from ?? null, o.to ?? null, o.center ?? null, o.r ?? null, o.h ?? null, o.hollow ?? null];
  });
  return sha256Hex(JSON.stringify({ protect_existing: protectExisting, ops: canon }));
}

export function registerBuildRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { state, records, rules, config } = ctx;

  // Deliberately synchronous from validation to response: no interleaving between requests.
  app.post('/v1/build', async (req, reply) => {
    const agent = me(req);
    const body = (req.body ?? {}) as { idempotency_key?: unknown; protect_existing?: unknown; ops?: unknown };

    if (!isUuid(body.idempotency_key)) return sendError(reply, 400, 'idempotency_key must be a UUID');
    if (body.protect_existing !== undefined && typeof body.protect_existing !== 'boolean') {
      return sendError(reply, 400, 'protect_existing must be a boolean');
    }
    if (!Array.isArray(body.ops) || body.ops.length === 0) return sendError(reply, 400, 'ops must be a non-empty array');
    if (body.ops.length > config.maxOpsPerBuild) {
      return sendError(reply, 400, `too many ops (max ${config.maxOpsPerBuild} per call)`);
    }

    const key = body.idempotency_key;
    const protectExisting = body.protect_existing === true;
    const hash = payloadHash(protectExisting, body.ops);
    const now = config.now();

    const seen = records.idempotency.lookup(agent.builder_id, key, hash, now);
    if (seen.kind === 'replay') return reply.send(seen.response);
    if (seen.kind === 'conflict') {
      return sendError(reply, 409, 'idempotency_key already used with a different payload');
    }

    const claimed = agent.status === 'claimed';
    const quotaLeft = claimed
      ? config.claimedDailyQuota - records.usedOnDay(agent.builder_id, now)
      : config.unclaimedTotalQuota - records.usedTotal(agent.builder_id);
    const ts = iso(now);
    const unclaimedQuotaReason = `block quota exhausted (unclaimed builders: ${config.unclaimedTotalQuota} blocks total) — have your human claim you`;

    let charged = 0;
    let blockBudget = config.maxOpsPerBuild; // total cells this call may touch, generators included
    const summary = { placed: 0, removed: 0, rejected: 0, overwrote: 0 };
    const results: OpResult[] = [];

    /** One placement through the full check chain. Shared by primitives and generators. */
    const execPlace = (x: number, y: number, z: number, block: string): OpResult => {
      if (!inWorld(x, y, z)) return { ok: false, reason: REASONS.outsideWorld };
      if (!onIsland(x, z)) return { ok: false, reason: REASONS.outsideTerritory };
      if (!claimed && !inCommons(x, z)) return { ok: false, reason: REASONS.unclaimed };
      if (!isAvailableAt(block, x, z)) return { ok: false, reason: REASONS.material };
      if (y > HEIGHT_ENVELOPE) return { ok: false, reason: REASONS.height };
      if (charged >= quotaLeft) return { ok: false, reason: claimed ? REASONS.quotaDaily : unclaimedQuotaReason };
      if (protectExisting && state.placedAt(x, y, z)) return { ok: false, reason: REASONS.occupied };
      const edict = evaluateRules(rules, { x, y, z, block });
      if (edict !== null) { charged++; return { ok: false, edict }; }
      const prev = state.placedAt(x, y, z);
      state.appendBlockEvents([{ ts, builder: agent.builder_id, op: 'place', x, y, z, block }]);
      charged++;
      summary.placed++;
      if (prev && prev.builder !== agent.builder_id) {
        summary.overwrote++;
        return { ok: true, overwrote: true };
      }
      return { ok: true };
    };

    const execRemove = (x: number, y: number, z: number): OpResult => {
      if (!inWorld(x, y, z)) return { ok: false, reason: REASONS.outsideWorld };
      if (!onIsland(x, z)) return { ok: false, reason: REASONS.outsideTerritory };
      if (!claimed && !inCommons(x, z)) return { ok: false, reason: REASONS.unclaimed };
      if (charged >= quotaLeft) return { ok: false, reason: claimed ? REASONS.quotaDaily : unclaimedQuotaReason };
      const edict = evaluateRules(rules, { x, y, z });
      if (edict !== null) { charged++; return { ok: false, edict }; }
      if (state.read(x, y, z) === null) return { ok: false, reason: REASONS.nothing };
      state.appendBlockEvents([{ ts, builder: agent.builder_id, op: 'remove', x, y, z }]);
      charged++;
      summary.removed++;
      return { ok: true };
    };

    for (const raw of body.ops) {
      // Generators first: one requested op expands into many cells, one aggregated result.
      const expanded = expandGenerator(raw);
      if (expanded !== null) {
        if ('reason' in expanded) {
          summary.rejected++;
          results.push({ ok: false, expanded: 0, placed: 0, rejected: 1, overwrote: 0, reasons: { [expanded.reason]: 1 }, reason: expanded.reason });
          continue;
        }
        if (expanded.length > blockBudget) {
          summary.rejected++;
          results.push({ ok: false, expanded: expanded.length, placed: 0, rejected: 1, overwrote: 0, reasons: { [REASONS.budget]: 1 }, reason: REASONS.budget });
          continue;
        }
        blockBudget -= expanded.length;
        const block = (raw as Record<string, unknown>).block as string;
        const agg: GeneratorResult = { ok: true, expanded: expanded.length, placed: 0, rejected: 0, overwrote: 0, reasons: {} };
        for (const [x, y, z] of expanded) {
          const r = execPlace(x, y, z, block);
          if (r.ok) {
            agg.placed++;
            if ('overwrote' in r && r.overwrote) agg.overwrote++;
          } else {
            agg.rejected++;
            summary.rejected++;
            const label = 'edict' in r ? r.edict : (r as { reason: string }).reason;
            agg.reasons[label] = (agg.reasons[label] || 0) + 1;
          }
        }
        results.push(agg);
        continue;
      }

      // Primitive ops.
      const parsed = parseOp(raw);
      if ('reason' in parsed) {
        summary.rejected++;
        results.push({ ok: false, reason: parsed.reason });
        continue;
      }
      if (blockBudget <= 0) {
        summary.rejected++;
        results.push({ ok: false, reason: REASONS.budget });
        continue;
      }
      blockBudget--;
      const r = parsed.op === 'place'
        ? execPlace(parsed.x, parsed.y, parsed.z, parsed.block!)
        : execRemove(parsed.x, parsed.y, parsed.z);
      if (!r.ok) summary.rejected++;
      results.push(r);
    }

    const response: BuildResponse = { summary, results };
    records.append({
      type: 'build.recorded',
      ts: now,
      builder_id: agent.builder_id,
      idempotency_key: key,
      hash,
      response,
      charged,
    });
    return reply.send(response);
  });
}
