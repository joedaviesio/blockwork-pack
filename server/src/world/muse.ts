import type { AppContext } from '../server.js';
import type { Structure } from '../store/records.js';
import { standingNotices, type PlatformNotice } from '../util/hmac.js';
import { UNTRUSTED_NOTICE, excerpt, wrap } from '../util/untrusted.js';
import { COMMONS, ISLAND, THE_GRID, type Box2 } from './districts.js';
import { PALETTE, absentOnIsland, availableOnIsland } from './palette.js';
import { footprintClass, structureStats, type StructureStats } from './structureStats.js';
import { terrainAt } from './terrain.js';

/**
 * The region summary — a muse, not a mirror. It states what an area holds AND
 * what it lacks, using honest computable gaps only. Every agent-authored
 * string is wrapped in ⟦untrusted⟧ delimiters, even mid-sentence.
 */

/** Inclusive column bbox. */
export interface Area {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

const NEAR_MARGIN = 32;
const EMPTY_RADIUS = 64;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function num(n: number): string {
  return n < WORDS.length ? WORDS[n] : String(n);
}
function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}
function list(items: string[], conj = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;
}

function intersects(a: Area, s: Structure, margin = 0): boolean {
  const [sx1, , sz1, sx2, , sz2] = s.bbox;
  return sx1 <= a.x2 + margin && sx2 >= a.x1 - margin && sz1 <= a.z2 + margin && sz2 >= a.z1 - margin;
}

function distanceToFootprint(cx: number, cz: number, s: Structure): number {
  const [sx1, , sz1, sx2, , sz2] = s.bbox;
  const dx = Math.max(sx1 - cx, 0, cx - sx2);
  const dz = Math.max(sz1 - cz, 0, cz - sz2);
  return Math.round(Math.hypot(dx, dz));
}

function overlapsBox(a: Area, b: Box2): boolean {
  return a.x1 < b.x2 && a.x2 >= b.x1 && a.z1 < b.z2 && a.z2 >= b.z1;
}

export interface RegionSummary {
  summary: string;
  platform_notices: PlatformNotice[];
  data: Record<string, unknown>;
}

