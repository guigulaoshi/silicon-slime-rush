export type SurfaceKind = 'slick';

export interface SurfaceZone {
  key: string;
  tile: string | null;
  source: 'static' | 'dynamic';
  kind: SurfaceKind;
  x: number;
  z: number;
  radius: number;
}

export interface SurfaceSample {
  slick: number;
}

const CELL_SIZE = 8;
const EDGE_FEATHER = 0.8;

/** One spatial index for runtime slick/collapse zones. */
export class SurfaceGrid {
  private readonly zones = new Map<string, SurfaceZone>();
  private readonly cells = new Map<string, Set<string>>();
  private readonly order: string[] = [];

  constructor(private limit: number) {}

  get count(): number { return this.zones.size; }

  add(zone: Readonly<SurfaceZone>): SurfaceZone[] {
    this.remove(zone.key);
    const stored: SurfaceZone = { ...zone, radius: Math.max(0.1, zone.radius) };
    this.zones.set(stored.key, stored);
    if (stored.source === 'dynamic') this.order.push(stored.key);
    this.index(stored, true);
    return this.trim();
  }

  remove(key: string): SurfaceZone | null {
    const zone = this.zones.get(key);
    if (!zone) return null;
    this.index(zone, false);
    this.zones.delete(key);
    const at = this.order.indexOf(key);
    if (at >= 0) this.order.splice(at, 1);
    return zone;
  }

  removeTile(tile: string): SurfaceZone[] {
    const removed: SurfaceZone[] = [];
    for (const zone of [...this.zones.values()]) {
      if (zone.tile !== tile) continue;
      const item = this.remove(zone.key);
      if (item) removed.push(item);
    }
    return removed;
  }

  setLimit(limit: number): SurfaceZone[] {
    this.limit = Math.max(0, limit);
    return this.trim();
  }

  query(x: number, z: number): SurfaceSample {
    const keys = this.cells.get(this.cell(x, z));
    let slick = 0;
    if (!keys) return { slick };
    for (const key of keys) {
      const zone = this.zones.get(key);
      if (!zone) continue;
      const distance = Math.hypot(x - zone.x, z - zone.z);
      if (distance >= zone.radius) continue;
      const strength = Math.min(1, (zone.radius - distance) / EDGE_FEATHER);
      slick = Math.max(slick, strength);
    }
    return { slick };
  }

  private trim(): SurfaceZone[] {
    const removed: SurfaceZone[] = [];
    // Dynamic residue uses whatever room remains under the quality ceiling and is eligible for FIFO reuse.
    while (this.zones.size > this.limit && this.order.length > 0) {
      const key = this.order[0];
      if (key === undefined) break;
      const zone = this.remove(key);
      if (zone) removed.push(zone);
    }
    return removed;
  }

  private index(zone: SurfaceZone, add: boolean): void {
    const minX = Math.floor((zone.x - zone.radius) / CELL_SIZE);
    const maxX = Math.floor((zone.x + zone.radius) / CELL_SIZE);
    const minZ = Math.floor((zone.z - zone.radius) / CELL_SIZE);
    const maxZ = Math.floor((zone.z + zone.radius) / CELL_SIZE);
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const cell = `${x}:${z}`;
      if (add) {
        const keys = this.cells.get(cell) ?? new Set<string>();
        keys.add(zone.key);
        this.cells.set(cell, keys);
      } else {
        const keys = this.cells.get(cell);
        keys?.delete(zone.key);
        if (keys?.size === 0) this.cells.delete(cell);
      }
    }
  }

  private cell(x: number, z: number): string {
    return `${Math.floor(x / CELL_SIZE)}:${Math.floor(z / CELL_SIZE)}`;
  }
}
