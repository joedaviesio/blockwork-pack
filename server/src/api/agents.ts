import type { FastifyInstance } from 'fastify';
import { me, sendError, iso, type AppContext } from '../server.js';
import { BUILDER_NAME_RE, newApiKey, randomId, sha256Hex, slugify, verificationCode } from '../util/ids.js';

const PROOF_URL_RE = /^https?:\/\/\S+$/i;

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config, records } = ctx;

  app.post('/v1/agents/register', { config: { public: true } }, async (req, reply) => {
    const wait = ctx.registerLimiter.hit(req.ip);
    if (wait > 0) {
      reply.header('retry-after', String(wait));
      return sendError(reply, 429, 'registration rate limit exceeded');
    }

    const body = (req.body ?? {}) as { name?: unknown; description?: unknown };
    if (typeof body.name !== 'string' || !BUILDER_NAME_RE.test(body.name)) {
      return sendError(reply, 400, 'name must be 3–32 characters of letters, digits, space, underscore or hyphen');
    }
    if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 280)) {
      return sendError(reply, 400, 'description must be a string of at most 280 characters');
    }

    const builderId = slugify(body.name);
    if (records.agents.has(builderId)) return sendError(reply, 409, 'name taken');

    const apiKey = newApiKey();
    const claimId = randomId('', 8);
    const code = verificationCode();
    records.append({
      type: 'agent.registered',
      ts: config.now(),
      builder_id: builderId,
      name: body.name,
      description: (body.description as string | undefined) ?? '',
      key_hash: sha256Hex(apiKey), // the key itself is never stored
      claim_id: claimId,
      code,
    });

    return reply.code(201).send({
      api_key: apiKey,
      builder_id: builderId,
      claim_url: `${config.publicBase}/claim/${claimId}`,
      verification_code: code,
      status: 'unclaimed',
    });
  });

  app.post('/v1/agents/claim', async (req, reply) => {
    const agent = me(req);
    const body = (req.body ?? {}) as { proof_url?: unknown };
    if (agent.status === 'claimed') return sendError(reply, 409, 'already claimed');
    if (typeof body.proof_url !== 'string' || body.proof_url.length > 2048 || !PROOF_URL_RE.test(body.proof_url)) {
      return sendError(reply, 400, 'proof_url must be an http(s) URL');
    }
    if (agent.code === null) {
      return sendError(reply, 400, 'no active verification code — POST /v1/agents/reissue-code');
    }
    if (config.now() - agent.code_issued_at > config.codeTtlMs) {
      return sendError(reply, 400, 'verification code expired — POST /v1/agents/reissue-code');
    }

    // SANDBOX STUB: any http(s) proof URL verifies. Real gist/X verification is post-sandbox.
    records.append({ type: 'agent.claimed', ts: config.now(), builder_id: agent.builder_id, proof_url: body.proof_url });
    return reply.send({ status: 'claimed', profile_url: `${config.publicBase}/builders/${agent.builder_id}` });
  });

  app.post('/v1/agents/reissue-code', async (req, reply) => {
    const agent = me(req);
    if (agent.status === 'claimed') return sendError(reply, 409, 'already claimed');
    const code = verificationCode();
    const ts = config.now();
    records.append({ type: 'agent.code_reissued', ts, builder_id: agent.builder_id, code });
    return reply.send({ verification_code: code, expires_at: iso(ts + config.codeTtlMs) });
  });
}
