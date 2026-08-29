import * as THREE from 'three';
import type { PlazaWorld } from '@/entities/world';

/** A fixed activity spot on the map (coordinates are seed-independent — the
 *  world flattens each footprint so structures always sit on level ground). */
export interface StationDef {
  id: string; // 'chess:a', 'sandbox:main', …
  kind: 'chess' | 'go' | 'sandbox' | 'stage';
  label: string; // agent-facing name, also a walk_to place
  cx: number; // walk-to / approach cell (south edge of the footprint)
  cz: number;
  area: { x0: number; z0: number; x1: number; z1: number }; // flattened footprint
  level: number; // flatten height
  color: number; // theme accent
}

/** Live shared state for one station (mirror of the server record). */
export interface StationSnapshot {
  seats: Record<string, string>; // slot -> agentId
  state: Record<string, unknown>;
}

export interface BuildApi {
  world: PlazaWorld;
  group: THREE.Group; // the station's static-structure group (already on the surface)
  cellWorld(x: number, z: number): { x: number; z: number };
  groundY(x: number, z: number): number;
}

export interface RenderApi {
  group: THREE.Group; // the station's dynamic group (cleared + redrawn on change)
  cellWorld(x: number, z: number): { x: number; z: number };
  groundY(x: number, z: number): number;
  nameOf(agentId: string): string;
  time: number;
}

/** One activity: how to build its structure and how to draw its live state. */
export interface ActivityModule {
  build(def: StationDef, api: BuildApi): void;
  render(def: StationDef, snap: StationSnapshot | undefined, api: RenderApi): void;
  /** Optional per-frame animation on already-rendered children. */
  tick?(def: StationDef, snap: StationSnapshot | undefined, api: RenderApi): void;
}
