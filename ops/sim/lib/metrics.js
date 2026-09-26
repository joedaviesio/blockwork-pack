// Run-wide metrics aggregation and report rendering.
export class Metrics {
  constructor() {
    this.counters = Object.create(null);
    this.started = Date.now();
  }
  inc(key, n = 1) { this.counters[key] = (this.counters[key] || 0) + n; }
  addRejects(map) { for (const [code, n] of Object.entries(map || {})) this.inc(`rejects.${code}`, n); }
  get(key) { return this.counters[key] || 0; }

  finish(bots) {
    const seconds = (Date.now() - this.started) / 1000;
    let requests = 0, errors = 0, retries = 0;
    for (const b of bots) { requests += b.client.stats.requests; errors += b.client.stats.errors; retries += b.client.stats.retries; }
    const c = this.counters;
    const rejects = Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('rejects.')).map(([k, v]) => [k.slice(8), v]));
    const edicts = Object.fromEntries(Object.entries(rejects).filter(([k]) => /^EDICT/i.test(k)));
    const gapHit = c['responder.gapHit'] || 0, gapMiss = c['responder.gapMiss'] || 0;
    return {
      run: { seconds: +seconds.toFixed(1), bots: bots.length, requests, errors, retries, rps: +(requests / Math.max(seconds, 1)).toFixed(1) },
      onboarding: { registered: c.registered || 0, registerFailed: c.registerFailed || 0, claimed: c.claimed || 0, claimFailed: c.claimFailed || 0 },
      building: {
        blocksAccepted: c.blocksAccepted || 0, blocksRejected: Object.values(rejects).reduce((s, n) => s + n, 0),
        overwrites: c.overwrites || 0, rejectsByReason: rejects, edictCodesSeen: edicts,
        buildCalls: c.buildCalls || 0,
      },
      social: {
        structuresDeclared: c.structuresDeclared || 0, declareRejected: c.declareRejected || 0,
        distinctStyles: c.__styles ? c.__styles.size : 0,
        talkPosts: c.talkPosts || 0, talkUnsupported: c.talkUnsupported || 0,
        inboxChecks: c.inboxChecks || 0, summaryReads: c.summaryReads || 0,
      },
      thesis: {
        responderGapHit: gapHit, responderGapMiss: gapMiss,
        gapResponseRate: gapHit + gapMiss > 0 ? +(gapHit / (gapHit + gapMiss)).toFixed(2) : null,
      },
      personas: Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('persona.')).map(([k, v]) => [k.slice(8), v])),
    };
  }

  noteStyle(style) {
    if (!this.counters.__styles) this.counters.__styles = new Set();
    this.counters.__styles.add(style);
  }
}

export function renderReport(m, opts) {
  const t = m.thesis, b = m.building, s = m.social, o = m.onboarding;
  const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
  const lines = [
    `# Blockwork sim run — ${new Date().toISOString()}`,
    ``,
    `**${m.run.bots} bots · seed ${opts.seed} · ${m.run.seconds}s · ${m.run.requests} requests (${m.run.rps} rps) · ${m.run.errors} non-2xx responses (incl. expected contract rejections) · ${m.run.retries} retries**`,
    ``,
    `## Onboarding`,
    `- Registered: ${o.registered}/${m.run.bots} (${o.registerFailed} failed) · Claimed: ${o.claimed} (${o.claimFailed} failed)`,
    ``,
    `## Building`,
    `- Blocks accepted: ${b.blocksAccepted} across ${b.buildCalls} build calls · rejected: ${b.blocksRejected} · overwrites flagged: ${b.overwrites}`,
    `- Rejections by reason: ${JSON.stringify(b.rejectsByReason)}`,
    `- Latent edict codes collected: ${JSON.stringify(b.edictCodesSeen)}`,
    ``,
    `## Social layer`,
    `- Structures declared: ${s.structuresDeclared} (${s.declareRejected} rejected) · distinct styles: ${s.distinctStyles}`,
    `- Talk posts: ${s.talkPosts}${s.talkUnsupported ? ` (talk endpoint unsupported: ${s.talkUnsupported} attempts skipped)` : ''}`,
    `- Region-summary reads: ${s.summaryReads} · inbox checks: ${s.inboxChecks}`,
    ``,
    `## PLAN §3½ signals (sim analogues)`,
    `- **Gap-response rate (target ≥40%):** ${pct(t.gapResponseRate)} — responder bots that found a muse-named gap and built into it (${t.responderGapHit} hit / ${t.responderGapMiss} fell back).`,
    `- **Distinct styles (movement formation):** ${s.distinctStyles} named styles emerged from ${m.run.bots} bots.`,
    `- **Dispute raw material:** ${b.overwrites} overwrites + ${b.blocksRejected} rejections — enough friction to argue about; talk pages carried ${s.talkPosts} posts.`,
    `- Organic-claim and digest-return metrics don't apply in sim (all bots claim by script; no humans present).`,
    ``,
    `## Verdict heuristics`,
    `- Server stayed up: ${m.run.errors === 0 ? 'clean run, no non-2xx responses' : `${m.run.errors} non-2xx responses across ${m.run.requests} requests (${pct(m.run.errors / m.run.requests)}) — includes expected 4xx contract rejections`}.`,
    `- Personas: ${JSON.stringify(m.personas)}`,
  ];
  return lines.join('\n') + '\n';
}
