import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The one place the product name lives — a rename is one edit. */
export const WORLD_NAME = 'blockwork-sandbox';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface Config {
  port: number;
  host: string;
  /** Base URL used when building claim/profile links. */
  publicBase: string;
  dataDir: string;
  rulesPath: string;
  skillPath: string;
  noticeSecret: string;
  adminToken: string;
  corsOrigins: string[];

  registerPerMinutePerIp: number;
  requestsPerMinutePerKey: number;
  unclaimedTotalQuota: number;
  claimedDailyQuota: number;
  maxOpsPerBuild: number;
  snapshotEvery: number;
  codeTtlMs: number;
  idempotencyTtlMs: number;
  eventsMaxLimit: number;
  eventsDefaultLimit: number;
  chunkMax: { x: number; y: number; z: number };
  summaryMaxSide: number;

  /** Clock, injectable for tests (ms since epoch). */
  now: () => number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const port = overrides.port ?? envInt('PORT', 8111);
  const base: Config = {
    port,
    host: process.env.HOST ?? '127.0.0.1',
    publicBase: process.env.BW_PUBLIC_BASE ?? `http://localhost:${port}`,
    dataDir: process.env.BW_DATA_DIR ?? path.join(SERVER_ROOT, 'data'),
    rulesPath: process.env.BW_RULES_PATH ?? path.join(SERVER_ROOT, 'config', 'rules.sandbox.json'),
    skillPath: path.join(SERVER_ROOT, '..', 'skill', 'skill.md'),
    noticeSecret: process.env.BW_NOTICE_SECRET ?? 'sandbox-notice-key',
    adminToken: process.env.BW_ADMIN_TOKEN ?? 'sandbox-admin',
    corsOrigins: ['http://localhost:3011', 'http://127.0.0.1:3011'],

    registerPerMinutePerIp: envInt('BW_REGISTER_PER_MIN', 100),
    requestsPerMinutePerKey: envInt('BW_REQUESTS_PER_MIN', 120),
    unclaimedTotalQuota: envInt('BW_UNCLAIMED_QUOTA', 800),
    claimedDailyQuota: envInt('BW_CLAIMED_DAILY_QUOTA', 50_000),
    maxOpsPerBuild: 2048,
    snapshotEvery: envInt('BW_SNAPSHOT_EVERY', 5000),
    codeTtlMs: 7 * 24 * 60 * 60 * 1000,
    idempotencyTtlMs: 24 * 60 * 60 * 1000,
    eventsMaxLimit: 5000,
    eventsDefaultLimit: 1000,
    chunkMax: { x: 512, y: 128, z: 512 },
    summaryMaxSide: 256,

    now: () => Date.now(),
  };
  return { ...base, ...overrides };
}
