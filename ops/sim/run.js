#!/usr/bin/env node
// Blockwork agent-sim harness. Usage:
//   node run.js --bots 100 --base http://localhost:8111 --seed 42 --minutes 5
//   node run.js --bots 5 --smoke
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client, parseBuildResults } from './lib/client.js';
import { makeRng, hashSeed } from './lib/rng.js';
import { PERSONAS, personaWeights } from './lib/personas.js';
import { Metrics, renderReport } from './lib/metrics.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseArgs(argv) {
  const opts = { bots: 100, base: 'http://localhost:8111', seed: 42, minutes: 5, smoke: false, area: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bots') opts.bots = parseInt(argv[++i], 10);
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--seed') opts.seed = parseInt(argv[++i], 10);
    else if (a === '--minutes') opts.minutes = parseFloat(argv[++i]);
    else if (a === '--smoke') opts.smoke = true;
    else if (a === '--area') opts.area = argv[++i].split(',').map(Number);
    else if (a === '--edict-hint') opts.edictHint = argv[++i].split(',').map(Number); // "rumored district" [x1,z1,x2,z2] — stands in for talk-page lore concentrating probes
    else if (a === '--out') opts.out = argv[++i];
  }
  if (opts.smoke) { if (!argv.includes('--bots')) opts.bots = 5; if (!argv.includes('--minutes')) opts.minutes = 0.75; }
  return opts;
}

function deriveArea(meta, opts) {
  if (opts.area?.length === 4) return opts.area;
  const hb = meta?.habitable_bbox ?? meta?.habitable ?? meta?.spawn_area;
  if (Array.isArray(hb)) {
    if (hb.length === 4) return hb;
    if (hb.length === 6) return [hb[0], hb[2], hb[3], hb[5]];
  }
  return [300, 300, 700, 700];
}

function deriveMaterials(meta) {
  const pal = meta?.palette ?? meta?.materials;
  if (!Array.isArray(pal)) return null;
  if (typeof pal[0] === 'string') return pal;
  return pal.filter((p) => p && p.available !== false && p.available_here !== false).map((p) => p.name ?? p.type).filter(Boolean);
}

function assignBots(opts, area) {
  const master = makeRng(opts.seed);
  const weights = personaWeights();
  const [ax0, az0, ax1, az1] = area;
  const cols = Math.ceil(Math.sqrt(opts.bots));
  const cw = Math.max((ax1 - ax0) / cols, 8), ch = Math.max((az1 - az0) / cols, 8);
  const bots = [];
  for (let i = 0; i < opts.bots; i++) {
    const rng = makeRng(hashSeed(opts.seed, i));
    const persona = master.weighted(weights);
    const col = i % cols, row = Math.floor(i / cols);
    const jx = rng.int(-Math.min(6, cw / 4), Math.min(6, cw / 4));
    const jz = rng.int(-Math.min(6, ch / 4), Math.min(6, ch / 4));
    bots.push({
      i, persona, rng,
      name: `${persona}-${i}-s${opts.seed}`,
      home: { x: Math.round(ax0 + cw * (col + 0.5) + jx), z: Math.round(az0 + ch * (row + 0.5) + jz) },
      heartbeatMs: rng.int(2500, 6000),
      transcript: [], sim: {},
    });
  }
  return bots;
}

async function runBot(bot, opts, ctx, metrics) {
  bot.client = new Client(opts.base);
  bot.metrics = metrics;
  const reg = await bot.client.register(bot.name, `Sim persona: ${bot.persona}. Part of a sandbox load/behaviour test.`);
  if (!reg.ok || !reg.data?.api_key) {
    metrics.inc('registerFailed');
    bot.transcript.push({ t: new Date().toISOString(), action: 'register-failed', detail: { status: reg.status } });
    return;
  }
  metrics.inc('registered');
  bot.client.key = reg.data.api_key;
  bot.builderId = reg.data.builder_id ?? bot.name.toLowerCase();
  bot.transcript.push({ t: new Date().toISOString(), action: 'registered', detail: { builderId: bot.builderId } });

  if (bot.persona !== 'idler' || bot.rng.chance(0.5)) {
    const claim = await bot.client.claim(`https://gist.github.com/simhuman/${bot.builderId}`);
    if (claim.ok) metrics.inc('claimed'); else metrics.inc('claimFailed');
  }
  bot.availableMats = ctx.materials;
  metrics.inc(`persona.${bot.persona}`);
  try {
    await PERSONAS[bot.persona].run(bot, ctx);
  } catch (err) {
    metrics.inc('botCrashes'); // personas shouldn't throw; this is a harness bug signal, not a bot outcome
    bot.transcript.push({ t: new Date().toISOString(), action: 'crash', detail: String(err?.stack || err) });
  }
}

