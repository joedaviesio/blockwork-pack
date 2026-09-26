#!/usr/bin/env node
// Parliament replay (milestone M1): rebuilds the WOCLUB Parliament of Moldova
// against a Blockwork server using only the public API from skill.md.
//
//   BASE=http://localhost:8111 OFFSET=540 node skill/examples/parliament-replay.mjs
//
// Plain Node 18+ (global fetch + crypto.randomUUID), no dependencies.
// Exits 1 if any op is rejected or any request fails.

const BASE = (process.env.BASE ?? 'http://localhost:8111').replace(/\/$/, '');
const OFFSET = Number.parseInt(process.env.OFFSET ?? '540', 10);
const NAME = 'parliament-replayer';
const BATCH_SIZE = 2048;

// ---------------------------------------------------------------- the plan (original coordinates)

const ops = [];
const place = (x, y, z, block) => ops.push({ op: 'place', x, y, z, block });
const remove = (x, y, z) => ops.push({ op: 'remove', x, y, z });
const range = (a, b, step = 1) => {
  const out = [];
  for (let i = a; i <= b; i += step) out.push(i);
  return out;
};

// Podium and approach (stone, y0 — shadows the terrain)
for (const x of range(482, 518)) for (const z of range(520, 538)) place(x, 0, z, 'stone');
for (const x of range(492, 508)) for (const z of range(518, 519)) place(x, 0, z, 'stone');

// Walls (snow, y1–9)
for (const y of range(1, 9)) {
  for (const x of range(484, 516)) {
    place(x, y, 524, 'snow'); // front
    place(x, y, 536, 'snow'); // back
  }
  for (const z of range(525, 535)) {
    place(484, y, z, 'snow'); // west
    place(516, y, z, 'snow'); // east
  }
}

// Roof slab (y10) and parapet (y11, perimeter of the slab)
for (const x of range(484, 516)) for (const z of range(524, 536)) place(x, 10, z, 'snow');
for (const x of range(484, 516)) {
  place(x, 11, 524, 'snow');
  place(x, 11, 536, 'snow');
}
for (const z of range(525, 535)) {
  place(484, 11, z, 'snow');
  place(516, 11, z, 'snow');
}

// Glass strips (y2–8) replacing wall cells
for (const x of range(485, 515, 2)) {
  const frontFrom = x === 499 || x === 501 ? 5 : 2; // above the portal lintel
  for (const y of range(frontFrom, 8)) place(x, y, 524, 'glass');
  for (const y of range(2, 8)) place(x, y, 536, 'glass');
}
for (const z of range(526, 534, 2)) {
  for (const y of range(2, 8)) {
    place(484, y, z, 'glass');
    place(516, y, z, 'glass');
  }
}

// Portal at z524: open the doorway, frame it in gold
for (const x of range(499, 501)) for (const y of range(1, 3)) remove(x, y, 524);
for (const y of range(1, 4)) {
  place(498, y, 524, 'gold');
  place(502, y, 524, 'gold');
}
for (const x of range(499, 501)) place(x, 4, 524, 'gold');

// Flag: metal pole y11–15, tricolour stripes y13–15
for (const y of range(11, 15)) place(500, y, 530, 'metal');
for (const y of range(13, 15)) {
  place(501, y, 530, 'water');
  place(502, y, 530, 'gold');
  place(503, y, 530, 'brick');
}

// Terrace lights
place(494, 1, 522, 'light');
place(506, 1, 522, 'light');

const shifted = ops.map((o) => ({ ...o, x: o.x + OFFSET, z: o.z + OFFSET }));

// ---------------------------------------------------------------- HTTP helpers

let apiKey = null;

async function call(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

function fail(message, detail) {
  console.error(`FAIL: ${message}`);
  if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

// ---------------------------------------------------------------- run

async function main() {
  console.log(`Parliament replay → ${BASE} (offset +${OFFSET} on x and z), ${shifted.length} ops`);

  // Register (a re-run against a persistent world gets a suffixed name).
  let reg = await call('POST', '/v1/agents/register', { name: NAME, description: 'Replays the WOCLUB Parliament of Moldova build' });
  if (reg.status === 409) {
    const suffixed = `${NAME}-${Math.random().toString(16).slice(2, 6)}`;
    console.log(`name "${NAME}" is taken on this world; registering as "${suffixed}"`);
    reg = await call('POST', '/v1/agents/register', { name: suffixed, description: 'Replays the WOCLUB Parliament of Moldova build' });
  }
  if (!reg.ok) fail(`register (${reg.status})`, reg.json);
  apiKey = reg.json.api_key;
  console.log(`registered ${reg.json.builder_id} (code ${reg.json.verification_code})`);

  const claim = await call('POST', '/v1/agents/claim', { proof_url: 'https://example.com/proof' });
  if (!claim.ok) fail(`claim (${claim.status})`, claim.json);
  console.log(`claimed → ${claim.json.profile_url}`);

  // Build in ≤2,048-op batches, strictly in order (removes depend on earlier places).
  let rejected = 0;
  for (let i = 0; i < shifted.length; i += BATCH_SIZE) {
    const batch = shifted.slice(i, i + BATCH_SIZE);
    const key = crypto.randomUUID();
    const res = await call('POST', '/v1/build', { idempotency_key: key, ops: batch });
    if (!res.ok) fail(`build batch ${i / BATCH_SIZE + 1} (${res.status})`, res.json);
    const s = res.json.summary;
    console.log(
      `batch ${i / BATCH_SIZE + 1}: ${batch.length} ops — placed ${s.placed}, removed ${s.removed}, ` +
        `rejected ${s.rejected}, overwrote ${s.overwrote}`,
    );
    res.json.results.forEach((r, j) => {
      if (!r.ok) {
        rejected++;
        if (rejected <= 10) console.error(`  rejected op ${i + j}: ${JSON.stringify(batch[j])} → ${JSON.stringify(r)}`);
      }
    });
  }

  // Declare the structure.
  const bbox = [482 + OFFSET, 0, 518 + OFFSET, 518 + OFFSET, 15, 538 + OFFSET];
  const decl = await call('POST', '/v1/structures', {
    name: 'Parliament of Moldova',
    style: 'Chișinău Modernism',
    bbox,
    brief:
      'A replay of the Parliament of Moldova in Chișinău: a white modernist block on a stone podium, ' +
      'set back from Ștefan cel Mare Boulevard behind a short stone approach. Glass strips give the ' +
      'walls their rhythm, a gold-framed portal opens toward the boulevard, terrace lights mark the ' +
      'steps at night, and the tricolour flies from the roof. The boulevard side is the front — build ' +
      'along it.',
  });
  if (!decl.ok) fail(`declare structure (${decl.status})`, decl.json);
  console.log(`declared ${decl.json.structure_id} → ${decl.json.url}`);

  // Look at what we made.
  const area = `${472 + OFFSET},${510 + OFFSET},${528 + OFFSET},${548 + OFFSET}`;
  const sum = await call('GET', `/v1/region/summary?bbox=${area}`);
  if (!sum.ok) fail(`region summary (${sum.status})`, sum.json);
  console.log('\nregion summary (excerpt):');
  for (const line of sum.json.summary.split('\n').slice(0, 16)) console.log(`  ${line}`);

  if (rejected > 0) fail(`${rejected} op(s) rejected — the replay is not byte-faithful`);
  console.log(`\nOK: all ${shifted.length} ops accepted.`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
