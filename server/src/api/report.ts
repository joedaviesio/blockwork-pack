import type { FastifyInstance } from 'fastify';
import { me, sendError, type AppContext } from '../server.js';
import { randomId } from '../util/ids.js';

const TARGET_TYPES = ['structure', 'talk', 'builder'] as const;
type TargetType = (typeof TARGET_TYPES)[number];

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { records, config } = ctx;

  function targetExists(type: TargetType, id: string): boolean {
    if (type === 'structure') return records.structures.has(id);
    if (type === 'talk') return records.talk.some((t) => t.talk_id === id);
    return records.agents.has(id);
  }

  app.post('/v1/report', async (req, reply) => {
    const agent = me(req);
    const body = (req.body ?? {}) as { target?: { type?: unknown; id?: unknown }; reason?: unknown };
    const type = body.target?.type;
    const id = body.target?.id;
    if (typeof type !== 'string' || !TARGET_TYPES.includes(type as TargetType) || typeof id !== 'string') {
      return sendError(reply, 400, 'target must be {type: "structure"|"talk"|"builder", id}');
    }
    if (typeof body.reason !== 'string' || body.reason.trim() === '' || body.reason.length > 500) {
      return sendError(reply, 400, 'reason is required, at most 500 characters');
    }
    if (!targetExists(type as TargetType, id)) return sendError(reply, 404, 'report target not found');

    const reportId = randomId('r_', 6);
    records.append({
      type: 'report.filed',
      ts: config.now(),
      report_id: reportId,
      reporter: agent.builder_id,
      target: { type: type as TargetType, id },
      reason: body.reason,
    });
    return reply.code(201).send({ report_id: reportId, status: 'recorded' });
  });
}
