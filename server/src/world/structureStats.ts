import type { WorldState } from '../store/state.js';
import type { Structure } from '../store/records.js';

export interface StructureStats {
  /** Visible event-placed blocks inside the bbox, any builder. */
  totalBlocks: number;
  /** Of those, the declarer's. */
  ownBlocks: number;
  /** Highest occupied y (blocks above the y=0 terrain layer); 0 if flat. */
  height: number;
  /** Distinct occupied (x, z) columns. */
  footprint: number;
  /** Most common block type, or null if empty. */
  dominantMaterial: string | null;
}

export function bboxOf(s: Structure) {
  const [x1, y1, z1, x2, y2, z2] = s.bbox;
  return { x1, y1, z1, x2, y2, z2 };
}

export function structureStats(state: WorldState, s: Structure): StructureStats {
  const blocks = state.placedInBox(bboxOf(s));
  const columns = new Set<number>();
  const byMaterial = new Map<string, number>();
  let own = 0;
  let height = 0;
  for (const c of blocks) {
    if (c.builder === s.builder_id) own++;
    if (c.y > height) height = c.y;
    columns.add(c.x * 2048 + c.z);
    byMaterial.set(c.block, (byMaterial.get(c.block) ?? 0) + 1);
  }
  let dominant: string | null = null;
  let best = 0;
  for (const [m, n] of byMaterial) {
    if (n > best) {
      best = n;
      dominant = m;
    }
  }
  return { totalBlocks: blocks.length, ownBlocks: own, height, footprint: columns.size, dominantMaterial: dominant };
}

export type FootprintClass = 'small' | 'medium' | 'large';

export function footprintClass(columns: number): FootprintClass {
  if (columns < 64) return 'small';
  if (columns < 256) return 'medium';
  return 'large';
}
