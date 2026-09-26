#!/usr/bin/env node
// Blockwork LLM-bot runner: real model-driven agents whose only guidance is skill.md.
// Usage:
//   node run.js --provider anthropic --model claude-haiku-4-5 --bots 12 --heartbeats 4
//   node run.js --provider ollama --model qwen3.8:27b --bots 6 --hours 9
// Anthropic auth: ANTHROPIC_API_KEY env or --key-file <path>.
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = {
    provider: 'anthropic', model: null, bots: 4, heartbeats: 3, hours: null,
    base: 'http://localhost:8111', out: null, concurrency: null, keyFile: null,
    maxCallsPerHeartbeat: 25, maxModelCalls: 6000, maxTokensPerCall: 1500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') o.provider = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--bots') o.bots = parseInt(argv[++i], 10);
    else if (a === '--heartbeats') o.heartbeats = parseInt(argv[++i], 10);
    else if (a === '--hours') o.hours = parseFloat(argv[++i]);
    else if (a === '--base') o.base = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--concurrency') o.concurrency = parseInt(argv[++i], 10);
    else if (a === '--key-file') o.keyFile = argv[++i];
    else if (a === '--max-model-calls') o.maxModelCalls = parseInt(argv[++i], 10);
    else if (a === '--hb-min') o.hbMin = parseInt(argv[++i], 10); // heartbeat gap floor, seconds
    else if (a === '--hb-max') o.hbMax = parseInt(argv[++i], 10);
    else if (a === '--num-ctx') o.numCtx = parseInt(argv[++i], 10);
  }
  o.model ??= o.provider === 'ollama' ? 'qwen3.8:27b' : 'claude-haiku-4-5';
  o.concurrency ??= o.provider === 'ollama' ? 3 : 6;
  o.hbMin ??= o.hours ? 120 : 15;
  o.hbMax ??= o.hours ? 420 : 45;
  o.numCtx ??= 12288;
  return o;
}

// ---------- model providers ----------

async function makeAnthropic(opts) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && opts.keyFile) apiKey = (await readFile(opts.keyFile, 'utf8')).trim();
  if (!apiKey) throw new Error('No Anthropic credentials: set ANTHROPIC_API_KEY or pass --key-file <path>.');
  const client = new Anthropic({ apiKey });
  return async function callModel(system, messages) {
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokensPerCall,
      // skill.md is a large stable prefix — cache it.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const u = res.usage ?? {};
    return { text, tokensIn: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), tokensOut: u.output_tokens ?? 0 };
  };
}

