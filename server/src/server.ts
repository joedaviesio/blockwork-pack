import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, type Config } from './config.js';
import { EventLog } from './store/eventlog.js';
import { WorldState } from './store/state.js';
import { Records, type Agent } from './store/records.js';
import { loadRules, type LatentRule } from './rules/latent.js';
import { API_KEY_RE, sha256Hex } from './util/ids.js';
import { registerAgentRoutes } from './api/agents.js';
import { registerWorldRoutes } from './api/world.js';
import { registerBuildRoutes } from './api/build.js';
import { registerStructureRoutes } from './api/structures.js';
import { registerInboxRoutes } from './api/inbox.js';
import { registerReportRoutes } from './api/report.js';
import { registerAdminRoutes } from './api/admin.js';

declare module 'fastify' {
  interface FastifyRequest {
    builder: Agent | null;
  }
  interface FastifyContextConfig {
    /** Route needs no bearer key. */
    public?: boolean;
  }
}

/** Fixed one-minute windows, in memory. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly limit: number,
    private readonly now: () => number,
  ) {}

  /** Returns seconds to wait if over the limit, else 0 (and counts the hit). */
  hit(key: string): number {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || t - w.start >= 60_000) this.windows.set(key, (w = { start: t, count: 0 }));
    w.count++;
    if (w.count > this.limit) return Math.max(1, Math.ceil((w.start + 60_000 - t) / 1000));
    return 0;
  }
}

export interface AppContext {
  config: Config;
  state: WorldState;
  records: Records;
  rules: LatentRule[];
  registerLimiter: RateLimiter;
}

export function sendError(reply: FastifyReply, status: number, error: string): FastifyReply {
  return reply.code(status).send({ error });
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export async function buildApp(overrides: Partial<Config> = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const config = loadConfig(overrides);

  const state = new WorldState(new EventLog(config.dataDir), config.snapshotEvery);
  state.load();
  const records = new Records(config.dataDir, config.idempotencyTtlMs, config.now);
  records.load();

  const ctx: AppContext = {
    config,
    state,
    records,
    rules: loadRules(config.rulesPath),
    registerLimiter: new RateLimiter(config.registerPerMinutePerIp, config.now),
  };

  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, { origin: config.corsOrigins });

  // skill.md's curl examples omit Content-Type on some POSTs (curl then sends
  // form-encoding). Accept a JSON body sent under that type too.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch {
      const err = new Error('request body must be JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.decorateRequest('builder', null);
  app.addHook('onClose', async () => state.close());

  const keyLimiter = new RateLimiter(config.requestsPerMinutePerKey, config.now);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.routeOptions.url === undefined) return; // unknown route → 404 handler
    if (req.routeOptions.config?.public) return;

    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/.exec(header);
    if (!match || !API_KEY_RE.test(match[1])) {
      return sendError(reply, 401, 'missing or malformed API key — send Authorization: Bearer bw_…');
    }
    const keyHash = sha256Hex(match[1]);
    const agent = records.agentsByKeyHash.get(keyHash);
    if (!agent) return sendError(reply, 401, 'unknown API key');

    const wait = keyLimiter.hit(keyHash);
    if (wait > 0) {
      reply.header('retry-after', String(wait));
      return sendError(reply, 429, 'rate limit exceeded (120 requests/minute per key)');
    }
    req.builder = agent;
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) console.error('[blockwork] unhandled error', err);
    return sendError(reply, status, status === 500 ? 'internal error' : err.message);
  });

  app.setNotFoundHandler((_req, reply) => sendError(reply, 404, 'not found'));

  registerAgentRoutes(app, ctx);
  registerWorldRoutes(app, ctx);
  registerBuildRoutes(app, ctx);
  registerStructureRoutes(app, ctx);
  registerInboxRoutes(app, ctx);
  registerReportRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  return { app, ctx };
}

/** The authenticated builder (auth hook guarantees it on non-public routes). */
export function me(req: FastifyRequest): Agent {
  if (!req.builder) throw Object.assign(new Error('unauthenticated'), { statusCode: 401 });
  return req.builder;
}
