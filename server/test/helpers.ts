import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach } from 'vitest';
import { buildApp, type AppContext } from '../src/server.js';
import type { Config } from '../src/config.js';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

export function tempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'blockwork-test-'));
  dirs.push(dir);
  return dir;
}

export async function makeApp(overrides: Partial<Config> = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const built = await buildApp({ dataDir: overrides.dataDir ?? tempDataDir(), ...overrides });
  apps.push(built.app);
  return built;
}

/** Close an app early (e.g. to reboot from the same data dir). */
export async function closeApp(app: FastifyInstance): Promise<void> {
  const i = apps.indexOf(app);
  if (i >= 0) apps.splice(i, 1);
  await app.close();
}

export interface Builder {
  key: string;
  id: string;
  code: string;
}

export async function register(app: FastifyInstance, name: string): Promise<Builder> {
  const res = await app.inject({ method: 'POST', url: '/v1/agents/register', payload: { name } });
  if (res.statusCode !== 201) throw new Error(`register ${name} failed: ${res.statusCode} ${res.body}`);
  const body = res.json();
  return { key: body.api_key, id: body.builder_id, code: body.verification_code };
}

export async function claim(app: FastifyInstance, b: Builder): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/agents/claim',
    headers: auth(b),
    payload: { proof_url: 'https://gist.github.com/someone/abc' },
  });
  if (res.statusCode !== 200) throw new Error(`claim failed: ${res.statusCode} ${res.body}`);
}

export async function claimedBuilder(app: FastifyInstance, name: string): Promise<Builder> {
  const b = await register(app, name);
  await claim(app, b);
  return b;
}

export function auth(b: Builder): Record<string, string> {
  return { authorization: `Bearer ${b.key}` };
}

export interface Op {
  op: 'place' | 'remove';
  x: number;
  y: number;
  z: number;
  block?: string;
}

export function place(x: number, y: number, z: number, block: string): Op {
  return { op: 'place', x, y, z, block };
}

export function remove(x: number, y: number, z: number): Op {
  return { op: 'remove', x, y, z };
}

export async function build(
  app: FastifyInstance,
  b: Builder,
  ops: Op[],
  opts: { key?: string; protect_existing?: boolean } = {},
) {
  const payload: Record<string, unknown> = { idempotency_key: opts.key ?? randomUUID(), ops };
  if (opts.protect_existing !== undefined) payload.protect_existing = opts.protect_existing;
  return app.inject({ method: 'POST', url: '/v1/build', headers: auth(b), payload });
}

/** A filled rectangle of blocks at one y level (inclusive ranges). */
export function slab(x1: number, x2: number, z1: number, z2: number, y: number, block: string): Op[] {
  const ops: Op[] = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) ops.push(place(x, y, z, block));
  return ops;
}

export async function chunks(app: FastifyInstance, b: Builder, bbox: number[]) {
  const res = await app.inject({ method: 'GET', url: `/v1/chunks?bbox=${bbox.join(',')}`, headers: auth(b) });
  return res.json().blocks as [number, number, number, string, string | null][];
}

/** Coordinates well inside the island, away from river, coast, Commons and the Grid. */
export const OPEN_GROUND = { x: 950, z: 1150 };
/** Inside the Commons. */
export const COMMONS_SPOT = { x: 1050, z: 1050 };
/** Inside the Grid (fixture edict district). */
export const GRID_SPOT = { x: 820, z: 820 };
