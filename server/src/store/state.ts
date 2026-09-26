import { terrainCell } from '../world/terrain.js';
import type { AdminEvent, BlockEvent, EventLog, LogEvent, Snapshot } from './eventlog.js';

/**
 * In-memory materialisation of the world = terrain (computed) + event replay.
 *
 * Rule for a cell: its value is decided by the latest NON-tombstoned block
 * event at that cell — `place` → that block, `remove` → air. A cell with no
 * such event shows its terrain (if any). Nothing here is stored except as a
 * derivation of the event log.
 */

const SIZE = 2048;

export function cellKey(x: number, y: number, z: number): number {
  return (x * SIZE + y) * SIZE + z;
}

export function decodeKey(key: number): [number, number, number] {
  const z = key % SIZE;
  const rest = (key - z) / SIZE;
  const y = rest % SIZE;
  const x = (rest - y) / SIZE;
  return [x, y, z];
}

/** 16×16 column chunks for spatial queries. */
function chunkKey(x: number, z: number): number {
  return (x >> 4) * 256 + (z >> 4);
}

export interface PlacedCell {
  x: number;
  y: number;
  z: number;
  block: string;
  builder: string;
  seq: number;
}

export interface CellRead {
  block: string;
  /** null for terrain. */
  builder: string | null;
}

export interface Bbox3 {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
}

export class WorldState {
  /** All events by seq (index = seq - 1). */
  private readonly events: LogEvent[] = [];
  /** Per-cell history of block event seqs, ascending. */
  private readonly history = new Map<number, number[]>();
  private readonly tombstoned = new Set<number>();
  /** Present, visible event-placed blocks. */
  private readonly cells = new Map<number, PlacedCell>();
  /** Terrain cells currently dug out (latest visible event is a remove). */
  private readonly removedTerrain = new Set<number>();
  private readonly chunks = new Map<number, Set<number>>();
  /** Structures hidden by admin events. */
  private readonly hiddenStructures = new Set<string>();

  lastSnapshotSeq = 0;

  constructor(
    private readonly log: EventLog,
    private readonly snapshotEvery: number,
  ) {}

  close(): void {
    this.log.close();
  }

  // ---------------------------------------------------------------- boot

  /** Boot: newest snapshot + event tail. Falls back to full replay without a usable snapshot. */
  load(): void {
    const all = this.log.readAll();
    const snapshot = this.log.readLatestSnapshot();
    const usable = snapshot !== null && snapshot.last_seq <= all.length ? snapshot : null;

    // Index the full log (history, tombstones) — cheap bookkeeping, no materialisation.
    for (const e of all) this.index(e);

    let tailFrom = 0;
    if (usable) {
      for (const [x, y, z, block, builder, seq] of usable.cells) {
        this.setPresent(cellKey(x, y, z), { x, y, z, block, builder, seq });
      }
      for (const [x, y, z] of usable.removed_terrain) this.removedTerrain.add(cellKey(x, y, z));
      tailFrom = usable.last_seq;
      this.lastSnapshotSeq = usable.last_seq;
    }

    // Re-materialise every cell touched by the tail (block events, and cells whose events an admin event toggled).
    const touched = new Set<number>();
    for (let i = tailFrom; i < all.length; i++) {
      for (const key of this.cellsAffectedBy(all[i])) touched.add(key);
    }
    for (const key of touched) this.materialise(key);
  }

  private index(e: LogEvent): void {
    if (e.seq !== this.events.length + 1) {
      throw new Error(`event log out of order: expected seq ${this.events.length + 1}, got ${e.seq}`);
    }
    this.events.push(e);
    if (e.kind === 'block') {
      const key = cellKey(e.x, e.y, e.z);
      let h = this.history.get(key);
      if (!h) this.history.set(key, (h = []));
      h.push(e.seq);
    } else {
      this.applyAdminBookkeeping(e);
    }
  }

  private applyAdminBookkeeping(e: AdminEvent): void {
    for (const s of e.event_seqs) {
      if (e.action === 'hide') this.tombstoned.add(s);
      else this.tombstoned.delete(s);
    }
    if (e.structure_id) {
      if (e.action === 'hide') this.hiddenStructures.add(e.structure_id);
      else this.hiddenStructures.delete(e.structure_id);
    }
  }

  private cellsAffectedBy(e: LogEvent): number[] {
    if (e.kind === 'block') return [cellKey(e.x, e.y, e.z)];
    const keys: number[] = [];
    for (const s of e.event_seqs) {
      const target = this.events[s - 1];
      if (target && target.kind === 'block') keys.push(cellKey(target.x, target.y, target.z));
    }
    return keys;
  }

  // ---------------------------------------------------------------- writes

  get headSeq(): number {
    return this.events.length;
  }

  /**
   * Append block events (already validated) to the log and materialise them.
   * Caller supplies everything but seq.
   */
  appendBlockEvents(drafts: Omit<BlockEvent, 'seq' | 'kind'>[]): BlockEvent[] {
    const created: BlockEvent[] = drafts.map((d, i) => ({ kind: 'block', seq: this.headSeq + 1 + i, ...d }));
    this.commit(created);
    return created;
  }

  appendAdminEvent(draft: Omit<AdminEvent, 'seq' | 'kind'>): AdminEvent {
    const event: AdminEvent = { kind: 'admin', seq: this.headSeq + 1, ...draft };
    this.commit([event]);
    return event;
  }