function makeOllama(opts) {
  return async function callModel(system, messages) {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model, stream: false,
        messages: [{ role: 'system', content: system }, ...messages],
        options: { temperature: 0.8, num_ctx: opts.numCtx, num_predict: opts.maxTokensPerCall },
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    // qwen3-family models may emit <think>…</think>; strip before parsing.
    const text = String(data.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return { text, tokensIn: data.prompt_eval_count ?? 0, tokensOut: data.eval_count ?? 0 };
  };
}

// ---------- harness ----------

const PROTOCOL = `
[HARNESS NOTE — how you act]
You are an autonomous agent joining Blockwork. The document below (skill.md) is your only guide to the world.
You act by replying with EXACTLY ONE JSON object per turn, nothing else (no prose outside the JSON):
  {"action":"http","method":"GET"|"POST","path":"/v1/…","body":{…}}   — make an API call (path only; the harness knows the host)
  {"action":"note","text":"…"}                                        — record a private thought/plan (logged, costs a turn)
  {"action":"sleep"}                                                  — end this heartbeat; you'll wake on the next one
The next user message after an http action is the JSON response: {"status":…,"body":…}.
Sandbox notes: you have no human present, and the claim endpoint here accepts any public-looking URL — when skill.md
says to have your human post a code, instead claim yourself with {"proof_url":"https://gist.github.com/sandbox/<your-builder-name>"}.
The harness stores your api_key and attaches it to your requests automatically after you register.
Choose your own builder name and identity. Build well — the world remembers.
`;

function extractAction(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  // Walk to the matching close brace so trailing prose doesn't break parsing.
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = inStr; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(candidate.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async run(fn) {
    if (this.n <= 0) await new Promise((r) => this.q.push(r));
    else this.n--;
    try { return await fn(); } finally { const next = this.q.shift(); if (next) next(); else this.n++; }
  }
}

async function httpAction(base, act, bot) {
  const method = String(act.method ?? 'GET').toUpperCase();
  const p = String(act.path ?? '/');
  if (!p.startsWith('/')) return { status: 0, body: { error: 'path must start with /' } };
  const headers = { 'content-type': 'application/json' };
  if (bot.apiKey) headers.authorization = `Bearer ${bot.apiKey}`;
  let res;
  try {
    res = await fetch(base + p, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(act.body ?? {}), signal: AbortSignal.timeout(20000) });
  } catch (e) { return { status: 0, body: { error: String(e.message ?? e) } }; }
  let body; const raw = await res.text();
  try { body = JSON.parse(raw); } catch { body = raw.slice(0, 2000); }
  // Capture credentials from a successful registration.
  if (p.includes('/agents/register') && res.ok && body?.api_key) {
    bot.apiKey = body.api_key; bot.builderId = body.builder_id ?? null;
  }
  return { status: res.status, body };
}

function tally(bot, act, resp, m) {
  m.httpCalls++;
  const p = String(act.path ?? '');
  if (p.includes('/build') && resp.body?.summary) {
    m.blocksPlaced += resp.body.summary.placed ?? 0;
    m.blocksRejected += resp.body.summary.rejected ?? 0;
    for (const r of resp.body.results ?? []) if (r?.edict) m.edicts[r.edict] = (m.edicts[r.edict] || 0) + 1;
  } else if (p.includes('/structures') && p.includes('/talk') && act.method?.toUpperCase() === 'POST' && resp.status < 300) m.talkPosts++;
  else if (p.includes('/structures') && act.method?.toUpperCase() === 'POST' && resp.status < 300) { m.structures++; if (act.body?.style) m.styles.add(String(act.body.style)); }
  else if (p.includes('/region/summary')) m.museReads++;
  else if (p.includes('/agents/register') && resp.status < 300) m.registered++;
  else if (p.includes('/agents/claim') && resp.status < 300) m.claimed++;
}

async function runBot(bot, ctx) {
  const { opts, callModel, sem, metrics, outDir, skill } = ctx;
  const system = PROTOCOL + '\n\n' + skill;
  const transcript = path.join(outDir, 'transcripts', `${bot.name}.jsonl`);
  const log = (entry) => appendFile(transcript, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n').catch(() => {});
  let messages = [{ role: 'user', content: 'You just arrived. The world API is live. Begin.' }];

  const trim = () => {
    if (messages.length <= 26) return;
    const pin = { role: 'user', content: `[HARNESS MEMORY] You are already registered: builder_id=${bot.builderId ?? 'unknown'}; your api_key is stored and auto-attached. Earlier turns were trimmed. Continue from your current situation.` };
    messages = [pin, ...messages.slice(-20)];
    if (messages[1]?.role === 'user') messages.splice(1, 1); // keep roles alternating after the pin
  };

  const untilHb = opts.hours ? Infinity : opts.heartbeats;
  for (let hb = 0; hb < untilHb; hb++) {
    if (Date.now() > ctx.deadline || metrics.modelCalls >= opts.maxModelCalls) break;
    if (hb > 0) {
      messages.push({ role: 'user', content: `[HEARTBEAT ${hb + 1}] You wake up. Check what changed near your builds (inbox, region summary) and act if you have something to add — skill.md's heartbeat etiquette applies. Reply with one JSON action.` });
    }
    let badParses = 0;
    for (let turn = 0; turn < opts.maxCallsPerHeartbeat; turn++) {
      if (Date.now() > ctx.deadline || metrics.modelCalls >= opts.maxModelCalls) break;
      trim();
      let out;
      try {
        out = await sem.run(() => callModel(system, messages));
      } catch (e) {
        log({ kind: 'model-error', error: String(e.message ?? e) });
        metrics.modelErrors++;
        await sleep(5000);
        continue;
      }
      metrics.modelCalls++; metrics.tokensIn += out.tokensIn; metrics.tokensOut += out.tokensOut;
      messages.push({ role: 'assistant', content: out.text });
      log({ kind: 'model', text: out.text });
      const act = extractAction(out.text);
      if (!act || typeof act.action !== 'string') {
        if (++badParses > 2) break;
        messages.push({ role: 'user', content: 'Could not parse that. Reply with exactly one JSON object per the harness note.' });
        continue;
      }
      if (act.action === 'sleep') break;
      if (act.action === 'note') { messages.push({ role: 'user', content: '(noted)' }); continue; }
      if (act.action === 'http') {
        const resp = await httpAction(opts.base, act, bot);
        tally(bot, act, resp, metrics);
        log({ kind: 'http', method: act.method, path: act.path, status: resp.status });
        messages.push({ role: 'user', content: JSON.stringify(resp).slice(0, 6000) });
        continue;
      }
      messages.push({ role: 'user', content: `Unknown action "${act.action}". Use http, note, or sleep.` });
    }
    const gap = (opts.hbMin + Math.random() * Math.max(opts.hbMax - opts.hbMin, 1)) * 1000;
    if (hb + 1 < untilHb && Date.now() + gap < ctx.deadline) await sleep(gap); else if (opts.hours && Date.now() + gap < ctx.deadline) await sleep(gap); else if (opts.hours) break;
  }
  log({ kind: 'done', builderId: bot.builderId });
}

function renderReport(m, opts, started) {
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  return [
    `# Blockwork LLM run — ${new Date(started).toISOString()}`,
    '',
    `**provider ${opts.provider} · model ${opts.model} · ${opts.bots} bots · ${mins} min elapsed**`,
    '',
    `- Model calls: ${m.modelCalls} (${m.modelErrors} errors) · tokens in/out: ${m.tokensIn}/${m.tokensOut}`,
    `- HTTP calls: ${m.httpCalls} · registered: ${m.registered} · claimed: ${m.claimed}`,
    `- Blocks placed: ${m.blocksPlaced} · rejected: ${m.blocksRejected}`,
    `- Structures declared: ${m.structures} · styles: ${m.styles.size ? [...m.styles].join(', ') : 0} · talk posts: ${m.talkPosts} · muse reads: ${m.museReads}`,
    `- Edict codes collected: ${JSON.stringify(m.edicts)}`,
    '',
    `Transcripts (the culture evidence) are in ./transcripts/ — one JSONL per bot.`,
  ].join('\n');
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const skill = await readFile(path.join(here, '..', '..', '..', 'skill', 'skill.md'), 'utf8');
  const meta = await fetch(`${opts.base}/v1/world/meta`).then((r) => r.ok).catch(() => false);
  if (!meta) throw new Error(`World server unreachable at ${opts.base} — start it first.`);
  const callModel = opts.provider === 'ollama' ? makeOllama(opts) : await makeAnthropic(opts);

  const started = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = opts.out ? path.resolve(here, opts.out) : path.join(here, 'reports', stamp);
  await mkdir(path.join(outDir, 'transcripts'), { recursive: true });
  const metrics = { modelCalls: 0, modelErrors: 0, tokensIn: 0, tokensOut: 0, httpCalls: 0, registered: 0, claimed: 0, blocksPlaced: 0, blocksRejected: 0, structures: 0, styles: new Set(), talkPosts: 0, museReads: 0, edicts: {} };
  const ctx = {
    opts, callModel, metrics, outDir, skill,
    sem: new Semaphore(opts.concurrency),
    deadline: started + (opts.hours ? opts.hours * 3600_000 : 24 * 3600_000),
  };
  const checkpoint = setInterval(() => {
    writeFile(path.join(outDir, 'report.md'), renderReport(metrics, opts, started)).catch(() => {});
  }, 5 * 60_000);

  const bots = Array.from({ length: opts.bots }, (_, i) => ({ i, name: `llm-${opts.provider}-${i}`, apiKey: null, builderId: null }));
  await Promise.all(bots.map(async (b, i) => { await sleep(i * (opts.provider === 'ollama' ? 3000 : 800)); await runBot(b, ctx).catch((e) => appendFile(path.join(outDir, 'transcripts', `${b.name}.jsonl`), JSON.stringify({ kind: 'fatal', error: String(e) }) + '\n')); }));

  clearInterval(checkpoint);
  const report = renderReport(metrics, opts, started);
  await writeFile(path.join(outDir, 'report.md'), report);
  await writeFile(path.join(outDir, 'metrics.json'), JSON.stringify({ ...metrics, styles: [...metrics.styles] }, null, 2));
  console.log(report);
  console.log(`\n[llm] report: ${outDir}/report.md`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(`[llm] ${e.message}`); process.exitCode = 1; });
}
