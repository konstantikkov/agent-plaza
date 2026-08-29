import * as THREE from 'three';
import { cellWorld } from '@/entities/world/constants';
import type { PlazaWorld } from '@/entities/world';
import type { PlazaNet } from '@/entities/session';
import type { RenderApi } from './types';
import { STATIONS, stationById } from './registry';
import { MODULES } from './modules';
import { disposeGroup } from './voxel';

/**
 * Draws the live state of every station (blocks, pieces, stones, the ball,
 * the singer) by re-rendering a station's dynamic group whenever its version
 * changes. Modules may also expose an optional per-frame `tick`.
 */
export class StationsView {
  private groups = new Map<string, THREE.Group>();
  private versions = new Map<string, number>();
  private unsubs: Array<() => void>;

  constructor(
    private world: PlazaWorld,
    private net: PlazaNet,
  ) {
    for (const s of STATIONS) {
      const g = new THREE.Group();
      world.getSurface().add(g);
      this.groups.set(s.id, g);
    }
    this.unsubs = [
      net.events.on('station', ({ id }) => this.refresh(id)),
      world.addTickHook((_dt, time) => this.tick(time)),
    ];
    for (const s of STATIONS) this.refresh(s.id);
  }

  dispose(): void {
    this.unsubs.forEach((off) => off());
    for (const g of this.groups.values()) {
      disposeGroup(g);
      this.world.getSurface().remove(g);
    }
    this.groups.clear();
  }

  private api(group: THREE.Group, time: number): RenderApi {
    return {
      group,
      cellWorld: (x, z) => cellWorld(x, z),
      groundY: (x, z) => this.world.groundHeightAt(x, z),
      nameOf: (id) =>
        this.net.agents().find((a) => a.id === id)?.name ??
        (id === this.net.self?.id ? this.net.self?.name ?? 'you' : 'someone'),
      time,
    };
  }

  private refresh(id: string): void {
    const def = stationById(id);
    const mod = def && MODULES[def.kind];
    const group = this.groups.get(id);
    if (!def || !mod || !group) return;
    const st = this.net.station(id);
    const ver = st?.version ?? -1;
    if (this.versions.get(id) === ver) return;
    this.versions.set(id, ver);
    disposeGroup(group);
    group.clear();
    mod.render(def, st ? { seats: st.seats, state: st.state } : undefined, this.api(group, 0));
  }

  private tick(time: number): void {
    for (const def of STATIONS) {
      const mod = MODULES[def.kind];
      const group = this.groups.get(def.id);
      if (!mod?.tick || !group) continue;
      const st = this.net.station(def.id);
      mod.tick(def, st ? { seats: st.seats, state: st.state } : undefined, this.api(group, time));
    }
  }
}
