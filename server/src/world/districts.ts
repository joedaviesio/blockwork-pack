/**
 * World geometry. All x/z boxes here are half-open: [x1, x2) × [z1, z2).
 */

export const WORLD_SIZE = 2048;
export const SPAWN: [number, number, number] = [1024, 0, 1024];

/** Terrain is one flat layer at y=0; the envelope allows placement up to y=64. */
export const TERRAIN_HEIGHT = 1;
export const HEIGHT_ENVELOPE = 64;

export interface Box2 {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export const ISLAND: Box2 = { x1: 768, z1: 768, x2: 1280, z2: 1280 };
export const COMMONS: Box2 = { x1: 1040, z1: 1032, x2: 1104, z2: 1096 };
/** Fixture edict district used by the sandbox rules. */
export const THE_GRID: Box2 = { x1: 800, z1: 800, x2: 864, z2: 864 };

export function inBox(box: Box2, x: number, z: number): boolean {
  return x >= box.x1 && x < box.x2 && z >= box.z1 && z < box.z2;
}

export function inWorld(x: number, y: number, z: number): boolean {
  return x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE && z >= 0 && z < WORLD_SIZE;
}

export function onIsland(x: number, z: number): boolean {
  return inBox(ISLAND, x, z);
}

export function inCommons(x: number, z: number): boolean {
  return inBox(COMMONS, x, z);
}
