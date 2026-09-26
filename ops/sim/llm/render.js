// Tier-2 sight: render a world area to PNG for multimodal bots. Zero dependencies —
// oblique projection (rectangles only) + a minimal PNG encoder over node:zlib.
import { deflateSync } from 'node:zlib';

const PALETTE = {
  stone: '#9aa3ad', dirt: '#8a6a4f', grass: '#7fae62', sand: '#e5d5a4', water: '#4f86c6',
  wood: '#a5824f', leaves: '#5d8f4e', glass: '#bcd6e2', metal: '#b8bec6', light: '#fff3c0',
  obsidian: '#2b2733', snow: '#f2f5f7', brick: '#b0574a', gold: '#f0c75e', moss: '#6f9a6a',
};
const EMISSIVE = new Set(['light', 'gold']);
const SKY = [26, 32, 46], GROUND_VOID = [24, 30, 22];

// ---- minimal PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function encodePng(rgba, W, H) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- oblique renderer ----
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = ([r, g, b], f) => [Math.min(255, r * f) | 0, Math.min(255, g * f) | 0, Math.min(255, b * f) | 0];

/**
 * cubes: [{x,y,z,block}] · bounds: [x1,z1,x2,z2].
 * View: from the south, slightly above — north (−z) is up; +x is right.
 */
export function renderArea(cubes, bounds) {
  const [x1, z1, x2, z2] = bounds;
  const W_CELL = 8, D = 4, HPX = 5;
  const maxY = Math.min(70, Math.max(8, ...cubes.map((c) => c.y)));
  const W = (x2 - x1 + 1) * W_CELL + 2;
  const H = (z2 - z1 + 1) * D + (maxY + 2) * HPX + 2;
  const img = Buffer.alloc(W * H * 4);
  const put = (px, py, [r, g, b], a = 255) => {
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const i = (py * W + px) * 4;
    img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = a;
  };
  const rect = (px, py, w, h, c) => {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) put(px + dx, py + dy, c);
  };
  // sky, then void-ground band at the bottom
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, SKY);
  rect(0, H - D * 2, W, D * 2, GROUND_VOID);

  const inArea = cubes.filter((c) => c.x >= x1 && c.x <= x2 && c.z >= z1 && c.z <= z2 && c.y <= 70);
  // painter's order: far (small z) first, then low y first so tall things overpaint correctly
  inArea.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const baseY = 1 + (maxY + 1) * HPX;
  for (const c of inArea) {
    const color = hex(PALETTE[c.block] ?? '#c0c0c0');
    const sx = 1 + (c.x - x1) * W_CELL;
    const sy = baseY + (c.z - z1) * D - c.y * HPX;
    const glow = EMISSIVE.has(c.block);
    rect(sx, sy, W_CELL, HPX, shade(color, glow ? 1.15 : 0.68)); // front face
    rect(sx, sy - D, W_CELL, D, shade(color, glow ? 1.3 : 1.0)); // top face
    if (glow) rect(sx - 1, sy - D - 1, W_CELL + 2, 1, shade(color, 1.4)); // halo hint
  }
  return encodePng(img, W, H);
}

export function caption(bounds, count) {
  const [x1, z1, x2, z2] = bounds;
  return `[image] Oblique view of the area x∈[${x1},${x2}], z∈[${z1},${z2}] (${count} blocks shown). ` +
    `North (−z) is toward the top, +x is right; taller stacks rise up-screen. Emissive blocks (light, gold) render bright with a halo.`;
}
