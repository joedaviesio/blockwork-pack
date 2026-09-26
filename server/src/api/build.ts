import type { FastifyInstance } from 'fastify';
import { me, sendError, iso, type AppContext } from '../server.js';
import { evaluateRules } from '../rules/latent.js';
import { HEIGHT_ENVELOPE, inCommons, inWorld, onIsland } from '../world/districts.js';
import { isAvailableAt, isKnownBlock } from '../world/palette.js';
import { isUuid, sha256Hex } from '../util/ids.js';

export type OpResult =
  | { ok: true; overwrote?: true }
  | { ok: false; reason: string }
  | { ok: false; edict: string };

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
  invalidOp: 'invalid op — expected {op:"place"|"remove", x, y, z (integers), block (for place)}',
  unknownBlock: 'unknown block type',
  outsideWorld: 'outside world bounds',
  outsideTerritory: 'outside habitable territory',
  unclaimed: 'unclaimed builders build in the Commons — have your human claim you',
  material: 'material not available in this territory',
  height: `exceeds height envelope (max ${HEIGHT_ENVELOPE} above terrain)`,
  quotaDaily: 'daily block quota exhausted — try again tomorrow (UTC)',
  occupied: 'cell occupied (protect_existing)',
  nothing: 'nothing to remove',
} as const;

/** Shape check for a single op; returns a normalised op or a rejection reason. */
function parseOp(raw: unknown): Op | { reason: string } {
  if (typeof raw !== 'object' || raw === null) return { reason: REASONS.invalidOp };
  const o = raw as Record<string, unknown>;
  if (o.op !== 'place' && o.op !== 'remove') return { reason: REASONS.invalidOp };
  if (![o.x, o.y, o.z].every((n) => Number.isSafeInteger(n))) return { reason: REASONS.invalidOp };
  const op: Op = { op: o.op, x: o.x as number, y: o.y as number, z: o.z as number };
  if (o.op === 'place') {
    if (o.block === undefined) return { reason: REASONS.invalidOp };
    if (!isKnownBlock(o.block)) return { reason: REASONS.unknownBlock };
    op.block = o.block;
  }
  return op;
}

/** Canonical form for hashing, so key order inside op objects doesn't matter. */
function payloadHash(protectExisting: boolean, ops: unknown[]): string {
  const canon = ops.map((raw) => {
    const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    return [o.op ?? null, o.x ?? null, o.y ?? null, o.z ?? null, o.block ?? null];
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
    const summary = { placed: 0, removed: 0, rejected: 0, overwrote: 0 };
    const results: OpResult[] = [];
    const reject = (r: OpResult) => {
      summary.rejected++;
      results.push(r);
    };

    for (const raw of body.ops) {
      const parsed = parseOp(raw);
      if ('reason' in parsed) {
        reject({ ok: false, reason: parsed.reason });
        continue;
      }
      const { op, x, y, z, block } = parsed;

      // 1. bounds / territory
      if (!inWorld(x, y, z)) { reject({ ok: false, reason: REASONS.outsideWorld }); continue; }
      if (!onIsland(x, z)) { reject({ ok: false, reason: REASONS.outsideTerritory }); continue; }
      if (!claimed && !inCommons(x, z)) { reject({ ok: false, reason: REASONS.unclaimed }); continue; }
      // 2. material availability
      if (op === 'place' && !isAvailableAt(block!, x, z)) { reject({ ok: false, reason: REASONS.material }); continue; }
      // 3. height envelope
      if (op === 'place' && y > HEIGHT_ENVELOPE) { reject({ ok: false, reason: REASONS.height }); continue; }
      // 4. quota
      if (charged >= quotaLeft) {
        reject({ ok: false, reason: claimed ? REASONS.quotaDaily : unclaimedQuotaReason });
        continue;
      }
      // 5. protect_existing (places only; terrain never counts)
      if (protectExisting && op === 'place' && state.placedAt(x, y, z)) {
        reject({ ok: false, reason: REASONS.occupied });
        continue;
      }
      // 6. latent rules (never in the Commons) — bare code, quota-charged
      const edict = evaluateRules(rules, { x, y, z, block });
      if (edict !== null) {
        charged++;
        reject({ ok: false, edict });
        continue;
      }
      // 7. apply
      if (op === 'place') {
        const prev = state.placedAt(x, y, z);
        state.appendBlockEvents([{ ts, builder: agent.builder_id, op, x, y, z, block }]);
        charged++;
        summary.placed++;
        if (prev && prev.builder !== agent.builder_id) {
          summary.overwrote++;
          results.push({ ok: true, overwrote: true });
        } else {
          results.push({ ok: true });
        }
      } else {
        if (state.read(x, y, z) === null) {
          reject({ ok: false, reason: REASONS.nothing });
          continue;
        }
        state.appendBlockEvents([{ ts, builder: agent.builder_id, op, x, y, z }]);
        charged++;
        summary.removed++;
        results.push({ ok: true });
      }
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
