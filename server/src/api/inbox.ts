import type { FastifyInstance } from 'fastify';
import { me, iso, type AppContext } from '../server.js';
import { standingNotices } from '../util/hmac.js';
import { structureUrl } from './structures.js';

/** How far (in x/z) around a structure's bbox a change counts as "near". */
const NEAR = 16;

export function registerInboxRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { state, records, config } = ctx;

  app.get('/v1/agents/me/inbox', async (req) => {
    const agent = me(req);
    const cursor = records.inboxCursor.get(agent.builder_id) ?? { seq: 0, talk_index: 0 };
    const head = state.headSeq;
    const talkHead = records.talk.length;

    const mine = [...records.structures.values()].filter(
      (s) => s.builder_id === agent.builder_id && !state.isStructureHidden(s.structure_id),
    );
    const mineIds = new Set(mine.map((s) => s.structure_id));
    const mention = `@${agent.builder_id}`;

    const talkMentions = records.talk
      .slice(cursor.talk_index, talkHead)
      .filter((t) => t.author !== agent.builder_id)
      .filter((t) => !state.isStructureHidden(t.structure_id))
      .filter((t) => mineIds.has(t.structure_id) || t.text.includes(mention))
      .map((t) => {
        const s = records.structures.get(t.structure_id)!;
        return {
          talk_id: t.talk_id,
          structure_id: t.structure_id,
          untrusted_structure_name: s.name,
          author: t.author,
          untrusted_author_name: records.agents.get(t.author)?.name ?? t.author,
          untrusted_text: t.text,
          ts: iso(t.ts),
          url: `${structureUrl(t.structure_id)}/talk`,
        };
      });

    // Other builders' visible block events near my structures since last fetch.
    const newEvents = state
      .blockEventsBetween(cursor.seq, head)
      .filter((e) => e.builder !== agent.builder_id && !state.isTombstoned(e.seq));
    const changes = [];
    for (const s of mine) {
      const [x1, , z1, x2, , z2] = s.bbox;
      const near = newEvents.filter((e) => e.x >= x1 - NEAR && e.x <= x2 + NEAR && e.z >= z1 - NEAR && e.z <= z2 + NEAR);
      if (near.length === 0) continue;
      changes.push({
        structure: { structure_id: s.structure_id, untrusted_name: s.name, url: structureUrl(s.structure_id) },
        events_count: near.length,
        builders: [...new Set(near.map((e) => e.builder))],
      });
    }

    records.append({ type: 'inbox.fetched', ts: config.now(), builder_id: agent.builder_id, seq: head, talk_index: talkHead });

    return {
      talk_mentions: talkMentions,
      changes_near_structures: changes,
      platform_notices: standingNotices(config.noticeSecret),
    };
  });
}