export async function runSim(opts) {
  const probe = new Client(opts.base);
  const meta = await probe.meta();
  if (!meta.ok) {
    throw new Error(`Server unreachable at ${opts.base} (GET /v1/world/meta -> ${meta.status} ${meta.error ?? ''}). Start the server first.`);
  }
  const area = deriveArea(meta.data, opts);
  const materials = deriveMaterials(meta.data);
  const bots = assignBots(opts, area);
  const metrics = new Metrics();
  const ctx = { deadline: Date.now() + opts.minutes * 60_000, area, materials, edictHint: opts.edictHint?.length === 4 ? opts.edictHint : null };

  const tasks = bots.map(async (bot) => { await sleep(bot.i * 35); await runBot(bot, opts, ctx, metrics); });
  await Promise.all(tasks);

  const summary = metrics.finish(bots);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = opts.out ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'reports', stamp);
  await mkdir(path.join(outDir, 'transcripts'), { recursive: true });
  await writeFile(path.join(outDir, 'metrics.json'), JSON.stringify({ opts: { ...opts }, area, materials, summary, assignments: bots.map((b) => ({ i: b.i, persona: b.persona, home: b.home })) }, (k, v) => (v instanceof Set ? [...v] : v), 2));
  await writeFile(path.join(outDir, 'report.md'), renderReport(summary, opts));
  const seen = new Set();
  for (const b of bots) {
    if (seen.has(b.persona) || seen.size >= 6) continue;
    seen.add(b.persona);
    await writeFile(path.join(outDir, 'transcripts', `${b.name}.json`), JSON.stringify(b.transcript, null, 2));
  }
  return { summary, outDir, assignments: bots.map((b) => b.persona) };
}

async function contractSmoke(opts) {
  const checks = [];
  const ok = (name, cond, extra = '') => { checks.push({ name, pass: !!cond, extra }); return cond; };
  const c = new Client(opts.base);
  const meta = await c.meta();
  ok('GET /v1/world/meta', meta.ok);
  const reg = await c.register('smoke-check', 'contract smoke test');
  if (ok('POST /v1/agents/register returns api_key', reg.ok && reg.data?.api_key)) c.key = reg.data.api_key;
  const claim = await c.claim('https://gist.github.com/simhuman/smoke');
  ok('POST /v1/agents/claim', claim.ok);
  const area = deriveArea(meta.data, opts);
  const cx = Math.round((area[0] + area[2]) / 2) + 3, cz = Math.round((area[1] + area[3]) / 2) + 3;
  const sum = await c.summary([cx - 30, 0, cz - 30, cx + 30, 80, cz + 30]);
  ok('GET /v1/region/summary', sum.ok);
  const ops = [];
  for (let i = 0; i < 12; i++) ops.push({ op: 'place', x: cx + (i % 4), y: Math.floor(i / 4), z: cz, block: 'stone' });
  const build = await c.build(ops);
  const parsed = parseBuildResults(build.data);
  ok('POST /v1/build accepts ops (per-op results)', build.ok && parsed.accepted >= 10, `accepted=${parsed.accepted}`);
  const idem = await c.build(ops, { key: '00000000-0000-4000-8000-00000000feed' });
  const idem2 = await c.build(ops, { key: '00000000-0000-4000-8000-00000000feed' });
  ok('idempotency key replays', idem.ok && idem2.ok);
  const decl = await c.declare({ name: 'Smoke Obelisk', bbox: [cx, 0, cz, cx + 3, 2, cz], brief: 'contract smoke' });
  ok('POST /v1/structures (>=70% ownership)', decl.ok, `status=${decl.status}`);
  const ev = await c.events(0);
  ok('GET /v1/events?since=0', ev.ok);
  const inbox = await c.inbox();
  ok('GET /v1/agents/me/inbox', inbox.ok);
  return checks;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  process.on('unhandledRejection', (e) => console.error('[sim] unhandled rejection:', e));
  try {
    const { summary, outDir } = await runSim(opts);
    console.log(`\n[sim] done: ${summary.run.bots} bots, ${summary.building.blocksAccepted} blocks accepted, ` +
      `${summary.social.structuresDeclared} structures, ${summary.social.distinctStyles} styles, ` +
      `gap-response ${summary.thesis.gapResponseRate ?? 'n/a'}\n[sim] report: ${outDir}/report.md`);
    if (opts.smoke) {
      console.log('\n[smoke] contract checks:');
      const checks = await contractSmoke(opts);
      for (const ch of checks) console.log(`  ${ch.pass ? 'PASS' : 'FAIL'}  ${ch.name} ${ch.extra}`);
      if (checks.some((ch) => !ch.pass)) process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[sim] ${err.message}`);
    process.exitCode = 1;
  }
}
