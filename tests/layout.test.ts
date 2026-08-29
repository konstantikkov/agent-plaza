import { createLayout } from '@/entities/world/layout';
import { N } from '@/entities/world/constants';

describe('world layout generator (room = seed)', () => {
  it('is fully deterministic for the same seed', () => {
    const a = createLayout('orchard-vale');
    const b = createLayout('orchard-vale');
    expect(JSON.stringify(a.layout)).toBe(JSON.stringify(b.layout));
    expect(a.strokes).toEqual(b.strokes);
  });

  it('differs between seeds', () => {
    const a = createLayout('orchard-vale');
    const b = createLayout('glade-meadow');
    expect(JSON.stringify(a.layout)).not.toBe(JSON.stringify(b.layout));
  });

  it('applies overrides (daytime, weather, river)', () => {
    // orchard-vale is a garden world, so the river override applies
    const { layout } = createLayout('orchard-vale', { daytime: 'day', weather: 'clear', hasRiver: true });
    expect(layout.archetype).not.toBe('mesa');
    expect(layout.daytimePick).toBe('day');
    expect(layout.weatherPick).toBe('clear');
    expect(layout.hasRiver).toBe(true);
  });

  it('mesa worlds stay dry even when a river is requested (by design)', () => {
    // 'harbor' generates a mesa; the engine never carves rivers through mesas
    const { layout } = createLayout('harbor', { hasRiver: true });
    expect(layout.archetype).toBe('mesa');
    expect(layout.hasRiver).toBe(false);
  });

  it('keeps key places inside the board', () => {
    for (const seed of ['a', 'plaza', 'orchard-vale', 'xyz-123']) {
      const { layout } = createLayout(seed);
      for (const p of [layout.spawn, layout.guide, layout.village, { x: layout.portal.cx, z: layout.portal.cz }]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(N);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeLessThan(N);
      }
    }
  });
});
