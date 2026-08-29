import type { GridPosition } from '../shared';
import { TERRAIN_WALKABLE, type TerrainType } from './terrain';

export interface GridCell {
  x: number;
  z: number;
  terrain: TerrainType;
  walkable: boolean;
  occupiedBy?: string;
}

export interface Footprint {
  width: number;
  depth: number;
}

/**
 * Logical occupancy grid. Knows nothing about rendering.
 * Multi-cell objects are anchored at their minimum-corner cell and occupy
 * `width × depth` cells toward +x/+z.
 */
export class Grid {
  readonly width: number;
  readonly depth: number;
  private cells: GridCell[];
  private occupants = new Map<string, GridPosition[]>();

  constructor(width: number, depth: number, defaultTerrain: TerrainType = 'floor') {
    this.width = width;
    this.depth = depth;
    this.cells = [];
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        this.cells.push({
          x,
          z,
          terrain: defaultTerrain,
          walkable: TERRAIN_WALKABLE[defaultTerrain],
        });
      }
    }
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth;
  }

  cellAt(x: number, z: number): GridCell | undefined {
    if (!this.inBounds(x, z)) return undefined;
    return this.cells[z * this.width + x];
  }

  setTerrain(x: number, z: number, terrain: TerrainType): void {
    const cell = this.cellAt(x, z);
    if (!cell) throw new Error(`setTerrain out of bounds: ${x},${z}`);
    cell.terrain = terrain;
    cell.walkable = TERRAIN_WALKABLE[terrain];
  }

  /** Walkable = terrain allows it AND no blocking occupant. */
  isWalkable(x: number, z: number): boolean {
    const cell = this.cellAt(x, z);
    return !!cell && cell.walkable && !cell.occupiedBy;
  }

  occupantAt(x: number, z: number): string | undefined {
    return this.cellAt(x, z)?.occupiedBy;
  }

  footprintCells(x: number, z: number, footprint: Footprint): GridPosition[] {
    const out: GridPosition[] = [];
    for (let dz = 0; dz < footprint.depth; dz++) {
      for (let dx = 0; dx < footprint.width; dx++) {
        out.push({ x: x + dx, z: z + dz });
      }
    }
    return out;
  }

  /** True when every footprint cell is in bounds, terrain-walkable and unoccupied. */
  canPlace(x: number, z: number, footprint: Footprint): boolean {
    return this.footprintCells(x, z, footprint).every((p) => {
      const cell = this.cellAt(p.x, p.z);
      return !!cell && cell.walkable && !cell.occupiedBy;
    });
  }

  place(instanceId: string, x: number, z: number, footprint: Footprint): void {
    if (this.occupants.has(instanceId)) {
      throw new Error(`instance already placed: ${instanceId}`);
    }
    if (!this.canPlace(x, z, footprint)) {
      throw new Error(`cannot place ${instanceId} at ${x},${z} (${footprint.width}×${footprint.depth})`);
    }
    const cells = this.footprintCells(x, z, footprint);
    for (const p of cells) {
      const cell = this.cellAt(p.x, p.z);
      if (cell) cell.occupiedBy = instanceId;
    }
    this.occupants.set(instanceId, cells);
  }

  remove(instanceId: string): boolean {
    const cells = this.occupants.get(instanceId);
    if (!cells) return false;
    for (const p of cells) {
      const cell = this.cellAt(p.x, p.z);
      if (cell && cell.occupiedBy === instanceId) cell.occupiedBy = undefined;
    }
    this.occupants.delete(instanceId);
    return true;
  }

  cellsOf(instanceId: string): GridPosition[] {
    return this.occupants.get(instanceId) ?? [];
  }

  occupiedCells(): GridCell[] {
    return this.cells.filter((c) => c.occupiedBy !== undefined);
  }

  allCells(): readonly GridCell[] {
    return this.cells;
  }

  /** Nearest walkable cell adjacent (8-neighborhood) to any footprint cell of an instance. */
  nearestAdjacentWalkable(instanceId: string, from: GridPosition): GridPosition | undefined {
    const cells = this.cellsOf(instanceId);
    let best: GridPosition | undefined;
    let bestDist = Infinity;
    for (const c of cells) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const x = c.x + dx;
          const z = c.z + dz;
          if (!this.isWalkable(x, z)) continue;
          const d = Math.abs(x - from.x) + Math.abs(z - from.z);
          if (d < bestDist) {
            bestDist = d;
            best = { x, z };
          }
        }
      }
    }
    return best;
  }
}
