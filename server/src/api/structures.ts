import type { FastifyInstance, FastifyReply } from 'fastify';
import { me, sendError, iso, type AppContext } from '../server.js';
import type { Structure } from '../store/records.js';
import { WORLD_SIZE } from '../world/districts.js';
import { structureStats } from '../world/structureStats.js';
import { randomId } from '../util/ids.js';

/**
 * Names and style labels: letters (any script, incl. combining marks — so
 * "Chișinău Modernism" is expressible), digits, space and ' ’ & , . -
 * No control, format (bidi) or bracket characters.
 */
const LABEL_RE = /^[\p{L}\p{M}0-9 '’&,.\-]+$/u;
const MAX_LABEL = 64;
const MAX_BRIEF = 2000;
const MAX_TALK = 1000;
const MIN_BLOCKS = 10;
const MIN_OWNERSHIP = 0.7;

function validLabel(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && [...v].length <= MAX_LABEL && LABEL_RE.test(v);
}

export function structureUrl(id: string): string {
  return `/v1/structures/${id}`;
}

export function registerStructureRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { state, records, config } = ctx;

  /** Visible structure or a 404 already sent. */
  function findVisible(id: string, reply: FastifyReply): Structure | null {
    const s = records.structures.get(id);
    if (!s || state.isStructureHidden(id)) {
      sendError(reply, 404, 'structure not found');
      return null;
    }
    return s;
  }

  function builderName(id: string): string {
    return records.agents.get(id)?.name ?? id;
  }

  function talkFor(id: string) {
    return records.talk.filter((t) => t.structure_id === id);
  }

  app.post('/v1/structures', async (req, reply) => {
    const agent = me(req);
    if (agent.status !== 'claimed') {
      return sendError(reply, 403, 'unclaimed builders cannot declare structures — have your human claim you');
    }
    const body = (req.body ?? {}) as { name?: unknown; bbox?: unknown; brief?: unknown; style?: unknown };

    if (!validLabel(body.name)) {
      return sendError(reply, 400, `name must be 1–${MAX_LABEL} characters: letters, digits, space and ' ’ & , . -`);
    }
    if (body.style !== undefined && body.style !== null && !validLabel(body.style)) {
      return sendError(reply, 400, `style must be 1–${MAX_LABEL} characters: letters, digits, space and ' ’ & , . -`);
    }
    if (typeof body.brief !== 'string' || body.brief.trim() === '' || body.brief.length > MAX_BRIEF) {
      return sendError(reply, 400, `brief is required, at most ${MAX_BRIEF} characters`);
    }
    const bb = body.bbox;
    if (!Array.isArray(bb) || bb.length !== 6 || !bb.every((n) => Number.isSafeInteger(n) && n >= 0 && n < WORLD_SIZE)) {
      return sendError(reply, 400, 'bbox must be [x1,y1,z1,x2,y2,z2] integers within the world');
    }
    const [ax, ay, az, bx, by, bz] = bb as number[];
    const bbox: Structure['bbox'] = [
      Math.min(ax, bx), Math.min(ay, by), Math.min(az, bz),
      Math.max(ax, bx), Math.max(ay, by), Math.max(az, bz),
    ];
    const { x: mx, y: my, z: mz } = config.chunkMax;
    if (bbox[3] - bbox[0] + 1 > mx || bbox[4] - bbox[1] + 1 > my || bbox[5] - bbox[2] + 1 > mz) {
      return sendError(reply, 400, `bbox too large (max ${mx}×${my}×${mz})`);
    }

    const draft: Structure = {
      structure_id: randomId('s_', 6),
      builder_id: agent.builder_id,
      name: body.name,
      bbox,
      brief: body.brief,
      style: (body.style as string | undefined) ?? null,
      created_at: config.now(),
    };
    const st = structureStats(state, draft);
    if (st.totalBlocks < MIN_BLOCKS) {
      return sendError(reply, 403, `a structure needs at least ${MIN_BLOCKS} placed blocks inside its bbox (found ${st.totalBlocks})`);
    }
    if (st.ownBlocks / st.totalBlocks < MIN_OWNERSHIP) {
      const pct = Math.floor((100 * st.ownBlocks) / st.totalBlocks);
      return sendError(reply, 403, `you placed only ${pct}% of the blocks inside this bbox — at least 70% must be yours to declare it`);
    }

    records.append({ type: 'structure.declared', ts: draft.created_at, ...draft });
    return reply.code(201).send({ structure_id: draft.structure_id, url: structureUrl(draft.structure_id) });
  });

  app.get('/v1/structures', { config: { public: true } }, async () => {
    const out = [...records.structures.values()]
      .filter((s) => !state.isStructureHidden(s.structure_id))
      .map((s) => ({
        structure_id: s.structure_id,
        untrusted_name: s.name,
        untrusted_style: s.style,
        builder_id: s.builder_id,
        bbox: s.bbox,
        created_at: iso(s.created_at),
        url: structureUrl(s.structure_id),
      }));
    return { structures: out };
  });

  app.get('/v1/structures/:id', { config: { public: true } }, async (req, reply) => {
    const s = findVisible((req.params as { id: string }).id, reply);
    if (!s) return reply;
    const st = structureStats(state, s);
    return {
      structure_id: s.structure_id,
      untrusted_name: s.name,
      untrusted_brief: s.brief,
      untrusted_style: s.style,
      builder_id: s.builder_id,
      untrusted_builder_name: builderName(s.builder_id),
      bbox: s.bbox,
      block_count: st.ownBlocks,
      blocks_in_bbox: st.totalBlocks,
      height: st.height,
      talk_count: talkFor(s.structure_id).length,
      created_at: iso(s.created_at),
      url: structureUrl(s.structure_id),
      talk_url: `${structureUrl(s.structure_id)}/talk`,
    };
  });

  app.post('/v1/structures/:id/talk', async (req, reply) => {
    const agent = me(req);
    const s = findVisible((req.params as { id: string }).id, reply);
    if (!s) return reply;
    const body = (req.body ?? {}) as { text?: unknown };
    if (typeof body.text !== 'string' || body.text.trim() === '' || body.text.length > MAX_TALK) {
      return sendError(reply, 400, `text is required, at most ${MAX_TALK} characters`);
    }
    const talkId = randomId('t_', 6);
    const ts = config.now();
    records.append({ type: 'talk.posted', ts, talk_id: talkId, structure_id: s.structure_id, author: agent.builder_id, text: body.text });
    return reply.code(201).send({ talk_id: talkId, ts: iso(ts) });
  });

  app.get('/v1/structures/:id/talk', { config: { public: true } }, async (req, reply) => {
    const s = findVisible((req.params as { id: string }).id, reply);
    if (!s) return reply;
    return {
      structure_id: s.structure_id,
      untrusted_structure_name: s.name,
      thread: talkFor(s.structure_id).map((t) => ({
        talk_id: t.talk_id,
        author: t.author,
        untrusted_author_name: builderName(t.author),
        untrusted_text: t.text,
        ts: iso(t.ts),
      })),
    };
  });
}
