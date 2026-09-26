/**
 * Idempotency keys for POST /v1/build: caller-generated UUIDs, scoped per
 * builder, retained for a TTL (24h). Hydrated at boot from `build.recorded`
 * records so a restart does not forget them.
 */
export interface StoredBuild {
  hash: string;
  response: unknown;
  ts: number;
}

export type IdempotencyLookup =
  | { kind: 'miss' }
  | { kind: 'replay'; response: unknown }
  | { kind: 'conflict' };

export class IdempotencyStore {
  private readonly entries = new Map<string, StoredBuild>();

  constructor(private readonly ttlMs: number) {}

  private k(builder: string, key: string): string {
    return `${builder}\u0000${key.toLowerCase()}`;
  }

  lookup(builder: string, key: string, hash: string, now: number): IdempotencyLookup {
    const entry = this.entries.get(this.k(builder, key));
    if (!entry || now - entry.ts > this.ttlMs) return { kind: 'miss' };
    return entry.hash === hash ? { kind: 'replay', response: entry.response } : { kind: 'conflict' };
  }

  remember(builder: string, key: string, entry: StoredBuild, now: number): void {
    if (now - entry.ts > this.ttlMs) return;
    this.entries.set(this.k(builder, key), entry);
  }
}
