import { Grid, findPath, type GridPosition } from '@/shared/lib/game-core/index';
import { createLayout, type WorldLayout } from './layout';
import { N, BORDER } from './constants';
import type { WorldManifest } from './types';
import type { WorldPort, CellInfo } from './port';

/**
 * The no-WebGL world: the same deterministic layout and the same A* walking,
 * with no rendering at all. When WebGL is unavailable the page runs on this —
 * humans get the 2D map widget, and agents get the identical WebMCP tool
 * surface (the tools only ever talk to WorldPort, so they cannot tell the
 * difference). Simplified terrain: hedge ring, pond, lakes and the river
 * block movement (one bridge crosses the river); everything else is open.
 */
export class FlatWorld implements WorldPort {
  readonly layout: WorldLayout;
  private grid = new Grid(N, N, 'floor');
  private pos: { x: number; z: number };
  private path: GridPosition[] = [];
  private walkResolve: ((r: 'arrived' | 'interrupted') => void) | null = null;
  private ticker: ReturnType<typeof setInterval>;

  constructor(readonly seed: string) {
    this.layout = createLayout(seed, { daytime: 'day', weather: 'clear' }).layout;
    const L = this.layout;

    const block = (id: string, x: number, z: number): void => {
      try {
        this.grid.place(id, x, z, { width: 1, depth: 1 });
      } catch {
        /* already blocked */
      }
    };

    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        // hedge ring with the south gate kept open
        const border = x < BORDER || z < BORDER || x >= N - BORDER || z >= N - BORDER;
        const gate = x >= L.corridorX0 && x <= L.corridorX0 + 3 && z >= N - BORDER;
        if (border && !gate) {
          block(`hedge-${x}-${z}`, x, z);
          continue;
        }
        // pond
        if (x >= L.pond.x0 && x < L.pond.x0 + L.pond.size && z >= L.pond.z0 && z < L.pond.z0 + L.pond.size) {
          block(`water-${x}-${z}`, x, z);
          continue;
        }
        // lakes
        for (const lake of L.lakes) {
          if (Math.hypot(x - lake.x, z - lake.z) < lake.r) {
            block(`water-${x}-${z}`, x, z);
            break;
          }
        }
        // river with one bridge
        if (
          L.hasRiver &&
          z >= L.pond.z0 + L.pond.size + 1 &&
          z <= N - 5 &&
          Math.abs(x + 0.5 - this.riverXAt(z)) < 1.35 &&
          !(z >= L.bridgeZ0 && z <= L.bridgeZ0 + 1) &&
          !(x >= L.corridorX0 && x <= L.corridorX0 + 3)
        ) {
          block(`water-${x}-${z}`, x, z);
        }
      }
    }
    block('portal', L.portal.cx, L.portal.cz);
    block('guide', L.guide.x, L.guide.z);

    this.pos = { x: L.spawn.x, z: L.spawn.z };
    this.ticker = setInterval(() => this.step(), 100); // 10 Hz walking sim
  }

  private lastTick = Date.now();

  private riverXAt(z: number): number {
    const L = this.layout;
    return L.pond.cx + L.riverAmp * Math.sin(z * L.riverFreq + L.riverPhase);
  }

  /** Advance the walk by REAL elapsed time. Browsers throttle timers hard in
   *  background tabs (1s, then 1/min) — using wall-clock time means the walk
   *  still covers the right distance per tick, so remote viewers stay in sync
   *  even when this tab is hidden. */
  private step(): void {
    const now = Date.now();
    let dt = Math.min((now - this.lastTick) / 1000, 10);
    this.lastTick = now;
    const SPEED = 2.7; // hero walking speed, cells/sec
    while (dt > 0 && this.path.length > 0) {
      const target = this.path[0]!;
      const dx = target.x - this.pos.x;
      const dz = target.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = SPEED * dt;
      if (dist <= stepLen) {
        this.pos = { x: target.x, z: target.z };
        this.path.shift();
        dt -= dist / SPEED;
        if (this.path.length === 0 && this.walkResolve) {
          const resolve = this.walkResolve;
          this.walkResolve = null;
          resolve('arrived');
        }
      } else {
        this.pos = { x: this.pos.x + (dx / dist) * stepLen, z: this.pos.z + (dz / dist) * stepLen };
        dt = 0;
      }
    }
  }

  dispose(): void {
    clearInterval(this.ticker);
  }

  // ---------- WorldPort ----------
  isReady(): boolean {
    return true;
  }

  heroCell(): { x: number; z: number } {
    return { x: Math.round(this.pos.x), z: Math.round(this.pos.z) };
  }

  getLayer(): 'surface' | 'cave' {
    return 'surface';
  }

  getPlaces(): { kind: string; x: number; z: number }[] {
    const L = this.layout;
    return [
      { kind: 'portal', x: L.portal.cx, z: L.portal.cz },
      { kind: 'pond', x: Math.round(L.pond.cx), z: Math.round(L.pond.cz) },
      { kind: 'village', x: L.village.x, z: L.village.z },
      { kind: 'guide', x: L.guide.x, z: L.guide.z },
      { kind: 'spawn', x: L.spawn.x, z: L.spawn.z },
    ];
  }

  exportWorld(): WorldManifest {
    const L = this.layout;
    const entity = (id: string, kind: string, category: WorldManifest['entities'][0]['category'], x: number, z: number, alive = false) => ({
      id,
      kind,
      category,
      x,
      z,
      layer: 'surface' as const,
      alive,
      solid: true,
      interactive: kind === 'guide' || kind === 'portal',
      source: 'generated' as const,
    });
    return {
      version: 1,
      seed: this.seed,
      size: N,
      archetype: L.archetype,
      daytime: L.daytimePick,
      weather: L.weatherPick,
      levels: [],
      entities: [
        entity('portal', 'portal', 'portal', L.portal.cx, L.portal.cz),
        entity('pond', 'pond', 'nature', Math.round(L.pond.cx), Math.round(L.pond.cz)),
        entity('guide', 'guide', 'npc', L.guide.x, L.guide.z, true),
      ],
      note: '2D fallback world (WebGL unavailable): terrain simplified, same layout and walking.',
    };
  }

  walkTo(x: number, z: number): Promise<'arrived' | 'blocked' | 'no-path' | 'interrupted'> {
    const from = this.heroCell();
    let target: GridPosition = { x, z };
    if (x === from.x && z === from.z) return Promise.resolve('arrived');
    if (!this.grid.isWalkable(x, z)) {
      const owner = this.grid.occupantAt(x, z);
      const approach = owner ? this.grid.nearestAdjacentWalkable(owner, from) : undefined;
      if (!approach) return Promise.resolve('blocked');
      target = approach;
      if (target.x === from.x && target.z === from.z) return Promise.resolve('arrived');
    }
    const path = findPath(this.grid, from, target);
    if (!path) return Promise.resolve('no-path');
    this.walkResolve?.('interrupted');
    this.walkResolve = null;
    this.path = path.filter((c, i) => !(i === 0 && c.x === from.x && c.z === from.z));
    if (this.path.length === 0) return Promise.resolve('arrived');
    return new Promise((resolve) => {
      this.walkResolve = resolve;
    });
  }

  cellInfo(x: number, z: number): CellInfo {
    if (x < 0 || z < 0 || x >= N || z >= N) return { walkable: false, kind: 'edge' };
    const occupant = this.grid.occupantAt(x, z);
    if (!occupant) return { walkable: true, kind: 'ground' };
    const kind = occupant.startsWith('hedge-')
      ? 'hedge'
      : occupant.startsWith('water-')
        ? 'water'
        : occupant === 'portal'
          ? 'portal'
          : occupant === 'guide'
            ? 'npc'
            : 'object';
    return { walkable: false, kind };
  }
}
