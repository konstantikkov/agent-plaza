import { Grid, findPath } from '@/shared/lib/game-core/index';

describe('Grid + A* pathfinding (the walk_to engine)', () => {
  it('finds a straight path on open ground', () => {
    const grid = new Grid(10, 10, 'floor');
    const path = findPath(grid, { x: 1, z: 1 }, { x: 6, z: 1 });
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 6, z: 1 });
    expect(path!.length).toBeGreaterThanOrEqual(6);
  });

  it('routes around an obstacle wall', () => {
    const grid = new Grid(10, 10, 'floor');
    // wall across x=4 with one gap at z=8
    for (let z = 0; z < 8; z++) grid.place(`wall-${z}`, 4, z, { width: 1, depth: 1 });
    const path = findPath(grid, { x: 1, z: 1 }, { x: 8, z: 1 });
    expect(path).not.toBeNull();
    // the path must pass through the gap row
    expect(path!.some((c) => c.z >= 8)).toBe(true);
    // and never step on a wall cell
    for (const c of path!) expect(grid.isWalkable(c.x, c.z) || (c.x === 1 && c.z === 1)).toBe(true);
  });

  it('returns null when the target is unreachable', () => {
    const grid = new Grid(10, 10, 'floor');
    for (let z = 0; z < 10; z++) grid.place(`wall-${z}`, 4, z, { width: 1, depth: 1 });
    expect(findPath(grid, { x: 1, z: 1 }, { x: 8, z: 1 })).toBeNull();
  });

  it('placed footprints block walkability and can be removed', () => {
    const grid = new Grid(10, 10, 'floor');
    grid.place('hut', 2, 2, { width: 2, depth: 2 });
    expect(grid.isWalkable(2, 2)).toBe(false);
    expect(grid.isWalkable(3, 3)).toBe(false);
    expect(grid.occupantAt(3, 2)).toBe('hut');
    grid.remove('hut');
    expect(grid.isWalkable(2, 2)).toBe(true);
  });

  it('nearestAdjacentWalkable finds an approach cell next to an occupant', () => {
    const grid = new Grid(10, 10, 'floor');
    grid.place('table', 5, 5, { width: 1, depth: 1 });
    const approach = grid.nearestAdjacentWalkable('table', { x: 1, z: 5 });
    expect(approach).toBeDefined();
    const d = Math.abs(approach!.x - 5) + Math.abs(approach!.z - 5);
    expect(d).toBe(1);
  });
});
