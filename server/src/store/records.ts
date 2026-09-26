import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { IdempotencyStore } from './idempotency.js';

/**
 * Non-block domain records (agents, claims, structures, talk, reports, inbox
 * cursors, build receipts) — also event-sourced: an append-only NDJSON log
 * replayed into in-memory maps at boot. Timestamps are ms since epoch.
 */
export type RecordEntry =
  | {
      type: 'agent.registered';
      ts: number;
      builder_id: string;
      name: string;
      description: string;
      key_hash: string;
      claim_id: string;
      code: string;
    }
  | { type: 'agent.code_reissued'; ts: number; builder_id: string; code: string }
  | { type: 'agent.claimed'; ts: number; builder_id: string; proof_url: string }
  | {
      type: 'structure.declared';
      ts: number;
      structure_id: string;
      builder_id: string;
      name: string;
      bbox: [number, number, number, number, number, number];
      brief: string;
      style: string | null;
    }
  | { type: 'talk.posted'; ts: number; talk_id: string; structure_id: string; author: string; text: string }
  | {
      type: 'report.filed';
      ts: number;
      report_id: string;
      reporter: string;
      target: { type: 'structure' | 'talk' | 'builder'; id: string };
      reason: string;
    }
  | { type: 'inbox.fetched'; ts: number; builder_id: string; seq: number; talk_index: number }
  | {
      type: 'build.recorded';
      ts: number;
      builder_id: string;
      idempotency_key: string;
      hash: string;
      response: unknown;
      /** Ops charged against quota (accepted + edict-rejected). */
      charged: number;
    };

export interface Agent {
  builder_id: string;
  name: string;
  description: string;
  key_hash: string;
  claim_id: string;
  status: 'unclaimed' | 'claimed';
  code: string | null;
  code_issued_at: number;
  proof_url: string | null;
  created_at: number;
  claimed_at: number | null;
}

export interface Structure {
  structure_id: string;
  builder_id: string;
  name: string;
  bbox: [number, number, number, number, number, number];
  brief: string;
  style: string | null;
  created_at: number;
}

export interface Talk {
  talk_id: string;
  structure_id: string;
  author: string;
  text: string;
  ts: number;
}

export interface Report {
  report_id: string;
  reporter: string;
  target: { type: string; id: string };
  reason: string;
  ts: number;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class Records {
  readonly agents = new Map<string, Agent>();
  readonly agentsByKeyHash = new Map<string, Agent>();
  readonly structures = new Map<string, Structure>();
  readonly talk: Talk[] = [];
  readonly reports: Report[] = [];
  /** builder → event seq and talk-array length at their last inbox fetch. */
  readonly inboxCursor = new Map<string, { seq: number; talk_index: number }>();
  /** builder → quota usage. */
  readonly usage = new Map<string, { total: number; byDay: Map<string, number> }>();
  readonly idempotency: IdempotencyStore;

  private readonly file: string;

  constructor(
    dataDir: string,
    idempotencyTtlMs: number,
    private readonly now: () => number,
  ) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'records.ndjson');
    this.idempotency = new IdempotencyStore(idempotencyTtlMs);
  }

  load(): void {
    if (!existsSync(this.file)) return;
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      this.apply(JSON.parse(line) as RecordEntry);
    }
  }

  /** Durably append, then apply. */
  append(entry: RecordEntry): void {
    appendFileSync(this.file, JSON.stringify(entry) + '\n');
    this.apply(entry);
  }

  private apply(r: RecordEntry): void {
    switch (r.type) {
      case 'agent.registered': {
        const agent: Agent = {
          builder_id: r.builder_id,
          name: r.name,
          description: r.description,
          key_hash: r.key_hash,
          claim_id: r.claim_id,
          status: 'unclaimed',
          code: r.code,
          code_issued_at: r.ts,
          proof_url: null,
          created_at: r.ts,
          claimed_at: null,
        };
        this.agents.set(agent.builder_id, agent);
        this.agentsByKeyHash.set(agent.key_hash, agent);
        break;
      }
      case 'agent.code_reissued': {
        const a = this.agents.get(r.builder_id);
        if (a) {
          a.code = r.code;
          a.code_issued_at = r.ts;
        }
        break;
      }
      case 'agent.claimed': {
        const a = this.agents.get(r.builder_id);
        if (a) {
          a.status = 'claimed';
          a.code = null; // single-use: consumed
          a.proof_url = r.proof_url;
          a.claimed_at = r.ts;
        }
        break;
      }
      case 'structure.declared':
        this.structures.set(r.structure_id, {
          structure_id: r.structure_id,
          builder_id: r.builder_id,
          name: r.name,
          bbox: r.bbox,
          brief: r.brief,
          style: r.style,
          created_at: r.ts,
        });
        break;
      case 'talk.posted':
        this.talk.push({ talk_id: r.talk_id, structure_id: r.structure_id, author: r.author, text: r.text, ts: r.ts });
        break;
      case 'report.filed':
        this.reports.push({ report_id: r.report_id, reporter: r.reporter, target: r.target, reason: r.reason, ts: r.ts });
        break;
      case 'inbox.fetched':
        this.inboxCursor.set(r.builder_id, { seq: r.seq, talk_index: r.talk_index });
        break;
      case 'build.recorded': {
        let u = this.usage.get(r.builder_id);
        if (!u) this.usage.set(r.builder_id, (u = { total: 0, byDay: new Map() }));
        u.total += r.charged;
        const day = utcDay(r.ts);
        u.byDay.set(day, (u.byDay.get(day) ?? 0) + r.charged);
        this.idempotency.remember(r.builder_id, r.idempotency_key, { hash: r.hash, response: r.response, ts: r.ts }, this.now());
        break;
      }
    }
  }

  usedTotal(builder: string): number {
    return this.usage.get(builder)?.total ?? 0;
  }

  usedOnDay(builder: string, ms: number): number {
    return this.usage.get(builder)?.byDay.get(utcDay(ms)) ?? 0;
  }
}
