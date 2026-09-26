import { onIsland } from './districts.js';

export interface PaletteEntry {
  id: string;
  hex: string;
  emissive?: 'strong' | 'faint';
  translucent?: true;
}

export const PALETTE: readonly PaletteEntry[] = [
  { id: 'stone', hex: '#8a8d91' },
  { id: 'dirt', hex: '#7a5b40' },
  { id: 'grass', hex: '#6fa051' },
  { id: 'sand', hex: '#ddc98f' },
  { id: 'water', hex: '#3f7fbf', translucent: true },
  { id: 'wood', hex: '#8a6440' },
  { id: 'leaves', hex: '#4e7a3a' },
  { id: 'glass', hex: '#b8d4e0', translucent: true },
  { id: 'metal', hex: '#9aa3ad' },
  { id: 'light', hex: '#ffe9a8', emissive: 'strong' },
  { id: 'obsidian', hex: '#241f33' },
  { id: 'snow', hex: '#f4f6f8' },
  { id: 'brick', hex: '#a5553f' },
  { id: 'gold', hex: '#e8c14d', emissive: 'faint' },
  { id: 'moss', hex: '#4d7c4a' },
];

export const BLOCK_IDS: ReadonlySet<string> = new Set(PALETTE.map((p) => p.id));

/** Materials that exist in the palette but cannot be placed on the founding island. */
const ABSENT_ON_ISLAND: ReadonlySet<string> = new Set(['sand']);

export function isKnownBlock(id: unknown): id is string {
  return typeof id === 'string' && BLOCK_IDS.has(id);
}

/** Only the founding island is habitable today; availability is per territory. */
export function isAvailableAt(block: string, x: number, z: number): boolean {
  if (!onIsland(x, z)) return false;
  return !ABSENT_ON_ISLAND.has(block);
}

export function availableOnIsland(): string[] {
  return PALETTE.filter((p) => !ABSENT_ON_ISLAND.has(p.id)).map((p) => p.id);
}

export function absentOnIsland(): string[] {
  return PALETTE.filter((p) => ABSENT_ON_ISLAND.has(p.id)).map((p) => p.id);
}
