import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';

/**
 * The world's source of truth: an append-only NDJSON log of immutable events.
 * Block events change cells; admin events tombstone / restore earlier events.
 * Both share one monotonically increasing `seq`.
 */
export interface BlockEvent {
  kind: 'block';
  seq: number;
  ts: string;
  builder: string;
  op: 'place' | 'remove';
  x: number;
  y: number;
  z: number;
  block?: string;
}

export interface AdminEvent {
  kind: 'admin';
  seq: number;
  ts: string;
  action: 'hide' | 'unhide';
  event_seqs: number[];
  structure_id?: string;
}

export type LogEvent = BlockEvent | AdminEvent;

/**
 * Snapshot of the materialised cell state at `last_seq`. It is a boot-time
 * cache only; the event log remains authoritative.
 */
export interface Snapshot {
  last_seq: number;
  /** Present event-placed blocks: [x, y, z, block, builder, seq]. */
  cells: [number, number, number, string, string, number][];
  /** Terrain cells whose latest (visible) event is a remove: [x, y, z]. */
  removed_terrain: [number, number, number][];
}

export class EventLog {
  readonly file: string;
  readonly snapshotDir: string;
  private fd: number | null = null;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'events.ndjson');
    this.snapshotDir = path.join(dataDir, 'snapshots');
    mkdirSync(this.snapshotDir, { recursive: true });
  }

  readAll(): LogEvent[] {
    if (!existsSync(this.file)) return [];
    const out: LogEvent[] = [];
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      out.push(JSON.parse(line) as LogEvent);
    }
    return out;
  }

  /** Synchronous append: an op is applied only after its event is written to the log. */
  append(events: readonly LogEvent[]): void {
    if (events.length === 0) return;
    if (this.fd === null) this.fd = openSync(this.file, 'a');
    writeSync(this.fd, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }

  close(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
  }

  writeSnapshot(snapshot: Snapshot): void {
    const name = `snapshot-${String(snapshot.last_seq).padStart(12, '0')}.json`;
    const tmp = path.join(this.snapshotDir, `${name}.tmp`);
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, path.join(this.snapshotDir, name));
  }

  readLatestSnapshot(): Snapshot | null {
    const names = readdirSync(this.snapshotDir)
      .filter((n) => /^snapshot-\d+\.json$/.test(n))
      .sort();
    const newest = names[names.length - 1];
    if (!newest) return null;
    return JSON.parse(readFileSync(path.join(this.snapshotDir, newest), 'utf8')) as Snapshot;
  }
}
