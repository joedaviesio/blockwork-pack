// Voxel build programs. Each returns { ops, bbox, name, kind }.
// bbox = [x0,y0,z0,x1,y1,z1]. Ops use skill.md shape: {op:'place'|'remove', x,y,z, block}.

function place(ops, x, y, z, block) { ops.push({ op: 'place', x, y, z, block }); }

function box(ops, x0, y0, z0, x1, y1, z1, block, { hollow = false } = {}) {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    if (hollow && x > x0 && x < x1 && z > z0 && z < z1 && y > y0 && y < y1) continue;
    place(ops, x, y, z, block);
  }
}

export function cottage(cx, cz, { wall = 'wood', roof = 'leaves', size = 7, height = 3 } = {}) {
  const h = Math.floor(size / 2);
  const ops = [];
  box(ops, cx - h, 0, cz - h, cx + h, 0, cz + h, 'stone'); // floor
  for (let y = 1; y <= height; y++) { // walls
    for (let x = cx - h; x <= cx + h; x++) for (const z of [cz - h, cz + h]) place(ops, x, y, z, wall);
    for (let z = cz - h + 1; z <= cz + h - 1; z++) for (const x of [cx - h, cx + h]) place(ops, x, y, z, wall);
  }
  // door + windows
  const door = ops.filter((o) => !(o.x === cx && o.z === cz - h && o.y <= 2));
  ops.length = 0; ops.push(...door);
  place(ops, cx - 2, 2, cz - h, 'glass'); place(ops, cx + 2, 2, cz - h, 'glass');
  for (let i = 0; i <= h; i++) { // pyramid roof
    box(ops, cx - h + i, height + 1 + i, cz - h + i, cx + h - i, height + 1 + i, cz + h - i, roof);
  }
  place(ops, cx, height + 2 + h, cz, 'light');
  return { ops, bbox: [cx - h, 0, cz - h, cx + h, height + 2 + h, cz + h], name: 'Cottage', kind: 'cottage' };
}

export function tower(cx, cz, { height = 20, mat = 'stone', r = 2 } = {}) {
  const ops = [];
  for (let y = 0; y <= height; y++) {
    for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
      const edge = x === cx - r || x === cx + r || z === cz - r || z === cz + r;
      if (edge || y === 0) place(ops, x, y, z, mat);
    }
  }
  box(ops, cx - r, height + 1, cz - r, cx + r, height + 1, cz + r, 'light');
  return { ops, bbox: [cx - r, 0, cz - r, cx + r, height + 1, cz + r], name: 'Tower', kind: 'tower' };
}

export function road(x0, z0, x1, z1, { mat = 'stone' } = {}) {
  const ops = [];
  const dx = x1 - x0, dz = z1 - z0;
  const steps = Math.max(Math.abs(dx), Math.abs(dz), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (dx * i) / steps), z = Math.round(z0 + (dz * i) / steps);
    place(ops, x, 0, z, mat); place(ops, x + 1, 0, z, mat);
    if (i % 8 === 0) { place(ops, x - 1, 1, z, 'wood'); place(ops, x - 1, 2, z, 'light'); }
  }
  const bbox = [Math.min(x0, x1) - 1, 0, Math.min(z0, z1), Math.max(x0, x1) + 1, 2, Math.max(z0, z1)];
  return { ops, bbox, name: 'Road', kind: 'road' };
}

export function bridge(x0, z0, x1, z1, { deck = 'wood', y = 4 } = {}) {
  const ops = [];
  const dx = x1 - x0, dz = z1 - z0;
  const steps = Math.max(Math.abs(dx), Math.abs(dz), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (dx * i) / steps), z = Math.round(z0 + (dz * i) / steps);
    place(ops, x, y, z, deck); place(ops, x + 1, y, z, deck);
    place(ops, x, y + 1, z + 0, i % 4 === 0 ? 'light' : 'wood'); // railing posts
    if (i % 6 === 0) for (let py = 0; py < y; py++) place(ops, x, py, z, 'stone'); // piers
  }
  const bbox = [Math.min(x0, x1), 0, Math.min(z0, z1), Math.max(x0, x1) + 1, y + 1, Math.max(z0, z1)];
  return { ops, bbox, name: 'Bridge', kind: 'bridge' };
}

