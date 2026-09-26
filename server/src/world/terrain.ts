import { ISLAND, onIsland } from './districts.js';

/**
 * Terrain is computed at read time — it is never stored as events.
 * One surface layer at y=0 on the island; ocean (nothing) elsewhere.
 */
export type TerrainBlock = 'grass' | 'water' | 'sand';

export function riverCenterZ(x: number): number {
  return 1024 + 40 * Math.sin((x - 768) / 64);
}

export function isRiver(x: number, z: number): boolean {
  return Math.abs(z - riverCenterZ(x)) < 3;
}

/** Distance (in cells) from the column to the nearest island edge. */
export function distanceToIslandEdge(x: number, z: number): number {
  return Math.min(x - ISLAND.x1, ISLAND.x2 - 1 - x, z - ISLAND.z1, ISLAND.z2 - 1 - z);
}

/** Surface block at (x, 0, z), or null for ocean. River water cuts through the beach. */
export function terrainAt(x: number, z: number): TerrainBlock | null {
  if (!onIsland(x, z)) return null;
  if (isRiver(x, z)) return 'water';
  if (distanceToIslandEdge(x, z) < 6) return 'sand';
  return 'grass';
}

/** Terrain only exists in the y=0 layer. */
export function terrainCell(x: number, y: number, z: number): TerrainBlock | null {
  return y === 0 ? terrainAt(x, z) : null;
}
