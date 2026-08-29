import type { GridPosition } from '../shared';
import type { Grid } from './grid';
import { manhattan } from './coords';

/**
 * Grid A*, 4-directional (no corner cutting to worry about).
 * Returns the path INCLUDING start and goal, or null when unreachable.
 * 15×15 maps don't need a heap; a linear open list is fine.
 */
export function findPath(
  grid: Grid,
  start: GridPosition,
  goal: GridPosition,
  opts: { ignoreOccupants?: string[] } = {},
): GridPosition[] | null {
  const ignore = new Set(opts.ignoreOccupants ?? []);
  const walkable = (x: number, z: number): boolean => {
    const cell = grid.cellAt(x, z);
    if (!cell || !cell.walkable) return false;
    return !cell.occupiedBy || ignore.has(cell.occupiedBy);
  };

  if (!grid.inBounds(start.x, start.z) || !walkable(goal.x, goal.z)) return null;
  if (start.x === goal.x && start.z === goal.z) return [start];

  const key = (x: number, z: number) => z * grid.width + x;
  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const open = new Map<number, number>(); // key -> fScore
  const closed = new Set<number>();

  const startKey = key(start.x, start.z);
  gScore.set(startKey, 0);
  open.set(startKey, manhattan(start, goal));

  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (open.size > 0) {
    let currentKey = -1;
    let bestF = Infinity;
    for (const [k, f] of open) {
      if (f < bestF) {
        bestF = f;
        currentKey = k;
      }
    }
    open.delete(currentKey);
    closed.add(currentKey);

    const cx = currentKey % grid.width;
    const cz = Math.floor(currentKey / grid.width);

    if (cx === goal.x && cz === goal.z) {
      const path: GridPosition[] = [{ x: cx, z: cz }];
      let k = currentKey;
      while (cameFrom.has(k)) {
        k = cameFrom.get(k)!;
        path.push({ x: k % grid.width, z: Math.floor(k / grid.width) });
      }
      return path.reverse();
    }

    for (const [dx, dz] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!walkable(nx, nz)) continue;
      const nKey = key(nx, nz);
      if (closed.has(nKey)) continue;
      const tentative = (gScore.get(currentKey) ?? Infinity) + 1;
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentative);
        open.set(nKey, tentative + manhattan({ x: nx, z: nz }, goal));
      }
    }
  }
  return null;
}
