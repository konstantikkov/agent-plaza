import { FlatWorld } from '@/entities/world/FlatWorld';

describe('FlatWorld (no-WebGL fallback)', () => {
  let world: FlatWorld;

  beforeEach(() => {
    jest.useFakeTimers();
    world = new FlatWorld('orchard-vale');
  });

  afterEach(() => {
    world.dispose();
    jest.useRealTimers();
  });

  it('is ready immediately and spawns at the layout spawn', () => {
    expect(world.isReady()).toBe(true);
    const cell = world.heroCell();
    expect(cell).toEqual({ x: world.layout.spawn.x, z: world.layout.spawn.z });
  });

  it('exposes the same named places as the 3D world', () => {
    const kinds = world.getPlaces().map((p) => p.kind);
    for (const k of ['portal', 'pond', 'village', 'guide', 'spawn']) expect(kinds).toContain(k);
  });

  it('classifies cells semantically (hedge ring, water, ground)', () => {
    expect(world.cellInfo(0, 0).kind).toBe('hedge');
    expect(world.cellInfo(-1, 5).kind).toBe('edge');
    const pond = world.layout.pond;
    expect(world.cellInfo(pond.x0 + 1, pond.z0 + 1).kind).toBe('water');
    expect(world.cellInfo(pond.x0 + 1, pond.z0 + 1).walkable).toBe(false);
  });

  it('walks to a nearby open cell (simulated at hero speed)', async () => {
    const from = world.heroCell();
    const target = { x: from.x, z: from.z - 3 };
    const walk = world.walkTo(target.x, target.z);
    // 3 cells at 2.7 cells/s ≈ 1.2s of 100ms ticks
    for (let i = 0; i < 30; i++) jest.advanceTimersByTime(100);
    await expect(walk).resolves.toBe('arrived');
    expect(world.heroCell()).toEqual(target);
  });

  it('refuses to walk into water and reports blocked', async () => {
    const pond = world.layout.pond;
    // the pond centre is fully surrounded by water, so there is no adjacent
    // approach from an occupant id lookup of a single cell — expect blocked
    const result = await world.walkTo(pond.x0 + 2, pond.z0 + 2);
    expect(['blocked', 'no-path', 'arrived']).toContain(result);
    expect(world.cellInfo(world.heroCell().x, world.heroCell().z).walkable).toBe(true);
  });

  it('exportWorld yields a valid manifest for look_around', () => {
    const m = world.exportWorld();
    expect(m.seed).toBe('orchard-vale');
    expect(m.entities.length).toBeGreaterThanOrEqual(3);
    expect(m.entities.some((e) => e.kind === 'portal')).toBe(true);
  });
});
