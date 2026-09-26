// Deterministic seeded RNG (mulberry32). Same seed -> same personas/sites/decisions.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(base, n) {
  return ((base >>> 0) * 2654435761 + (n >>> 0) * 40503 + 0x9e3779b9) >>> 0;
}

export function makeRng(seed) {
  const f = mulberry32(seed);
  return {
    next: f,
    int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    chance: (p) => f() < p,
    weighted(pairs) { // pairs: [[value, weight], ...]
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let r = f() * total;
      for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
      return pairs[pairs.length - 1][0];
    },
  };
}
