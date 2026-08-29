import type { GridPosition } from '../shared';

/**
 * The single place where logical grid coordinates become world units.
 * One block = one world unit. Cell [x, z] spans world [x, x+1) × [z, z+1);
 * its walkable center is at (x + 0.5, z + 0.5).
 */
export const BLOCK_SIZE = 1;

export interface WorldPosition {
  x: number;
  z: number;
}

/** World-space center of a grid cell. */
export function gridToWorld(x: number, z: number): WorldPosition {
  return { x: (x + 0.5) * BLOCK_SIZE, z: (z + 0.5) * BLOCK_SIZE };
}

/** World-space center of a footprint anchored at [x, z] (anchor = min corner cell). */
export function footprintCenterWorld(
  x: number,
  z: number,
  footprint: { width: number; depth: number },
): WorldPosition {
  return {
    x: (x + footprint.width / 2) * BLOCK_SIZE,
    z: (z + footprint.depth / 2) * BLOCK_SIZE,
  };
}

export function worldToGrid(worldX: number, worldZ: number): GridPosition {
  return { x: Math.floor(worldX / BLOCK_SIZE), z: Math.floor(worldZ / BLOCK_SIZE) };
}

export function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.z === b.z;
}

/** Chebyshev distance — adjacency including diagonals. */
export function chebyshev(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function manhattan(a: GridPosition, b: GridPosition): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}