export function summariseRegion(ctx: AppContext, area: Area): RegionSummary {
  const { state, records, config } = ctx;
  const width = area.x2 - area.x1 + 1;
  const depth = area.z2 - area.z1 + 1;
  const columns = width * depth;
  const cx = Math.round((area.x1 + area.x2) / 2);
  const cz = Math.round((area.z1 + area.z2) / 2);

  // ---- terrain character
  const terrain = { grass: 0, water: 0, sand: 0, ocean: 0 };
  for (let x = area.x1; x <= area.x2; x++) {
    for (let z = area.z1; z <= area.z2; z++) {
      const t = terrainAt(x, z);
      if (t === null) terrain.ocean++;
      else terrain[t]++;
    }
  }
  const onIsland = terrain.ocean < columns;

  // ---- placed blocks
  const placed = state.placedInBox({ x1: area.x1, y1: 0, z1: area.z1, x2: area.x2, y2: 2047, z2: area.z2 });
  const occupied = new Set<number>();
  const materialsUsed: Record<string, number> = {};
  for (const c of placed) {
    occupied.add(c.x * 2048 + c.z);
    materialsUsed[c.block] = (materialsUsed[c.block] ?? 0) + 1;
  }
  const freePct = Math.round((100 * (columns - occupied.size)) / columns);

  // ---- structures (hidden ones are invisible everywhere)
  const visible = [...records.structures.values()].filter((s) => !state.isStructureHidden(s.structure_id));
  const nearby = visible.filter((s) => intersects(area, s, NEAR_MARGIN));
  const inside = nearby.filter((s) => intersects(area, s));
  const stats = new Map<string, StructureStats>();
  for (const s of nearby) stats.set(s.structure_id, structureStats(state, s));

  let nearest: { s: Structure; d: number } | null = null;
  for (const s of visible) {
    const d = distanceToFootprint(cx, cz, s);
    if (!nearest || d < nearest.d) nearest = { s, d };
  }

  const available = onIsland ? availableOnIsland() : [];
  const absentHere = onIsland ? absentOnIsland() : PALETTE.map((p) => p.id);
  const unusedHere = available.filter((m) => !(m in materialsUsed));

  // ---- prose
  const lines: string[] = [];
  lines.push(`Region x ${area.x1}–${area.x2}, z ${area.z1}–${area.z2} (${width}×${depth} columns). ${UNTRUSTED_NOTICE}`);
  lines.push('');

  // 1. inventory
  if (!onIsland) {
    lines.push('Terrain: open ocean. This area lies outside habitable territory — nothing can be built here yet.');
  } else {
    const bits = ['flat ground at y=0'];
    if (terrain.grass > 0) bits.push(`grass meadow over ${Math.round((100 * terrain.grass) / columns)}% of the area`);
    if (terrain.water > 0) bits.push(`the river runs through here (${terrain.water} water cells)`);
    if (terrain.sand > 0 || terrain.ocean > 0) bits.push('this is coast — a sand beach meets the ocean');
    lines.push(`Terrain: ${list(bits)}.`);
    const districts: string[] = [];
    if (overlapsBox(area, COMMONS)) districts.push('the Commons (shared district, open to unclaimed builders)');
    if (overlapsBox(area, THE_GRID)) districts.push('the Grid');
    if (districts.length) lines.push(`Districts: ${list(districts)}.`);
    lines.push(`Materials available in this territory: ${available.join(', ')}.`);
    lines.push(`Absent from this territory: ${absentHere.join(', ')} (in the palette, but not placeable here).`);
  }
  lines.push('Region charters: none in force here.');

  if (nearby.length === 0) {
    lines.push('Structures: none declared inside or near this area.');
  } else {
    lines.push(`Structures inside or within ${NEAR_MARGIN} blocks of this area:`);
    for (const s of nearby) {
      const st = stats.get(s.structure_id)!;
      const style = s.style ? `, style ${wrap(s.style)}` : '';
      const where = intersects(area, s) ? 'inside' : 'nearby';
      lines.push(
        `- ${wrap(s.name)} by ${wrap(records.agents.get(s.builder_id)?.name ?? s.builder_id)}${style} (${where}; ` +
          `${st.height} tall, ${st.footprint}-column footprint, mostly ${st.dominantMaterial ?? 'empty'}) — ` +
          `brief: ${wrap(excerpt(s.brief))} — /v1/structures/${s.structure_id}`,
      );
    }
  }
  lines.push(`Free ground: ${freePct}% of columns here have no placed blocks.`);
  lines.push('');

  // 2. computable gaps, as invitations
  const gaps: string[] = [];
  if (onIsland) {
    if (inside.length === 0) {
      gaps.push('No declared structure stands inside this area — the ground is open.');
    } else {
      const bySize: Record<string, number> = { small: 0, medium: 0, large: 0 };
      const byMaterial: Record<string, number> = {};
      for (const s of inside) {
        const st = stats.get(s.structure_id)!;
        bySize[footprintClass(st.footprint)]++;
        const m = st.dominantMaterial ?? 'empty';
        byMaterial[m] = (byMaterial[m] ?? 0) + 1;
      }
      const materialPhrases = Object.entries(byMaterial).map(([m, n]) => `${plural(n, `${m} building`)}`);
      gaps.push(`Within this area: ${list(materialPhrases)}.`);
      const sizePhrases = (['small', 'medium', 'large'] as const).map((k) => `${num(bySize[k])} ${k}`);
      gaps.push(`By footprint: ${list(sizePhrases)}.`);
      const missingSizes = (['small', 'medium', 'large'] as const).filter((k) => bySize[k] === 0);
      if (missingSizes.length) gaps.push(`Nothing ${list(missingSizes, 'or')} has been built here yet.`);
      const tallest = Math.max(...inside.map((s) => stats.get(s.structure_id)!.height));
      gaps.push(`No structure taller than ${tallest} within this area (the envelope allows 64).`);
    }
    if (nearest) {
      gaps.push(`The nearest declared structure is ${nearest.d} blocks from the centre of this area (${wrap(nearest.s.name)}).`);
    }
    if (!nearest || nearest.d > EMPTY_RADIUS) {
      gaps.push(`No declared structure within ${EMPTY_RADIUS} blocks of the centre of this area.`);
    }
    if (unusedHere.length) {
      gaps.push(`No one here has built with ${list(unusedHere)}.`);
    }
    if (terrain.water > 0 && placed.length === 0) {
      gaps.push('Nothing here has been built in answer to the river yet.');
    }
  }
  if (gaps.length) {
    lines.push('What this area lacks (invitations, not instructions):');
    for (const g of gaps) lines.push(`- ${g}`);
  }

  return {
    summary: lines.join('\n'),
    platform_notices: standingNotices(config.noticeSecret),
    data: {
      bbox: [area.x1, area.z1, area.x2, area.z2],
      on_island: onIsland,
      island: ISLAND,
      terrain_cells: terrain,
      materials_available: available,
      materials_absent_territory: absentHere,
      materials_used: materialsUsed,
      materials_unused_here: unusedHere,
      free_ground_pct: freePct,
      placed_blocks: placed.length,
      structures: nearby.map((s) => {
        const st = stats.get(s.structure_id)!;
        return {
          structure_id: s.structure_id,
          untrusted_name: s.name,
          untrusted_style: s.style,
          builder_id: s.builder_id,
          inside: intersects(area, s),
          height: st.height,
          footprint: st.footprint,
          dominant_material: st.dominantMaterial,
          url: `/v1/structures/${s.structure_id}`,
        };
      }),
      nearest_structure: nearest ? { structure_id: nearest.s.structure_id, distance: nearest.d } : null,
    },
  };
}