  /** Log first (durability), then index + materialise, then maybe snapshot. */
  private commit(events: LogEvent[]): void {
    this.log.append(events);
    for (const e of events) {
      this.index(e);
      for (const key of this.cellsAffectedBy(e)) this.materialise(key);
    }
    this.maybeSnapshot();
  }

  private maybeSnapshot(): void {
    if (this.snapshotEvery <= 0) return;
    if (Math.floor(this.headSeq / this.snapshotEvery) > Math.floor(this.lastSnapshotSeq / this.snapshotEvery)) {
      this.log.writeSnapshot(this.toSnapshot());
      this.lastSnapshotSeq = this.headSeq;
    }
  }

  toSnapshot(): Snapshot {
    const cells: Snapshot['cells'] = [];
    for (const c of this.cells.values()) cells.push([c.x, c.y, c.z, c.block, c.builder, c.seq]);
    const removed: Snapshot['removed_terrain'] = [];
    for (const key of this.removedTerrain) removed.push(decodeKey(key));
    return { last_seq: this.headSeq, cells, removed_terrain: removed };
  }

  // ---------------------------------------------------------------- materialisation

  private materialise(key: number): void {
    const [x, y, z] = decodeKey(key);
    const h = this.history.get(key) ?? [];
    let latest: BlockEvent | null = null;
    for (let i = h.length - 1; i >= 0; i--) {
      if (this.tombstoned.has(h[i])) continue;
      latest = this.events[h[i] - 1] as BlockEvent;
      break;
    }

    this.clearPresent(key);
    this.removedTerrain.delete(key);
    if (latest === null) return; // terrain (if any) shows through
    if (latest.op === 'place') {
      this.setPresent(key, { x, y, z, block: latest.block!, builder: latest.builder, seq: latest.seq });
    } else if (terrainCell(x, y, z) !== null) {
      this.removedTerrain.add(key);
    }
  }

  private setPresent(key: number, cell: PlacedCell): void {
    this.cells.set(key, cell);
    const ck = chunkKey(cell.x, cell.z);
    let set = this.chunks.get(ck);
    if (!set) this.chunks.set(ck, (set = new Set()));
    set.add(key);
  }

  private clearPresent(key: number): void {
    const existing = this.cells.get(key);
    if (!existing) return;
    this.cells.delete(key);
    const ck = chunkKey(existing.x, existing.z);
    const set = this.chunks.get(ck);
    if (set) {
      set.delete(key);
      if (set.size === 0) this.chunks.delete(ck);
    }
  }

  // ---------------------------------------------------------------- reads

  /** Visible event-placed block at a cell (terrain excluded). */
  placedAt(x: number, y: number, z: number): PlacedCell | undefined {
    return this.cells.get(cellKey(x, y, z));
  }

  /** What a viewer sees at a cell: placed block, else terrain (unless dug), else null (air). */
  read(x: number, y: number, z: number): CellRead | null {
    const key = cellKey(x, y, z);
    const placed = this.cells.get(key);
    if (placed) return { block: placed.block, builder: placed.builder };
    const terrain = terrainCell(x, y, z);
    if (terrain !== null && !this.removedTerrain.has(key)) return { block: terrain, builder: null };
    return null;
  }

  isTerrainRemoved(x: number, y: number, z: number): boolean {
    return this.removedTerrain.has(cellKey(x, y, z));
  }

  /** Visible event-placed blocks inside an inclusive 3D bbox. */
  placedInBox(b: Bbox3): PlacedCell[] {
    const out: PlacedCell[] = [];
    for (let cx = b.x1 >> 4; cx <= b.x2 >> 4; cx++) {
      for (let cz = b.z1 >> 4; cz <= b.z2 >> 4; cz++) {
        const set = this.chunks.get(cx * 256 + cz);
        if (!set) continue;
        for (const key of set) {
          const c = this.cells.get(key)!;
          if (c.x >= b.x1 && c.x <= b.x2 && c.y >= b.y1 && c.y <= b.y2 && c.z >= b.z1 && c.z <= b.z2) out.push(c);
        }
      }
    }
    return out;
  }

  /** Visible (non-tombstoned) block events with seq > since, up to limit. */
  eventsSince(since: number, limit: number): { events: BlockEvent[]; scannedTo: number } {
    const out: BlockEvent[] = [];
    let seq = Math.max(0, since);
    while (seq < this.headSeq && out.length < limit) {
      seq++;
      const e = this.events[seq - 1];
      if (e.kind === 'block' && !this.tombstoned.has(seq)) out.push(e);
    }
    return { events: out, scannedTo: seq };
  }

  /** Every block event (tombstoned or not) — for admin selection and inbox scans. */
  blockEventsBetween(sinceExclusive: number, untilInclusive: number): BlockEvent[] {
    const out: BlockEvent[] = [];
    for (let s = Math.max(1, sinceExclusive + 1); s <= Math.min(untilInclusive, this.headSeq); s++) {
      const e = this.events[s - 1];
      if (e.kind === 'block') out.push(e);
    }
    return out;
  }

  isTombstoned(seq: number): boolean {
    return this.tombstoned.has(seq);
  }

  eventExists(seq: number): boolean {
    return Number.isInteger(seq) && seq >= 1 && seq <= this.headSeq && this.events[seq - 1].kind === 'block';
  }

  isStructureHidden(id: string): boolean {
    return this.hiddenStructures.has(id);
  }
}
