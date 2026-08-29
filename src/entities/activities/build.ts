import * as THREE from 'three';
import type { PlazaWorld } from '@/entities/world';
import { cellWorld } from '@/entities/world/constants';
import { STATIONS, PLAZA_BANDS } from './registry';
import { MODULES } from './modules';

/** Reserved footprints kept clear of trees/buildings — the whole flat plaza. */
export const STATION_AREAS = PLAZA_BANDS.map((b) => ({ ...b }));

/** Build every activity station: flatten the two plaza bands so the ground is
 *  clean and level, raise the structures, and register each as a walk_to place.
 *  Call once, after the world is ready. */
export function buildActivities(world: PlazaWorld): void {
  for (const b of PLAZA_BANDS) world.openArea(b);
  world.flattenAreas(PLAZA_BANDS.map((b) => ({ ...b, level: 1 })));

  const surface = world.getSurface();
  for (const def of STATIONS) {
    const mod = MODULES[def.kind];
    if (mod) {
      const group = new THREE.Group();
      surface.add(group);
      mod.build(def, {
        world,
        group,
        cellWorld: (x, z) => cellWorld(x, z),
        groundY: (x, z) => world.groundHeightAt(x, z),
      });
    }
    world.registerPlace(def.label, def.cx, def.cz);
    world.registerPlace(def.kind, def.cx, def.cz);
  }
}
