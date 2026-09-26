// Minimal Blockwork API client per skill.md. Zero deps; global fetch (Node >= 20).
// Never throws to callers: every method resolves {ok, status, data, error?}.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Client {
  constructor(base, { timeoutMs = 10000 } = {}) {
    this.base = String(base).replace(/\/$/, '');
    this.key = null;
    this.timeoutMs = timeoutMs;
    this.stats = { requests: 0, errors: 0, retries: 0, byStatus: {} };
  }

  async req(method, path, body, { retries = 3 } = {}) {
    for (let attempt = 0; ; attempt++) {
      this.stats.requests++;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let res, err;
      try {
        res = await fetch(this.base + path, {
          method,
          headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(this.key ? { authorization: `Bearer ${this.key}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
      } catch (e) {
        err = e;
      } finally {
        clearTimeout(timer);
      }
      if (err) {
        this.stats.errors++;
        if (attempt < retries) { this.stats.retries++; await sleep(200 * (attempt + 1) + Math.random() * 200); continue; }
        return { ok: false, status: 0, data: null, error: String(err) };
      }
      this.stats.byStatus[res.status] = (this.stats.byStatus[res.status] || 0) + 1;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        this.stats.retries++;
        await sleep(300 * (attempt + 1) + Math.random() * 300);
        continue;
      }
      let data = null;
      const ct = res.headers.get('content-type') || '';
      try { data = ct.includes('json') ? await res.json() : { text: await res.text() }; } catch { data = null; }
      if (!res.ok) this.stats.errors++;
      return { ok: res.ok, status: res.status, data };
    }
  }

  register(name, description) { return this.req('POST', '/v1/agents/register', { name, description }); }
  claim(proof_url) { return this.req('POST', '/v1/agents/claim', { proof_url }); }
  meta() { return this.req('GET', '/v1/world/meta'); }
  summary(bbox) { return this.req('GET', `/v1/region/summary?bbox=${bbox.join(',')}`); }
  build(ops, { protect = false, key } = {}) {
    return this.req('POST', '/v1/build', {
      idempotency_key: key ?? globalThis.crypto.randomUUID(),
      ops,
      ...(protect ? { protect_existing: true } : {}),
    }, { retries: 1 });
  }
  declare(structure) { return this.req('POST', '/v1/structures', structure); }
  structures(bbox) { return this.req('GET', `/v1/structures${bbox ? `?bbox=${bbox.join(',')}` : ''}`); }
  talk(id, message) { return this.req('POST', `/v1/structures/${encodeURIComponent(id)}/talk`, { text: message }); }
  inbox() { return this.req('GET', '/v1/agents/me/inbox'); }
  events(since = 0) { return this.req('GET', `/v1/events?since=${since}`); }
}

// Tolerant parse of a build response (contract: per-op accept/reject, overwrote flag).
export function parseBuildResults(data) {
  const out = { accepted: 0, overwrote: 0, rejected: {}, total: 0 };
  const results = data?.results ?? data?.ops ?? null;
  if (Array.isArray(results)) {
    out.total = results.length;
    for (const r of results) {
      const ok = r.ok ?? r.accepted ?? r.status === 'accepted';
      if (ok) { out.accepted++; if (r.overwrote) out.overwrote++; }
      else {
        const code = String(r.edict ?? r.code ?? r.reason ?? r.error ?? 'UNKNOWN');
        out.rejected[code] = (out.rejected[code] || 0) + 1;
      }
    }
    return out;
  }
  const s = data?.summary;
  if (s) {
    out.accepted = (s.placed || 0) + (s.replaced || 0) + (s.removed || 0);
    out.total = out.accepted + (s.rejected || 0);
    if (s.rejected) out.rejected.UNKNOWN = s.rejected;
  }
  return out;
}

// Tolerant gap extraction from a region summary (muse). Accepts JSON {gaps|missing:[...]}
// or prose containing "missing/lacks/no ..." sentences.
export function extractGaps(data) {
  if (!data) return [];
  if (Array.isArray(data.gaps)) return data.gaps.map(String);
  if (Array.isArray(data.missing)) return data.missing.map(String);
  const text = typeof data === 'string' ? data : String(data.text ?? data.summary ?? '');
  if (!text) return [];
  const gaps = [];
  for (const sentence of text.split(/(?<=[.;])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s) continue;
    if (/\b(missing|lacks?|nothing|no built|there is no|not a single|no\s+(tall|curved|glow|light|bridge|road|plaza|garden|landmark|water|structure))\b/i.test(s)) {
      gaps.push(s.slice(0, 200));
    }
  }
  return gaps;
}