export function lanternPlaza(cx, cz, { size = 9 } = {}) {
  const h = Math.floor(size / 2);
  const ops = [];
  box(ops, cx - h, 0, cz - h, cx + h, 0, cz + h, 'stone');
  for (const [dx, dz] of [[-h, -h], [-h, h], [h, -h], [h, h]]) {
    place(ops, cx + dx, 1, cz + dz, 'wood'); place(ops, cx + dx, 2, cz + dz, 'wood'); place(ops, cx + dx, 3, cz + dz, 'light');
  }
  place(ops, cx, 1, cz, 'gold');
  return { ops, bbox: [cx - h, 0, cz - h, cx + h, 3, cz + h], name: 'Lantern Plaza', kind: 'plaza' };
}

export function garden(cx, cz, rng, { size = 9 } = {}) {
  const h = Math.floor(size / 2);
  const ops = [];
  box(ops, cx - h, 0, cz - h, cx + h, 0, cz + h, 'grass');
  box(ops, cx - 1, 0, cz - 1, cx + 1, 0, cz + 1, 'water');
  for (let i = 0; i < 14; i++) {
    const x = cx + rng.int(-h, h), z = cz + rng.int(-h, h);
    place(ops, x, 1, z, rng.pick(['moss', 'leaves', 'leaves']));
  }
  place(ops, cx + h - 1, 1, cz + h - 1, 'wood'); place(ops, cx + h - 1, 2, cz + h - 1, 'leaves');
  return { ops, bbox: [cx - h, 0, cz - h, cx + h, 2, cz + h], name: 'Garden', kind: 'garden' };
}

export function dome(cx, cz, { r = 6, mat = 'glass' } = {}) {
  const ops = [];
  for (let x = -r; x <= r; x++) for (let y = 0; y <= r; y++) for (let z = -r; z <= r; z++) {
    const d = Math.sqrt(x * x + y * y + z * z);
    if (Math.abs(d - r) < 0.55) place(ops, cx + x, y, cz + z, mat);
  }
  place(ops, cx, r, cz, 'light');
  return { ops, bbox: [cx - r, 0, cz - r, cx + r, r, cz + r], name: 'Dome', kind: 'dome' };
}

export function pavilion(cx, cz, { mat = 'wood', size = 7 } = {}) {
  const h = Math.floor(size / 2);
  const ops = [];
  box(ops, cx - h, 0, cz - h, cx + h, 0, cz + h, 'stone');
  for (const [dx, dz] of [[-h, -h], [-h, h], [h, -h], [h, h]]) {
    for (let y = 1; y <= 3; y++) place(ops, cx + dx, y, cz + dz, mat);
  }
  box(ops, cx - h, 4, cz - h, cx + h, 4, cz + h, mat);
  place(ops, cx, 1, cz, 'light');
  return { ops, bbox: [cx - h, 0, cz - h, cx + h, 4, cz + h], name: 'Pavilion', kind: 'pavilion' };
}

// Swap materials a program used for ones available in this territory.
export function adaptMaterials(prog, available) {
  if (!available || available.length === 0) return prog;
  const set = new Set(available);
  const fallback = (want) => {
    if (set.has(want)) return want;
    const subs = {
      brick: ['stone', 'sand', 'wood'], wood: ['stone', 'sand'], stone: ['sand', 'wood'],
      leaves: ['moss', 'grass'], moss: ['grass', 'leaves'], glass: ['snow', 'stone'],
      light: ['gold', 'glass'], gold: ['light', 'metal'], grass: ['moss', 'dirt'],
      water: ['glass'], snow: ['stone'], metal: ['stone'], obsidian: ['stone'], sand: ['dirt', 'stone'], dirt: ['stone'],
    };
    for (const s of subs[want] || []) if (set.has(s)) return s;
    return available[0];
  };
  for (const op of prog.ops) if (op.op === 'place') op.block = fallback(op.block);
  return prog;
}
