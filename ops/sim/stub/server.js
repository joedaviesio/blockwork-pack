// TEST STUB — NOT the product server. An in-memory double of the skill.md contract,
// used only so the sim harness can be unit-tested without /server running.
// Mirrors the amended-PLAN semantics: non-atomic batches, per-op results, overwrote flag,
// protect_existing, height envelope 64, EDICT fixture zone, quota, >=70% structure ownership.
import http from 'node:http';

const HEIGHT_LIMIT = 64;
const QUOTA = 6000;
const EDICT_ZONE = { x0: 600, z0: 600, x1: 640, z1: 640, code: 'EDICT-7' };
const PALETTE = ['stone', 'dirt', 'grass', 'water', 'wood', 'leaves', 'glass', 'metal', 'light', 'obsidian', 'snow', 'brick', 'gold', 'moss']; // no sand on founding island

export function startStub(port = 0) {
  const builders = new Map(); // key -> {id, name, claimed, used}
  const blocks = new Map();   // "x,y,z" -> {block, builder}
  const events = [];
  const structures = [];
  const talks = new Map();    // structureId -> [{builder, message}]
  const idem = new Map();     // builderId:key -> response

  const auth = (req) => builders.get((req.headers.authorization || '').replace(/^Bearer /, '')) || null;
  const json = (res, code, body) => {
    const s = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(s);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    let data = {};
    try { data = body ? JSON.parse(body) : {}; } catch { return json(res, 400, { error: 'bad json' }); }
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /v1/world/meta') {
      return json(res, 200, { size: 2048, habitable_bbox: [300, 300, 700, 700], height_limit: HEIGHT_LIMIT, palette: PALETTE.map((name) => ({ name, available: true, emissive: name === 'light' ? 'strong' : name === 'gold' ? 'faint' : false })) });
    }
    if (route === 'POST /v1/agents/register') {
      const id = String(data.name || 'anon').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) + '-' + (builders.size + 1);
      const key = 'bw_stub_' + Math.random().toString(36).slice(2);
      builders.set(key, { id, name: String(data.name || 'anon').slice(0, 64), claimed: false, used: 0 });
      return json(res, 200, { api_key: key, builder_id: id, claim_url: `http://stub/claim/${id}`, verification_code: `stub-${id}`, status: 'unclaimed' });
    }
    const b = auth(req);
    if (!b) return json(res, 401, { error: 'unauthorized' });

    if (route === 'POST /v1/agents/claim') { b.claimed = true; return json(res, 200, { status: 'claimed' }); }
    if (route === 'GET /v1/agents/me/inbox') return json(res, 200, { platform_notices: [], untrusted_mentions: (talks.get('__mentions:' + b.id) || []) });

    if (route === 'GET /v1/region/summary') {
      const [x0, , z0, x1, , z1] = (url.searchParams.get('bbox') || '0,0,0,0,0,0').split(',').map(Number);
      let count = 0, tallest = 0, lights = 0, water = 0;
      for (const [k, v] of blocks) {
        const [x, y, z] = k.split(',').map(Number);
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) {
          count++; tallest = Math.max(tallest, y);
          if (v.block === 'light' || v.block === 'gold') lights++;
          if (v.block === 'water') water++;
        }
      }
      const gaps = [];
      if (tallest < 15) gaps.push('no tall landmark rises within this area');
      if (!lights) gaps.push('nothing here glows after dark');
      if (!water) gaps.push('no water, pond or pool anywhere nearby');
      if (count < 30) gaps.push('mostly free ground; no road or path connects anything');
      return json(res, 200, { text: `This area holds ${count} placed blocks; tallest point ${tallest}. Missing: ${gaps.join('; ')}.`, gaps, untrusted_briefs: structures.filter((s) => s.bbox[0] >= x0 - 50 && s.bbox[0] <= x1 + 50).map((s) => `⟦untrusted⟧${s.brief}⟦/untrusted⟧`) });
    }

    if (route === 'POST /v1/build') {
      const ops = Array.isArray(data.ops) ? data.ops.slice(0, 2048) : [];
      const ikey = data.idempotency_key ? `${b.id}:${data.idempotency_key}` : null;
      if (ikey && idem.has(ikey)) return json(res, 200, idem.get(ikey));
      const results = ops.map((op) => {
        const { x, y, z } = op;
        if (![x, y, z].every(Number.isInteger)) return { ok: false, code: 'BAD_COORDS' };
        if (b.used >= QUOTA) return { ok: false, code: 'QUOTA_EXCEEDED' };
        if (op.op === 'remove') {
          const k = `${x},${y},${z}`;
          const had = blocks.get(k);
          blocks.delete(k);
          events.push({ seq: events.length, builder: b.id, op: 'remove', blocks: [{ x, y, z }] });
          return { ok: true, removed: !!had };
        }
        if (y > HEIGHT_LIMIT) return { ok: false, code: 'HEIGHT_LIMIT', reason: `max build height is ${HEIGHT_LIMIT} above terrain` };
        if (x >= EDICT_ZONE.x0 && x <= EDICT_ZONE.x1 && z >= EDICT_ZONE.z0 && z <= EDICT_ZONE.z1) return { ok: false, code: EDICT_ZONE.code };
        if (!PALETTE.includes(op.block)) return { ok: false, code: 'UNKNOWN_MATERIAL' };
        const k = `${x},${y},${z}`;
        const prev = blocks.get(k);
        if (prev && data.protect_existing) return { ok: false, code: 'OCCUPIED' };
        blocks.set(k, { block: op.block, builder: b.id });
        b.used++;
        events.push({ seq: events.length, builder: b.id, op: 'place', blocks: [{ x, y, z, block: op.block }] });
        return { ok: true, ...(prev && prev.builder !== b.id ? { overwrote: true } : {}) };
      });
      const resp = { results, summary: { accepted: results.filter((r) => r.ok).length, rejected: results.filter((r) => !r.ok).length } };
      if (ikey) idem.set(ikey, resp);
      return json(res, 200, resp);
    }

    if (route === 'POST /v1/structures') {
      const bbox = data.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 6) return json(res, 400, { error: 'bad bbox' });
      let mine = 0, total = 0;
      for (const [k, v] of blocks) {
        const [x, y, z] = k.split(',').map(Number);
        if (x >= bbox[0] && x <= bbox[3] && y >= bbox[1] && y <= bbox[4] && z >= bbox[2] && z <= bbox[5]) { total++; if (v.builder === b.id) mine++; }
      }
      if (total < 10 || mine / total < 0.7) return json(res, 403, { error: 'OWNERSHIP', detail: `need >=70% of >=10 blocks; you own ${mine}/${total}` });
      const s = { id: structures.length + 1, name: String(data.name || '').slice(0, 64), style: data.style ? String(data.style).slice(0, 64) : undefined, brief: String(data.brief || '').slice(0, 2000), bbox, builder: b.id };
      structures.push(s);
      return json(res, 200, { id: s.id });
    }
    if (route === 'GET /v1/structures') {
      const q = url.searchParams.get('bbox');
      let list = structures;
      if (q) {
        const [x0, , z0, x1, , z1] = q.split(',').map(Number);
        list = structures.filter((s) => s.bbox[0] <= x1 && s.bbox[3] >= x0 && s.bbox[2] <= z1 && s.bbox[5] >= z0);
      }
      return json(res, 200, { structures: list.map((s) => ({ ...s, brief: `⟦untrusted⟧${s.brief}⟦/untrusted⟧` })) });
    }
    const talkMatch = url.pathname.match(/^\/v1\/structures\/(\d+)\/talk$/);
    if (talkMatch && req.method === 'POST') {
      const sid = Number(talkMatch[1]);
      const s = structures.find((x) => x.id === sid);
      if (!s) return json(res, 404, { error: 'no such structure' });
      const list = talks.get(sid) || [];
      list.push({ builder: b.id, message: String(data.message || '').slice(0, 500) });
      talks.set(sid, list);
      const mentions = talks.get('__mentions:' + s.builder) || [];
      mentions.push(`⟦untrusted⟧${b.id}: ${String(data.message || '').slice(0, 200)}⟦/untrusted⟧`);
      talks.set('__mentions:' + s.builder, mentions);
      return json(res, 200, { ok: true });
    }
    if (route === 'GET /v1/events') {
      const since = Number(url.searchParams.get('since') || 0);
      return json(res, 200, { events: events.slice(since, since + 2000), next: Math.min(since + 2000, events.length) });
    }
    if (route === 'GET /v1/chunks') {
      const cubes = [...blocks.entries()].map(([k, v]) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z, block: v.block, builder: v.builder }; });
      return json(res, 200, { cubes });
    }
    return json(res, 404, { error: `no route ${route}` });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, state: { builders, blocks, events, structures, talks } }));
  });
}

if (process.argv[1] && process.argv[1].endsWith('stub/server.js')) {
  const { port } = await startStub(Number(process.env.PORT || 8199));
  console.log(`[stub] contract test double listening on http://127.0.0.1:${port} (NOT the product server)`);
}
