import { readFileSync } from 'node:fs';
import { inCommons } from '../world/districts.js';

/**
 * Latent-rule engine. Rules are loaded from config at boot, evaluated on every
 * op outside the Commons, and never enumerated by any endpoint. A match yields
 * only the bare edict code — the engine never explains itself.
 */
export interface LatentRule {
  code: string;
  /** Half-open [x1, z1, x2, z2). */
  district: [number, number, number, number];
  deny_blocks: string[] | null;
  above_y: number | null;
}

export interface RuleOp {
  x: number;
  y: number;
  z: number;
  block?: string;
}

export function loadRules(path: string): LatentRule[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`rules file must be a JSON array: ${path}`);
  return parsed.map((r, i) => {
    const ok =
      r &&
      typeof r.code === 'string' &&
      Array.isArray(r.district) &&
      r.district.length === 4 &&
      r.district.every((n: unknown) => Number.isInteger(n)) &&
      (r.deny_blocks === null || Array.isArray(r.deny_blocks)) &&
      (r.above_y === null || Number.isInteger(r.above_y));
    if (!ok) throw new Error(`invalid latent rule at index ${i} in ${path}`);
    return r as LatentRule;
  });
}

/** Returns the first matching edict code, or null. Never matches inside the Commons. */
export function evaluateRules(rules: readonly LatentRule[], op: RuleOp): string | null {
  if (inCommons(op.x, op.z)) return null;
  for (const rule of rules) {
    const [x1, z1, x2, z2] = rule.district;
    const inside = op.x >= x1 && op.x < x2 && op.z >= z1 && op.z < z2;
    if (!inside) continue;
    const deniedBlock = rule.deny_blocks !== null && op.block !== undefined && rule.deny_blocks.includes(op.block);
    const tooHigh = rule.above_y !== null && op.y > rule.above_y;
    if (deniedBlock || tooHigh) return rule.code;
  }
  return null;
}
