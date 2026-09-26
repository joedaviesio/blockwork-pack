import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sendError, type AppContext } from '../server.js';

const MAX_SEQS = 50_000;

function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sandbox moderation power: tombstone (hide) or restore events. The hide
 * itself is an admin event in the log — nothing is ever deleted.
 */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { state, records, config } = ctx;

  app.post('/v1/admin/hide', { config: { public: true } }, async (req, reply) => {
    if (!tokenMatches(req.headers['x-admin-token'], config.adminToken)) {
      return sendError(reply, 403, 'admin token required');
    }
    const body = (req.body ?? {}) as { structure_id?: unknown; event_seqs?: unknown; hidden?: unknown };
    if (typeof body.hidden !== 'boolean') return sendError(reply, 400, 'hidden must be a boolean');
    const action = body.hidden ? 'hide' : 'unhide';

    let seqs: number[];
    let structureId: string | undefined;
    if (typeof body.structure_id === 'string') {
      const s = records.structures.get(body.structure_id);
      if (!s) return sendError(reply, 404, 'structure not found');
      structureId = s.structure_id;
      // The declarer's block events (places and removes) inside the structure's bbox.
      const [x1, y1, z1, x2, y2, z2] = s.bbox;
      seqs = state
        .blockEventsBetween(0, state.headSeq)
        .filter((e) => e.builder === s.builder_id && e.x >= x1 && e.x <= x2 && e.y >= y1 && e.y <= y2 && e.z >= z1 && e.z <= z2)
        .map((e) => e.seq);
    } else if (Array.isArray(body.event_seqs)) {
      if (body.event_seqs.length === 0 || body.event_seqs.length > MAX_SEQS) {
        return sendError(reply, 400, `event_seqs must hold 1–${MAX_SEQS} block event seqs`);
      }
      const bad = body.event_seqs.find((n) => !state.eventExists(n as number));
      if (bad !== undefined) return sendError(reply, 400, `not a block event seq: ${JSON.stringify(bad)}`);
      seqs = [...new Set(body.event_seqs as number[])];
    } else {
      return sendError(reply, 400, 'provide structure_id or event_seqs');
    }

    const event = state.appendAdminEvent({
      ts: new Date(config.now()).toISOString(),
      action,
      event_seqs: seqs,
      ...(structureId ? { structure_id: structureId } : {}),
    });
    return reply.send({ status: 'ok', action, admin_seq: event.seq, events_affected: seqs.length, structure_id: structureId ?? null });
  });
}
